import { writeFile, mkdir } from 'node:fs/promises';
import { analyseGame } from '../src/lib/analytics.js';

const id = process.argv[2];
if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Использование: npm run import:game -- GAME_ID');
const response = await fetch(`https://data.ifled.info/games/${id}/game_info.json`);
if (!response.ok) throw new Error(`Ошибка загрузки: HTTP ${response.status}`);
const raw = await response.json();
const game = analyseGame(raw);
if (raw.game_metadata?.game_id && raw.game_metadata.game_id !== id) throw new Error('ID игры не совпадает');
const content = JSON.stringify(raw, null, 2) + '\n';
for (const folder of ['src/lib/data', 'static/data']) {
  const target = new URL(`../${folder}/`, import.meta.url);
  await mkdir(target, { recursive: true });
  await writeFile(new URL(`${id}.json`, target), content);
}
console.log(`${id}: ${game.players.length} игроков, ${game.totalHits} попаданий, ${game.issues.length} расхождений.`);
console.log('Игру можно открыть в интерфейсе по ID или ссылке; менять импорт для этого не нужно.');
