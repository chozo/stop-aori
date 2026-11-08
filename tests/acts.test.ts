import { expect, it } from 'vitest';
import { World } from '../src/sim';
import { play } from './bot';

// 何もしない（ぶつかってもミスを戻す）で3分間走ったとき、あおり行動が何回あるか
it('あおり行動がひんぱんに起きる', () => {
  const totals: Record<string, number> = {};
  let firstAct = Infinity;
  let quiet = 0; // あおり行動が10秒以上なかった回数
  for (const seed of [1, 2, 3]) {
    const w = new World(seed);
    let last = 0;
    while (w.time < 180) {
      w.step(1 / 120);
      w.misses = 0;
      for (const e of w.events) {
        if (e.type === 'aori') {
          totals[e.act] = (totals[e.act] ?? 0) + 1;
          firstAct = Math.min(firstAct, w.time);
          if (w.time - last > 10) quiet++;
          last = w.time;
        }
      }
      w.events.length = 0;
    }
  }
  const per = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v / 3)]));
  console.log('3分あたり', JSON.stringify(per), '最初のあおり', firstAct.toFixed(1), '秒', '10秒以上の空白', quiet);
  for (const act of ['蛇行運転', 'パッシング', '割り込み', '急ブレーキ', 'ムダブレーキ', '幅寄せ']) expect(per[act] ?? 0).toBeGreaterThan(2);
  expect(firstAct).toBeLessThan(8);
});

// バランス: 単純な操作では勝てず、避けて撃てば勝てることがある
it('自動プレイの結果', () => {
  const clears: Record<string, number> = {};
  for (const s of ['idle', 'spam', 'bot', 'drive'] as const) {
    const r = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seed) => play(seed, s));
    clears[s] = r.filter((x) => x.state === 'clear').length;
    console.log(s, clears[s], '/ 12', JSON.stringify(r.map((x) => [x.state[0], x.time, '接触' + x.crashes, '誤射' + x.wrongHits, '撃退' + x.defeated, x.aori])));
  }
  expect(clears.idle).toBe(0);
  expect(clears.spam).toBe(0);
  expect(clears.bot).toBeGreaterThanOrEqual(1);
});
