import './style.css';
import { CONFIG as C } from './config';
import { World } from './sim';
import { Renderer } from './render';
import { Sfx } from './audio';
import { ROUTE, kmRemaining, nextIcIndex, TOTAL_KM } from './route';
import { rank } from './rules';
import type { GameEvent } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const gameEl = $('game');
const hud = $('hud');
const titleEl = $('title');
const resultEl = $('result');
const pausedEl = $('paused');

const renderer = new Renderer($<HTMLCanvasElement>('view'));
const sfx = new Sfx();

type Phase = 'title' | 'playing' | 'paused' | 'result';
let phase: Phase = 'title';
let world = new World(12345); // タイトル画面の背景として走らせる
let demo = true;
let timeScale = 1;
let manual = false;
let acc = 0;
let last = performance.now();
let resultTimer = -1;
const eventLog: GameEvent[] = [];
const announced = new Set<number>();

const rearEl = $('rearview');
function resize(): void {
  const r = gameEl.getBoundingClientRect();
  const w = Math.max(1, r.width);
  const h = Math.max(1, r.height);
  // 後方モニターは HTML の枠に合わせて描く（縦向き・横向きで位置が変わる）
  const m = rearEl.getBoundingClientRect();
  const bw = 3; // 枠線の太さ
  const rear =
    m.width > 0
      ? { x: (m.left + bw - r.left) / w, y: (m.top + bw - r.top) / h, w: (m.width - bw * 2) / w, h: (m.height - bw * 2) / h }
      : null;
  renderer.resize(w, h, rear);
}
const ro = new ResizeObserver(resize);
ro.observe(gameEl);
ro.observe(rearEl);
resize();

// ---- 重い端末では解像度を下げる ----
let slowT = 0;
let fastT = 0;
let frameAvg = 1 / 60;
const maxRatio = Math.min(window.devicePixelRatio, 2);
function adaptQuality(dt: number): void {
  if (phase !== 'playing') return;
  frameAvg += (dt - frameAvg) * 0.05;
  if (frameAvg > 1 / 45) {
    slowT += dt;
    fastT = 0;
  } else if (frameAvg < 1 / 58) {
    fastT += dt;
    slowT = 0;
  }
  if (slowT > 1.5) {
    slowT = 0;
    if (renderer.rearEvery === 1) renderer.rearEvery = 2;
    else if (renderer.pixelRatio > 1) renderer.setPixelRatio(Math.max(1, renderer.pixelRatio - 0.25));
  } else if (fastT > 8 && renderer.pixelRatio < maxRatio) {
    fastT = 0;
    renderer.setPixelRatio(Math.min(maxRatio, renderer.pixelRatio + 0.25));
  }
}

const vibrate = (ms: number | number[]) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 対応していない端末は無視 */
  }
};

// ---- 画面の切り替え ----
function start(seed = Math.floor(Math.random() * 1e9)): void {
  world = new World(seed);
  demo = false;
  renderer.reset();
  announced.clear();
  acc = 0;
  resultTimer = -1;
  phase = 'playing';
  titleEl.hidden = true;
  resultEl.hidden = true;
  pausedEl.hidden = true;
  hud.hidden = false;
  sfx.start();
  eventLog.length = 0;
  banner('東京IC 出発！ 名古屋ICを目指せ');
}

function toTitle(): void {
  world = new World(12345);
  demo = true;
  renderer.reset();
  phase = 'title';
  hud.hidden = true;
  resultEl.hidden = true;
  pausedEl.hidden = true;
  titleEl.hidden = false;
  sfx.engineUpdate(0, false);
}

function setPaused(on: boolean): void {
  if (on && phase === 'playing') {
    phase = 'paused';
    pausedEl.hidden = false;
    sfx.engineUpdate(0, false);
  } else if (!on && phase === 'paused') {
    phase = 'playing';
    pausedEl.hidden = true;
    last = performance.now();
  }
}

function showResult(): void {
  phase = 'result';
  const clear = world.state === 'clear';
  $('rKicker').textContent = clear ? '名古屋IC 到着' : `${ROUTE[Math.max(0, world.nextIc - 1)].name} IC 付近でリタイア`;
  $('rTitle').textContent = clear ? 'クリア！' : 'ゲームオーバー';
  $('rReason').textContent = clear ? '' : `最後のミス：${world.lastMissText}`;
  $('rKills').textContent = String(world.defeated);
  $('rMiss').textContent = String(world.misses);
  const t = world.finishTime;
  $('rTime').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  $('rDist').textContent = `${(TOTAL_KM - kmRemaining(world.progress)).toFixed(0)}km`;
  const score = world.score;
  $('rScore').textContent = score.toLocaleString();
  $('rRank').textContent = clear ? rank(score, clear) : '';
  resultEl.hidden = false;
  sfx.engineUpdate(0, false);
}

// ---- 表示 ----
function toast(text: string, kind: 'good' | 'bad' | 'warn' | 'info' | 'aori'): void {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild?.remove();
  setTimeout(() => el.remove(), 1700);
}

