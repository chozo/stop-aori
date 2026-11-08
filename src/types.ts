import type { DIMS } from './config';

export type Model = keyof typeof DIMS;
export type CarKind = 'normal' | 'truck' | 'bus' | 'hurry' | 'police' | 'aori';
export type AoriMode =
  | 'approachTail' // 後ろへ回って迫る（蛇行）
  | 'tailgate' // 車間詰め・パッシング・クラクション
  | 'overtake' // 横の車線から追い越す
  | 'cutin' // 前に割り込む
  | 'brake' // 急ブレーキ
  | 'hold' // 前に居座る
  | 'frontWeave' // 前で蛇行・進路妨害
  | 'tap' // ムダブレーキ
  | 'sideApproach' // 横に並びに行く
  | 'side' // 並走して幅寄せ
  | 'waitAhead' // 前方で待ち構える（まだ何もしていない）
  | 'leave';
/** あおり車の手口 */
export type Tactic = 'tail' | 'cut' | 'side' | 'frontWeave' | 'tap';
export type CarMode = AoriMode | 'cruise';
export type HitKind = 'defeat' | 'early' | 'civilian' | 'police';

export interface HitResult {
  kind: HitKind;
  misses: number;
  score: number;
  text: string;
}

export interface Car {
  id: number;
  kind: CarKind;
  model: Model;
  color: number;
  x: number;
  z: number;
  speed: number;
  desired: number;
  targetLane: number;
  lateralSpeed: number;
  length: number;
  width: number;
  headway: number;
  minGap: number;
  accel: number;
  decel: number;
  override: number | null;
  ignorePlayer: boolean;
  laneCooldown: number;
  wrecked: boolean;
  wreckT: number;
  spin: number;
  wreckX: number;
  result?: HitKind;
  aggressive: boolean;
  flashing: boolean;
  braking: boolean;
  hornT: number;
  mode: CarMode;
  modeT: number;
  plan: Tactic;
  acts: number;
  sideOffset: number;
  cycles: number;
  laneDelay: number;
  pendingLane: number;
  dodgeT: number;
  weaveAmp: number;
  weaveTarget: number;
  weavePhase: number;
  tailTime: number;
  age: number;
}

export interface Missile {
  id: number;
  dir: 1 | -1;
  x: number;
  z: number;
  speed: number;
  traveled: number;
  dead: boolean;
  checked: Set<number>;
  passed: Set<number>;
}

export interface Player {
  x: number;
  z: number;
  speed: number;
  targetLane: number;
  prevLane: number;
  length: number;
  width: number;
  invuln: number;
}

export type GameEvent =
  | { type: 'fire'; dir: 1 | -1 }
  | { type: 'hit'; result: HitResult; carId: number; x: number; z: number }
  | { type: 'crash'; carId: number; x: number; z: number }
  | { type: 'horn'; carId: number; dist: number }
  | { type: 'aori'; carId: number; act: string }
  | { type: 'dodge'; carId: number }
  | { type: 'whiff'; carId: number }
  | { type: 'escape'; carId: number }
  | { type: 'ic'; index: number; name: string }
  | { type: 'clear' }
  | { type: 'over' };
