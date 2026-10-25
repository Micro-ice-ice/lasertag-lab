import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { syncGames, visibleGames } from '../scripts/sync-games.mjs';

const raw = JSON.parse(readFileSync(new URL('../src/lib/data/aZ0dpB6H.json', import.meta.url), 'utf8'));
const id = raw.game_metadata.game_id;
const testRoot = fileURLToPath(new URL('../.test-output/', import.meta.url));
await mkdir(testRoot, { recursive: true });
const remote = () => ({ schema_version: 1, games: [
  { game_id: id, game_date: '2026-10-09', venue_name: 'Арена', player_count: 24, content_sha256: 'a'.repeat(64), visibility: { hidden: false } },
  { game_id: 'hidden', game_date: '2026-10-10', venue_name: 'Арена', player_count: 24, content_sha256: 'b'.repeat(64), visibility: { hidden: true } }
] });

test('Only visible games sync; changes get immutable URLs and old files are pruned', async () => {
  const output = await mkdtemp(join(testRoot, 'sync-'));
  const index = remote(); const value = structuredClone(raw); const calls = [];
  const options = { output, log: () => {}, now: () => new Date('2026-10-25T00:00:00Z'), fetcher: async url => {
    calls.push(url); return Response.json(url.endsWith('/index.json') ? index : value);
  } };
  const first = await syncGames(options);
  assert.equal(first.games.length, 1); assert.equal(calls.length, 2);
  assert.ok(!calls.some(url => url.includes('/hidden/')));
  assert.equal(JSON.parse(await readFile(join(output, 'games', `${id}.${first.games[0].revision}.json`), 'utf8')).game_metadata.game_id, id);
  calls.length = 0;
  const second = await syncGames(options);
  assert.equal(second.games[0].revision, first.games[0].revision);
  assert.equal(calls.length, 1);
  index.games[0].content_sha256 = 'c'.repeat(64); value.game_metadata.venue_name = 'Другая арена';
  const third = await syncGames(options);
  assert.notEqual(third.games[0].revision, first.games[0].revision);
  assert.equal((await readdir(join(output, 'games'))).length, 1);
  index.games[0].visibility.hidden = true;
  assert.equal((await syncGames(options)).games.length, 0);
  assert.deepEqual(await readdir(join(output, 'games')), []);
});

test('Failed refresh keeps the last complete manifest and files', async () => {
  const output = await mkdtemp(join(testRoot, 'sync-'));
  const index = remote(); let fail = false;
  const options = { output, log: () => {}, fetcher: async url => {
    if (url.endsWith('/index.json')) return Response.json(index);
    if (fail) return new Response('Unavailable', { status: 503 });
    return Response.json(raw);
  } };
  await syncGames(options);
  const before = await readFile(join(output, 'catalog.json'), 'utf8');
  index.games[0].content_sha256 = 'c'.repeat(64); fail = true;
  await assert.rejects(syncGames(options), /503/);
  assert.equal(await readFile(join(output, 'catalog.json'), 'utf8'), before);
  assert.equal((await readdir(join(output, 'games'))).length, 1);
});

test('Damaged cached file is redownloaded, and legacy players.json is supported', async () => {
  const output = await mkdtemp(join(testRoot, 'sync-'));
  let legacyCalls = 0;
  const options = { output, log: () => {}, fetcher: async url => {
    if (url.endsWith('/index.json')) return Response.json(remote());
    if (url.endsWith('/game_info.json')) return new Response('', { status: 404 });
    legacyCalls++; return Response.json(raw);
  } };
  const first = await syncGames(options);
  await writeFile(join(output, 'games', `${id}.${first.games[0].revision}.json`), '{}');
  const second = await syncGames(options);
  assert.equal(second.games[0].revision, first.games[0].revision);
  assert.equal(legacyCalls, 2);
});

test('Catalog duplicates, malformed schemas and unsafe IDs stop synchronization', () => {
  const duplicate = remote(); duplicate.games.push(duplicate.games[0]);
  assert.throws(() => visibleGames(duplicate));
  const unsafe = remote(); unsafe.games[0].game_id = '../other';
  assert.throws(() => visibleGames(unsafe));
  assert.throws(() => visibleGames({ games: [] }));
});
