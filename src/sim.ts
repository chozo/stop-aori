// ゲームの中身（描画なし）。テストやバランス確認でもこのまま使う
import { CONFIG as C, DIMS, kmh } from './config';
import { judgeHit, finalScore } from './rules';
import { ROUTE, icProgress } from './route';
import type { AoriMode, Car, CarKind, GameEvent, Missile, Model, Player, Tactic } from './types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const laneX = (l: number) => (l - 1) * C.laneWidth;
export const laneOf = (x: number) => clamp(Math.round(x / C.laneWidth) + 1, 0, C.laneCount - 1);

// 一般車とあおり車で同じ色・車種を使い、見た目だけでは見分けられないようにする
const COLORS = [0xf2f2f2, 0x1a1a1a, 0xb9bec4, 0x8a1c1c, 0x1d3f7a, 0x5f646b, 0xe6dcc6, 0x2e5e3a];
const CIVIL_MODELS: Model[] = ['sedan', 'sedan', 'compact', 'compact', 'suv', 'minivan', 'minivan', 'sports'];
const AORI_MODELS: Model[] = ['sedan', 'suv', 'minivan', 'sports', 'sedan'];
const HURRY_MODELS: Model[] = ['sports', 'sedan', 'compact', 'suv'];

export interface WorldOptions {
  autoSpawn?: boolean;
  initialTraffic?: boolean;
}

interface Leader {
  gap: number;
  speed: number;
  isPlayer: boolean;
}

export class World {
  readonly rng: () => number;
  readonly opts: Required<WorldOptions>;
  time = 0;
  finishTime = 0;
  state: 'playing' | 'clear' | 'over' = 'playing';
  player: Player;
  cars: Car[] = [];
  missiles: Missile[] = [];
  events: GameEvent[] = [];
  misses = 0;
  defeated = 0;
  escaped = 0;
  wrongHits = 0;
  crashes = 0;
  lastMissText = '';
  cooldown = { front: 0, rear: 0 };
  input = { accel: false, brake: false };
  nextIc = 1;
  aoriCount = 0;
  private nextId = 1;
  private nextAori: number;
  private nextDecoy: number;
  private trafficCd = 0;

  constructor(seed = 1, opts: WorldOptions = {}) {
    this.rng = mulberry32(seed);
    this.opts = { autoSpawn: true, initialTraffic: true, ...opts };
    const P = C.player;
    this.player = {
      x: laneX(1),
      z: 0,
      speed: kmh(P.startKmh),
      targetLane: 1,
      prevLane: 1,
      length: P.length,
      width: P.width,
      invuln: 0,
    };
    this.nextAori = C.aori.first;
    this.nextDecoy = C.decoy.first;
    if (this.opts.initialTraffic) this.seedTraffic();
  }

  get progress(): number {
    return clamp(this.player.z / C.courseLength, 0, 1);
  }

  get score(): number {
    return finalScore({
      defeated: this.defeated,
      misses: this.misses,
      cleared: this.state === 'clear',
      time: this.state === 'clear' ? this.finishTime : this.time,
    });
  }

  // ---- 操作 ----
  laneLeft(): void {
    if (this.state !== 'playing') return;
    const p = this.player;
    p.prevLane = p.targetLane;
    p.targetLane = Math.max(0, p.targetLane - 1);
  }

  laneRight(): void {
    if (this.state !== 'playing') return;
    const p = this.player;
    p.prevLane = p.targetLane;
    p.targetLane = Math.min(C.laneCount - 1, p.targetLane + 1);
  }

  fire(dir: 1 | -1): boolean {
    if (this.state !== 'playing') return false;
    const key = dir === 1 ? 'front' : 'rear';
    if (this.cooldown[key] > 0) return false;
    const p = this.player;
    this.missiles.push({
      id: this.nextId++,
      dir,
      x: p.x,
      z: p.z + dir * (p.length / 2 + 0.4),
      speed: p.speed + dir * C.missile.relSpeed,
      traveled: 0,
      dead: false,
      checked: new Set(),
      passed: new Set(),
    });
    this.cooldown[key] = C.missile.cooldown;
    this.events.push({ type: 'fire', dir });
    return true;
  }

