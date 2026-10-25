<script>
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { createGameClient, DEFAULT_GAME_ID, formatGameDate, parseGameId } from '#lib/game-source.js';

  let { game, onloaded } = $props();
  let input = $state('');
  let loading = $state(false);
  let error = $state('');
  let status = $state('Встроенная игра · доступна без загрузки');
  let recent = $state([]);
  let catalogGames = $state([]);
  let catalogLoading = $state(true);
  let catalogError = $state('');
  let catalogStale = $state(false);
  let syncedAt = $state('');
  let search = $state('');
  let catalogSort = $state('newest');
  let limit = $state(6);
  let catalogController;
  const filtered = $derived(catalogGames.filter(item =>
    `${item.venue_name} ${item.game_id} ${item.game_date} ${item.game_date.split('-').reverse().join('.')} ${formatGameDate(item.game_date)}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU'))
  ).sort((a, b) => catalogSort === 'players' ? b.player_count - a.player_count || b.game_date.localeCompare(a.game_date)
    : catalogSort === 'oldest' ? a.game_date.localeCompare(b.game_date) : b.game_date.localeCompare(a.game_date)));
  let activeId = DEFAULT_GAME_ID;
  let client;
  let controller;
  let request = 0;

  function readUrl() {
    const target = new URL(location.href).searchParams.get('game') ?? DEFAULT_GAME_ID;
    if (loading) {
      controller?.abort();
      request += 1;
      loading = false;
    }
    if (target !== activeId) open(target, { updateUrl: false });
  }
  onMount(() => {
    let storage;
    try { storage = localStorage; } catch { /* The in-memory cache remains available. */ }
    client = createGameClient({ storage, dataBase: `${resolve('/')}data` });
    recent = client.recent();
    let disposed = false;
    const initial = new URL(location.href).searchParams.get('game');
    loadCatalog().then(result => { if (!disposed && result && initial !== null) open(initial, { updateUrl: false }); });
    window.addEventListener('popstate', readUrl);
    return () => { disposed = true; controller?.abort(); catalogController?.abort(); window.removeEventListener('popstate', readUrl); };
  });

  async function loadCatalog() {
    catalogLoading = true;
    catalogError = '';
    catalogController = new AbortController();
    try {
      const result = await client.catalog({ refresh: true, signal: catalogController.signal });
      catalogGames = result.games;
      syncedAt = result.synced_at;
      catalogStale = result.stale;
      recent = client.recent();
      return result;
    } catch (reason) {
      if (!catalogController.signal.aborted) catalogError = `Не удалось загрузить каталог. ${reason.message}`;
      return null;
    } finally { catalogLoading = false; }
  }

  async function open(value, { refresh = false, updateUrl = true } = {}) {
    let id;
    try { id = parseGameId(value); }
    catch (reason) { error = reason.message; return; }
    const currentRequest = ++request;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    error = '';
    try {
      const result = await client.load(id, { refresh, signal: controller.signal });
      if (currentRequest !== request) return;
      if (updateUrl) {
        const url = new URL(location.href);
        url.searchParams.set('game', id);
        if (id !== activeId) url.hash = '';
        if (url.href !== location.href) history.pushState(history.state, '', url);
      }
      activeId = id;
      onloaded(result);
      input = id;
      recent = client.recent();
      const time = new Date(result.syncedAt).toLocaleString('ru-RU');
      status = `${result.source === 'browser-cache' ? 'Игра из кэша браузера' : 'Игра загружена'} · копия IFLED от ${time}${result.stale ? ' · нет связи, используется сохранённый каталог' : ''}`;
    } catch (reason) {
      if (currentRequest === request && !controller.signal.aborted) error = reason.message;
    } finally { if (currentRequest === request) loading = false; }
  }
</script>

<section class="panel game-loader" aria-labelledby="load-title" aria-busy={loading || catalogLoading}>
  <div class="section-head"><div><p class="eyebrow">Выбрать игру</p><h2 id="load-title">Каталог игр IFLED</h2></div><button class="action-button" disabled={catalogLoading || loading} onclick={loadCatalog}>{catalogLoading ? 'Загружаем список…' : 'Обновить список'}</button></div>
  <p class="profile-hint subtle">{syncedAt ? `Синхронизировано с IFLED: ${new Date(syncedAt).toLocaleString('ru-RU')}.` : 'Загружаем каталог игр.'} Автоматическая проверка новых игр — каждые 30 минут. «Обновить список» проверяет последнюю опубликованную копию.</p>
  {#if catalogStale}<p class="load-error" role="status">Нет связи. Показан сохранённый каталог; ранее открытые игры доступны из кэша.</p>{/if}
  {#if catalogError}<p class="load-error" role="alert">{catalogError}</p>{/if}
  <div class="toolbar"><label class="search-field">Поиск игры<input type="search" bind:value={search} oninput={() => limit = 6} placeholder="Дата, площадка или ID" /></label><label>Порядок игр<select bind:value={catalogSort} onchange={() => limit = 6}><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="players">Больше игроков</option></select></label></div>
  <p class="profile-hint subtle" role="status">Найдено игр: {filtered.length} из {catalogGames.length}{loading ? ' · загружаем выбранную игру…' : ''}</p>
  <div class="game-catalog-list">
    {#each filtered.slice(0, limit) as item}<button class="catalog-card" class:current-game={item.game_id === game.metadata.game_id} aria-pressed={item.game_id === game.metadata.game_id} disabled={loading || catalogLoading} onclick={() => open(item.game_id)}><span class="catalog-date">{formatGameDate(item.game_date)}</span><span class="catalog-venue">{item.venue_name}</span><span class="catalog-meta">{item.player_count} игроков · {item.game_id} <span>{item.game_id === game.metadata.game_id ? 'Открыта ✓' : 'Открыть ↗'}</span></span></button>{/each}
  </div>
  {#if !filtered.length && !catalogLoading && !catalogError}<p class="empty-state">{catalogGames.length ? 'По вашему запросу игр не найдено.' : 'В каталоге пока нет игр.'}</p>{/if}
  {#if filtered.length > limit}<button class="action-button show-games" onclick={() => limit += 12}>Показать ещё · осталось {filtered.length - limit}</button>{/if}
  <details class="manual-game"><summary>Открыть по ссылке или ID</summary><form class="toolbar" onsubmit={event => { event.preventDefault(); open(input); }}>
    <label class="search-field" for="game-input">Ссылка на игру или ID<input id="game-input" bind:value={input} placeholder="https://beta.ifled.info/games/… или ID" required maxlength="500" autocomplete="off" spellcheck="false" /></label>
    <button class="action-button primary-button" type="submit" disabled={loading}> {loading ? 'Загружаем…' : 'Открыть игру'} </button>
  </form></details>
  <p class="load-status" role="status">{loading ? 'Загружаем данные. Пока ниже показана предыдущая игра.' : status}</p>
  {#if error}<p class="load-error" role="alert">{error} Ниже остаётся игра {game.metadata.game_id}.</p>{/if}
  <p class="profile-hint subtle">Данные выбранной игры загружаются по нажатию. Последние восемь открытых игр сохраняются в этом браузере. Новые игры появляются после синхронизации и публикации сайта.</p>
  {#if recent.length}<div class="recent-games"><span class="subtle">Недавно открытые</span>{#each recent as item}<button class="action-button" class:current-game={item.id === game.metadata.game_id} aria-pressed={item.id === game.metadata.game_id} disabled={loading} onclick={() => open(item.id)}>{formatGameDate(item.metadata.game_date)} · {item.id}</button>{/each}</div>{/if}
</section>
