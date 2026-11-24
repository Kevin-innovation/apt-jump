import type { Save } from './storage';

const LEVELS = [0, 0.33, 0.66, 1];
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Original loop, 8 bars of 16 steps. Notes are MIDI numbers, 0 is a rest.
const BASS = [45, 41, 48, 43, 45, 41, 50, 52];
const CHORDS = [[69, 72, 76], [65, 69, 72], [67, 72, 76], [67, 71, 74], [69, 72, 76], [65, 69, 72], [65, 69, 74], [68, 71, 76]];
const LEAD = [
  [76, 0, 0, 76, 0, 74, 72, 0, 74, 0, 76, 0, 79, 0, 76, 0],
  [77, 0, 0, 76, 0, 72, 69, 0, 72, 0, 0, 74, 0, 72, 0, 0],
  [79, 0, 0, 79, 0, 76, 72, 0, 76, 0, 79, 0, 84, 0, 83, 0],
  [79, 0, 0, 74, 0, 71, 74, 0, 79, 0, 0, 0, 0, 0, 0, 0],
  [81, 0, 79, 76, 0, 72, 0, 74, 76, 0, 0, 72, 0, 69, 0, 0],
  [72, 0, 74, 76, 0, 77, 0, 76, 74, 0, 72, 0, 69, 0, 72, 0],
  [74, 0, 0, 77, 0, 81, 0, 79, 77, 0, 76, 0, 74, 0, 77, 0],
  [76, 0, 0, 80, 0, 83, 0, 80, 76, 0, 74, 0, 71, 0, 68, 0],
];
const BPM = 138;

export type Sfx = 'jump' | 'land' | 'perfect' | 'coin' | 'gold' | 'risk' | 'stumble' | 'fall' | 'ui' | 'count' | 'best';

export class Audio8 {
  private ctx: AudioContext | null = null;
  private music!: GainNode;
  private sfx!: GainNode;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private pulse!: PeriodicWave;
  private step = 0;
  private nextAt = 0;
  private timer = 0;
  private playing = false;
  /** 0 dusk to 1 night: swaps the chord stabs for an arpeggio. */
  night = 0;

  constructor(private save: Save) {}

  /** Call from a user gesture. Sound is optional, so failures are ignored. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const ctx = new AudioContext();
        this.master = ctx.createGain();
        this.master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
        this.music = ctx.createGain();
        this.sfx = ctx.createGain();
        this.music.connect(this.master);
        this.sfx.connect(this.master);
        this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate / 2), ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const re = new Float32Array(24), im = new Float32Array(24);
        for (let k = 1; k < 24; k++) {
          re[k] = (Math.sin(Math.PI * k * 0.5) * 2) / (k * Math.PI);
          im[k] = ((1 - Math.cos(Math.PI * k * 0.5)) * 2) / (k * Math.PI);
        }
        this.pulse = ctx.createPeriodicWave(re, im);
        this.ctx = ctx;
        this.apply();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
  }

  apply(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.save.muted ? 0 : 0.8, t, 0.02);
    this.music.gain.setTargetAtTime(0.5 * LEVELS[this.save.music]!, t, 0.02);
    this.sfx.gain.setTargetAtTime(0.8 * LEVELS[this.save.sfx]!, t, 0.02);
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.nextAt = 0;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }
  stop(): void { this.playing = false; clearInterval(this.timer); }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.nextAt < ctx.currentTime) this.nextAt = ctx.currentTime + 0.05;
    const len = 60 / BPM / 4;
    while (this.nextAt < ctx.currentTime + 0.14) {
      this.note(this.step, this.nextAt, len);
      this.step = (this.step + 1) % (16 * LEAD.length);
      this.nextAt += len;
    }
  }

  private note(step: number, t: number, len: number): void {
    const bar = Math.floor(step / 16), i = step % 16;
    const m = this.music;
    if (i % 2 === 0) this.tone('triangle', hz(BASS[bar]! - (i % 8 === 6 ? 0 : 12)), t, len * 1.7, 0.5, m);
    const n = LEAD[bar]![i]!;
    if (n) this.tone('pulse', hz(n), t, len * 2.1, 0.16 - 0.04 * this.night, m);
    if (this.night > 0.35) this.tone('pulse', hz(CHORDS[bar]![i % 3]! + (i % 6 > 2 ? 12 : 0)), t, len * 0.8, 0.05 * this.night, m);
    else if (i % 4 === 2) for (const c of CHORDS[bar]!) this.tone('square', hz(c - 12), t, len * 0.9, 0.035, m);
    if (i % 8 === 0) this.tone('sine', 130, t, 0.11, 0.6, m, 40);
    if (i % 8 === 4) this.hiss(t, 0.1, 0.22, 1800, m);
    if (i % 2 === 1 || i % 4 === 2) this.hiss(t, 0.03, 0.09, 7000, m);
  }

  private tone(type: 'sine' | 'square' | 'sawtooth' | 'triangle' | 'pulse', f: number, t: number, dur: number, vol: number, out: GainNode, to = f): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    if (type === 'pulse') o.setPeriodicWave(this.pulse);
    else o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to !== f) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(t: number, dur: number, vol: number, freq: number, out: GainNode): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.3);
    s.stop(t + dur);
  }

  play(name: Sfx): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, o = this.sfx;
    const run = (ns: number[], gap: number, vol = 0.2) =>
      ns.forEach((n, i) => this.tone('square', hz(n), t + i * gap, gap * 1.8, vol, o));
    switch (name) {
      case 'jump': this.tone('square', 240, t, 0.16, 0.16, o, 560); break;
      case 'land': this.hiss(t, 0.06, 0.18, 500, o); break;
      case 'perfect': run([76, 83, 88], 0.045); break;
      case 'coin': run([83, 88], 0.06, 0.16); break;
      case 'gold': run([83, 88, 95], 0.06, 0.2); break;
      case 'risk': run([72, 76, 79, 84], 0.05); break;
      case 'stumble': this.tone('sawtooth', 190, t, 0.22, 0.3, o, 60); this.hiss(t, 0.15, 0.3, 700, o); break;
      case 'fall': this.tone('square', 520, t, 0.7, 0.25, o, 60); break;
      case 'ui': run([79], 0.05, 0.14); break;
      case 'count': run([72], 0.08, 0.16); break;
      case 'best': run([72, 76, 79, 84, 79, 84, 88], 0.09); break;
    }
  }
}