  // ---- 1コマ進める ----
  step(dt: number): void {
    const playing = this.state === 'playing';
    this.time += dt;
    this.updatePlayer(dt);
    if (playing && this.opts.autoSpawn) this.spawn(dt);
    for (const car of this.cars) this.updateCar(car, dt);
    this.updateMissiles(dt, playing);
    if (playing) this.collidePlayer();
    this.despawn();
    if (playing) this.checkProgress();
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const P = C.player;
    if (this.state === 'playing') {
      if (this.input.accel) p.speed += P.accel * dt;
      if (this.input.brake) p.speed -= P.brake * dt;
      p.speed = clamp(p.speed, kmh(P.minKmh), kmh(P.maxKmh));
    } else if (this.state === 'over') {
      p.speed = Math.max(0, p.speed - 8 * dt);
    }
    const d = laneX(p.targetLane) - p.x;
    const m = P.lateralSpeed * dt;
    p.x += clamp(d, -m, m);
    p.z += p.speed * dt;
    p.invuln = Math.max(0, p.invuln - dt);
    this.cooldown.front = Math.max(0, this.cooldown.front - dt);
    this.cooldown.rear = Math.max(0, this.cooldown.rear - dt);
  }

  // ---- 車を出す ----
  private seedTraffic(): void {
    for (let i = 0; i < 9; i++) {
      const z = 30 + i * 26 + this.rng() * 10;
      const lane = this.pickLane();
      if (lane === 1 && z < 70) continue;
      if (!this.laneFree(lane, z - 20, z + 20)) continue;
      this.addCivilian(lane, z, this.laneSpeed(lane));
    }
  }

  private pickLane(): number {
    const r = this.rng();
    return r < 0.4 ? 0 : r < 0.75 ? 1 : 2;
  }

  private laneSpeed(lane: number): number {
    const r = this.rng();
    if (lane === 0) return kmh(78 + r * 12);
    if (lane === 1) return kmh(90 + r * 12);
    return kmh(102 + r * 13);
  }

  addCar(kind: CarKind, model: Model, lane: number, z: number, speed: number, color?: number): Car {
    const d = DIMS[model];
    const car: Car = {
      id: this.nextId++,
      kind,
      model,
      color: color ?? COLORS[Math.floor(this.rng() * COLORS.length)],
      x: laneX(lane),
      z,
      speed,
      desired: speed,
      targetLane: lane,
      lateralSpeed: 3.5,
      length: d.length,
      width: d.width,
      headway: 0.9,
      minGap: 6,
      accel: model === 'truck' || model === 'bus' ? 2 : 3.5,
      decel: 10,
      override: null,
      ignorePlayer: false,
      laneCooldown: 2 + this.rng() * 4,
      wrecked: false,
      wreckT: 0,
      spin: 0,
      wreckX: 0,
      aggressive: false,
      flashing: false,
      braking: false,
      hornT: 0.3,
      mode: 'cruise',
      modeT: 0,
      plan: 'tail',
      acts: 0,
      sideOffset: 0,
      cycles: 0,
      laneDelay: 0,
      pendingLane: -1,
      dodgeT: 0,
      weaveAmp: 0,
      weaveTarget: 0,
      weavePhase: this.rng() * Math.PI * 2,
      tailTime: 5,
      age: 0,
    };
    this.cars.push(car);
    return car;
  }

  private addCivilian(lane: number, z: number, speed: number): Car {
    const r = this.rng();
    if (r < 0.14 && lane <= 1) {
      const c = this.addCar('truck', 'truck', lane, z, Math.min(speed, kmh(85)), 0xdfe3e6);
      return c;
    }
    if (r < 0.18 && lane <= 1) return this.addCar('bus', 'bus', lane, z, Math.min(speed, kmh(88)), 0x2f6fb5);
    const model = CIVIL_MODELS[Math.floor(this.rng() * CIVIL_MODELS.length)];
    return this.addCar('normal', model, lane, z, speed);
  }

  /** あおり車を出す（テストからも呼ぶ）。fromFront なら前方で待ち構える */
  spawnAori(tactic: Tactic, lane: number, z: number, fromFront = false): Car {
    const p = this.player;
    const model = AORI_MODELS[Math.floor(this.rng() * AORI_MODELS.length)];
    this.aoriCount++;
    const car = this.addCar('aori', model, lane, z, fromFront ? p.speed - 6 : p.speed + 10);
    car.headway = 0.4;
    car.minGap = 3;
    car.accel = 7;
    car.lateralSpeed = 4;
    car.tailTime = C.aori.tailTime[0] + this.rng() * (C.aori.tailTime[1] - C.aori.tailTime[0]);
    car.plan = tactic;
    if (fromFront) this.setMode(car, 'waitAhead');
    else this.startTactic(car, tactic);
    return car;
  }

