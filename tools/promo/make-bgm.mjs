// 告知動画のBGM（ポップで軽快な曲）を一から合成して tools/promo/bgm.wav に書き出す。
// 使い方: node tools/promo/make-bgm.mjs
// 明るい長調（C→G→Am→F）、BPM156。跳ねるベース・裏拍の和音・ピコピコしたメロディ・手拍子・グロッケン。
// 外部の音源は使っていない（著作権の心配なし）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const BPM = 156;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 20;
const LEN = Math.ceil((BARS * BAR + 1.6) * SR);
const L = new Float32Array(LEN);
const R = new Float32Array(LEN);

// 決まった乱数（毎回同じ音にする）
let seed = 20261108;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const hz = (name) => {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  return 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12);
};

/** 音を足す。wave(位相, 経過秒) は -1〜1、env(経過秒) は 0〜1。pan は -1（左）〜1（右） */
function add(t0, dur, vol, pan, sample) {
  const i0 = Math.floor(t0 * SR);
  const n = Math.floor(dur * SR);
  const gl = vol * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = vol * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let k = 0; k < n && i0 + k < LEN; k++) {
    const v = sample(k / SR);
    L[i0 + k] += v * gl;
    R[i0 + k] += v * gr;
  }
}
const env = (t, a, d, s, len, r) => {
  if (t < a) return t / a;
  if (t < a + d) return 1 - ((1 - s) * (t - a)) / d;
  if (t < len) return s;
  return Math.max(0, s * (1 - (t - len) / r));
};
// 帯域を制限した波形（倍音を足して作るので耳に痛くない）
const pulse = (ph, f) => {
  let v = 0;
  for (let n = 1; n * f < 9000 && n <= 12; n++) v += Math.sin(2 * Math.PI * n * ph) * (n % 2 ? 1 : 0.55) / n;
  return v * 0.7;
};
const tri = (ph, f) => {
  let v = 0;
  for (let n = 1; n * f < 6000 && n <= 9; n += 2) v += ((n % 4 === 1 ? 1 : -1) * Math.sin(2 * Math.PI * n * ph)) / (n * n);
  return v * 0.9;
};
const saw = (ph, f) => {
  let v = 0;
  for (let n = 1; n * f < 8000 && n <= 10; n++) v += Math.sin(2 * Math.PI * n * ph) / n;
  return v * 0.55;
};

// ---- 楽器 ----
function lead(t0, note, beats, vol = 0.16) {
  const f = hz(note);
  const len = beats * BEAT * 0.82;
  add(t0, len + 0.12, vol, 0.1, (t) => {
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 6 * t) * Math.min(1, t / 0.12);
    return pulse(f * vib * t, f) * env(t, 0.005, 0.08, 0.7, len, 0.1);
  });
  // すぐ後ろに小さく同じ音（エコー）で広がりを出す
  add(t0 + BEAT * 0.75, len + 0.12, vol * 0.28, -0.5, (t) => pulse(f * t, f) * env(t, 0.005, 0.08, 0.6, len, 0.1));
}
function bass(t0, note, vol = 0.3) {
  const f = hz(note);
  const len = BEAT * 0.42;
  add(t0, len + 0.05, vol, 0, (t) => tri(f * t, f) * env(t, 0.003, 0.05, 0.75, len, 0.04));
}
function stab(t0, notes, vol = 0.07) {
  notes.forEach((n, i) => {
    const f = hz(n);
    add(t0, 0.2, vol, (i - 1) * 0.45, (t) => saw(f * t, f) * Math.exp(-t * 16));
  });
}
function glock(t0, note, vol = 0.07) {
  const f = hz(note);
  add(t0, 0.9, vol, 0.55, (t) => (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 9)) * Math.exp(-t * 4.5));
}
function kick(t0, vol = 0.42) {
  let ph = 0;
  add(t0, 0.16, vol, 0, (t) => {
    const f = 55 + 95 * Math.exp(-t * 32);
    ph += f / SR;
    return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 22);
  });
}
function clap(t0, vol = 0.22) {
  let prev = 0;
  add(t0, 0.18, vol, 0, (t) => {
    const n = rnd();
    const hp = n - prev; // 低い音を削る
    prev = n;
    const bursts = t < 0.03 ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.35) : Math.exp(-(t - 0.03) * 28);
    return hp * 0.6 * bursts;
  });
}
function hat(t0, vol = 0.05, open = false) {
  let prev = 0;
  add(t0, open ? 0.12 : 0.035, vol, 0.35, (t) => {
    const n = rnd();
    const hp = n - prev;
    prev = n;
    return hp * Math.exp(-t * (open ? 30 : 110));
  });
}

