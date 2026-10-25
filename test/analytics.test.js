import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyseGame, pairFor, playerProfile, sortPlayers } from '../src/lib/analytics.js';

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