  private spawn(dt: number): void {
    const p = this.player;
    const prog = this.progress;

    // 一般車
    this.trafficCd -= dt;
    if (this.trafficCd <= 0) {
      const T = C.traffic;
      const count = this.cars.filter(
        (c) => !c.wrecked && (c.kind === 'normal' || c.kind === 'truck' || c.kind === 'bus'),
      ).length;
      if (count < Math.round(lerp(T.countStart, T.countEnd, prog))) {
        this.trafficCd = T.spawnGap;
        if (this.rng() < 0.22) {
          const lane = this.rng() < 0.6 ? 2 : 1;
          const z = p.z - T.behind + 5;
          if (this.laneFree(lane, z - 25, z + 25)) {
            this.addCivilian(lane, z, Math.max(p.speed + 4 + this.rng() * 3, kmh(95)));
          }
        } else {
          const lane = this.pickLane();
          const z = p.z + T.ahead - this.rng() * 40;
          if (this.laneFree(lane, z - 30, z + 30)) this.addCivilian(lane, z, this.laneSpeed(lane));
        }
      }
    }

    // 紛らわしい車（急いでいる一般車・覆面パトカー）
    this.nextDecoy -= dt;
    if (this.nextDecoy <= 0) {
      const D = C.decoy;
      this.nextDecoy = D.intervalMin + this.rng() * (D.intervalMax - D.intervalMin);
      const lane = Math.floor(this.rng() * 3);
      const z = p.z - 85;
      if (this.laneFree(lane, z - 15, z + 15)) {
        if (prog >= D.policeFrom && this.rng() < D.policeRate) {
          const c = this.addCar('police', 'sedan', lane, z, p.speed + 4, this.rng() < 0.5 ? 0xf2f2f2 : 0x3b3f45);
          c.headway = 1.0;
          c.minGap = 8;
        } else {
          const model = HURRY_MODELS[Math.floor(this.rng() * HURRY_MODELS.length)];
          const c = this.addCar('hurry', model, lane, z, p.speed + 8);
          c.headway = 0.6;
          c.minGap = 8;
          c.accel = 5;
          c.lateralSpeed = 4.5;
        }
      }
    }

    // あおり車: いつも一定の数が絡んでいるようにする
    this.nextAori -= dt;
    if (this.nextAori <= 0 && p.z < C.courseLength - C.aori.noSpawnLast) {
      const A = C.aori;
      const active = this.cars.filter((c) => c.kind === 'aori' && !c.wrecked && c.mode !== 'leave').length;
      const target = Math.round(lerp(A.activeStart, A.activeEnd, prog));
      let spawned = false;
      if (active < target) {
        const first = this.aoriCount === 0;
        const lane = first ? p.targetLane : Math.floor(this.rng() * 3);
        if (!first && this.rng() < A.frontRate) {
          const z = p.z + A.spawnAhead[0] + this.rng() * (A.spawnAhead[1] - A.spawnAhead[0]);
          if (this.laneFree(lane, z - 15, z + 15)) {
            this.spawnAori(this.rng() < 0.5 ? 'tap' : 'frontWeave', lane, z, true);
            spawned = true;
          }
        } else {
          const z = p.z - A.spawnBehind;
          if (this.laneFree(lane, z - 12, z + 12)) {
            // 最初の1台は、すぐあおりが始まるよう後ろから蛇行して迫る
            const tactics: Tactic[] = first ? ['tail'] : ['tail', 'tail', 'side', 'cut'];
            this.spawnAori(tactics[Math.floor(this.rng() * tactics.length)], lane, z);
            spawned = true;
          }
        }
      }
      this.nextAori = spawned ? lerp(A.intervalStart, A.intervalEnd, prog) * (0.8 + this.rng() * 0.4) : 0.4;
    }
  }

  // ---- 周りの状況 ----
  /** その車線の [z0, z1] に車（自車を含む）がいなければ true */
  laneFree(lane: number, z0: number, z1: number, exceptId = -1): boolean {
    const lx = laneX(lane);
    for (const c of this.cars) {
      if (c.wrecked || c.id === exceptId) continue;
      if (Math.abs(c.x - lx) > 2.4 && Math.abs(laneX(c.targetLane) - lx) > 0.1) continue;
      if (c.z + c.length / 2 > z0 && c.z - c.length / 2 < z1) return false;
    }
    const p = this.player;
    if (exceptId !== 0 && (Math.abs(p.x - lx) < 2.4 || p.targetLane === lane)) {
      if (p.z + p.length / 2 > z0 && p.z - p.length / 2 < z1) return false;
    }
    return true;
  }

  private leaderOf(car: Car, includePlayer: boolean): Leader | null {
    let best: Leader | null = null;
    const consider = (x: number, z: number, w: number, l: number, speed: number, isPlayer: boolean) => {
      if (Math.abs(x - car.x) > (w + car.width) / 2 + 0.3) return;
      const dz = z - car.z;
      if (dz <= 0) return;
      const gap = dz - (l + car.length) / 2;
      if (!best || gap < best.gap) best = { gap, speed, isPlayer };
    };
    for (const o of this.cars) {
      if (o === car || o.wrecked) continue;
      consider(o.x, o.z, o.width, o.length, o.speed, false);
    }
    if (includePlayer) {
      const p = this.player;
      consider(p.x, p.z, p.width, p.length, p.speed, true);
    }
    return best;
  }

