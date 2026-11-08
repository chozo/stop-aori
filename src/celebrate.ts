// クリア時の紙吹雪と花火（画面に重ねた2Dキャンバスに描く）
// 時間はゲームの描画ループから update(dt) で進める（確認用の入口でコマ送りしても同じ絵になる）

const COLORS = ['#ffd84a', '#ff5a3c', '#3cc4ff', '#7dff6a', '#ff7ad9', '#ffffff', '#ffa63c'];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  flip: number; // くるくる回って見える幅
  vf: number;
  w: number;
  h: number;
  color: string;
  life: number;
  kind: 'paper' | 'spark';
}

export class Celebration {
  private ctx: CanvasRenderingContext2D;
  private pieces: Piece[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private rain = 0; // 1秒あたりに上から降らせる枚数
  private fireworkT = 0;
  private fireworkLeft = 0;
  active = false;
  /** 花火が開いたときに呼ぶ（音を鳴らすため） */
  onPop: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  /** クリアした瞬間: 左右下から紙吹雪を噴き出し、花火を上げ始める */
  start(): void {
    this.resize();
    this.active = true;
    this.pieces.length = 0;
    this.cannon(0.02, 1);
    this.cannon(0.98, -1);
    this.rain = 70;
    this.fireworkLeft = 7;
    this.fireworkT = 0.25;
  }

  /** 結果画面の決めの瞬間: もう一度大きく噴き出す */
  finale(): void {
    if (!this.active) return;
    this.cannon(0.02, 1, 0.8);
    this.cannon(0.98, -1, 0.8);
    this.burst(this.w * 0.5, this.h * 0.3, 1.2);
    this.onPop?.();
    this.rain = 45;
  }

  stop(): void {
    this.active = false;
    this.pieces.length = 0;
    this.rain = 0;
    this.fireworkLeft = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private paper(x: number, y: number, vx: number, vy: number): Piece {
    const s = Math.max(6, Math.min(this.w, this.h) * 0.016);
    return {
      x,
      y,
      vx,
      vy,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 12,
      flip: Math.random() * Math.PI * 2,
      vf: 6 + Math.random() * 8,
      w: s * (0.7 + Math.random() * 0.6),
      h: s * (0.4 + Math.random() * 0.3),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 6 + Math.random() * 3,
      kind: 'paper',
    };
  }

  /** 画面の下の端から斜め上へ紙吹雪を噴き出す。dir は右向き 1、左向き -1 */
  private cannon(fx: number, dir: number, amount = 1): void {
    const n = Math.round(150 * amount);
    const speed = Math.max(this.w, this.h) * 1.15;
    for (let i = 0; i < n; i++) {
      const a = ((62 + Math.random() * 22) * Math.PI) / 180;
      const v = speed * (0.45 + Math.random() * 0.6);
      this.pieces.push(this.paper(this.w * fx, this.h * 1.02, Math.cos(a) * v * dir, -Math.sin(a) * v));
    }
  }

  /** 花火を1発開く */
  private burst(x: number, y: number, scale = 1): void {
    const color = COLORS[Math.floor(Math.random() * (COLORS.length - 1))];
    const color2 = COLORS[Math.floor(Math.random() * COLORS.length)];
    const n = Math.round(70 * scale);
    const sp = Math.min(this.w, this.h) * 0.55 * scale;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const v = sp * (0.75 + Math.random() * 0.35);
      this.pieces.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        rot: 0,
        vr: 0,
        flip: 0,
        vf: 0,
        w: 2.6,
        h: 2.6,
        color: i % 3 === 0 ? color2 : color,
        life: 1.1 + Math.random() * 0.5,
        kind: 'spark',
      });
    }
  }

  update(dt: number): void {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    // 上から降らせる
    let k = this.rain * dt;
    while (k > 0) {
      if (Math.random() < k) {
        const p = this.paper(Math.random() * this.w, -20, (Math.random() - 0.5) * 60, 40 + Math.random() * 80);
        this.pieces.push(p);
      }
      k -= 1;
    }
    // 花火
    if (this.fireworkLeft > 0) {
      this.fireworkT -= dt;
      if (this.fireworkT <= 0) {
        this.fireworkLeft--;
        this.fireworkT = 0.28 + Math.random() * 0.3;
        this.burst(this.w * (0.15 + Math.random() * 0.7), this.h * (0.12 + Math.random() * 0.3), 0.8 + Math.random() * 0.5);
        this.onPop?.();
      }
    }
    const g = this.h * 0.9;
    for (const p of this.pieces) {
      p.life -= dt;
      if (p.kind === 'paper') {
        // 空気抵抗で落ちる速さに上限があり、ひらひら揺れる
        p.vx *= Math.exp(-2.2 * dt);
        p.vy += g * dt;
        p.vy *= Math.exp(-2.6 * dt);
        p.vx += Math.sin(p.flip) * 30 * dt;
        p.rot += p.vr * dt;
        p.flip += p.vf * dt;
      } else {
        p.vx *= Math.exp(-2.4 * dt);
        p.vy *= Math.exp(-2.4 * dt);
        p.vy += g * 0.18 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.pieces = this.pieces.filter((p) => p.life > 0 && p.y < this.h + 40);
    if (this.pieces.length > 1600) this.pieces.splice(0, this.pieces.length - 1600);
  }

  draw(): void {
    if (!this.active) return;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    for (const p of this.pieces) {
      if (p.kind === 'spark') {
        const a = Math.min(1, p.life / 0.5);
        c.globalAlpha = a;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.w * (0.6 + a * 0.6), 0, Math.PI * 2);
        c.fill();
        continue;
      }
      c.globalAlpha = Math.min(1, p.life);
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.scale(1, Math.cos(p.flip));
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    c.globalAlpha = 1;
  }
}
