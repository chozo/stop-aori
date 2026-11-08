// 道路と景色。自車の位置に合わせて作り直す
import * as THREE from 'three';
import { CONFIG as C } from './config';
import { ROUTE, icProgress } from './route';
import { buildCarMesh, paint, signTexture } from './models';
import { mulberry32 } from './sim';

const SEG = 40; // 景色を置く区切り（m）
const ROAD_TILE = 20; // 路面テクスチャ1枚の長さ（m）
const ROAD_LEFT = -7.6;
const ROAD_RIGHT = 6.3;
const MEDIAN_X = 6.75;

/** 東京ICからの km によって景色を変える */
const region = (km: number) => ({
  urban: km < 42 || km > 300,
  hills: (km > 45 && km < 125) || (km > 175 && km < 270),
  fuji: km > 65 && km < 150,
  sea: (km > 133 && km < 150) || (km > 262 && km < 282),
  tea: km > 170 && km < 215,
});

function roadTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4d52';
  g.fillRect(0, 0, w, h);
  // ざらつき
  for (let i = 0; i < 3000; i++) {
    const v = 60 + Math.random() * 30;
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  const px = (x: number) => ((x - ROAD_LEFT) / (ROAD_RIGHT - ROAD_LEFT)) * w;
  const lw = (0.15 / (ROAD_RIGHT - ROAD_LEFT)) * w;
  g.fillStyle = '#f4f4f0';
  // 外側線
  g.fillRect(px(-5.4) - lw / 2, 0, lw, h);
  g.fillRect(px(5.4) - lw / 2, 0, lw, h);
  // 車線境界の破線（8m 線 / 12m 空き）
  for (const x of [-1.8, 1.8]) g.fillRect(px(x) - lw / 2, 0, lw, (8 / ROAD_TILE) * h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function railTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8eaec';
  g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#9aa0a6';
  g.fillRect(0, 0, 6, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  trunk: new THREE.CylinderGeometry(0.2, 0.28, 1, 6),
  crown: new THREE.ConeGeometry(1, 1, 7),
  ball: new THREE.IcosahedronGeometry(1, 1),
  pole: new THREE.CylinderGeometry(0.12, 0.15, 1, 6),
};
const mat = {
  trunk: paint(0x6b4a2e, 0.9, 0),
  tree: [paint(0x2f6b35, 0.9, 0), paint(0x3d7d3a, 0.9, 0), paint(0x285a33, 0.9, 0)],
  hill: [paint(0x5d8f4c, 1, 0), paint(0x4f7f45, 1, 0), paint(0x6c9a55, 1, 0)],
  building: [paint(0xc9c3b6, 0.9, 0), paint(0x9ea4ab, 0.9, 0), paint(0xe2ddd2, 0.9, 0), paint(0x7d858e, 0.9, 0)],
  wall: new THREE.MeshStandardMaterial({ color: 0x9fb7c4, roughness: 0.4, transparent: true, opacity: 0.75 }),
  pole: paint(0x8d949b, 0.5, 0.7),
  tea: paint(0x2c6a2c, 1, 0),
  gantry: paint(0x7b8288, 0.5, 0.6),
};

function mesh(g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const o = new THREE.Mesh(g, m);
  o.scale.set(sx, sy, sz);
  o.position.set(x, y, z);
  return o;
}

export class Scenery {
  readonly root = new THREE.Group();
  private roadTex = roadTexture();
  private railTex = railTexture();
  private road: THREE.Mesh;
  private oppRoad: THREE.Mesh;
  private ground: THREE.Mesh;
  private moving: THREE.Object3D[] = [];
  private fuji: THREE.Group;
  private water: THREE.Mesh;
  private segs = new Map<number, THREE.Group>();
  private gantries = new Map<number, THREE.Group>();
  private oncoming: { obj: THREE.Object3D; z: number; x: number; v: number }[] = [];
  private rng = mulberry32(7);

  constructor() {
    const len = 1400;
    this.roadTex.repeat.set(1, len / ROAD_TILE);
    const roadW = ROAD_RIGHT - ROAD_LEFT;
    this.road = new THREE.Mesh(
      new THREE.PlaneGeometry(roadW, len).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.92 }),
    );
    this.road.position.x = (ROAD_LEFT + ROAD_RIGHT) / 2;
    this.road.position.y = 0.01;
    this.oppRoad = new THREE.Mesh(
      new THREE.PlaneGeometry(roadW, len).rotateX(-Math.PI / 2).rotateY(Math.PI),
      new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.92 }),
    );
    this.oppRoad.position.set(MEDIAN_X * 2 - (ROAD_LEFT + ROAD_RIGHT) / 2 + 0.2, 0.01, 0);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(10000, 10000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x6f9a4f, roughness: 1 }),
    );
    this.ground.position.y = -0.35;
    this.root.add(this.road, this.oppRoad, this.ground);

    // 中央分離帯・ガードレール（自車と一緒に動き、テクスチャだけずらす）
    const median = mesh(geo.box, paint(0xbfc3c6, 0.8, 0), 0.6, 0.85, len, MEDIAN_X, 0.42, 0);
    const hedge = mesh(geo.box, paint(0x2f5a2f, 1, 0), 0.5, 0.7, len, MEDIAN_X, 1.2, 0);
    const railMat = new THREE.MeshStandardMaterial({ map: this.railTex, roughness: 0.5, metalness: 0.3 });
    this.railTex.repeat.set(len / 4, 1);
    const railL = mesh(geo.box, railMat, 0.12, 0.35, len, ROAD_LEFT - 0.1, 0.7, 0);
    const railO = mesh(geo.box, railMat, 0.12, 0.35, len, MEDIAN_X * 2 - ROAD_LEFT + 0.3, 0.7, 0);
    this.moving.push(this.road, this.oppRoad, this.ground, median, hedge, railL, railO);
    this.root.add(median, hedge, railL, railO);

    // 富士山
    this.fuji = new THREE.Group();
    const fm = new THREE.MeshStandardMaterial({ color: 0x4f6d93, roughness: 1, fog: false, transparent: true });
    const sm = new THREE.MeshStandardMaterial({ color: 0xf6f8fb, roughness: 1, fog: false, transparent: true });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(60, 1000, 900, 40, 1, true), fm);
    cone.position.y = 450;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(60, 330, 300, 40, 1), sm);
    cap.position.y = 750;
    this.fuji.add(cone, cap);
    this.root.add(this.fuji);

    // 海・湖
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 1800).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3a7fb8, roughness: 0.25, metalness: 0.3 }),
    );
    this.water.position.set(ROAD_LEFT - 12 - 450, -0.15, 0);
    this.root.add(this.water);

    // 対向車線の車（雰囲気だけ）
    const colors = [0xf2f2f2, 0x1a1a1a, 0xb9bec4, 0x8a1c1c, 0x1d3f7a];
    const models = ['sedan', 'compact', 'minivan', 'truck', 'suv', 'sedan'] as const;
    for (let i = 0; i < 6; i++) {
      const cm = buildCarMesh(models[i], models[i] === 'truck' ? 0xdfe3e6 : colors[i % colors.length]);
      cm.root.rotation.y = Math.PI;
      const lane = i % 3;
      this.oncoming.push({ obj: cm.root, z: 60 + i * 90, x: MEDIAN_X * 2 - (lane - 1) * C.laneWidth + 0.2, v: 26 + lane * 3 });
      this.root.add(cm.root);
    }
  }

  update(pz: number, km: number, dt: number): void {
    // 路面などは自車と一緒に動かし、模様だけずらす
    for (const o of this.moving) o.position.z = -pz;
    this.roadTex.offset.y = (pz / ROAD_TILE) % 1;
    this.railTex.offset.x = -(pz / 4) % 1;

    const r = region(km);
    // 富士山: 御殿場あたりで右前方、富士ICあたりで右横へ
    const ft = THREE.MathUtils.clamp((km - 65) / 85, 0, 1);
    const ang = THREE.MathUtils.degToRad(6 + ft * 34);
    const dist = 3200;
    this.fuji.position.set(Math.sin(ang) * dist, -40, -(pz + Math.cos(ang) * dist));
    const fade = THREE.MathUtils.clamp(Math.min(km - 60, 155 - km) / 12, 0, 1);
    this.fuji.visible = fade > 0;
    this.fuji.children.forEach((c) => (((c as THREE.Mesh).material as THREE.Material).opacity = fade));

    this.water.visible = r.sea;
    this.water.position.z = -pz - 300;

    // 景色の区切りを作る・消す
    const first = Math.floor((pz - 80) / SEG);
    const last = Math.floor((pz + 520) / SEG);
    for (const [i, g] of this.segs) {
      if (i < first || i > last) {
        this.root.remove(g);
        this.segs.delete(i);
      }
    }
    for (let i = first; i <= last; i++) {
      if (!this.segs.has(i)) {
        const g = this.buildSegment(i);
        this.segs.set(i, g);
        this.root.add(g);
      }
    }

    // ICの案内標識
    for (let i = 1; i < ROUTE.length; i++) {
      const z = icProgress(i) * C.courseLength - 30;
      const near = z - pz < 650 && z - pz > -80;
      const has = this.gantries.get(i);
      if (near && !has) {
        const g = this.buildGantry(i, z);
        this.gantries.set(i, g);
        this.root.add(g);
      } else if (!near && has) {
        this.root.remove(has);
        this.gantries.delete(i);
      }
    }

    // 対向車
    for (const o of this.oncoming) {
      o.z -= o.v * dt;
      if (o.z < pz - 60) o.z = pz + 450 + this.rng() * 250;
      o.obj.position.set(o.x, 0, -o.z);
    }
  }

  private buildSegment(i: number): THREE.Group {
    const g = new THREE.Group();
    const rnd = mulberry32(i * 9973 + 17);
    const z0 = i * SEG;
    const km = ROUTE[0].km + (z0 / C.courseLength) * (ROUTE[ROUTE.length - 1].km - ROUTE[0].km);
    const r = region(km);
    const at = (z: number) => -(z0 + z);

    // 中央分離帯の照明
    if (i % 2 === 0) {
      g.add(mesh(geo.pole, mat.pole, 1, 9, 1, MEDIAN_X, 4.5, at(0)));
      g.add(mesh(geo.box, mat.pole, 2.4, 0.15, 0.2, MEDIAN_X - 1.2, 9, at(0)));
      g.add(mesh(geo.box, paint(0xfff3c4, 0.3, 0), 0.6, 0.12, 0.35, MEDIAN_X - 2.3, 8.9, at(0)));
    }

    // 防音壁（街中）
    if (r.urban) g.add(mesh(geo.box, mat.wall, 0.2, 3.6, SEG, ROAD_LEFT - 0.9, 1.8, at(SEG / 2)));

    const sides: [number, number][] = [
      [-1, ROAD_LEFT - 3],
      [1, MEDIAN_X * 2 - ROAD_LEFT + 3],
    ];
    for (const [side, edge] of sides) {
      const waterSide = side === -1 && r.sea;
      if (waterSide) continue;
      if (r.urban) {
        const n = 1 + Math.floor(rnd() * 2);
        for (let k = 0; k < n; k++) {
          const w = 10 + rnd() * 14;
          const h = 8 + rnd() * 26;
          const x = edge + side * (8 + rnd() * 40 + w / 2);
          g.add(mesh(geo.box, mat.building[Math.floor(rnd() * 4)], w, h, 10 + rnd() * 16, x, h / 2, at(rnd() * SEG)));
        }
      }
      if (r.tea && rnd() < 0.8) {
        for (let k = 0; k < 4; k++) {
          const x = edge + side * (4 + k * 2.4);
          g.add(mesh(geo.box, mat.tea, 1.5, 0.9, SEG - 2, x, 0.45, at(SEG / 2)));
        }
      }
      const trees = r.urban ? 1 : 4;
      for (let k = 0; k < trees; k++) {
        const x = edge + side * ((r.tea ? 14 : 2) + rnd() * 30);
        const z = at(rnd() * SEG);
        const h = 4 + rnd() * 5;
        g.add(mesh(geo.trunk, mat.trunk, 1, h * 0.35, 1, x, h * 0.17, z));
        g.add(mesh(geo.crown, mat.tree[Math.floor(rnd() * 3)], h * 0.35, h * 0.75, h * 0.35, x, h * 0.35 + h * 0.37, z));
      }
      if (r.hills && i % 3 === 0) {
        const s = 50 + rnd() * 70;
        const x = edge + side * (s * 1.6 + 60 + rnd() * 120);
        g.add(mesh(geo.ball, mat.hill[Math.floor(rnd() * 3)], s * 1.6, s * 0.5, s, x, 0, at(rnd() * SEG)));
      }
    }
    return g;
  }

  private buildGantry(i: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const left = ROAD_LEFT - 0.6;
    const right = MEDIAN_X;
    g.add(mesh(geo.pole, mat.gantry, 1.6, 7.5, 1.6, left, 3.75, 0));
    g.add(mesh(geo.pole, mat.gantry, 1.6, 7.5, 1.6, right, 3.75, 0));
    g.add(mesh(geo.box, mat.gantry, right - left, 0.35, 0.35, (left + right) / 2, 7.2, 0));
    const ic = ROUTE[i];
    const last = i === ROUTE.length - 1;
    const sub = last ? 'ゴール！' : `名古屋まで ${Math.round(ROUTE[ROUTE.length - 1].km - ic.km)} km`;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 3),
      new THREE.MeshBasicMaterial({ map: signTexture(`${ic.name} IC`, sub), toneMapped: false }),
    );
    sign.position.set(-0.7, 6.0, 0.25);
    g.add(sign);
    g.position.z = -z;
    return g;
  }
}
