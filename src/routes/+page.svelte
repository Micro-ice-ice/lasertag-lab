<script>
  import { resolve } from '$app/paths';
  import initialRaw from '#lib/data/aZ0dpB6H.json';
  import { formatGameDate } from '#lib/game-source.js';
  import GameLoader from '#lib/components/GameLoader.svelte';
  import { analyseGame, playerMetrics, sortPlayers } from '#lib/analytics.js';
  import HitMatrix from '#lib/components/HitMatrix.svelte';
  import PlayerExplorer from '#lib/components/PlayerExplorer.svelte';
  import './style.css';
  let raw = $state(initialRaw);
  let version = $state(0);
  const game = $derived(analyseGame(raw));
  const date = $derived(formatGameDate(game.metadata.game_date));
  const downloadUrl = $derived(`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(raw, null, 2))}`);
  function loaded(result) {
    raw = result.raw;
    version += 1;
    rankingQuery = '';
    duelLimit = '6';
  }
  let rankingSort = $state('AllHits');
  let rankingDirection = $state('desc');
  let rankingQuery = $state('');
  let duelSort = $state('total');
  let duelLimit = $state('6');
  const leaders = $derived(sortPlayers(game.players, rankingSort, rankingDirection, rankingQuery));
  const duels = $derived([...game.duels].sort((a, b) => duelSort === 'gap' ? Math.abs(b.balance) - Math.abs(a.balance) || b.total - a.total : b.total - a.total).slice(0, Number(duelLimit)));
  const maxHits = $derived(Math.max(1, ...game.players.map(p => Math.max(p.AllHits,p.Wounds))));
  const number = n => n.toLocaleString('ru-RU');
</script>

<svelte:head>
  <title>Lasertag Lab — {game.metadata.game_id} · {date}</title>
  <meta name="description" content="Разбор игр IFLED: карта попаданий, баланс дуэлей и личная статистика игроков. Откройте игру по ссылке или ID." />
</svelte:head>

<div class="app-shell">
  <header class="topbar"><a class="brand" href={resolve('/')}><span class="brand-mark">↗</span>LASERTAG <span class="subtle">/ LAB</span></a><a class="source-link" href="#players">Найти свой профиль ↗</a></header>
  <main>
    <section class="hero">
      <p class="eyebrow"><span class="live-dot"></span> Разбор игры / {game.metadata.game_id}</p>
      <h1>Каждое попадание.<br /><span>Каждое противостояние.</span></h1>
      <div class="hero-bottom"><div><p class="game-date">{date}</p><p class="subtle">{game.metadata.venue_name}</p></div><a class="source-link" href={`https://beta.ifled.info/games/${game.metadata.game_id}`} target="_blank" rel="noreferrer">Открыть на IFLED ↗</a></div>
    </section>
    <GameLoader {game} onloaded={loaded} />
    <div class="stats"><div><span>Игроков</span><strong>{game.players.length}</strong></div><div><span>Попаданий в карте</span><strong>{number(game.totalHits)}</strong></div><div><span>Пар с записью</span><strong>{game.duels.length}</strong></div><div><span>Без указанного стрелявшего*</span><strong>{number(game.unattributed)}</strong></div></div>
    {#key version}<PlayerExplorer {game} /><HitMatrix {game} />{/key}
    <div class="lower-grid">
      <section class="panel" aria-labelledby="ranking-title">
        <p class="eyebrow">02 / Игроки</p><h2 id="ranking-title">Нанёс и получил</h2>
        <div class="matrix-legend"><span><i class="swatch positive"></i>Попадания</span><span><i class="swatch negative"></i>Ранения от известных игроков</span></div>
        <div class="toolbar"><label class="search-field">Поиск<input type="search" bind:value={rankingQuery} placeholder="Позывной" /></label><label>Сортировать по<select bind:value={rankingSort}><option value="Name">Позывной</option>{#each playerMetrics as m}<option value={m.key}>{m.label}</option>{/each}</select></label><label>Порядок<select bind:value={rankingDirection}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></label></div>
        <div class="ranking">
          {#each leaders as p, i}
            <div class="ranking-row"><span class="rank">{String(i+1).padStart(2,'0')}</span><a class="player-link" href={`#${new URLSearchParams({player:p.Name})}`}>{p.Name}</a><div class="bars" role="img" aria-label={`${p.Name}: нанёс ${p.AllHits}, получил ${p.Wounds}`}><div class="bar mint" style:width={`${p.AllHits/maxHits*100}%`}></div><div class="bar coral" style:width={`${p.Wounds/maxHits*100}%`}></div></div><span class="score">{p.AllHits}<span class="subtle"> / {p.Wounds}</span></span></div>
          {/each}
        </div>
        {#if !leaders.length}<p class="empty-state" role="status">Игрок не найден.</p>{/if}
      </section>
      <div class="side-stack">
        <section class="panel" aria-labelledby="duel-title"><p class="eyebrow">03 / Плотность игры</p><h2 id="duel-title">Самые активные дуэли</h2><p class="subtle">Сумма попаданий в обе стороны.</p>
          <div class="toolbar"><label>Сортировать по<select bind:value={duelSort}><option value="total">Активность пары</option><option value="gap">Разрыв попаданий</option></select></label><label>Показать<select bind:value={duelLimit}><option value="6">Топ-6</option><option value="12">Топ-12</option><option value={String(game.duels.length)}>Все пары</option></select></label></div>
          <ol class="duels">{#each duels as duel}<li><div><span><a class="player-link" href={`#${new URLSearchParams({player:duel.from})}`}>{duel.from}</a> <span class="subtle">↔</span> <a class="player-link" href={`#${new URLSearchParams({player:duel.to})}`}>{duel.to}</a></span><small>{duel.hits} : {duel.received} · разрыв {Math.abs(duel.balance)}</small></div><strong>{duel.total}</strong></li>{/each}</ol>
        </section>
        <section class="panel notes"><p class="eyebrow">О данных</p><h2>Что видит карта</h2><p>Попадания между игроками за всю игру. Времени событий и границ раундов в этой визуализации нет.</p><p>* Разница между AllWounds и Wounds — {number(game.unattributed)}. В записях пар эти дополнительные ранения не распределены по стрелявшим.</p><p>Цвет команды не используется для разделения: история смены составов неизвестна. Пропущенная пара обозначена тире, а не нулём.</p><p class="validation">{game.issues.length ? `Обнаружено расхождений: ${game.issues.length}` : '✓ Пары и итоги игроков согласованы'}</p><a class="source-link" href={downloadUrl} download={`${game.metadata.game_id}.json`}>Скачать JSON этой игры ↓</a></section>
      </div>
    </div>
  </main>
  <footer><span>LASERTAG / LAB</span><span>Источник: IFLED · Игра {game.metadata.game_id}</span></footer>
</div>
