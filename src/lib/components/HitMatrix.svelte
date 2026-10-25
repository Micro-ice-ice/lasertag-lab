<script>
  import { pairFor, playerMetrics, sortPlayers } from '#lib/analytics.js';
  let { game } = $props();
  let mode = $state('hits');
  let selected = $state(null);
  let sort = $state('AllHits');
  let direction = $state('desc');
  const players = $derived(sortPlayers(game.players, sort, direction));
  const maximum = $derived(Math.max(1, ...game.pairs.map(p => mode === 'hits' ? p.hits : Math.abs(p.balance))));
  const current = $derived(selected ? pairFor(game, selected.from, selected.to) : game.pairs.reduce((a,b) => !a || b.hits > a.hits ? b : a, null));
  function fill(pair) {
    if (!pair) return 'transparent';
    const value = mode === 'hits' ? pair.hits : pair.balance;
    const color = mode === 'hits' || value > 0 ? 'var(--mint)' : value < 0 ? 'var(--coral)' : 'var(--line)';
    return `color-mix(in srgb, ${color} ${8 + Math.abs(value) / maximum * 68}%, transparent)`;
  }
</script>

<section class="panel matrix-panel" aria-labelledby="matrix-title">
  <div class="section-head">
    <div><p class="eyebrow">01 / Взаимодействия</p><h2 id="matrix-title">{mode === 'hits' ? 'Карта попаданий' : 'Баланс дуэлей'}</h2></div>
    <div class="segments" aria-label="Показатель карты">
      <button class:active={mode === 'hits'} aria-pressed={mode === 'hits'} onclick={() => mode = 'hits'}>Попадания</button>
      <button class:active={mode === 'balance'} aria-pressed={mode === 'balance'} onclick={() => mode = 'balance'}>Баланс</button>
    </div>
  </div>
  <p class="subtle">Строка — кто стрелял. Столбец — в кого попал. Выберите ячейку для сравнения.</p>
  <div class="toolbar"><label>Порядок игроков<select bind:value={sort}><option value="Name">Позывной</option>{#each playerMetrics as m}<option value={m.key}>{m.label}</option>{/each}</select></label><label>Направление<select bind:value={direction}><option value="desc">По убыванию</option><option value="asc">По возрастанию</option></select></label></div>
  {#if current}
    <div class="pair-detail" aria-live="polite">
      <span><a class="player-link" href={`#${new URLSearchParams({player:current.from})}`}>{current.from} ↗</a> <span class="arrow">→</span> <a class="player-link" href={`#${new URLSearchParams({player:current.to})}`}>{current.to} ↗</a></span>
      <span><strong>{current.hits}</strong> попаданий <span class="subtle">/ в ответ {current.received}</span></span>
      <span class="balance">Баланс {current.balance > 0 ? '+' : ''}{current.balance}</span>
    </div>
  {/if}
  <div class="matrix-scroll" role="region" aria-label="Матрица попаданий с горизонтальной прокруткой">
    <table class="matrix">
      <thead><tr><th class="corner">Кто ↓ / в кого →</th>{#each players as p}<th scope="col"><span class="column-name">{p.Name}</span></th>{/each}</tr></thead>
      <tbody>
        {#each players as p}
          <tr><th scope="row"><a class="player-link" href={`#${new URLSearchParams({player:p.Name})}`}>{p.Name}</a></th>
            {#each players as q}
              {@const pair = pairFor(game, p.Name, q.Name)}
              <td>
                {#if p.Name === q.Name}<span class="empty">×</span>
                {:else if pair}
                  <button style:background={fill(pair)} class:chosen={current?.from === p.Name && current?.to === q.Name}
                    aria-label={`${p.Name} → ${q.Name}: ${pair.hits}, в ответ ${pair.received}, баланс ${pair.balance}`}
                    aria-pressed={current?.from === p.Name && current?.to === q.Name}
                    onclick={() => selected = {from:p.Name,to:q.Name}}>
                    {mode === 'hits' ? pair.hits : (pair.balance > 0 ? '+' : '') + pair.balance}
                  </button>
                {:else}<span class="empty" title="Нет записи пары">—</span>{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="matrix-legend"><span><i class="swatch positive"></i>{mode === 'hits' ? 'Больше попаданий' : 'Преимущество строки'}</span>{#if mode === 'balance'}<span><i class="swatch negative"></i>Преимущество столбца</span>{/if}<span>— нет записи · × тот же игрок</span></div>
</section>