  /** かわす確率。自車との車間が近いほど下がり、至近距離では0 */
  private dodgeChance(car: Car): number {
    const p = this.player;
    const gap = Math.abs(car.z - p.z) - (car.length + p.length) / 2;
    const near = clamp((gap - C.aori.dodgeNear) / (C.aori.dodgeFar - C.aori.dodgeNear), 0, 1);
    return lerp(C.aori.dodgeStart, C.aori.dodgeEnd, this.progress) * near;
  }

  // ---- 車の動き ----
  private updateCar(car: Car, dt: number): void {
    car.age += dt;
    car.laneCooldown -= dt;
    if (car.wrecked) {
      car.wreckT += dt;
      car.speed = Math.max(0, car.speed - 9 * dt);
      car.spin += dt * Math.max(0, 9 - car.wreckT * 5);
      car.x += (car.wreckX - car.x) * Math.min(1, dt * 1.5);
      car.z += car.speed * dt;
      return;
    }
    switch (car.kind) {
      case 'aori':
        this.thinkAori(car, dt);
        break;
      case 'hurry':
        this.thinkHurry(car);
        break;
      case 'police':
        this.thinkPolice(car);
        break;
      default:
        this.thinkNormal(car);
    }
    this.move(car, dt);
  }

  private move(car: Car, dt: number): void {
    let target = car.override ?? car.desired;
    const lead = this.leaderOf(car, !car.ignorePlayer);
    if (lead) {
      const safe = car.headway * car.speed + car.minGap;
      if (lead.gap < safe) target = Math.min(target, lead.speed + (lead.gap - safe) * 0.9);
      if (lead.gap < 1) target = Math.min(target, lead.speed - 3);
    }
    const dv = target - car.speed;
    car.speed += dv > 0 ? Math.min(dv, car.accel * dt) : Math.max(dv, -car.decel * dt);
    car.speed = Math.max(0, car.speed);
    // 蛇行: 周期の違う2つの波を重ねて、読みにくくする
    car.weaveAmp += clamp(car.weaveTarget - car.weaveAmp, -2 * dt, 2 * dt);
    const ph = car.weavePhase;
    const weave =
      car.weaveAmp > 0.01 ? (Math.sin(car.age * 2.3 + ph) * 0.8 + Math.sin(car.age * 3.9 + ph * 1.7) * 0.35) * car.weaveAmp : 0;
    const tx = laneX(car.targetLane) + weave + car.sideOffset;
    const ls = car.dodgeT > 0 ? C.aori.dodgeLateral : car.weaveAmp > 0.01 ? Math.max(car.lateralSpeed, 7) : car.lateralSpeed;
    car.x += clamp(tx - car.x, -ls * dt, ls * dt);
    car.z += car.speed * dt;
  }

  private settled(car: Car): boolean {
    return Math.abs(car.x - laneX(car.targetLane)) < 0.2;
  }

  /** 前が詰まっていたら空いている車線へ移る */
  private tryOvertake(car: Car, threshold: number, cooldown: number): void {
    if (car.laneCooldown > 0 || !this.settled(car)) return;
    const lead = this.leaderOf(car, true);
    if (!lead || lead.gap > threshold || lead.speed > car.desired - 1.5) return;
    const heavy = car.model === 'truck' || car.model === 'bus';
    const cur = car.targetLane;
    const order = this.rng() < 0.7 ? [cur + 1, cur - 1] : [cur - 1, cur + 1];
    for (const l of order) {
      if (l < 0 || l >= C.laneCount || (heavy && l > 1)) continue;
      if (this.laneFree(l, car.z - 14, car.z + 22, car.id)) {
        car.targetLane = l;
        car.laneCooldown = cooldown;
        return;
      }
    }
    car.laneCooldown = 1;
  }

  private thinkNormal(car: Car): void {
    car.override = null;
    car.ignorePlayer = false;
    const safe = car.headway * car.speed + car.minGap;
    this.tryOvertake(car, safe * 1.4, 5 + this.rng() * 4);
  }

  private thinkHurry(car: Car): void {
    car.override = null;
    car.ignorePlayer = false;
    car.desired = Math.max(this.player.speed + 9, 30);
    this.tryOvertake(car, 35, 1.6);
  }

  private thinkPolice(car: Car): void {
    const p = this.player;
    car.override = null;
    car.ignorePlayer = false;
    if (car.age < 12) {
      // 後ろにしばらく付いてくる（あおり車と紛らわしい）
      car.desired = Math.max(p.speed + 2, 25);
      const dz = car.z - p.z;
      if (
        dz < -15 &&
        dz > -60 &&
        car.targetLane !== p.targetLane &&
        car.laneCooldown <= 0 &&
        this.settled(car) &&
        this.laneFree(p.targetLane, car.z - 10, car.z + 10, car.id)
      ) {
        car.targetLane = p.targetLane;
        car.laneCooldown = 4;
      }
    } else {
      car.desired = Math.max(p.speed + 9, 30);
      this.tryOvertake(car, 35, 2);
    }
  }

