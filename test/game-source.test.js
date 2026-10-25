import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameClient, parseGameId, validateGame, validateCatalog, formatGameDate } from '../src/lib/game-source.js';

const raw = JSON.parse(readFileSync(new URL('../src/lib/data/aZ0dpB6H.json', import.meta.url), 'utf8'));
const id = raw.game_metadata.game_id;
const revision = 'a'.repeat(64);
const catalog = () => ({ schema_version: 1, synced_at: '2026-10-25T00:00:00.000Z', games: [
  { game_id: id, revision, game_date: '2026-10-09', venue_name: 'Арена', player_count: 24 }
] });
const storage = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };

test('Accepts IFLED links and IDs; rejects arbitrary hosts and paths', () => {
  for (const input of [id, ` https://beta.ifled.info/games/${id}/?view=players#test `, `https://data.ifled.info/games/${id}/game_info.json`, `https://ifled.info/games/${id}`]) assert.equal(parseGameId(input), id);
  for (const input of ['', '../secret', 'https://evil.example/games/abc', 'https://beta.ifled.info.evil.example/games/abc', 'https://beta.ifled.info/games/a/b', 'file:///games/abc']) assert.throws(() => parseGameId(input));
  assert.equal(formatGameDate('21.10.2026'), '21 октября 2026');
  assert.equal(formatGameDate('2026-10-21'), '21 октября 2026');
  assert.equal(formatGameDate(undefined), 'Дата не указана');
  assert.equal(formatGameDate('31.02.2026'), 'Дата не указана');
});

test('Validates game identity, totals and catalog asset paths', () => {
  assert.throws(() => validateGame(raw, 'wrong'), /ID/);
  assert.throws(() => validateGame({}, id), /игроков/);
  const invalid = structuredClone(raw); invalid.taggers_info.players_info[0].AllHits = null;
  assert.throws(() => validateGame(invalid, id), /AllHits/);
  const legacy = structuredClone(raw); delete legacy.game_metadata;
  assert.equal(validateGame(legacy, id).game_metadata.game_id, id);
  const value = catalog(); value.games[0].game_id = '../private';
  assert.throws(() => validateCatalog(value));
  const repeated = catalog(); repeated.games.push(repeated.games[0]);
  assert.throws(() => validateCatalog(repeated));
});

test('Loads only catalog until selection; fetches versioned same-origin files and persists games', async () => {
  const calls = [];
  const store = storage();
  const options = { storage: store, dataBase: '/lab/data', fetcher: async url => {
    calls.push(url); return Response.json(url.endsWith('/catalog.json') ? catalog() : raw);
  } };
  const client = createGameClient(options);
  await client.catalog();
  assert.deepEqual(calls, ['/lab/data/catalog.json']);
  assert.equal(client.recent().length, 0);
  await client.load(id);
  assert.equal(calls[1], `/lab/data/games/${id}.${revision}.json`);
  const restored = createGameClient(options);
  assert.equal((await restored.load(id)).source, 'browser-cache');
  assert.equal(calls.length, 2);
  assert.equal(restored.recent()[0].id, id);
});

test('Catalog revision changes invalidate cached data; removed games cannot reopen from cache', async () => {
  const index = catalog(); let gameCalls = 0;
  const client = createGameClient({ fetcher: async url => {
    if (url.endsWith('catalog.json')) return Response.json(index);
    gameCalls++; return Response.json(raw);
  } });
  await client.load(id); assert.equal(gameCalls, 1);
  index.games[0].revision = 'b'.repeat(64);
  await client.catalog({ refresh: true });
  await client.load(id); assert.equal(gameCalls, 2);
  index.games = [];
  await client.catalog({ refresh: true });
  assert.equal(client.recent().length, 0);
  await assert.rejects(client.load(id), /пока нет/);
  assert.equal(gameCalls, 2);
});

test('Offline browser restores catalog and selected game; unknown games remain unavailable', async () => {
  const store = storage();
  await createGameClient({ storage: store, now: () => 0, fetcher: async url => Response.json(url.endsWith('catalog.json') ? catalog() : raw) }).load(id);
  const offline = createGameClient({ storage: store, now: () => 99999999, fetcher: async () => { throw new TypeError('offline'); } });
  const result = await offline.load(id);
  assert.equal(result.stale, true); assert.equal(result.source, 'browser-cache');
  await assert.rejects(offline.load('unknown'), /пока нет/);
});

test('Unknown game does not cause a fetch of arbitrary game data', async () => {
  let calls = 0;
  const client = createGameClient({ fetcher: async () => { calls++; return Response.json(catalog()); } });
  await assert.rejects(client.load('unknown'), /после следующей синхронизации/);
  assert.equal(calls, 1);
});

test('Corrupt storage and quota errors do not prevent selection', async () => {
  for (const value of ['{', JSON.stringify({ entries: { broken: null } })]) {
    const client = createGameClient({ storage: { getItem: () => value, setItem: () => { throw new Error('quota'); } }, fetcher: async url => Response.json(url.endsWith('catalog.json') ? catalog() : raw) });
    assert.equal(client.recent().length, 0);
    await client.load(id); assert.equal(client.recent().length, 1);
  }
});

test('Malformed selected game is rejected; cancellation is propagated', async () => {
  const invalid = createGameClient({ fetcher: async url => Response.json(url.endsWith('catalog.json') ? catalog() : {}) });
  await assert.rejects(invalid.load(id), /игроков/);
  const controller = new AbortController(); controller.abort();
  const client = createGameClient({ fetcher: async () => { throw new DOMException('Aborted', 'AbortError'); } });
  await assert.rejects(client.load(id, { signal: controller.signal }), { name: 'AbortError' });
});
