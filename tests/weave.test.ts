import { expect, it } from 'vitest';
import { CONFIG as C } from '../src/config';
import { World } from '../src/sim';

// 車間を詰めて蛇行するあおり車に、タイミングを見ずに後ろへ撃ったときの命中率
function hitRate(progress: number): number {
  let hits = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) {
    const w = new World(seed, { autoSpawn: false, initialTraffic: false });
    w.player.z = C.courseLength * progress;
    const car = w.spawnAori('tail', 1, w.player.z - 40);
    for (let i = 0; i < 60 * 10 && car.mode !== 'tailgate'; i++) w.step(1 / 60);
    for (let i = 0; i < 60 + (seed * 7) % 120; i++) w.step(1 / 60); // 撃つ時刻をばらす
    car.dodgeT = 99; // かわす動きは除いて、蛇行だけの効果を見る
    w.fire(-1);
    for (let i = 0; i < 30; i++) w.step(1 / 60);
    if (car.wrecked) hits++;
  }
  return hits / N;
}

it('蛇行で、タイミングを見ずに撃つと外れることがある', () => {
  const early = hitRate(0.05);
  const late = hitRate(0.95);
  console.log('命中率 序盤', early, '終盤', late);
  expect(early).toBeLessThan(0.85);
  expect(early).toBeGreaterThan(0.4);
  expect(late).toBeLessThan(early);
});