  private setMode(car: Car, mode: AoriMode): void {
    car.mode = mode;
    car.modeT = 0;
    car.decel = 10;
    car.lateralSpeed = 4;
    car.flashing = false;
    car.braking = false;
  }

  /** 手口を始める。前にいる必要がある手口は、まず追い越す */
  private startTactic(car: Car, tactic: Tactic): void {
    const p = this.player;
    car.plan = tactic;
    const aheadInLane =
      car.targetLane === p.targetLane && car.z - p.z - (car.length + p.length) / 2 > 3 && this.settled(car);
    switch (tactic) {
      case 'tail':
        this.setMode(car, 'approachTail');
        break;
      case 'side':
        this.setMode(car, 'sideApproach');
        break;
      case 'cut':
        this.setMode(car, aheadInLane ? 'brake' : 'overtake');
        if (aheadInLane) this.beginBrake(car);
        break;
      case 'frontWeave':
      case 'tap':
        if (aheadInLane) this.beginFront(car, tactic);
        else this.setMode(car, 'overtake');
        break;
    }
  }

  /** 次の手口を選ぶ。同じ手口は続けない */
  private nextTactic(car: Car): void {
    car.acts++;
    if (car.acts >= C.aori.maxActs || car.age > C.aori.maxLife) {
      this.setMode(car, 'leave');
      return;
    }
    const ahead = car.z > this.player.z;
    const pool: Tactic[] = ahead ? ['frontWeave', 'tap', 'cut', 'tail'] : ['tail', 'side', 'cut', 'frontWeave', 'tap'];
    const choices = pool.filter((t) => t !== car.plan);
    this.startTactic(car, choices[Math.floor(this.rng() * choices.length)]);
  }

  private beginBrake(car: Car): void {
    this.setMode(car, 'brake');
    car.braking = true;
    this.aoriAct(car, '急ブレーキ');
    this.horn(car);
  }

  private beginFront(car: Car, tactic: Tactic): void {
    if (tactic === 'tap') {
      this.setMode(car, 'tap');
      this.aoriAct(car, 'ムダブレーキ');
    } else {
      this.setMode(car, 'frontWeave');
      this.aoriAct(car, '蛇行運転');
    }
  }

  private adjacentLane(pLane: number, car: Car): number {
    if (pLane === 0) return 1;
    if (pLane === 2) return 1;
    const left = this.laneFree(0, car.z - 8, car.z + 12, car.id);
    const right = this.laneFree(2, car.z - 8, car.z + 12, car.id);
    if (left && !right) return 0;
    if (right && !left) return 2;
    return car.x < 0 ? 0 : 2;
  }

  private aoriAct(car: Car, act: string): void {
    car.aggressive = true;
    this.events.push({ type: 'aori', carId: car.id, act });
  }

  private horn(car: Car): void {
    this.events.push({ type: 'horn', carId: car.id, dist: Math.abs(car.z - this.player.z) });
  }

