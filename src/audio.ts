// 効果音は Web Audio で合成する。最初の操作のあとに鳴らし始める
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
  muted = false;

  start(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // エンジン音（小さめの持続音）
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc2.type = 'triangle';
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(lp);
      osc2.connect(lp);
      lp.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      this.engine = { osc, osc2, gain };
    }
    void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  engineUpdate(kmh: number, on: boolean): void {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const f = 48 + kmh * 0.55;
    this.engine.osc.frequency.setTargetAtTime(f, t, 0.1);
    this.engine.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(on ? 0.045 : 0, t, 0.2);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'bandpass', delay = 0): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  horn(dist: number): void {
    const v = Math.max(0.05, 0.22 - dist * 0.004);
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.02);
    g.gain.setValueAtTime(v, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    lp.connect(g).connect(this.master);
    for (const f of [370, 466]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.6);
    }
  }

  fire(): void {
    this.hiss(0.5, 0.35, 3000, 500);
    this.tone('sawtooth', 500, 120, 0.35, 0.08);
  }

  /** 爆発音。big なら撃退の大きな爆発 */
  boom(big = true): void {
    const v = big ? 1 : 0.7;
    this.hiss(0.12, 0.7 * v, 6000, 2000, 'highpass'); // 最初の破裂音
    this.hiss(1.4, 0.75 * v, 1600, 60, 'lowpass'); // ゴーッという爆風
    this.tone('sine', 140, 28, 1.0, 0.75 * v); // 腹に響く低音
    this.tone('triangle', 70, 30, 0.7, 0.4 * v);
    // パチパチと燃える音
    for (let i = 0; i < 7; i++) this.hiss(0.05, 0.25 * v, 3000, 1500, 'bandpass', 0.15 + Math.random() * 0.8);
  }

  crash(): void {
    this.hiss(0.35, 0.6, 2500, 300, 'lowpass');
    this.tone('square', 160, 60, 0.25, 0.2);
  }

  defeat(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.18, 0.12 + i * 0.07));
  }

  miss(): void {
    this.tone('square', 330, 300, 0.18, 0.12, 0.1);
    this.tone('square', 220, 180, 0.32, 0.12, 0.3);
  }

  dodge(): void {
    this.hiss(0.25, 0.2, 600, 2400);
  }

  chime(): void {
    this.tone('sine', 988, 988, 0.5, 0.12);
    this.tone('sine', 784, 784, 0.7, 0.12, 0.18);
  }

  clear(): void {
    [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.2, i * 0.13));
  }

  over(): void {
    [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.3, 0.18, i * 0.2));
  }
}