let bannerTimer = 0;
function banner(text: string): void {
  const b = $('banner');
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => b.classList.remove('show'), 1800);
}

// 命中の瞬間、時間を一瞬ゆっくりにする（ヒットストップ）
let hitStop = 0;
function boomFlash(): void {
  const f = $('boom');
  f.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
}

function flashRed(): void {
  const f = $('flash');
  f.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
}

function handleEvents(): void {
  // ゲームが終わったあとは、終わりの音以外は鳴らさない（周りの車のクラクションなど）。
  // 終わりの原因になった命中・接触の音は鳴らす
  let ended = world.state !== 'playing' && !world.events.some((e) => e.type === 'over' || e.type === 'clear');
  for (const e of world.events) {
    renderer.onEvent(e, world);
    if (demo) continue;
    eventLog.push(e);
    if (eventLog.length > 1000) eventLog.shift();
    if (ended) continue;
    if (e.type === 'over' || e.type === 'clear') ended = true;
    switch (e.type) {
      case 'fire':
        sfx.fire();
        break;
      case 'hit':
        sfx.boom(e.result.kind === 'defeat');
        boomFlash();
        hitStop = e.result.kind === 'defeat' ? 0.14 : 0.08;
        if (e.result.kind === 'defeat') {
          sfx.defeat();
          vibrate(30);
        } else {
          sfx.miss();
          flashRed();
          vibrate([60, 40, 60]);
          toast(`${e.result.text}  ミス${e.result.misses > 1 ? '×' + e.result.misses : ''}`, 'bad');
        }
        break;
      case 'crash':
        sfx.crash();
        sfx.miss();
        flashRed();
        vibrate(120);
        toast('接触！  ミス', 'bad');
        break;
      case 'horn':
        sfx.horn(e.dist);
        break;
      case 'aori':
        if (!announced.has(e.carId)) {
          announced.add(e.carId);
          toast('あおり運転を確認！ 撃退せよ', 'aori');
        }
        break;
      case 'dodge':
        sfx.dodge();
        toast('かわされた！', 'warn');
        break;
      case 'whiff':
        toast('外れた！', 'warn');
        break;
      case 'escape':
        toast('あおり車に逃げられた', 'info');
        break;
      case 'ic':
        // 画面には出さない（プレイの邪魔になるため）。音だけで知らせる
        sfx.chime();
        break;
      case 'clear':
        sfx.clear();
        resultTimer = 2.2;
        break;
      case 'over':
        sfx.over();
        resultTimer = 1.8;
        break;
    }
  }
  world.events.length = 0;
}

let hudT = 0;
function updateHud(dt: number): void {
  if (phase === 'title') return;
  hudT -= dt;
  const p = world.player;
  // 後方から車間を詰めてくる車があれば知らせる（あおり車かどうかは教えない）
  const close = world.cars.some((c) => {
    if (c.wrecked || Math.abs(c.x - p.x) > 1.6) return false;
    const gap = p.z - c.z - (c.length + p.length) / 2;
    return gap > -0.5 && gap < 12;
  });
  $('warn').classList.toggle('show', close && world.state === 'playing');
  const setGauge = (id: string, cd: number) => {
    const els = [$(id), document.querySelector<HTMLElement>(id === 'gF' ? '.fire.front' : '.fire.rear')];
    for (const el of els) {
      if (!el) continue;
      el.classList.toggle('cool', cd > 0);
      const bar = el.querySelector('i');
      if (bar) bar.style.transform = `scaleX(${1 - cd / C.missile.cooldown})`;
    }
  };
  setGauge('gF', world.cooldown.front);
  setGauge('gR', world.cooldown.rear);
  if (hudT > 0) return;
  hudT = 0.1;
  $('km').textContent = kmRemaining(world.progress).toFixed(1);
  $('prog').style.width = `${world.progress * 100}%`;
  $('nextIc').textContent = ROUTE[nextIcIndex(world.progress)].name;
  $('speed').textContent = String(Math.round(p.speed * 3.6));
  $('kills').textContent = String(world.defeated);
  $('lives').innerHTML = Array.from({ length: C.maxMisses }, (_, i) =>
    i < world.misses ? '<span class="x">✕</span>' : '<span class="o">●</span>',
  ).join('');
}

// ---- 進行 ----
const STEP = 1 / 60;
function stepOnce(): void {
  world.step(STEP);
  if (demo) {
    world.misses = 0; // タイトルの背景はミスで止めない
    if (world.state !== 'playing') world = new World(Math.floor(Math.random() * 1e9));
    autoDrive();
  }
  handleEvents();
}

/** タイトル画面の背景で、ぶつからないように軽く運転する */
function autoDrive(): void {
  const p = world.player;
  const ahead = world.cars.find(
    (c) => !c.wrecked && Math.abs(c.x - p.x) < 2 && c.z > p.z && c.z - p.z < 22,
  );
  if (ahead && Math.abs(p.x - (p.targetLane - 1) * C.laneWidth) < 0.2) {
    const options = [p.targetLane - 1, p.targetLane + 1].filter(
      (l) =>
        l >= 0 &&
        l < 3 &&
        world.laneFree(l, p.z - 8, p.z + 16, 0),
    );
    if (options.length) {
      if (options[0] < p.targetLane) world.laneLeft();
      else world.laneRight();
    }
  }
}