  private thinkAori(car: Car, dt: number): void {
    const p = this.player;
    const A = C.aori;
    car.modeT += dt;
    car.ignorePlayer = true;
    car.override = null;
    car.weaveTarget = 0;
    car.sideOffset = 0;
    if (car.dodgeT > 0) car.dodgeT -= dt;
    if (car.laneDelay > 0) car.laneDelay -= dt;
    const pLane = p.targetLane;
    const dz = car.z - p.z;
    const half = (car.length + p.length) / 2;
    const gapBehind = -dz - half; // あおり車が後ろにいるときの車間
    const gapAhead = dz - half; // あおり車が前にいるときの車間
    // 蛇行していても「自車と同じ車線」とみなす
    const inLane = car.targetLane === pLane && Math.abs(car.x - laneX(pLane)) < 3.0;
    const weaveAmp = lerp(A.weaveStart, A.weaveEnd, this.progress);
    /** 自車の車線へ少し遅れて付いていく。移ったら true */
    const follow = (delay: number): boolean => {
      if (car.dodgeT > 0 || car.targetLane === pLane) return false;
      if (car.pendingLane !== pLane) {
        car.pendingLane = pLane;
        car.laneDelay = delay;
        return false;
      }
      if (car.laneDelay <= 0) {
        // 真横にいるときや、入る先に車がいるときは入らない（横からぶつけない）
        if (Math.abs(dz) - half < 2.5) return false;
        if (!this.laneFree(pLane, car.z - car.length / 2 - 2, car.z + car.length / 2 + 2, car.id)) return false;
        car.targetLane = pLane;
        return true;
      }
      return false;
    };
    /** 前で一定の車間を保つ速さ */
    const keepAhead = (gap: number) => p.speed + clamp((gap - gapAhead) * 0.7, -7, 8);
    /** 横の車線へ移る（自車の車線にいるとき） */
    const toSide = () => {
      if (car.dodgeT > 0 || car.laneDelay > 0 || !this.settled(car)) return;
      const want = car.targetLane === pLane || Math.abs(car.targetLane - pLane) !== 1 ? this.adjacentLane(pLane, car) : car.targetLane;
      if (want !== car.targetLane && this.laneFree(want, car.z - 8, car.z + 12, car.id)) {
        car.targetLane = want;
        car.laneDelay = 1.0;
      }
    };

    if (car.age > A.maxLife && car.mode !== 'leave') this.setMode(car, 'leave');

    switch (car.mode) {
      // ---- 後ろから迫って車間詰め ----
      case 'approachTail':
        if (dz > -2) {
          // 前や横にいるので、隣の車線で減速して後ろへ回る
          car.ignorePlayer = false;
          toSide();
          // 横へ移れるまでは、自車の真ん前で急に減速しない
          car.override = car.targetLane === pLane ? keepAhead(A.frontGap) : p.speed - 8;
        } else {
          if (dz > -80) follow(0.3);
          // 隣の車線のすぐ後ろでは並ばない（横からぶつけない）
          car.override = inLane
            ? p.speed + clamp((gapBehind - A.tailGap) * 0.8, -12, 11)
            : gapBehind < 8
              ? p.speed + clamp((gapBehind - 6) * 0.8, -8, 2)
              : p.speed + 11;
          if (inLane && gapBehind > -0.5 && gapBehind < A.weaveRange) {
            car.weaveTarget = weaveAmp;
            if (!car.aggressive) this.aoriAct(car, '蛇行運転');
          }
          if (inLane && gapBehind < A.tailGap + 2.5 && gapBehind > -0.5) {
            this.setMode(car, 'tailgate');
            car.hornT = 0.6;
            this.aoriAct(car, 'パッシング');
          }
        }
        if (car.modeT > 10) this.nextTactic(car);
        break;

      case 'tailgate':
        car.flashing = true;
        car.decel = 14;
        follow(0.6);
        // 車線を変えられても、まず車間を保ったまま付いていく
        car.override = p.speed + clamp((gapBehind - (inLane ? A.tailGap : 6)) * 1.6, -16, 7);
        if (inLane) car.weaveTarget = weaveAmp;
        car.hornT -= dt;
        if (car.hornT <= 0) {
          car.hornT = 1.2 + this.rng() * 0.8;
          this.horn(car);
        }
        if (car.modeT > car.tailTime) this.nextTactic(car);
        break;

      // ---- 追い越して前に割り込む ----
      case 'overtake':
        car.ignorePlayer = false;
        if (car.targetLane === pLane && gapAhead > 3 && this.settled(car)) {
          // すでに前にいる
          this.afterCut(car);
          break;
        }
        toSide();
        car.override = p.speed + 10;
        if (gapAhead > A.cutGap && this.settled(car) && car.targetLane !== pLane) {
          this.setMode(car, 'cutin');
          car.targetLane = pLane;
          car.lateralSpeed = A.cutLateral;
          this.aoriAct(car, '割り込み');
        } else if (car.modeT > 10) {
          this.nextTactic(car);
        }
        break;

      case 'cutin':
        car.lateralSpeed = A.cutLateral;
        if (car.dodgeT <= 0) car.targetLane = pLane;
        // 割り込みながら速度を落とし、車間が詰まったまま次の行動へ
        car.override = p.speed - 1.5;
        car.decel = 12;
        if (Math.abs(car.x - laneX(pLane)) < 0.5 && gapAhead > 0) this.afterCut(car);
        else if (car.modeT > 3) this.nextTactic(car);
        break;

      case 'brake':
        car.braking = true;
        car.decel = A.brakeDecel;
        car.override = 0;
        if (car.modeT > A.brakeTime) this.setMode(car, 'hold');
        break;

      case 'hold':
        car.override = keepAhead(A.holdGap);
        follow(0.5);
        if (car.modeT > A.holdTime) this.nextTactic(car);
        break;

      // ---- 前で蛇行・進路妨害 ----
      case 'frontWeave':
        car.override = keepAhead(A.frontGap) - (Math.sin(car.modeT * 1.3) > 0.6 ? 2 : 0);
        if (inLane) car.weaveTarget = weaveAmp * 0.9;
        if (car.modeT > 0.5 && gapAhead > 3 && follow(0.5)) {
          car.lateralSpeed = A.cutLateral;
          this.aoriAct(car, '進路妨害');
        }
        if (car.modeT > A.frontWeaveTime) this.nextTactic(car);
        break;

      // ---- ムダブレーキ ----
      case 'tap': {
        const phase = car.modeT % A.tapPeriod;
        car.braking = phase < A.tapOn;
        car.decel = A.tapDecel;
        car.override = car.braking ? car.speed - 4 : keepAhead(A.frontGap);
        if (car.modeT > 0.5 && gapAhead > 3 && follow(0.6)) {
          car.lateralSpeed = A.cutLateral;
          this.aoriAct(car, '進路妨害');
        }
        if (car.modeT > A.tapTime) {
          if (this.rng() < 0.4 && inLane && gapAhead > 2 && gapAhead < 16) this.beginBrake(car);
          else this.nextTactic(car);
        }
        break;
      }

      // ---- 並走して幅寄せ ----
      case 'sideApproach': {
        car.ignorePlayer = false;
        toSide();
        car.override = p.speed + clamp(-dz * 0.8, -8, 11);
        const beside = Math.abs(car.targetLane - pLane) === 1 && this.settled(car);
        if (beside && Math.abs(dz) < 2.5) {
          this.setMode(car, 'side');
          car.hornT = 0.4;
          this.aoriAct(car, '幅寄せ');
        } else if (car.modeT > 8) {
          this.nextTactic(car);
        }
        break;
      }

      case 'side': {
        car.ignorePlayer = false;
        car.override = p.speed + clamp(-dz * 1.2, -6, 6);
        // 自車のほうへ寄ってくる
        if (Math.abs(car.targetLane - pLane) === 1) {
          const toward = Math.sign(laneX(pLane) - laneX(car.targetLane));
          car.sideOffset = toward * Math.max(0, Math.sin(car.modeT * 2.6)) * A.swerve;
          car.lateralSpeed = 6;
        } else {
          toSide();
        }
        car.hornT -= dt;
        if (car.hornT <= 0) {
          car.hornT = 1.0 + this.rng() * 0.6;
          this.horn(car);
        }
        if (car.modeT > A.sideTime) {
          car.plan = 'cut';
          this.setMode(car, 'overtake');
        }
        break;
      }

      // ---- 前方で待ち構える（まだ何もしていない） ----
      case 'waitAhead':
        car.ignorePlayer = false;
        car.desired = p.speed - 9;
        if (gapAhead < 40 && gapAhead > 6 && car.targetLane !== pLane && this.settled(car) && car.laneDelay <= 0) {
          // 自車の前へ入る（車間はまだ広いので、あおりではない）
          if (this.laneFree(pLane, car.z - 10, car.z + 10, car.id)) {
            car.targetLane = pLane;
            car.laneDelay = 1.0;
          }
        }
        if (inLane && this.settled(car) && gapAhead < A.frontGap + 10 && gapAhead > 3) this.beginFront(car, car.plan);
        else if (gapAhead < -2 || car.modeT > 15) this.startTactic(car, 'tail'); // 抜かれたら後ろから
        break;

      case 'leave':
        car.ignorePlayer = false;
        car.desired = Math.max(p.speed + 14, 34);
        this.tryOvertake(car, 35, 1.5);
        break;
    }
    this.tryDodge(car);
  }

