// バランス確認用の自動プレイ
import { CONFIG as C, kmh } from '../src/config';
import { World, laneX } from '../src/sim';

export type Strategy = 'idle' | 'spam' | 'drive' | 'bot';

function laneSafe(w: World, lane: number): boolean {
  const p = w.player;
  if (lane < 0 || lane >= C.laneCount) return false;
  return w.cars.every(
    (c) => c.wrecked || Math.abs(c.x - laneX(lane)) > 2.2 || c.z + c.length / 2 < p.z - 7 || c.z - c.length / 2 > p.z + 14,
  );
}

// 人間の反応の遅れ。危険に気づいてから操作するまで
const REACTION = 0.45;
let noticed = -1;

function drive(w: World): void {
  const p = w.player;
  const lane = p.targetLane;
  w.input.accel = false;
  w.input.brake = false;
  const ahead = w.cars
    .filter((c) => !c.wrecked && Math.abs(c.x - p.x) < (c.width + p.width) / 2 + 0.2 && c.z > p.z)
    .sort((a, b) => a.z - b.z)[0];
  if (ahead) {
    const gap = ahead.z - p.z - (ahead.length + p.length) / 2;
    const closing = p.speed - ahead.speed;
    if (gap < 16 && (closing > 0.5 || ahead.braking)) {
      if (noticed < 0) noticed = w.time;
      if (w.time - noticed < REACTION) return;
      const options = [lane + 1, lane - 1].filter((l) => laneSafe(w, l));
      if (options.length && Math.abs(p.x - laneX(lane)) < 0.3) {
        if (options[0] > lane) w.laneRight();
        else w.laneLeft();
      } else w.input.brake = true;
      return;
    }
  }
  noticed = -1;
  if (p.speed < kmh(105)) w.input.accel = true;
}

function clearLine(w: World, targetId: number, dir: 1 | -1, x: number): boolean {
  const p = w.player;
  return w.cars.every((c) => {
    if (c.wrecked || c.id === targetId) return true;
    if (Math.abs(c.x - x) > c.width / 2 + 1.2) return true;
    const d = (c.z - p.z) * dir;
    return d < 0 || d > C.missile.range;
  });
}

function aim(w: World): void {
  const p = w.player;
  for (const c of w.cars) {
    if (c.wrecked || c.kind !== 'aori' || !c.aggressive) continue;
    if (Math.abs(c.x - p.x) > 0.8) continue;
    const dir: 1 | -1 = c.z > p.z ? 1 : -1;
    if (Math.abs(c.z - p.z) > 70) continue;
    if (clearLine(w, c.id, dir, p.x)) w.fire(dir);
  }
}

export function play(seed: number, strategy: Strategy, maxTime = 400) {
  const w = new World(seed);
  noticed = -1;
  const seen = new Set<number>();
  const dt = 1 / 60;
  while (w.state === 'playing' && w.time < maxTime) {
    if (strategy === 'spam') {
      w.fire(1);
      w.fire(-1);
    }
    if (strategy === 'drive' || strategy === 'bot') drive(w);
    if (strategy === 'bot') aim(w);
    w.step(dt);
    for (const c of w.cars) if (c.kind === 'aori') seen.add(c.id);
    w.events.length = 0;
  }
  return {
    state: w.state,
    time: Math.round(w.time),
    misses: w.misses,
    crashes: w.crashes,
    wrongHits: w.wrongHits,
    defeated: w.defeated,
    escaped: w.escaped,
    score: w.score,
    aori: seen.size,
  };
}
