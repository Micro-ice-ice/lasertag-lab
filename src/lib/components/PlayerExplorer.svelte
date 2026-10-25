<script>
  import { onMount } from 'svelte';
  import { playerMetrics, playerProfile, playerValue, sortPlayers } from '#lib/analytics.js';
  import { formatGameDate } from '#lib/game-source.js';
  let { game } = $props();
  let selected = $state('');
  let mine = $state('');
  let query = $state('');
  let sort = $state('AllHits');
  let direction = $state('desc');
  let opponentQuery = $state('');
  let duelSort = $state('total');
  let duelDirection = $state('desc');
  let filter = $state('all');
  let copyStatus = $state('');
  const players = $derived(sortPlayers(game.players, sort, direction, query));
  const profile = $derived(playerProfile(game, selected));
  const opponents = $derived((profile?.duels ?? []).filter(p =>
    p.to.toLocaleLowerCase('ru-RU').includes(opponentQuery.trim().toLocaleLowerCase('ru-RU')) &&
    (filter === 'all' || (filter === 'ahead' && p.balance > 0) || (filter === 'behind' && p.balance < 0) || (filter === 'tied' && p.balance === 0))
  ).sort((a, b) => {
    const order = duelSort === 'to' ? a.to.localeCompare(b.to, 'ru') : a[duelSort] - b[duelSort];
    return (duelDirection === 'asc' ? order : -order) || a.to.localeCompare(b.to, 'ru');
  }));
  const format = (n, key = '') => !Number.isFinite(n) ? '—' : key === 'Accuracy'
    ? `${(n * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
    : `${key === 'balance' && n > 0 ? '+' : ''}${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}`;

  function readHash() {
    const name = new URLSearchParams(location.hash.slice(1)).get('player');
    if (name === null) return;
    opponentQuery = '';
    filter = 'all';
    copyStatus = '';
    selected = game.players.some(p => p.Name === name) ? name : '';
    if (selected) document.getElementById('player-profile')?.scrollIntoView({ block: 'start' });
  }
  onMount(() => {
    try { mine = localStorage.getItem('lasertag-player') ?? ''; } catch { /* Storage can be disabled. */ }
    if (!game.players.some(p => p.Name === mine)) mine = '';
    readHash();
    if (!selected && mine) selected = mine;
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  });
  function openPlayer(name) {
    selected = name;
    opponentQuery = '';
    filter = 'all';
    copyStatus = '';
    const url = new URL(location.href);
    url.searchParams.set('game', game.metadata.game_id);
    url.hash = new URLSearchParams({ player: name }).toString();
    history.pushState(history.state, '', url);
    document.getElementById('player-profile')?.scrollIntoView({ block: 'start' });
  }
  function remember() {
    mine = mine === selected ? '' : selected;
    try {
      if (mine) localStorage.setItem('lasertag-player', mine);
      else localStorage.removeItem('lasertag-player');
    } catch { /* Profile remains usable without persistence. */ }
  }
  async function copyLink() {
    const url = new URL(location.href);
    url.searchParams.set('game', game.metadata.game_id);
    url.hash = new URLSearchParams({ player: selected }).toString();
    try { await navigator.clipboard.writeText(url.toString()); copyStatus = 'Ссылка скопирована'; }
    catch { copyStatus = 'Скопируйте ссылку из адресной строки'; history.replaceState(history.state, '', url); }
  }
</script>

<section class="panel explorer" id="players" aria-labelledby="players-title">
  <div class="section-head"><div><p class="eyebrow">Личный разбор / {formatGameDate(game.metadata.game_date)}</p><h2 id="players-title">Найди себя в игре</h2></div>
    {#if mine}<button class="action-button" onclick={() => openPlayer(mine)}>Мой профиль · {mine} ↗</button>{/if}
  </div>
  <p class="subtle">Выберите позывной: показатели, место в игре и каждое противостояние.</p>
  <div class="toolbar">
    <label class="search-field">Поиск игрока<input type="search" bind:value={query} placeholder="Ваш позывной" /></label>
    <label>Сортировать по<select bind:value={sort}><option value="Name">Позывной</option>{#each playerMetrics as m}<option value={m.key}>{m.label}</option>{/each}</select></label>
    <label>Порядок<select bind:value={direction}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></label>
    <button class="text-button" onclick={() => { query = ''; sort = 'AllHits'; direction = 'desc'; }}>Сбросить</button>
  </div>
  <div class="player-picker" aria-label="Выбор игрока">
    {#each players as p}<button id={`player=${p.Name}`} class:active={selected === p.Name} aria-pressed={selected === p.Name} onclick={() => openPlayer(p.Name)}><span>{p.Name}{mine === p.Name ? ' · я' : ''}</span><small>{sort === 'Name' ? `${format(p.AllHits)} поп.` : format(playerValue(p, sort), sort)}</small></button>{/each}
  </div>
  {#if !players.length}<p class="empty-state" role="status">Игрок не найден. Попробуйте другой позывной или сбросьте поиск.</p>{/if}

  <div id="player-profile" class="profile-anchor">
    {#if profile}
      <div class="profile-heading section-head"><div><p class="eyebrow">Профиль игрока / Эта игра</p><h2 class="profile-name">{profile.player.Name}</h2></div><div class="profile-actions"><button class="action-button" aria-pressed={mine === selected} onclick={remember}>{mine === selected ? '✓ Это мой профиль' : 'Это я · запомнить'}</button><button class="action-button" onclick={copyLink}>Поделиться ↗</button></div></div>
      <p class="subtle profile-hint">Выбор «Это я» сохраняется в этом браузере. Профили доступны всем по ссылке.</p>
      <p class="copy-status" role="status">{copyStatus}</p>
      <div class="profile-metrics">
        {#each profile.metrics as metric}<div class="metric-card"><span>{metric.label}</span><strong class:mint-text={metric.key === 'balance' && metric.value > 0} class:coral-text={metric.key === 'balance' && metric.value < 0}>{format(metric.value, metric.key)}</strong><small>Среднее: {format(metric.average, metric.key)}</small><small>{metric.rank === null ? 'Нет данных' : `Место ${metric.rank} из ${game.players.length}`}{['Wounds', 'AllWounds'].includes(metric.key) ? ' · меньше — выше' : ''}</small></div>{/each}
      </div>
      <p class="profile-hint subtle">Баланс = попадания − ранения от игроков. При равном результате место одинаковое. Место по выстрелам показывает объём стрельбы. Рейтинг и точность взяты из IFLED.</p>
      <div class="duel-summary"><span><strong class="mint-text">{profile.ahead}</strong> с преимуществом</span><span><strong>{profile.tied}</strong> на равных</span><span><strong class="coral-text">{profile.behind}</strong> с отставанием</span><span><strong>{profile.unknown}</strong> без записи пары</span></div>
      <p class="profile-hint subtle">Ещё {format(profile.unattributed)} ранений не распределены по стрелявшим; они входят во «Все ранения» и не включены в баланс дуэлей. Преимущество в попаданиях не означает победу в раунде.</p>
      <h3>Противостояния игрока</h3>
      <div class="toolbar">
        <label class="search-field">Поиск участника<input type="search" bind:value={opponentQuery} placeholder="Позывной в паре" /></label>
        <label>Показать<select bind:value={filter}><option value="all">Все пары</option><option value="ahead">С преимуществом</option><option value="behind">С отставанием</option><option value="tied">На равных</option></select></label>
        <label>Сортировать по<select bind:value={duelSort}><option value="total">Активность пары</option><option value="hits">Нанесённые попадания</option><option value="received">Полученные попадания</option><option value="balance">Баланс</option><option value="to">Позывной</option></select></label>
        <label>Порядок<select bind:value={duelDirection}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></label>
      </div>
      <div class="table-scroll" role="region" aria-label="Противостояния с горизонтальной прокруткой"><table class="profile-table"><caption>Показано пар: {opponents.length} из {profile.duels.length}. Все числа — с точки зрения {selected}.</caption><thead><tr><th scope="col">Участник</th><th scope="col">Нанёс</th><th scope="col">Получил</th><th scope="col">Баланс</th><th scope="col">Всего</th></tr></thead><tbody>{#each opponents as duel}<tr><th scope="row"><button class="player-link" onclick={() => openPlayer(duel.to)}>{duel.to} ↗</button></th><td>{duel.hits}</td><td>{duel.received}</td><td class:mint-text={duel.balance > 0} class:coral-text={duel.balance < 0}>{format(duel.balance, 'balance')}</td><td>{duel.total}</td></tr>{/each}</tbody></table></div>
      {#if !opponents.length}<p class="empty-state" role="status">Нет пар по выбранным условиям.</p>{/if}
    {:else}<div class="empty-state">Выберите свой позывной выше, чтобы открыть личный разбор.</div>{/if}
  </div>
</section>