  /** 割り込んだあと、手口に合わせて次の行動へ */
  private afterCut(car: Car): void {
    switch (car.plan) {
      case 'frontWeave':
      case 'tap':
        this.beginFront(car, car.plan);
        break;
      case 'side':
      case 'cut':
      default:
        this.beginBrake(car);
    }
  }

  /** ミサイルが近づいたら一定の確率で車線を変えてかわす（自車から離れているときだけ） */
  private tryDodge(car: Car): void {
    if (car.dodgeT > 0) return;
    for (const m of this.missiles) {
      if (m.dead || m.checked.has(car.id)) continue;
      if (Math.abs(m.x - car.x) > car.width / 2 + 0.6) continue;
      const d = (car.z - m.z) * m.dir;
      if (d <= 0 || d > C.aori.dodgeRange) continue;
      m.checked.add(car.id);
      if (this.rng() >= this.dodgeChance(car)) continue;
      const lanes = [car.targetLane - 1, car.targetLane + 1].filter(
        (l) => l >= 0 && l < C.laneCount && this.laneFree(l, car.z - 6, car.z + 6, car.id),
      );
      if (lanes.length === 0) continue;
      car.targetLane = lanes[Math.floor(this.rng() * lanes.length)];
      car.dodgeT = 0.8;
      car.pendingLane = -1;
      car.laneDelay = 0.9;
      this.events.push({ type: 'dodge', carId: car.id });
      return;
    }
  }