function advance(dt: number): number {
  if (phase === 'paused') return 0;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 600) {
    stepOnce();
    acc -= STEP;
    n++;
  }
  if (resultTimer > 0) {
    resultTimer -= n * STEP;
    if (resultTimer <= 0 && phase === 'playing') showResult();
  }
  return n * STEP;
}

function draw(simDt: number, realDt: number): void {
  renderer.sync(world, simDt);
  renderer.render(phase !== 'title');
  updateHud(realDt);
  if (phase === 'playing') sfx.engineUpdate(world.player.speed * 3.6, world.state === 'playing');
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let scale = timeScale;
  if (hitStop > 0) {
    hitStop -= dt;
    scale *= 0.12;
  }
  const simDt = manual ? 0 : advance(dt * scale);
  draw(simDt, dt);
  if (!manual) adaptQuality(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- 操作 ----
type Action = 'left' | 'right' | 'accel' | 'brake' | 'fireF' | 'fireR';
function press(a: Action): void {
  if (phase !== 'playing') return;
  if (a === 'left') world.laneLeft();
  else if (a === 'right') world.laneRight();
  else if (a === 'accel') world.input.accel = true;
  else if (a === 'brake') world.input.brake = true;
  else if (a === 'fireF') world.fire(1);
  else if (a === 'fireR') world.fire(-1);
}
function release(a: Action): void {
  if (a === 'accel') world.input.accel = false;
  else if (a === 'brake') world.input.brake = false;
}

const KEYS: Record<string, Action> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'accel',
  KeyW: 'accel',
  ArrowDown: 'brake',
  KeyS: 'brake',
  KeyZ: 'fireF',
  Space: 'fireF',
  KeyJ: 'fireF',
  KeyX: 'fireR',
  KeyK: 'fireR',
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && (phase === 'title' || phase === 'result')) {
    start();
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    setPaused(phase === 'playing');
    return;
  }
  if (e.code === 'KeyM') {
    toggleMute();
    return;
  }
  const a = KEYS[e.code];
  if (!a) return;
  e.preventDefault();
  if (e.repeat && a !== 'accel' && a !== 'brake') return;
  press(a);
});
window.addEventListener('keyup', (e) => {
  const a = KEYS[e.code];
  if (a) release(a);
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('#touch button')) {
  const a = btn.dataset.act as Action;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('down');
    press(a);
  });
  const up = () => {
    btn.classList.remove('down');
    release(a);
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

function toggleMute(): void {
  sfx.setMuted(!sfx.muted);
  $('mute').textContent = sfx.muted ? '🔇' : '🔊';
}

$('startBtn').addEventListener('click', () => start());
$('retryBtn').addEventListener('click', () => start());
$('titleBtn').addEventListener('click', () => toTitle());
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('pause').addEventListener('click', () => setPaused(true));
$('mute').addEventListener('click', toggleMute);

// 全画面（Android の Chrome など。iPhone の Safari は未対応なので出さない）
const fsTarget = document.documentElement;
const canFullscreen = !!fsTarget.requestFullscreen && document.fullscreenEnabled && matchMedia('(pointer: coarse)').matches;
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void fsTarget.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
}
if (canFullscreen) {
  $('fsBtn').hidden = false;
  $('fsStart').hidden = false;
  $('fsBtn').addEventListener('click', toggleFullscreen);
  $('fsStart').addEventListener('click', () => {
    if (!document.fullscreenElement) toggleFullscreen();
    start();
  });
}
// iPhone の Safari で2本指の拡大を防ぐ
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener('blur', () => {
  world.input.accel = false;
  world.input.brake = false;
});

// ---- 確認用の入口 ----
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  get phase() {
    return phase;
  },
  state() {
    const w = world;
    return {
      phase,
      state: w.state,
      time: w.time,
      z: w.player.z,
      x: w.player.x,
      progress: w.progress,
      misses: w.misses,
      defeated: w.defeated,
      escaped: w.escaped,
      wrongHits: w.wrongHits,
      crashes: w.crashes,
      speedKmh: w.player.speed * 3.6,
      lane: w.player.targetLane,
      score: w.score,
      cars: w.cars.map((c) => ({
        id: c.id,
        kind: c.kind,
        x: c.x,
        z: c.z,
        aggressive: c.aggressive,
        mode: c.mode,
        wrecked: c.wrecked,
        braking: c.braking,
      })),
    };
  },
  start,
  toTitle,
  setTimeScale(s: number) {
    timeScale = s;
  },
  manual(on: boolean) {
    manual = on;
  },
  step(n = 1) {
    for (let i = 0; i < n; i++) advance(STEP);
    draw(n * STEP, n * STEP);
  },
  press,
  release,
  tap(a: Action) {
    press(a);
    release(a);
  },
  drainEvents() {
    const e = eventLog.slice();
    eventLog.length = 0;
    return e;
  },
  world: () => world,
  audio: sfx,
  renderer,
};
