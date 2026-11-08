// 3D描画。ゲームの中身（World）を見て、毎コマ画面をそろえる
import * as THREE from 'three';
import { progressToKm } from './route';
import { Scenery } from './scenery';
import { buildCarMesh, glowTexture, smokeTexture, starTexture, textSprite, type CarMesh } from './models';
import type { World } from './sim';
import type { Car, GameEvent } from './types';

interface CarView {
  mesh: CarMesh;
  marker: THREE.Sprite | null;
  bubble: THREE.Sprite | null;
  bubbleT: number;
  siren: THREE.Mesh | null;
  lastX: number;
  // 撃たれたときに跳ねて転がる
  hopY: number;
  hopVy: number;
  roll: number;
  rollV: number;
  burnT: number;
}

interface Particle {
  obj: THREE.Sprite | THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
  gravity: number;
  drag: number;
  spin?: THREE.Vector3;
  from?: THREE.Color; // 色の変化（火の玉: 白っぽい黄色 → 赤黒い色）
  to?: THREE.Color;
  bounce?: boolean;
}

interface ParticleOpts {
  vel?: THREE.Vector3;
  grow?: number;
  additive?: boolean;
  gravity?: number;
  drag?: number;
  to?: number;
}

const BUBBLE = {
  horn: ['プァーン！', '#fff6b0', '#3a2a00'],
  act: ['', '#ff3b30', '#ffffff'],
  early: ['まだ何も…', '#ffe0e0', '#8a0000'],
  civilian: ['ひどい！', '#ffe0e0', '#8a0000'],
  police: ['覆面パトカー！', '#2b2b2b', '#ffffff'],
} as const;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 6000);
  private rearCam = new THREE.PerspectiveCamera(42, 2.6, 0.3, 500);
  private rt = new THREE.WebGLRenderTarget(512, 196);
  private overlay = new THREE.Scene();
  private overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rearQuad: THREE.Mesh;
  private scenery = new Scenery();
  private player: CarMesh;
  private cars = new Map<number, CarView>();
  private missiles = new Map<number, THREE.Group>();
  private particles: Particle[] = [];
  private blastLight = new THREE.PointLight(0xffa040, 0, 60, 1.6);
  private blastT = 0;
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
  private debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  private camPos = new THREE.Vector3();
  private shake = 0;
  private time = 0;
  private width = 1;
  private height = 1;
  private rearRect = { x: 0.36, y: 0.03, w: 0.28, h: 0.17 }; // 画面に対する割合
  private frame = 0;
  // カメラの置き方（縦向き・横向きで変える）
  private cam = { height: 8.6, back: 19, ahead: 15 };
  /** 描画の解像度（端末の画素密度に対する倍率）。重いときに下げる */
  pixelRatio = Math.min(window.devicePixelRatio, 2);
  /** 後方モニターを何コマに1回描くか */
  rearEvery = 1;

  constructor(canvas: HTMLCanvasElement) {
    // 画素密度が高い端末ではアンチエイリアスなしでも十分きれいで、軽くなる
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;

    const sky = document.createElement('canvas');
    sky.width = 4;
    sky.height = 256;
    const g = sky.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#3f8fd6');
    gr.addColorStop(0.6, '#9fcdee');
    gr.addColorStop(1, '#dcebf3');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog(0xcfe3ee, 180, 900);

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x5d6b4a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
    sun.position.set(-40, 80, 30);
    this.scene.add(sun);
    this.scene.add(this.scenery.root);

    this.camera.layers.enable(1);
    this.blastLight.position.set(0, -100, 0);
    this.scene.add(this.blastLight);
    this.player = buildCarMesh('compact', 0x2b8fe0, { player: true });
    this.scene.add(this.player.root);

    // 後方モニター（左右反転してミラーのように見せる）
    this.rearQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.rt.texture, side: THREE.DoubleSide, depthTest: false }),
    );
    this.overlay.add(this.rearQuad);
  }

  /** rear は後方モニターの枠（画面に対する割合）。HUD が出ていないときは null */
  resize(w: number, h: number, rear: { x: number; y: number; w: number; h: number } | null = null): void {
    this.width = w;
    this.height = h;
    if (rear && rear.w > 0 && rear.h > 0) this.rearRect = rear;
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(w, h, false);
    const a = w / h;
    this.camera.aspect = a;
    if (a < 1) {
      // 縦向き: 3車線と真後ろの車が入る高さにしつつ、地平線が上のパネルに隠れないよう低めにして先を見る
      this.camera.fov = 66;
      this.cam = { height: 8.5, back: 18, ahead: 18 };
    } else {
      this.camera.fov = a > 1.9 ? 48 : 55;
      this.cam = { height: 7.2, back: 17, ahead: 20 };
    }
    this.camera.updateProjectionMatrix();
    const r = this.rearRect;
    const pw = r.w * w;
    const ph = r.h * h;
    this.rearCam.aspect = pw / ph;
    this.rearCam.fov = pw / ph > 2.7 ? 38 : 42;
    this.rearCam.updateProjectionMatrix();
    const dpr = Math.max(2, this.pixelRatio); // 小さすぎると路面が描かれないことがあるため2倍以上
    this.rt.setSize(Math.round(pw * dpr), Math.round(ph * dpr));
    // 正規化座標でモニターの位置を決める
    const cx = (r.x + r.w / 2) * 2 - 1;
    const cy = 1 - (r.y + r.h / 2) * 2;
    this.rearQuad.position.set(cx, cy, 0);
    this.rearQuad.scale.set(-r.w * 2, r.h * 2, 1);
  }

  /** 描画の解像度を変える（重い端末向け） */
  setPixelRatio(pr: number): void {
    this.pixelRatio = pr;
    this.resize(this.width, this.height);
  }

  reset(): void {
    for (const v of this.cars.values()) this.scene.remove(v.mesh.root);
    this.cars.clear();
    for (const m of this.missiles.values()) this.scene.remove(m);
    this.missiles.clear();
    for (const p of this.particles) this.scene.remove(p.obj);
    this.blastT = 0;
    this.particles = [];
    this.camPos.set(0, 0, 0);
  }

  // ---- 出来事に合わせた演出 ----
  onEvent(e: GameEvent, world: World): void {
    if (e.type === 'hit') {
      const car = world.cars.find((c) => c.id === e.carId);
      const big = e.result.kind === 'defeat';
      this.explode(e.x, e.z, car?.speed ?? world.player.speed, car?.color ?? 0x888888, big ? 1 : 0.8);
      if (big) this.floatText(`撃退！ +${e.result.score}`, e.x, e.z, car?.speed ?? world.player.speed);
      const v = this.cars.get(e.carId);
      if (v) {
        // 宙に跳ねて転がる
        v.hopVy = big ? 8 + Math.random() * 3 : 6;
        v.rollV = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4);
        v.burnT = big ? 4.5 : 3;
        // 撃退したときは吹き出しを出さない（プレイの邪魔になるため）。ミスのときだけ理由を出す
        if (e.result.kind !== 'defeat') {
          const b = BUBBLE[e.result.kind];
          this.setBubble(v, b[0], b[1], b[2], 99);
        } else if (v.bubble) {
          v.mesh.root.remove(v.bubble);
          v.bubble = null;
        }
        if (v.marker) {
          v.mesh.root.remove(v.marker);
          v.marker = null;
        }
        if (e.result.kind === 'police') this.addSiren(v);
      }
      this.shake = Math.max(this.shake, 1.4);
    } else if (e.type === 'crash') {
      this.puffs(e.x, e.z, 8, 0xdddddd, world.player.speed);
      this.stars(e.x, e.z, 5, world.player.speed);
      this.shake = 1;
    } else if (e.type === 'horn') {
      const v = this.cars.get(e.carId);
      if (v && v.bubbleT <= 0.3) this.setBubble(v, BUBBLE.horn[0], BUBBLE.horn[1], BUBBLE.horn[2], 0.8);
    } else if (e.type === 'aori') {
      const v = this.cars.get(e.carId);
      const car = world.cars.find((c) => c.id === e.carId);
      if (v && car) {
        this.setBubble(v, `${e.act}！`, BUBBLE.act[1], BUBBLE.act[2], 1.2);
        this.ensureMarker(v, car);
      }
    } else if (e.type === 'fire') {
      const p = world.player;
      // 発射台からの小さな煙と火（自車と一緒に流れ、すぐ消える）
      for (let i = 0; i < 3; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 2, 0.8, -p.speed - e.dir * (2 + Math.random() * 2));
        this.particle(smokeTexture(), 0xffffff, p.x, 2.1, p.z + e.dir * 1.6, 0.5, 0.35, { vel: v, grow: 2 });
      }
      this.particle(glowTexture(), 0xffc060, p.x, 2.1, p.z + e.dir * 1.6, 1.2, 0.12, { vel: new THREE.Vector3(0, 0, -p.speed), additive: true });
    }
  }

  private setBubble(v: CarView, text: string, bg: string, fg: string, t: number): void {
    if (v.bubble) v.mesh.root.remove(v.bubble);
    v.bubble = textSprite(text, bg, fg, 0.055);
    v.bubble.position.set(0, v.mesh.height + 1.6, 0);
    v.mesh.root.add(v.bubble);
    v.bubbleT = t;
  }

  private ensureMarker(v: CarView, car: Car): void {
    if (v.marker || car.wrecked) return;
    v.marker = textSprite('あおり', '#d70015', '#ffffff', 0.038);
    v.marker.position.set(0, v.mesh.height + 0.6, 0);
    v.mesh.root.add(v.marker);
  }

  private addSiren(v: CarView): void {
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.25, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 }),
    );
    s.position.set(0, v.mesh.height + 0.15, 0);
    v.mesh.body.add(s);
    v.siren = s;
  }

  // ---- 粒子 ----
  private particle(tex: THREE.Texture, color: number, x: number, y: number, z: number, size: number, life: number, o: ParticleOpts = {}): void {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color,
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, -z);
    s.scale.set(size, size, 1);
    this.scene.add(s);
    this.particles.push({
      obj: s,
      vel: o.vel ?? new THREE.Vector3(),
      life,
      max: life,
      grow: o.grow ?? 0,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 0,
      from: o.to !== undefined ? new THREE.Color(color) : undefined,
      to: o.to !== undefined ? new THREE.Color(o.to) : undefined,
    });
  }

  /** 爆発の場所から立ち上って消える文字 */
  private floatText(text: string, x: number, z: number, speed: number): void {
    const s = textSprite(text, 'rgba(0,0,0,0)', '#ffd84a', 0.085);
    (s.material as THREE.SpriteMaterial).color.set(0xffffff);
    s.position.set(x, 4, -z);
    this.scene.add(s);
    this.particles.push({ obj: s, vel: new THREE.Vector3(0, 3, -speed * 0.95), life: 1.3, max: 1.3, grow: 0, gravity: 0, drag: 0 });
  }

  /** 前へ流れる速さ（撃たれた車と一緒に流れるように） */
  private carry(speed: number, k = 1): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -speed * k);
  }

  private puffs(x: number, z: number, n: number, color: number, speed = 0): void {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4).add(this.carry(speed, 0.8));
      this.particle(smokeTexture(), color, x, 0.8 + Math.random(), z, 1.2 + Math.random(), 0.8 + Math.random() * 0.5, { vel: v, grow: 2.2, drag: 1.2 });
    }
  }

  private stars(x: number, z: number, n: number, speed = 0): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * 5, 4 + Math.random() * 3, Math.sin(a) * 5).add(this.carry(speed, 0.9));
      this.particle(starTexture(), 0xffffff, x, 1.6, z, 0.9, 1.1, { vel: v, gravity: 9, drag: 0.6 });
    }
  }

  private explode(x: number, z: number, speed: number, color: number, scale: number): void {
    const rnd = (a: number) => (Math.random() - 0.5) * a;
    // 一瞬の大きな閃光
    this.particle(glowTexture(), 0xfff2d0, x, 1.5, z, 9 * scale, 0.18, { vel: this.carry(speed), grow: 20, additive: true });
    // 火の玉（白っぽい黄色 → オレンジ → 赤黒く消える）
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3(rnd(10), 2 + Math.random() * 7, rnd(10)).add(this.carry(speed, 0.92));
      this.particle(smokeTexture(), i % 2 ? 0xffb020 : 0xff6a10, x + rnd(1.5), 1 + Math.random() * 1.5, z + rnd(2), (3 + Math.random() * 3) * scale, 0.7 + Math.random() * 0.5, {
        vel: v,
        grow: 6,
        drag: 2.2,
        to: 0x3a1608,
      });
    }
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3(rnd(5), 2 + Math.random() * 3, rnd(5)).add(this.carry(speed, 0.92));
      this.particle(glowTexture(), 0xfff4b0, x + rnd(1), 1.4, z + rnd(1), (2 + Math.random() * 2) * scale, 0.4 + Math.random() * 0.2, {
        vel: v,
        grow: 4,
        additive: true,
        drag: 2,
        to: 0xff5000,
      });
    }
    // 火花（重力で落ちる）
    for (let i = 0; i < 28; i++) {
      const v = new THREE.Vector3(rnd(26), 5 + Math.random() * 12, rnd(26)).add(this.carry(speed, 0.9));
      this.particle(glowTexture(), 0xffd060, x, 1.2, z, 0.35 + Math.random() * 0.35, 0.6 + Math.random() * 0.7, { vel: v, additive: true, gravity: 20, drag: 0.8 });
    }
    // もくもくの黒煙（長く残る）
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3(rnd(6), 3 + Math.random() * 4, rnd(6)).add(this.carry(speed, 0.9));
      const c = i % 3 === 0 ? 0x333333 : 0x666666;
      this.particle(smokeTexture(), c, x + rnd(2), 1.5 + Math.random() * 2, z + rnd(2), (1.8 + Math.random() * 1.6) * scale, 1.4 + Math.random() * 1.0, { vel: v, grow: 2.5, drag: 1.2 });
    }
    // 飛び散る破片（車体の色・黒・ガラス）
    const colors = [color, color, 0x222222, 0x9fb7c9];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        this.debrisGeo,
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.6, metalness: 0.3, transparent: true }),
      );
      const sz = 0.2 + Math.random() * 0.5;
      m.scale.set(sz * (1 + Math.random()), sz * 0.4, sz);
      m.position.set(x + rnd(1), 1 + Math.random(), -z + rnd(1));
      this.scene.add(m);
      this.particles.push({
        obj: m,
        vel: new THREE.Vector3(rnd(16), 6 + Math.random() * 9, rnd(16)).add(this.carry(speed, 0.9)),
        life: 2.2,
        max: 2.2,
        grow: 0,
        gravity: 22,
        drag: 0.5,
        spin: new THREE.Vector3(rnd(20), rnd(20), rnd(20)),
        bounce: true,
      });
    }
    // 地面を走る衝撃波
    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.position.set(x, 0.15, -z);
    this.scene.add(ring);
    this.particles.push({ obj: ring, vel: this.carry(speed, 0.9), life: 0.45, max: 0.45, grow: 32 * scale, gravity: 0, drag: 0 });
    // 周りを照らす閃光
    this.blastLight.position.set(x, 3, -z);
    this.blastT = 0.5;
    this.stars(x, z, 8, speed);
  }

  // ---- 毎コマ ----
  sync(world: World, dt: number): void {
    this.time += dt;
    const p = world.player;
    const km = progressToKm(world.progress);
    this.scenery.update(p.z, km, dt);

    // 自車
    const pr = this.player.root;
    const vx = (p.x - pr.position.x) / Math.max(dt, 1e-4);
    pr.position.set(p.x, 0, -p.z);
    pr.rotation.y = THREE.MathUtils.lerp(pr.rotation.y, -vx * 0.035, 0.3);
    pr.visible = p.invuln <= 0 || Math.floor(this.time * 12) % 2 === 0;
    this.player.tailMat.emissiveIntensity = world.input.brake ? 3 : 0.4;
    this.player.tailGlow.forEach((s) => (s.visible = world.input.brake));

    // 他の車
    const alive = new Set<number>();
    for (const car of world.cars) {
      alive.add(car.id);
      let v = this.cars.get(car.id);
      if (!v) {
        v = { mesh: buildCarMesh(car.model, car.color), marker: null, bubble: null, bubbleT: 0, siren: null, lastX: car.x, hopY: 0, hopVy: 0, roll: 0, rollV: 0, burnT: 0 };
        this.cars.set(car.id, v);
        this.scene.add(v.mesh.root);
        if (car.aggressive) this.ensureMarker(v, car);
      }
      const root = v.mesh.root;
      const cvx = (car.x - v.lastX) / Math.max(dt, 1e-4);
      v.lastX = car.x;
      root.position.set(car.x, 0, -car.z);
      if (car.wrecked) {
        v.mesh.body.rotation.y = car.spin;
        root.rotation.y = 0;
        if (v.hopVy !== 0 || v.hopY > 0) {
          v.hopY += v.hopVy * dt;
          v.hopVy -= 22 * dt;
          v.roll += v.rollV * dt;
          if (v.hopY <= 0) {
            v.hopY = 0;
            if (Math.abs(v.hopVy) > 3) {
              v.hopVy = -v.hopVy * 0.3;
              v.rollV *= 0.4;
              this.puffs(car.x, car.z, 3, 0x999999, car.speed);
            } else {
              v.hopVy = 0;
              v.rollV = 0;
            }
          }
        } else {
          // 着地したら、表か裏返しのどちらかに落ち着く
          const rest = Math.round(v.roll / Math.PI) * Math.PI;
          v.roll += (rest - v.roll) * Math.min(1, dt * 8);
        }
        // 転がると車体の上下が入れ替わるので、そのぶん持ち上げて地面にめり込まないようにする
        v.mesh.body.position.y = v.hopY + (v.mesh.height * (1 - Math.cos(v.roll))) / 2;
        v.mesh.body.rotation.z = v.roll;
        // しばらく燃える
        if (v.burnT > 0) {
          v.burnT -= dt;
          if (Math.random() < dt * 30) {
            const by = v.hopY + v.mesh.height * 0.8;
            this.particle(glowTexture(), 0xffc060, car.x + (Math.random() - 0.5), by, car.z + (Math.random() - 0.5) * 2, 1 + Math.random(), 0.45, {
              vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 3 + Math.random() * 2, -car.speed),
              grow: 1.5,
              additive: true,
              to: 0x701000,
            });
          }
          if (Math.random() < dt * 14) {
            this.particle(smokeTexture(), 0x555555, car.x, v.hopY + v.mesh.height + 0.5, car.z, 1.1, 1.3, {
              vel: new THREE.Vector3((Math.random() - 0.5), 3 + Math.random() * 1.5, -car.speed),
              grow: 2,
              drag: 0.6,
            });
          }
        }
      } else {
        root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, -cvx * 0.035, 0.3);
      }
      const flash = car.flashing && Math.sin(this.time * 18) > 0;
      v.mesh.headMat.emissiveIntensity = flash ? 4 : 0.3;
      v.mesh.headGlow.forEach((s) => (s.visible = flash));
      v.mesh.tailMat.emissiveIntensity = car.braking ? 3.5 : 0.4;
      v.mesh.tailGlow.forEach((s) => (s.visible = car.braking));
      if (v.siren) (v.siren.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(this.time * 14) > 0 ? 3 : 0.2;
      if (v.bubble) {
        v.bubbleT -= dt;
        v.bubble.position.y = v.mesh.height + 1.6 + Math.max(0, 0.3 - Math.abs(v.bubbleT - 0.3));
        if (v.bubbleT <= 0) {
          root.remove(v.bubble);
          v.bubble = null;
        }
      }
    }
    for (const [id, v] of this.cars) {
      if (!alive.has(id)) {
        this.scene.remove(v.mesh.root);
        this.cars.delete(id);
      }
    }

    // ミサイル
    const liveM = new Set<number>();
    for (const m of world.missiles) {
      liveM.add(m.id);
      let o = this.missiles.get(m.id);
      if (!o) {
        o = this.buildMissile(m.dir);
        this.missiles.set(m.id, o);
        this.scene.add(o);
      }
      o.position.set(m.x, 1.3, -m.z);
      if (Math.random() < 0.9) {
        this.particle(smokeTexture(), 0xeeeeee, m.x, 1.3, m.z - m.dir * 1.2, 0.55, 0.35, { vel: new THREE.Vector3(0, 0.5, -p.speed * 0.88), grow: 1.6 });
      }
    }
    for (const [id, o] of this.missiles) {
      if (!liveM.has(id)) {
        this.scene.remove(o);
        this.missiles.delete(id);
      }
    }

    // 粒子
    this.particles = this.particles.filter((pt) => {
      pt.life -= dt;
      const o = pt.obj;
      if (pt.life <= 0) {
        this.scene.remove(o);
        (o.material as THREE.Material).dispose();
        return false;
      }
      pt.vel.y -= pt.gravity * dt;
      if (pt.drag) pt.vel.multiplyScalar(Math.max(0, 1 - pt.drag * dt));
      o.position.addScaledVector(pt.vel, dt);
      if (pt.bounce && o.position.y < 0.12) {
        o.position.y = 0.12;
        pt.vel.y = Math.abs(pt.vel.y) * 0.35;
        pt.vel.x *= 0.6;
        pt.vel.z *= 0.85;
        pt.spin?.multiplyScalar(0.6);
      }
      if (pt.spin) {
        o.rotation.x += pt.spin.x * dt;
        o.rotation.y += pt.spin.y * dt;
        o.rotation.z += pt.spin.z * dt;
      }
      if (pt.grow) {
        const sx = o.scale.x + pt.grow * dt;
        o.scale.set(sx, o instanceof THREE.Sprite ? sx : o.scale.y, o instanceof THREE.Sprite ? 1 : sx);
      }
      const k = pt.life / pt.max;
      const mat = o.material as THREE.SpriteMaterial;
      mat.opacity = Math.min(1, k * (pt.bounce ? 3 : 1.5));
      if (pt.from && pt.to) mat.color.copy(pt.from).lerp(pt.to, 1 - k);
      return true;
    });
    this.blastT = Math.max(0, this.blastT - dt);
    this.blastLight.intensity = this.blastT > 0 ? 140 * (this.blastT / 0.5) ** 2 : 0;
    this.blastLight.position.z -= p.speed * dt * 0.9;

    // カメラ: 斜め後ろ上から
    const cam = this.cam;
    const target = new THREE.Vector3(p.x * 0.75, cam.height, -(p.z - cam.back));
    if (this.camPos.lengthSq() === 0) this.camPos.copy(target);
    this.camPos.lerp(target, 1 - Math.exp(-dt * 8));
    this.camPos.z = target.z;
    this.camera.position.copy(this.camPos);
    this.shake = Math.max(0, this.shake - dt * 2);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    this.camera.lookAt(p.x * 0.85, 0, -(p.z + cam.ahead));

    this.rearCam.position.set(p.x, 2.6, -(p.z - p.length / 2 - 0.2));
    this.rearCam.lookAt(p.x, 1.1, -(p.z - 45));
  }

  private buildMissile(dir: 1 | -1): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 1.4, 10).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.5 }),
    );
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.45, 10).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xff3b1f, roughness: 0.4 }),
    );
    nose.position.z = -0.9;
    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flame.scale.set(1.3, 1.3, 1);
    flame.position.z = 0.9;
    g.add(body, nose, flame);
    if (dir === -1) g.rotation.y = Math.PI;
    return g;
  }

  render(showRear: boolean): void {
    this.gl.setRenderTarget(null);
    this.gl.render(this.scene, this.camera);
    if (!showRear) return;
    // 重い端末では後方モニターを間引いて描く（前のコマの映像をそのまま使う）
    if (this.frame++ % this.rearEvery === 0) {
      const vis = this.player.root.visible;
      this.player.root.visible = false;
      this.gl.setRenderTarget(this.rt);
      this.gl.render(this.scene, this.rearCam);
      this.gl.setRenderTarget(null);
      this.player.root.visible = vis;
    }
    this.gl.autoClear = false;
    this.gl.render(this.overlay, this.overlayCam);
    this.gl.autoClear = true;
  }

  get size() {
    return { w: this.width, h: this.height };
  }
}

