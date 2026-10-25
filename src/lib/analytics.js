// Keep source records intact. An absent pair is unknown, never an inferred zero.
export function analyseGame(raw) {
  const source = raw?.taggers_info?.players_info;
  if (!Array.isArray(source) || !source.length) throw new Error('Нет списка игроков');
  for (const p of source) {
    if (!p || typeof p.Name !== 'string' || !p.Name.trim()) throw new Error('Некорректный позывной игрока');
    if (p.Hits != null && !Array.isArray(p.Hits)) throw new Error('Некорректный список пар');
    for (const key of ['AllHits', 'Wounds']) {
      if (!Number.isFinite(p[key]) || p[key] < 0) throw new Error(`Некорректный показатель ${key}`);
    }
    if (p.AllWounds != null && (!Number.isFinite(p.AllWounds) || p.AllWounds < p.Wounds)) throw new Error('Некорректное общее число ранений');
  }
  const names = source.map(p => p.Name);
  if (new Set(names).size !== names.length) throw new Error('Позывные повторяются: пары неоднозначны');
  const players = source.map(p => ({ ...p, Hits: p.Hits ?? [] }));
  const byName = new Map(players.map(p => [p.Name, p]));
  const issues = [];
  const pairs = [];
  const duels = [];
  for (const p of players) {
    const seen = new Set();
    for (const h of p.Hits) {
      if (!h || typeof h.name !== 'string' || h.name === p.Name || !byName.has(h.name)) throw new Error('Некорректный участник пары');
      if (seen.has(h.name)) throw new Error(`Повтор пары: ${p.Name} → ${h.name}`);
      seen.add(h.name);
      for (const key of ['hitsOut', 'hitsIn']) {
        if (!Number.isFinite(h[key]) || h[key] < 0) throw new Error('Некорректное число попаданий');
      }
      const reverse = byName.get(h.name)?.Hits.find(x => x.name === p.Name);
      if (!reverse || reverse.hitsIn !== h.hitsOut || reverse.hitsOut !== h.hitsIn)
        issues.push(`Не совпадает обратная запись: ${p.Name} → ${h.name}`);
      const pair = { from: p.Name, to: h.name, hits: h.hitsOut, received: h.hitsIn, balance: h.hitsOut - h.hitsIn };
      pairs.push(pair);
      if (p.Name < h.name) duels.push({ ...pair, total: h.hitsOut + h.hitsIn });
    }
    const out = p.Hits.reduce((s, h) => s + h.hitsOut, 0);
    const incoming = p.Hits.reduce((s, h) => s + h.hitsIn, 0);
    if (out !== p.AllHits || incoming !== p.Wounds) issues.push(`Не сходятся итоги: ${p.Name}`);
  }
  return {
    metadata: raw.game_metadata ?? {}, players, pairs, issues,
    duels: duels.sort((a, b) => b.total - a.total),
    totalHits: pairs.reduce((s, p) => s + p.hits, 0),
    unattributed: players.reduce((s, p) => s + (p.AllWounds ?? p.Wounds) - p.Wounds, 0)
  };
}

export function pairFor(game, from, to) {
  return game.pairs.find(p => p.from === from && p.to === to) ?? null;
}

export const playerMetrics = [
  { key: 'AllHits', label: 'Попадания' },
  { key: 'balance', label: 'Баланс' },
  { key: 'Accuracy', label: 'Точность' },
  { key: 'LaserwarRating', label: 'Рейтинг IFLED' },
  { key: 'Fire', label: 'Выстрелы' },
  { key: 'Wounds', label: 'Ранения от игроков' },
  { key: 'AllWounds', label: 'Все ранения' }
];

export function playerValue(player, key) {
  return key === 'balance' ? player.AllHits - player.Wounds : player[key];
}

export function sortPlayers(players, key = 'AllHits', direction = 'desc', query = '') {
  const search = query.trim().toLocaleLowerCase('ru-RU');
  return players.filter(p => p.Name.toLocaleLowerCase('ru-RU').includes(search)).sort((a, b) => {
    const order = key === 'Name' ? a.Name.localeCompare(b.Name, 'ru') : playerValue(a, key) - playerValue(b, key);
    return (direction === 'asc' ? order : -order) || a.Name.localeCompare(b.Name, 'ru');
  });
}

export function playerProfile(game, name) {
  const player = game.players.find(p => p.Name === name);
  if (!player) return null;
  const duels = game.pairs.filter(p => p.from === name).map(p => ({ ...p, total: p.hits + p.received }));
  const metrics = playerMetrics.map(metric => {
    const value = playerValue(player, metric.key);
    const values = game.players.map(p => playerValue(p, metric.key)).filter(Number.isFinite);
    const lowerIsBetter = ['Wounds', 'AllWounds'].includes(metric.key);
    return { ...metric, value, average: values.reduce((sum, n) => sum + n, 0) / values.length,
      rank: Number.isFinite(value) ? 1 + values.filter(n => lowerIsBetter ? n < value : n > value).length : null };
  });
  return { player, metrics, duels,
    ahead: duels.filter(p => p.balance > 0).length,
    tied: duels.filter(p => p.balance === 0).length,
    behind: duels.filter(p => p.balance < 0).length,
    unknown: game.players.length - 1 - duels.length,
    unattributed: (player.AllWounds ?? player.Wounds) - player.Wounds
  };
}
