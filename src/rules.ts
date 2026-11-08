import { CONFIG as C } from './config';
import type { CarKind, HitResult } from './types';

/** ミサイルが当たった車の判定 */
export function judgeHit(t: { kind: CarKind; aggressive: boolean }): HitResult {
  if (t.kind === 'aori') {
    return t.aggressive
      ? { kind: 'defeat', misses: 0, score: C.score.defeat, text: '撃退！' }
      : { kind: 'early', misses: 1, score: 0, text: 'まだ何もしていない車だ！' };
  }
  if (t.kind === 'police') {
    return { kind: 'police', misses: C.policeMisses, score: 0, text: '覆面パトカーだった！' };
  }
  return { kind: 'civilian', misses: 1, score: 0, text: '一般車に当ててしまった…' };
}

export interface ScoreInput {
  defeated: number;
  misses: number;
  cleared: boolean;
  time: number;
}

export function finalScore(s: ScoreInput): number {
  let score = s.defeated * C.score.defeat;
  if (s.cleared) {
    score += C.score.clear;
    score += Math.max(0, C.maxMisses - s.misses) * C.score.perLife;
    score += Math.max(0, Math.round((C.score.parTime - s.time) * C.score.perSecond));
  }
  return score;
}

export function rank(score: number, cleared: boolean): string {
  if (!cleared) return '-';
  if (score >= 22000) return 'S';
  if (score >= 16000) return 'A';
  if (score >= 11000) return 'B';
  return 'C';
}
