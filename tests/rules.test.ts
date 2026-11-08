import { describe, expect, it } from 'vitest';
import { judgeHit, finalScore, rank } from '../src/rules';
import { kmRemaining, nextIcIndex, icProgress, ROUTE, TOTAL_KM } from '../src/route';

describe('judgeHit', () => {
  it('あおった後のあおり車は撃退', () => {
    expect(judgeHit({ kind: 'aori', aggressive: true })).toMatchObject({ kind: 'defeat', misses: 0 });
  });
  it('あおる前のあおり車はミス1', () => {
    expect(judgeHit({ kind: 'aori', aggressive: false })).toMatchObject({ kind: 'early', misses: 1 });
  });
  it('一般車・トラック・急いでいる車はミス1', () => {
    for (const kind of ['normal', 'truck', 'bus', 'hurry'] as const) {
      expect(judgeHit({ kind, aggressive: false }).misses).toBe(1);
    }
  });
  it('覆面パトカーはミス2', () => {
    expect(judgeHit({ kind: 'police', aggressive: false }).misses).toBe(2);
  });
});

describe('score', () => {
  it('クリアしないとボーナスなし', () => {
    expect(finalScore({ defeated: 3, misses: 3, cleared: false, time: 100 })).toBe(3000);
    expect(rank(3000, false)).toBe('-');
  });
  it('クリアボーナス', () => {
    expect(finalScore({ defeated: 0, misses: 0, cleared: true, time: 200 })).toBe(5000 + 4500);
  });
});

describe('route', () => {
  it('東京から名古屋までの距離', () => {
    expect(TOTAL_KM).toBeCloseTo(325.5, 1);
    expect(kmRemaining(0)).toBeCloseTo(TOTAL_KM);
    expect(kmRemaining(1)).toBe(0);
  });
  it('次のIC', () => {
    expect(nextIcIndex(0)).toBe(1);
    expect(nextIcIndex(icProgress(3))).toBe(4);
    expect(nextIcIndex(1)).toBe(ROUTE.length - 1);
  });
});
