import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyseGame, pairFor, playerProfile, sortPlayers, sortDuels, labRatingFor } from '../src/lib/analytics.js';

const raw = JSON.parse(readFileSync(new URL('../src/lib/data/aZ0dpB6H.json', import.meta.url), 'utf8'));
test('Real game reconciles every pair and player total', () => {
  const game = analyseGame(raw);
  assert.deepEqual(game.issues, []);
  assert.equal(game.totalHits, 5993);
  assert.equal(game.unattributed, 854);
  assert.equal(game.duels.length * 2, game.pairs.length);
  assert.equal(pairFor(game, 'ИФЛЕД', 'Рыжая').hits, 76);
  assert.equal(pairFor(game, 'Рыжая', 'ИФЛЕД').received, 76);
});
test('Missing pairs remain unknown, and inconsistent records are reported', () => {
  const modified = structuredClone(raw);
  modified.taggers_info.players_info[0].Hits[0].hitsOut += 1;
  const game = analyseGame(modified);
  assert.ok(game.issues.length > 0);
  assert.equal(pairFor(game, 'нет игрока', 'Рыжая'), null);
});

test('Profiles reconcile personal duels and preserve unknown pairs', () => {
  const game = analyseGame(raw);
  for (const player of game.players) {
    const profile = playerProfile(game, player.Name);
    assert.equal(profile.duels.reduce((sum, p) => sum + p.hits, 0), player.AllHits);
    assert.equal(profile.duels.reduce((sum, p) => sum + p.received, 0), player.Wounds);
    assert.equal(profile.ahead + profile.tied + profile.behind + profile.unknown, game.players.length - 1);
    assert.equal(profile.unattributed, player.AllWounds - player.Wounds);
  }
  const ifled = playerProfile(game, 'ИФЛЕД');
  assert.equal(ifled.metrics.find(m => m.key === 'AllHits').rank, 1);
  assert.equal(ifled.metrics.find(m => m.key === 'balance').value, 205);
  assert.equal(ifled.duels.find(p => p.to === 'Рыжая').balance, 37);
  assert.ok(ifled.unknown > 0);
  assert.equal(playerProfile(game, 'неизвестный'), null);
});

test('Ranks share ties and fewer wounds rank higher', () => {
  const game = analyseGame(raw);
  assert.equal(playerProfile(game, 'Эйлис').metrics.find(m => m.key === 'Wounds').rank, 1);
  assert.equal(playerProfile(game, 'Папс').metrics.find(m => m.key === 'AllHits').rank,
    playerProfile(game, 'Рыжая').metrics.find(m => m.key === 'AllHits').rank);
  assert.equal(playerProfile(game, 'Эйлис').metrics.find(m => m.key === 'Accuracy').value,
    raw.taggers_info.players_info.find(p => p.Name === 'Эйлис').Accuracy);
});

test('Sorting supports both directions, balance and case-insensitive trimmed search without mutating data', () => {
  const game = analyseGame(raw);
  const before = game.players.map(p => p.Name);
  assert.equal(sortPlayers(game.players)[0].Name, 'ИФЛЕД');
  assert.equal(sortPlayers(game.players, 'AllHits', 'asc')[0].Name, 'Электро');
  assert.equal(sortPlayers(game.players, 'Accuracy')[0].Name, 'Эйлис');
  assert.equal(sortPlayers(game.players, 'AllHits', 'desc', '  ифЛЕд  ')[0].Name, 'ИФЛЕД');
  assert.equal(sortPlayers(game.players, 'Name', 'asc', 'несуществующий').length, 0);
  const balanced = sortPlayers(game.players, 'balance');
  assert.ok(balanced.every((p, i) => !i || balanced[i-1].AllHits - balanced[i-1].Wounds >= p.AllHits - p.Wounds));
  const alphabetic = sortPlayers(game.players, 'Name', 'asc');
  assert.ok(alphabetic.every((p, i) => !i || alphabetic[i-1].Name.localeCompare(p.Name, 'ru') <= 0));
  assert.deepEqual(game.players.map(p => p.Name), before);
});

