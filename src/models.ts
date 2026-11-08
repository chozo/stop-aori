// 車・テクスチャ・文字の吹き出しをコードで作る
import * as THREE from 'three';
import { DIMS } from './config';
import type { Model } from './types';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14).rotateZ(Math.PI / 2);
const tubeGeo = new THREE.CylinderGeometry(0.11, 0.11, 1, 10).rotateX(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.15, metalness: 0.6 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
const paintCache = new Map<string, THREE.MeshStandardMaterial>();

export function paint(color: number, roughness = 0.4, metalness = 0.35): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`;
  let m = paintCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    paintCache.set(key, m);
  }
  return m;
}

function box(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  glowTex ??= canvasTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  return glowTex;
}

let smokeTex: THREE.Texture | null = null;
export function smokeTexture(): THREE.Texture {
  smokeTex ??= canvasTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  return smokeTex;
}

let starTex: THREE.Texture | null = null;
export function starTexture(): THREE.Texture {
  starTex ??= canvasTexture(64, 64, (g) => {
    g.translate(32, 32);
    g.fillStyle = '#ffe14a';
    g.strokeStyle = '#a86a00';
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 28 : 12;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
  });
  return starTex;
}

let shadowTex: THREE.Texture | null = null;
function shadowTexture(): THREE.Texture {
  shadowTex ??= canvasTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 8, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  return shadowTex;
}
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ map: null, transparent: true, depthWrite: false });

// ---- 文字の吹き出し ----
const textCache = new Map<string, { tex: THREE.Texture; aspect: number }>();
export function textSprite(text: string, bg: string, fg: string, height = 0.05): THREE.Sprite {
  const key = `${text}|${bg}|${fg}`;
  let entry = textCache.get(key);
  if (!entry) {
    const font = 'bold 64px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
    const meas = document.createElement('canvas').getContext('2d')!;
    meas.font = font;
    const w = Math.ceil(meas.measureText(text).width) + 56;
    const h = 104;
    const tex = canvasTexture(w, h, (g) => {
      g.font = font;
      g.fillStyle = bg;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = 6;
      const r = 30;
      g.beginPath();
      g.roundRect(4, 4, w - 8, h - 8, r);
      g.fill();
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (bg === 'rgba(0,0,0,0)') {
        // 背景なし: 太い縁取りの文字
        g.clearRect(0, 0, w, h);
        g.lineJoin = 'round';
        g.lineWidth = 14;
        g.strokeStyle = '#7a2a00';
        g.strokeText(text, w / 2, h / 2 + 3);
      }
      g.fillStyle = fg;
      g.fillText(text, w / 2, h / 2 + 3);
    });
    entry = { tex, aspect: w / h };
    textCache.set(key, entry);
  }
  // 距離によらず同じ大きさで見せる（height は画面の高さに対する割合のめやす）
  const mat = new THREE.SpriteMaterial({ map: entry.tex, depthTest: false, transparent: true, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(height * entry.aspect, height, 1);
  s.renderOrder = 10;
  s.layers.set(1); // 後方モニターには映さない（左右反転で読めなくなるため）
  return s;
}

export function signTexture(main: string, sub: string): THREE.Texture {
  return canvasTexture(512, 192, (g) => {
    g.fillStyle = '#0f6b3a';
    g.fillRect(0, 0, 512, 192);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.strokeRect(10, 10, 492, 172);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 76px "Hiragino Sans", "Noto Sans JP", sans-serif';
    g.fillText(main, 256, 82);
    g.font = 'bold 36px "Hiragino Sans", "Noto Sans JP", sans-serif';
    g.fillText(sub, 256, 152);
  });
}

// ---- 車 ----
export interface CarMesh {
  root: THREE.Group;
  body: THREE.Group;
  headMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
  headGlow: THREE.Sprite[];
  tailGlow: THREE.Sprite[];
  height: number;
}

function glow(color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  s.scale.set(size, size, 1);
  s.visible = false;
  return s;
}

/** 車を作る。前は -z 向き */
export function buildCarMesh(model: Model, color: number, opts: { player?: boolean } = {}): CarMesh {
  const d = DIMS[model];
  const L = d.length;
  const W = d.width;
  const H = d.height;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a1a, emissiveIntensity: 0.4 });
  const pm = paint(color);
  let lightY = 0.75;

  if (model === 'truck') {
    body.add(box(pm, W, 2.3, 2.1, 0, 1.55, -L / 2 + 1.05)); // キャブ
    body.add(box(glassMat, W * 0.9, 0.9, 0.05, 0, 2.05, -L / 2 - 0.01));
    body.add(box(paint(0xcfd5da, 0.5, 0.6), W, H - 0.55, L - 2.3, 0, 0.55 + (H - 0.55) / 2, 1.15)); // 荷台
    body.add(box(darkMat, W * 0.95, 0.35, L, 0, 0.55, 0));
    lightY = 0.8;
  } else if (model === 'bus') {
    body.add(box(pm, W, H - 0.4, L, 0, 0.4 + (H - 0.4) / 2, 0));
    body.add(box(glassMat, W + 0.02, 0.9, L * 0.86, 0, H - 1.0, 0.3));
    body.add(box(glassMat, W * 0.9, 1.1, 0.05, 0, H - 1.0, -L / 2 - 0.01));
    body.add(box(paint(0xf2f2f2), W + 0.03, 0.25, L, 0, 1.35, 0));
    lightY = 0.8;
  } else {
    const lowH = H * 0.42;
    const base = 0.3;
    body.add(box(pm, W, lowH, L, 0, base + lowH / 2, 0));
    const cab: Record<string, [number, number, number]> = {
      // [長さの割合, 高さの割合, 後ろへのずれ]
      sedan: [0.46, 0.38, 0.06],
      compact: [0.58, 0.42, 0.1],
      suv: [0.6, 0.42, 0.1],
      minivan: [0.72, 0.46, 0.06],
      sports: [0.38, 0.33, 0.08],
    };
    const [cl, ch, co] = cab[model];
    const cabL = L * cl;
    const cabH = H * ch;
    const top = base + lowH;
    body.add(box(glassMat, W * 0.84, cabH, cabL, 0, top + cabH / 2, L * co));
    body.add(box(pm, W * 0.86, 0.07, cabL * 0.9, 0, top + cabH, L * co));
    lightY = base + lowH * 0.65;
    if (opts.player) {
      // 屋根のミサイル発射台（前向きと後ろ向き）
      const lm = paint(0x3d4650, 0.6, 0.5);
      const roof = top + cabH + 0.1;
      body.add(box(lm, 1.0, 0.16, 1.5, 0, roof, L * co));
      for (const sx of [-0.28, 0.28]) {
        const f = new THREE.Mesh(tubeGeo, lm);
        f.scale.set(1, 1, 0.9);
        f.position.set(sx, roof + 0.2, L * co - 0.35);
        body.add(f);
        const r = new THREE.Mesh(tubeGeo, lm);
        r.scale.set(1, 1, 0.6);
        r.position.set(sx, roof + 0.2, L * co + 0.45);
        body.add(r);
        body.add(box(paint(0xff4422, 0.5, 0.1), 0.18, 0.18, 0.06, sx, roof + 0.2, L * co - 0.82));
        body.add(box(paint(0xffcc22, 0.5, 0.1), 0.18, 0.18, 0.06, sx, roof + 0.2, L * co + 0.77));
      }
      // 側面のライン
      body.add(box(paint(0xffffff, 0.5, 0.1), W + 0.02, 0.08, L * 0.9, 0, base + lowH * 0.55, 0));
    }
  }

  // タイヤ
  const wz = L / 2 - (model === 'bus' ? 2.0 : model === 'truck' ? 1.4 : 0.8);
  const wheelZ = model === 'truck' || model === 'bus' ? [-wz, wz, wz - 1.3] : [-wz, wz];
  for (const z of wheelZ) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(sx * (W / 2 - 0.08), 0.34, z);
      body.add(w);
    }
  }

  // ライト
  const headGlow: THREE.Sprite[] = [];
  const tailGlow: THREE.Sprite[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.3);
    body.add(box(headMat, 0.42, 0.15, 0.06, x, lightY, -L / 2 - 0.02));
    body.add(box(tailMat, 0.38, 0.14, 0.06, x, lightY, L / 2 + 0.02));
    const hg = glow(0xfff4d0, 2.4);
    hg.position.set(x, lightY, -L / 2 - 0.3);
    body.add(hg);
    headGlow.push(hg);
    const tg = glow(0xff2a1a, 1.5);
    tg.position.set(x, lightY, L / 2 + 0.25);
    body.add(tg);
    tailGlow.push(tg);
  }

  // 影
  shadowMat.map ??= shadowTexture();
  const sh = new THREE.Mesh(shadowGeo, shadowMat);
  sh.scale.set(W * 1.5, 1, L * 1.25);
  sh.position.y = 0.03;
  root.add(sh);

  return { root, body, headMat, tailMat, headGlow, tailGlow, height: H };
}