// ---- 曲 ----
const CHORDS = [
  { root: 'C', bass: ['C3', 'C4'], stab: ['E4', 'G4', 'C5'], arp: ['C6', 'E6', 'G6', 'E6'] },
  { root: 'G', bass: ['G2', 'G3'], stab: ['D4', 'G4', 'B4'], arp: ['B5', 'D6', 'G6', 'D6'] },
  { root: 'Am', bass: ['A2', 'A3'], stab: ['E4', 'A4', 'C5'], arp: ['A5', 'C6', 'E6', 'C6'] },
  { root: 'F', bass: ['F2', 'F3'], stab: ['F4', 'A4', 'C5'], arp: ['A5', 'C6', 'F6', 'C6'] },
];
// メロディ（8分音符単位。null は休み、[音, 長さ(8分)]）
const A = [
  ['E5', 'G5', 'C6', 'G5', 'E5', 'G5', 'A5', 'G5'],
  ['D5', 'G5', 'B5', 'G5', 'D5', 'B4', 'D5', 'G5'],
  ['C5', 'E5', 'A5', 'E5', 'C6', 'B5', 'A5', 'E5'],
  ['F5', 'A5', 'C6', 'A5', 'G5', 'F5', 'E5', 'D5'],
];
const B = [
  [['C6', 2], null, 'C6', 'B5', ['C6', 2], null, 'G5'],
  [['B5', 2], null, 'B5', 'A5', ['B5', 2], null, 'D6'],
  [['C6', 2], null, 'B5', 'A5', ['G5', 2], null, 'E5'],
  ['F5', 'G5', 'A5', ['C6', 2], null, ['B5', 1], 'G5'],
];
// 小節ごとの構成: 0〜1 前奏、2〜5 A、6〜9 B、10〜13 A（きらきら）、14〜17 B（きらきら）、18〜19 A
const melodyOf = (bar) => (bar < 2 ? null : bar < 6 ? A : bar < 10 ? B : bar < 14 ? A : bar < 18 ? B : A);

for (let bar = 0; bar < BARS; bar++) {
  const t = bar * BAR;
  const ch = CHORDS[bar % 4];
  for (let b = 0; b < 4; b++) {
    const tb = t + b * BEAT;
    // ドラム: キックは1・3拍（サビは4つ打ち）、手拍子は2・4拍、ハイハットは8分
    if (b % 2 === 0 || bar >= 10) kick(tb, b % 2 === 0 ? 0.42 : 0.3);
    if (b % 2 === 1) clap(tb);
    hat(tb + BEAT / 2, 0.06, b === 3 && bar % 2 === 1);
    hat(tb, 0.025);
    if (bar >= 6) hat(tb + BEAT * 0.25, 0.018), hat(tb + BEAT * 0.75, 0.018);
    // ベース: 8分でオクターブを跳ねる
    bass(tb, ch.bass[0]);
    bass(tb + BEAT / 2, ch.bass[1], 0.24);
    // 裏拍の和音
    stab(tb + BEAT / 2, ch.stab);
  }
  // グロッケンのきらきら（後半）
  if (bar >= 10 && bar < 18) {
    for (let i = 0; i < 8; i++) glock(t + i * (BEAT / 2), ch.arp[i % 4], 0.045);
  }
  // メロディ
  const mel = melodyOf(bar);
  if (mel) {
    let pos = 0;
    for (const n of mel[bar % 4]) {
      if (n === null) { pos += 1; continue; }
      const [note, len] = Array.isArray(n) ? n : [n, 1];
      lead(t + pos * (BEAT / 2), note, len / 2);
      pos += len;
    }
  }
}
// 最後に和音をジャーンと鳴らす
const end = BARS * BAR;
kick(end, 0.5);
clap(end, 0.25);
hat(end, 0.08, true);
['C4', 'E4', 'G4', 'C5', 'E5', 'G5'].forEach((n, i) => {
  const f = hz(n);
  add(end, 1.5, 0.07, (i % 3) * 0.5 - 0.5, (t) => saw(f * t, f) * Math.exp(-t * 2.2));
});
bass(end, 'C3', 0.35);
glock(end, 'C6', 0.08);

// ---- 書き出し（ピークを -1 dBFS にそろえる）----
let peak = 0;
for (let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.89 / peak;
const out = Buffer.alloc(44 + LEN * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + LEN * 4, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(LEN * 4, 40);
for (let i = 0; i < LEN; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
}
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bgm.wav');
fs.writeFileSync(file, out);
console.log(`${file}（${(LEN / SR).toFixed(1)} 秒、BPM ${BPM}）`);