test('Duel columns sort numerically in both directions, use Russian name ordering and preserve input', () => {
  const rows = [
    { to: 'Я', hits: 2, received: 40, balance: -38, total: 42 },
    { to: 'А', hits: 12, received: 0, balance: 12, total: 12 },
    { to: 'Б', hits: 0, received: 2, balance: -2, total: 2 }
  ];
  const before = structuredClone(rows);
  assert.deepEqual(sortDuels(rows, 'hits', 'desc').map(p => p.hits), [12, 2, 0]);
  assert.deepEqual(sortDuels(rows, 'hits', 'asc').map(p => p.hits), [0, 2, 12]);
  assert.deepEqual(sortDuels(rows, 'balance', 'asc').map(p => p.balance), [-38, -2, 12]);
  assert.deepEqual(sortDuels(rows, 'received', 'desc').map(p => p.received), [40, 2, 0]);
  assert.deepEqual(sortDuels(rows, 'total', 'desc').map(p => p.total), [42, 12, 2]);
  assert.deepEqual(sortDuels(rows, 'to', 'asc').map(p => p.to), ['А', 'Б', 'Я']);
  assert.deepEqual(rows, before);
});

test('Lab rating is neutral for balanced average participation; absent exchanges have no score', () => {
  assert.equal(labRatingFor({ Hits: [{ hitsOut: 10, hitsIn: 10 }, { hitsOut: 10, hitsIn: 10 }] }, 20).score, 50);
  assert.equal(labRatingFor({ Hits: [] }, 0).score, null);
  assert.equal(labRatingFor({ Hits: [{ hitsOut: 0, hitsIn: 0 }] }, 20).score, null);
  assert.ok(labRatingFor({ Hits: [{ hitsOut: 1, hitsIn: 0 }] }, 250).score < 50);
});

test('Lab rewards hits, penalizes received hits, ignores zero-only pairs and stays bounded', () => {
  const score = (out, incoming) => labRatingFor({ Hits: [{ hitsOut: out, hitsIn: incoming }] }, 100).score;
  assert.ok(score(200, 100) > score(100, 100));
  assert.ok(score(100, 200) < score(100, 100));
  for (const [out, incoming] of [[0, 100], [10000, 0], [5, 9000], [100, 100]]) {
    assert.ok(score(out, incoming) >= 0 && score(out, incoming) <= 100);
  }
  const active = { hitsOut: 100, hitsIn: 50 };
  assert.equal(labRatingFor({ Hits: [active] }, 100).score,
    labRatingFor({ Hits: [active, { hitsOut: 0, hitsIn: 0 }] }, 100).score);
});

test('Accuracy, shots, external rating and unattributed wounds cannot change Lab rating', () => {
  const original = analyseGame(raw);
  const changed = structuredClone(raw);
  for (const p of changed.taggers_info.players_info) {
    p.Accuracy = 1; p.Fire = 10000000; p.LaserwarRating = 1000; p.AllWounds += 100;
  }
  const result = analyseGame(changed);
  assert.deepEqual(result.players.map(p => p.LabRating), original.players.map(p => p.LabRating));
  assert.equal(sortPlayers(original.players, 'LabRating')[0].LabRating, Math.max(...original.players.map(p => p.LabRating)));
  assert.ok(!Object.hasOwn(raw.taggers_info.players_info[0], 'LabRating'));
});

test('Missing ratings remain last in either direction and have no invented rank', () => {
  const game = analyseGame({ taggers_info: { players_info: [{ Name: 'Нет пар', AllHits: 0, Wounds: 0 }] } });
  assert.equal(playerProfile(game, 'Нет пар').metrics.find(m => m.key === 'LabRating').rank, null);
  for (const direction of ['asc', 'desc']) assert.equal(sortPlayers([
    { Name: 'Нет пар', LabRating: null }, { Name: 'Есть пары', LabRating: 50 }
  ], 'LabRating', direction)[1].Name, 'Нет пар');
});
