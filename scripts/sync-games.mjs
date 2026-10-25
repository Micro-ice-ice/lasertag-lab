import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GAME_ID, validateGame, validateCatalog, formatGameDate } from '../src/lib/game-source.js';

const source = 'https://data.ifled.info/games';
const digest = content => createHash('sha256').update(content).digest('hex');

async function readJson(response) {
  if (!response.ok) throw new Error(`IFLED: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new Error('Слишком большой JSON IFLED'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function visibleGames(catalog) {
  if (catalog?.schema_version !== 1 || !Array.isArray(catalog.games)) throw new Error('Неизвестный формат каталога IFLED');
  const ids = new Set();
  return catalog.games.filter(game => {
    if (!game || typeof game.game_id !== 'string' || !GAME_ID.test(game.game_id) || ids.has(game.game_id) ||
      typeof game.visibility?.hidden !== 'boolean' || !/^[a-f0-9]{64}$/.test(game.content_sha256) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(game.game_date) || formatGameDate(game.game_date) === 'Дата не указана' ||
      typeof game.venue_name !== 'string' || !Number.isInteger(game.player_count) || game.player_count < 0)
      throw new Error('Некорректная запись каталога IFLED');
    ids.add(game.game_id);
    return !game.visibility.hidden && game.player_count > 0;
  }).sort((a, b) => b.game_date.localeCompare(a.game_date) || (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? '') || a.game_id.localeCompare(b.game_id));
}

export async function syncGames({ output = fileURLToPath(new URL('../static/data/', import.meta.url)), fetcher = fetch, now = () => new Date(), log = console.log } = {}) {
  const root = resolve(output);
  const gamesDir = resolve(root, 'games');
  const manifestPath = resolve(root, 'catalog.json');
  const request = url => fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  const remote = visibleGames(await readJson(await request(`${source}/index.json`)));
  let previous;
  try { previous = validateCatalog(JSON.parse(await readFile(manifestPath, 'utf8'))); } catch { previous = null; }
  await mkdir(gamesDir, { recursive: true });
  const games = [];
  let downloaded = 0;
  for (const game of remote) {
    const old = previous?.games.find(g => g.game_id === game.game_id && g.source_revision === game.content_sha256);
    let raw, revision;
    if (old) {
      try {
        const content = await readFile(resolve(gamesDir, `${old.game_id}.${old.revision}.json`));
        if (digest(content) !== old.revision) throw new Error('Повреждён локальный файл');
        raw = validateGame(JSON.parse(content.toString('utf8')), game.game_id);
        revision = old.revision;
      } catch { raw = null; }
    }
    if (!raw) {
      let response = await request(`${source}/${game.game_id}/game_info.json`);
      if (response.status === 404) response = await request(`${source}/${game.game_id}/players.json`);
      const value = await readJson(response);
      raw = validateGame({ ...value, game_metadata: {
        game_date: game.game_date, venue_name: game.venue_name, ...value.game_metadata
      } }, game.game_id);
      const content = JSON.stringify(raw) + '\n';
      revision = digest(content);
      await writeFile(resolve(gamesDir, `${game.game_id}.${revision}.json`), content);
      downloaded += 1;
    }
    games.push({ game_id: game.game_id, game_date: game.game_date, venue_name: game.venue_name,
      player_count: raw.taggers_info.players_info.length, uploaded_at: game.uploaded_at,
      source_revision: game.content_sha256, revision });
  }
  const manifest = validateCatalog({ schema_version: 1, synced_at: now().toISOString(), games });
  // Publish the manifest last: a failed fetch never exposes a partial catalog.
  const temp = `${manifestPath}.tmp`;
  await writeFile(temp, JSON.stringify(manifest, null, 2) + '\n');
  await rename(temp, manifestPath);
  const keep = new Set(games.map(g => `${g.game_id}.${g.revision}.json`));
  for (const name of await readdir(gamesDir)) {
    if (/^[A-Za-z0-9_-]{1,64}\.[a-f0-9]{64}\.json$/.test(name) && !keep.has(name)) await unlink(resolve(gamesDir, name));
  }
  log(`Каталог: ${games.length} игр, загружено ${downloaded}, без изменений ${games.length - downloaded}.`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncGames().catch(error => { console.error(`Синхронизация не завершена: ${error.message}`); process.exitCode = 1; });
}
