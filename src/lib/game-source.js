import { analyseGame } from './analytics.js';

export const DEFAULT_GAME_ID = 'aZ0dpB6H';
export const CACHE_TTL = 15 * 60 * 1000;
export const GAME_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseGameId(input) {
  const value = input.trim();
  if (GAME_ID.test(value)) return value;
  try {
    const url = new URL(value);
    const match = /^\/games\/([A-Za-z0-9_-]{1,64})(?:\/game_info\.json|\/players\.json|\/)?$/.exec(url.pathname);
    if (['https:', 'http:'].includes(url.protocol) &&
      ['ifled.info', 'www.ifled.info', 'beta.ifled.info', 'data.ifled.info'].includes(url.hostname) && match) return match[1];
  } catch { /* Fall through to a useful validation message. */ }
  throw new Error('Введите ID игры или ссылку вида https://beta.ifled.info/games/ID');
}

export function validateGame(raw, id) {
  if (raw?.game_metadata?.game_id && raw.game_metadata.game_id !== id) throw new Error('ID в данных не совпадает с запрошенной игрой');
  analyseGame(raw);
  return { ...raw, game_metadata: { ...raw.game_metadata, game_id: id,
    venue_name: raw.game_metadata?.venue_name ?? raw.taggers_info?.venue_name ?? 'Площадка не указана' } };
}

export function formatGameDate(value) {
  if (typeof value !== 'string') return 'Дата не указана';
  const local = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!local && !iso) return value;
  const [day, month, year] = local ? local.slice(1) : [iso[3], iso[2], iso[1]];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCDate() !== Number(day) || date.getUTCMonth() !== Number(month) - 1) return 'Дата не указана';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(' г.', '');
}

export function validateCatalog(value) {
  if (value?.schema_version !== 1 || !Number.isFinite(Date.parse(value.synced_at)) || !Array.isArray(value.games))
    throw new Error('Некорректный каталог игр');
  const ids = new Set();
  for (const game of value.games) {
    if (!game || typeof game.game_id !== 'string' || !GAME_ID.test(game.game_id) || ids.has(game.game_id) || !/^[a-f0-9]{64}$/.test(game.revision) ||
      typeof game.venue_name !== 'string' || !Number.isInteger(game.player_count) || game.player_count < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(game.game_date) || formatGameDate(game.game_date) === 'Дата не указана')
      throw new Error('Некорректная запись в каталоге игр');
    ids.add(game.game_id);
  }
  return value;
}

// Catalog and selected games come from this site's static files, never a runtime API.
export function createGameClient({ fetcher = fetch, storage, now = Date.now, dataBase = '/data' } = {}) {
  const key = 'lasertag-static-games-v1';
  let entries = {};
  let savedCatalog = null;
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? '{}');
    if (saved?.entries && typeof saved.entries === 'object' && !Array.isArray(saved.entries)) entries = saved.entries;
    if (saved?.catalog && Number.isFinite(saved.catalog.checkedAt)) {
      validateCatalog(saved.catalog.snapshot);
      savedCatalog = saved.catalog;
    }
  } catch { /* Disabled or corrupt storage does not block online loading. */ }
  function persist() {
    try { storage?.setItem(key, JSON.stringify({ entries, catalog: savedCatalog })); } catch { /* Keep memory cache. */ }
  }
  function cached(id, revision) {
    try {
      const item = entries[id];
      if (!item || !/^[a-f0-9]{64}$/.test(revision) || item.revision !== revision) return null;
      return { ...item, raw: validateGame(item.raw, id) };
    } catch { return null; }
  }
  async function catalog({ refresh = false, signal } = {}) {
    if (!refresh && savedCatalog && now() - savedCatalog.checkedAt < CACHE_TTL)
      return { ...savedCatalog.snapshot, stale: false };
    try {
      const response = await fetcher(`${dataBase}/catalog.json`, { signal, cache: 'no-cache' });
      if (!response.ok) throw new Error('Не удалось загрузить список игр. Попробуйте обновить страницу.');
      const snapshot = validateCatalog(await response.json());
      savedCatalog = { snapshot, checkedAt: now() };
      // Removed/hidden games cannot be reopened from a previous browser cache.
      entries = Object.fromEntries(Object.entries(entries).filter(([id, item]) => snapshot.games.some(g => g.game_id === id && g.revision === item.revision)));
      persist();
      return { ...snapshot, stale: false };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (savedCatalog) return { ...savedCatalog.snapshot, stale: true };
      throw error;
    }
  }
  return {
    catalog,
    recent() {
      return Object.entries(entries).filter(([id, item]) => cached(id, item?.revision))
        .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
        .map(([id, item]) => ({ id, metadata: item.raw.game_metadata }));
    },
    async load(input, { refresh = false, signal } = {}) {
      const id = parseGameId(input);
      const index = await catalog({ refresh, signal });
      const item = index.games.find(g => g.game_id === id);
      if (!item) throw new Error('Этой игры пока нет в копии каталога. Проверьте ID; новая игра появится после следующей синхронизации.');
      const previous = cached(id, item.revision);
      if (!refresh && previous) return { ...previous, source: 'browser-cache', stale: index.stale, syncedAt: index.synced_at };
      try {
        const response = await fetcher(`${dataBase}/games/${id}.${item.revision}.json`, { signal, cache: refresh ? 'reload' : 'default' });
        if (!response.ok) throw new Error('Файл игры недоступен. Обновите список игр и повторите открытие.');
        let raw;
        try { raw = validateGame(await response.json(), id); }
        catch (error) { throw Object.assign(error, { invalidData: true }); }
        const entry = { raw, revision: item.revision, fetchedAt: now() };
        entries = Object.fromEntries(Object.entries({ ...entries, [id]: entry }).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, 8));
        persist();
        return { ...entry, source: 'snapshot', stale: index.stale, syncedAt: index.synced_at };
      } catch (error) {
        if (signal?.aborted || error.invalidData) throw error;
        if (previous) return { ...previous, source: 'browser-cache', stale: true, syncedAt: index.synced_at };
        if (error instanceof TypeError) throw new Error('Нет подключения. Эту игру нужно хотя бы один раз открыть онлайн.');
        throw error;
      }
    }
  };
}