  // ---- ミサイル ----
  private updateMissiles(dt: number, playing: boolean): void {
    const r = C.missile.radius;
    for (const m of this.missiles) {
      if (m.dead) continue;
      const z0 = m.z;
      m.z += m.speed * dt;
      m.traveled += C.missile.relSpeed * dt;
      if (!playing) {
        m.dead = true;
        continue;
      }
      const lo = Math.min(z0, m.z);
      const hi = Math.max(z0, m.z);
      let hit: Car | null = null;
      let best = Infinity;
      for (const c of this.cars) {
        if (c.wrecked) continue;
        const rear = c.z - c.length / 2;
        const front = c.z + c.length / 2;
        if (front < lo || rear > hi) continue;
        if (Math.abs(c.x - m.x) > c.width / 2 + r) {
          // 蛇行やかわす動きで、あおり車の横をすり抜けた（ミサイルはそのまま飛び続ける）
          if (c.kind === 'aori' && c.aggressive && !m.passed.has(c.id) && Math.abs(c.x - m.x) < 5) {
            m.passed.add(c.id);
            this.events.push({ type: 'whiff', carId: c.id });
          }
          continue;
        }
        const d = m.dir === 1 ? rear - lo : hi - front;
        if (d < best) {
          best = d;
          hit = c;
        }
      }
      if (hit) {
        m.dead = true;
        this.resolveHit(hit);
      } else if (m.traveled > C.missile.range) {
        m.dead = true;
      }
    }
    this.missiles = this.missiles.filter((m) => !m.dead);
  }

  private resolveHit(car: Car): void {
    const result = judgeHit(car);
    car.wrecked = true;
    car.result = result.kind;
    car.flashing = false;
    car.braking = false;
    car.wreckX = car.x <= 0 ? -6.3 : 5.6;
    if (result.kind === 'defeat') {
      this.defeated++;
    } else {
      this.wrongHits++;
      this.lastMissText = result.text;
    }
    this.events.push({ type: 'hit', result, carId: car.id, x: car.x, z: car.z });
    this.addMisses(result.misses);
  }

  private addMisses(n: number): void {
    if (n <= 0 || this.state !== 'playing') return;
    this.misses = Math.min(C.maxMisses, this.misses + n);
    if (this.misses >= C.maxMisses) {
      this.state = 'over';
      this.finishTime = this.time;
      this.events.push({ type: 'over' });
    }
  }

  // ---- 自車の接触 ----
  private collidePlayer(): void {
    const p = this.player;
    for (const car of this.cars) {
      if (car.wrecked) continue;
      const dx = car.x - p.x;
      const dz = car.z - p.z;
      const ox = (car.width + p.width) / 2 - Math.abs(dx);
      const oz = (car.length + p.length) / 2 - Math.abs(dz);
      if (ox <= 0.05 || oz <= 0.05) continue;
      if (p.invuln <= 0) {
        p.invuln = C.player.invuln;
        this.crashes++;
        this.lastMissText = '他の車にぶつかった！';
        this.events.push({ type: 'crash', carId: car.id, x: (car.x + p.x) / 2, z: (car.z + p.z) / 2 });
        this.addMisses(1);
      }
      if (ox < oz) {
        // 横からの接触: 元の車線へ戻す
        p.x -= Math.sign(dx || 1) * (ox + 0.05);
        p.targetLane = p.prevLane;
      } else if (dz > 0) {
        p.z = car.z - (car.length + p.length) / 2 - 0.05;
        p.speed = clamp(Math.min(p.speed, car.speed - 2), kmh(C.player.minKmh), kmh(C.player.maxKmh));
      } else {
        car.z = p.z - (car.length + p.length) / 2 - 0.05;
        car.speed = Math.max(0, Math.min(car.speed, p.speed - 2));
      }
    }
  }

  private despawn(): void {
    const p = this.player;
    const T = C.traffic;
    this.cars = this.cars.filter((car) => {
      const dz = car.z - p.z;
      const out = dz > T.ahead + 60 || dz < -(T.behind + 40);
      if (out && car.kind === 'aori' && car.aggressive && !car.wrecked) {
        this.escaped++;
        this.events.push({ type: 'escape', carId: car.id });
      }
      return !out;
    });
  }

  private checkProgress(): void {
    const prog = this.progress;
    while (this.nextIc < ROUTE.length && prog >= icProgress(this.nextIc) - 1e-9) {
      this.events.push({ type: 'ic', index: this.nextIc, name: ROUTE[this.nextIc].name });
      this.nextIc++;
    }
    if (this.player.z >= C.courseLength) {
      this.state = 'clear';
      this.finishTime = this.time;
      this.events.push({ type: 'clear' });
    }
  }
}
