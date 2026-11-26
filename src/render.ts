import { START_X, type Game, type GameEvent } from './game';
import { drawAc, drawDiamond, drawDrone, drawFlag, drawPigeon, drawPower, drawQuilt, drawRoad, drawRoadSign, drawScaffold, drawTank, drawWarning, powerColor } from './art';
import { MAGNET_RANGE, POWER_NAMES } from './items';
import { missionText } from './missions';
import { BOOST_SPEED, canAirJump, enemyBox, HOLD_MAX, paceSpeed, PX_PER_M, roofEnd, timeRate } from './physics';
import { districtAt, type District, type DistrictKind } from './progression';
import { Rng } from './rng';
import { makeSprites, type Sprites } from './sprites';
import { ROAD_DEPTH, type Roof } from './world';
import { roadCars } from './traffic';

type Ctx = CanvasRenderingContext2D;
type RGB = [number, number, number];
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number }
interface Popup { x: number; y: number; life: number; text: string; color: string }
interface Pair { day: HTMLCanvasElement; night: HTMLCanvasElement }
interface Layer { pair: Pair; speed: number; base: number }
type Palette = District['palette'];
/** The scenery of one district, or of a made map (no kind). Only the current one and the one fading out are kept. */
interface Theme { kind: DistrictKind | null; palette: Palette | null; layers: Layer[]; sky: HTMLCanvasElement | null; skyKey: number }
/** Seconds one district's scenery takes to give way to the next. */
const FADE = 1.5;
const ROOF_CACHE = 80;
const KINDS: readonly DistrictKind[] = ['residential', 'construction', 'neon', 'riverside', 'highrise'];

const FONT = '11px Galmuri11, "Malgun Gothic", sans-serif';
const HEAD = 54;
export const RISK_NAMES = { tank: '위험한 길: 물탱크', line: '위험한 길: 빨랫줄', far: '먼 옥상 점프' } as const;
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join()})`;

const DUSK = ['#3b2a6b', '#6a3480', '#a83f86', '#e0567a', '#ff7d63', '#ffab58', '#ffd77a'].map(hex);
const NIGHT = ['#070a24', '#0b1033', '#121743', '#1b2056', '#2a2a6a', '#403680', '#5b4290'].map(hex);
const WALLS = [
  { wall: '#d9b49a', shade: '#b98a7c', trim: '#8f5f66', rail: '#7b4c5c' },
  { wall: '#c7c3cf', shade: '#9a93ae', trim: '#6f6790', rail: '#5d5580' },
  { wall: '#e0c48c', shade: '#b8935f', trim: '#8a6250', rail: '#6f4a4a' },
  { wall: '#a9c0c4', shade: '#7b93a4', trim: '#586a88', rail: '#4a5676' },
  { wall: '#cf8f7e', shade: '#a8655f', trim: '#784455', rail: '#5f344a' },
] as const;

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};
const ctxOf = (c: HTMLCanvasElement) => c.getContext('2d')!;
/** Between two #rrggbb colours, as #rrggbb. */
const blend = (a: string, b: string, t: number) => {
  const to = hex(b);
  return `#${hex(a).map((v, i) => Math.round(v + (to[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
/** A palette's sky stretched over as many bands as the dusk sky has. */
const bandsOf = (colors: readonly string[]) => DUSK.map((_, i) => {
  const at = (i / (DUSK.length - 1)) * (colors.length - 1), j = Math.floor(at);
  return hex(blend(colors[j]!, colors[Math.min(colors.length - 1, j + 1)]!, at - j));
});

/** Copies a dusk picture, darkens only its own pixels, then lets the caller add lights. */
function nightOf(day: HTMLCanvasElement, color: string, alpha: number, lights: (g: Ctx) => void): HTMLCanvasElement {
  const c = canvas(day.width, day.height);
  const g = ctxOf(c);
  g.drawImage(day, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalAlpha = 1;
  lights(g);
  return c;
}

export class Renderer {
  W = 384;
  H = 216;
  quality: 'low' | 'medium' | 'high' = 'high';
  shakeOn = true;
  private g: Ctx;
  private sprites: Sprites;
  private camY = 0;
  private shake = 0;
  private t = 0;
  private roofs = new Map<number, Pair>();
  private theme: Theme | null = null;
  private leaving: Theme | null = null;
  private fade = 1;
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private squash = 0;
  private trail: { x: number; y: number }[] = [];

  constructor(private el: HTMLCanvasElement) {
    this.g = el.getContext('2d', { alpha: false })!;
    this.sprites = makeSprites();
    this.resize();
  }

  /** Whole-number pixel scale, so every art pixel is the same size on screen. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(innerWidth * dpr)), ph = Math.max(1, Math.round(innerHeight * dpr));
    const s = Math.max(1, Math.floor(Math.min(ph / 200, pw / 260)));
    this.W = Math.ceil(pw / s);
    this.H = Math.ceil(ph / s);
    this.el.width = this.W;
    this.el.height = this.H;
    this.el.style.width = `${(this.W * s) / dpr}px`;
    this.el.style.height = `${(this.H * s) / dpr}px`;
    this.dropScenery();
  }

  /** Forgets everything drawn ahead of time: it is made again when next needed. */
  private dropScenery(): void {
    this.roofs.clear();
    this.theme = this.leaving = null;
    this.fade = 1;
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    if (q === this.quality) return;
    this.quality = q;
    this.dropScenery();
  }

  reset(): void {
    this.particles = [];
    this.popups = [];
    this.trail = [];
    this.dropScenery();
    this.camY = -this.H * 0.64;
    this.shake = 0;
  }

  nightAt(distance: number): number {
    const t = Math.min(1, Math.max(0, (distance - 40) / 520));
    return t * t * (3 - 2 * t);
  }

  // ---- Art ---------------------------------------------------------------

  private themeFor(district: District | null): Theme {
    const layers = district ? this.districtLayers(district.kind, district.palette) : this.classicLayers();
    return { kind: district?.kind ?? null, palette: district?.palette ?? null, layers, sky: null, skyKey: -1 };
  }

  /** The city of the made maps. */
  private classicLayers(): Layer[] {
    const layers: Layer[] = [];
    const mk = (seed: number, w: number, h: number, color: string, nightColor: string, min: number, max: number, speed: number, base: number) => {
      const rng = new Rng(seed);
      const day = canvas(w, h);
      const g = ctxOf(day);
      const wins: [number, number][] = [];
      for (let x = 0; x < w - 14;) {
        const bw = Math.min(w - x, rng.int(18, 46));
        const bh = rng.int(min, max);
        g.fillStyle = color;
        g.fillRect(x, h - bh, bw, bh);
        if (rng.chance(0.5)) g.fillRect(x + 4, h - bh - 5, 8, 5);
        if (rng.chance(0.35)) g.fillRect(x + bw - 7, h - bh - 12, 1, 12);
        for (let wy = h - bh + 5; wy < h - 4; wy += 7) for (let wx = x + 4; wx < x + bw - 4; wx += 6)
          if (rng.chance(0.34)) wins.push([wx, wy]);
        x += bw + (rng.chance(0.3) ? rng.int(2, 10) : 0);
      }
      const night = nightOf(day, nightColor, 0.92, (n) => {
        for (const [x, y] of wins) {
          n.fillStyle = (x * 7 + y * 3) % 11 < 8 ? '#f2c66b' : '#8fd6ff';
          n.globalAlpha = 0.35 + speed;
          n.fillRect(x, y, 2, 3);
        }
        n.globalAlpha = 1;
      });
      layers.push({ pair: { day, night }, speed, base });
    };
    const hills = canvas(512, 70);
    const g = ctxOf(hills);
    g.fillStyle = '#8c3f7c';
    for (let x = 0; x < 512; x++) {
      const a = (x / 512) * Math.PI * 2;
      const y = Math.round(26 - 10 * Math.sin(a * 2) - 7 * Math.sin(a * 5 + 1) - 3 * Math.sin(a * 11));
      g.fillRect(x, y, 1, 70 - y);
    }
    // A hilltop transmission mast, blinking at night.
    g.fillRect(150, 0, 2, 30); g.fillRect(146, 8, 10, 3); g.fillRect(148, 11, 6, 4);
    layers.push({ pair: { day: hills, night: nightOf(hills, '#161446', 0.95, (n) => { n.fillStyle = '#ff5566'; n.fillRect(150, 0, 2, 2); }) }, speed: 0.04, base: 0.5 });
    if (this.quality !== 'low') mk(11, 640, 120, '#a1467f', '#191a52', 34, 96, 0.1, 0.56);
    mk(23, 768, 130, '#75356f', '#12143f', 30, 90, 0.22, 0.68);
    if (this.quality === 'high') mk(37, 896, 110, '#4d265c', '#0b0d2c', 18, 66, 0.4, 0.8);
    return layers;
  }

  /** A district's skyline: its own shapes, not only its own colours. Far to near, as many as the quality allows. */
  private districtLayers(kind: DistrictKind, p: Palette): Layer[] {
    const make = (seed: number, depth: 0 | 1 | 2, w: number, h: number, speed: number, base: number): Layer => {
      const rng = new Rng(seed);
      const day = canvas(w, h);
      const g = ctxOf(day);
      const color = [p.far, p.mid, p.near][depth]!;
      const lights: [x: number, y: number, w: number, h: number, color: string][] = [];
      const box = (x: number, y: number, bw: number, bh: number, c = color) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(bw), Math.round(bh)); };
      const lamp = (x: number, y: number, lw = 2, lh = 3, c = '#f2c66b') => lights.push([x, y, lw, lh, c]);
      const windows = (x: number, y: number, bw: number, bh: number, share: number) => {
        for (let wy = y + 5; wy < y + bh - 4; wy += 7) for (let wx = x + 4; wx < x + bw - 4; wx += 6) if (rng.chance(share)) lamp(wx, wy);
      };
      const tree = (x: number) => { box(x + 3, h - 10, 2, 10); box(x, h - 17, 8, 8); box(x + 2, h - 20, 4, 3); };
      for (let x = 0; x < w - 50;) {
        let step: number;
        if (kind === 'residential') {
          if (depth === 2 && rng.chance(0.6)) {
            // Houses with pitched roofs, and trees between them.
            const bw = rng.int(22, 34), bh = rng.int(14, 26);
            box(x, h - bh, bw, bh);
            for (let i = 0; i < bw / 2; i += 2) box(x + i, h - bh - i / 2 - 1, bw - i * 2, 2, blend(color, p.accent, 0.25));
            lamp(x + 5, h - bh + 6, 4, 4);
            tree(x + bw + 3);
            step = bw + 14;
          } else {
            // Slab blocks with their water tanks.
            const bw = rng.int(30, 48), bh = rng.int(34, 78);
            box(x, h - bh, bw, bh); box(x + 5, h - bh - 6, 10, 6); box(x + 7, h - bh - 9, 6, 3);
            windows(x, h - bh, bw, bh, 0.32);
            step = bw + rng.int(3, 9);
          }
        } else if (kind === 'construction') {
          const bw = rng.int(28, 48), bh = rng.int(28, 62);
          // A bare frame: floors and columns, open between them.
          for (let y = h - bh; y < h; y += 10) box(x, y, bw, 2);
          for (let c = 0; c <= bw; c += 12) box(x + Math.min(c, bw - 2), h - bh - 4, 2, bh + 4);
          box(x, h - 12, bw, 12);
          if (rng.chance(0.55)) {
            // A tower crane: mast, jib, counterweight, cable and hook.
            const mx = x + bw + 14, top = rng.int(6, 22);
            box(mx, top, 2, h - top);
            for (let y = top + 4; y < h; y += 8) box(mx - 2, y, 6, 1);
            box(mx - 12, top, 46, 2); box(mx - 12, top + 2, 7, 5, blend(color, p.accent, 0.5));
            box(mx + 28, top + 2, 1, 18); box(mx + 26, top + 20, 5, 3, p.accent);
            lamp(mx, top - 2, 2, 2, '#ff5566');
            step = bw + 50;
          } else step = bw + rng.int(8, 18);
        } else if (kind === 'neon') {
          const bw = rng.int(24, 40), bh = rng.int(30, depth === 2 ? 54 : 74);
          box(x, h - bh, bw, bh);
          windows(x, h - bh, bw, bh, 0.22);
          const glow = rng.chance(0.5) ? p.accent : '#ff5fc8';
          if (rng.chance(0.65)) {
            // A tall sign hung off the corner.
            const sh = rng.int(16, Math.max(17, Math.min(34, bh - 6))), sx = x + bw - 3, sy = h - bh + 4;
            box(sx, sy, 7, sh, blend(color, '#140c2e', 0.5));
            for (let y = sy + 2; y < sy + sh - 3; y += 6) { box(sx + 2, y, 3, 3, glow); lamp(sx + 2, y, 3, 3, glow); }
          } else {
            // A rooftop billboard on two legs.
            box(x + 5, h - bh - 8, 1, 8); box(x + bw - 6, h - bh - 8, 1, 8);
            box(x + 3, h - bh - 17, bw - 6, 10, glow); box(x + 5, h - bh - 15, bw - 10, 6);
            lamp(x + 3, h - bh - 17, bw - 6, 2, glow);
          }
          step = bw + rng.int(5, 10);
        } else if (kind === 'riverside') {
          if (depth === 1) {
            // A suspension bridge: towers, sagging cables, hangers and deck. 128px spans tile the 768px layer.
            const span = 128, deck = h - 20;
            box(x, deck, span, 4); box(x + 4, h - 62, 4, 62);
            for (let i = 0; i <= span; i += 2) {
              const t = i / span, y = h - 60 + Math.round(4 * t * (1 - t) * 36);
              box(x + 6 + i, y, 2, 1);
              if (i % 12 === 0) { box(x + 6 + i, y, 1, deck - y); lamp(x + 6 + i, deck - 2, 1, 1); }
            }
            step = span;
          } else {
            const bw = rng.int(18, 34), bh = rng.int(10, depth === 0 ? 40 : 22);
            box(x, h - bh, bw, bh); windows(x, h - bh, bw, bh, 0.3);
            if (depth === 2) tree(x + bw + 4);
            step = bw + rng.int(14, 34);
          }
        } else {
          // Slender towers with setbacks, glass bands and spires.
          const bw = rng.int(16, 30), bh = rng.int(depth === 2 ? 48 : 66, h - 22);
          box(x, h - bh, bw, bh); box(x + 3, h - bh - 9, bw - 6, 9); box(x + bw / 2 - 1, h - bh - 20, 2, 11);
          for (let c = x + 4; c < x + bw - 3; c += 5) box(c, h - bh + 3, 1, bh - 6, blend(color, p.accent, 0.3));
          windows(x, h - bh, bw, bh, 0.4);
          lamp(x + Math.round(bw / 2) - 1, h - bh - 21, 2, 2, '#ff5566');
          step = bw + rng.int(4, 14);
        }
        x += step;
      }
      if (kind === 'riverside' && depth === 2) {
        // The river along the foot of the nearest bank, with broken reflections.
        box(0, h - 7, w, 7, blend(p.near, p.accent, 0.35));
        for (let x = 3; x < w; x += rng.int(9, 22)) { box(x, h - rng.int(2, 5), rng.int(4, 10), 1, p.accent); lamp(x, h - 3, 4, 1, '#8fd6ff'); }
      }
      const night = nightOf(day, blend(color, '#0b0d2c', 0.8), 0.9, (n) => {
        for (const [x, y, lw, lh, c] of lights) { n.fillStyle = c; n.globalAlpha = 0.4 + speed; n.fillRect(x, y, lw, lh); }
        n.globalAlpha = 1;
      });
      return { pair: { day, night }, speed, base };
    };
    const seed = 101 + KINDS.indexOf(kind) * 53;
    const horizon = canvas(512, 60);
    const g = ctxOf(horizon);
    g.fillStyle = blend(p.far, p.sky[Math.floor(p.sky.length / 2)]!, 0.4);
    // Hills behind low districts, nearly flat ground behind built-up ones.
    const rise = kind === 'residential' || kind === 'riverside' ? 9 : 3;
    for (let x = 0; x < 512; x++) {
      const a = (x / 512) * Math.PI * 2;
      const y = Math.round(30 - rise * Math.sin(a * 2) - rise * 0.6 * Math.sin(a * 5 + 1));
      g.fillRect(x, y, 1, 60 - y);
    }
    const layers: Layer[] = [{ pair: { day: horizon, night: nightOf(horizon, '#161446', 0.92, () => {}) }, speed: 0.04, base: 0.5 }];
    if (this.quality !== 'low') layers.push(make(seed, 0, 640, 120, 0.1, 0.56));
    layers.push(make(seed + 1, 1, 768, 130, 0.22, 0.68));
    if (this.quality === 'high') layers.push(make(seed + 2, 2, 896, 110, 0.4, 0.8));
    return layers;
  }

  private skyOf(theme: Theme, n: number): HTMLCanvasElement {
    const key = Math.round(n * 40);
    if (key !== theme.skyKey || !theme.sky) {
      const c = canvas(this.W, this.H);
      const g = ctxOf(c);
      const k = key / 40;
      const dusk = theme.palette ? bandsOf(theme.palette.sky) : DUSK;
      // A district's night keeps a trace of its own colour.
      const night = theme.palette ? NIGHT.map((v, i) => v.map((x, j) => Math.round(x * 0.75 + dusk[i]![j]! * 0.25)) as RGB) : NIGHT;
      const top = this.H * 0.82;
      const bands = dusk.length;
      for (let i = 0; i < bands; i++) {
        const y0 = Math.round((top * i) / bands), y1 = Math.round((top * (i + 1)) / bands);
        g.fillStyle = mix(dusk[i]!, night[i]!, k);
        g.fillRect(0, y0, this.W, i === bands - 1 ? this.H - y0 : y1 - y0);
        if (i > 0) for (let d = 0; d < 4; d++) for (let x = (d * 3) % (2 + d * 2); x < this.W; x += 2 + d * 2) g.fillRect(x, y0 - 1 - d, 1, 1);
      }
      if (k > 0.2) {
        const r = new Rng(77);
        g.fillStyle = '#fff3d6';
        const count = Math.round((this.W * this.H) / 900);
        for (let i = 0; i < count; i++) {
          g.globalAlpha = Math.min(1, (k - 0.2) * 1.4) * r.range(0.25, 1);
          g.fillRect(r.int(0, this.W), r.int(0, Math.floor(this.H * 0.55)), 1, 1);
        }
        g.globalAlpha = 1;
      }
      theme.sky = c;
      theme.skyKey = key;
    }
    return theme.sky;
  }

  private drawSky(n: number, distance: number): void {
    const g = this.g;
    if (this.leaving) g.drawImage(this.skyOf(this.leaving, n), 0, 0);
    g.globalAlpha = this.leaving ? this.fade : 1;
    g.drawImage(this.skyOf(this.theme!, n), 0, 0);
    g.globalAlpha = 1;
    // Sun sinks while the moon climbs.
    const disc = (cx: number, cy: number, r: number, color: string, stripes: boolean) => {
      g.fillStyle = color;
      for (let y = -r; y <= r; y++) {
        if (stripes && y > 0 && y % 5 >= 4) continue;
        const w = Math.floor(Math.sqrt(r * r - y * y));
        g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
      }
    };
    const sunY = Math.round(this.H * (0.38 + 0.5 * n));
    if (n < 0.95) {
      g.globalAlpha = 0.18; disc(Math.round(this.W * 0.7), sunY, 33, '#ffe08a', false);
      g.globalAlpha = 1; disc(Math.round(this.W * 0.7), sunY, 25, '#fff0a0', true);
    }
    if (n > 0.3) {
      const a = (n - 0.3) / 0.7;
      const mx = Math.round(this.W * 0.22), my = Math.round(this.H * (0.5 - 0.3 * a));
      g.globalAlpha = a * 0.12; disc(mx, my, 20, '#cfe3ff', false);
      g.globalAlpha = a; disc(mx, my, 12, '#f4f1dc', false);
      g.fillStyle = '#d8d3b8'; g.fillRect(mx - 5, my - 3, 4, 3); g.fillRect(mx + 2, my + 3, 3, 3); g.fillRect(mx + 3, my - 6, 2, 2);
      g.globalAlpha = 1;
    }
    if (this.quality !== 'low') {
      g.fillStyle = n < 0.5 ? '#ffc2a0' : '#4a4a8f';
      g.globalAlpha = 0.45;
      for (let i = 0; i < 6; i++) {
        const span = this.W + 120;
        const x = Math.round((((i * 137 - distance * (0.8 + i * 0.12) - this.t * 2) % span) + span) % span) - 60;
        const y = Math.round(this.H * (0.1 + 0.055 * i));
        g.fillRect(x, y, 34 + i * 4, 2); g.fillRect(x + 8, y - 2, 18, 2); g.fillRect(x + 14, y + 2, 26, 1);
      }
      g.globalAlpha = 1;
    }
  }

  /** A block as its own district builds them; a made map's blocks keep the plain look. */
  private roofArt(r: Roof, district: District | null): Pair {
    const cached = this.roofs.get(r.id);
    if (cached) return cached;
    const rng = new Rng(r.seed);
    const base = WALLS[r.style]!, kind = district?.kind ?? null, tint = district?.palette.wall;
    const p = tint ? { wall: blend(base.wall, tint, 0.65), shade: blend(base.shade, tint, 0.45), trim: base.trim, rail: base.rail } : base;
    const h = HEAD + this.H + 80;
    const day = canvas(r.w, h);
    const g = ctxOf(day);
    const wins: { x: number; y: number; on: number }[] = [];

    g.fillStyle = p.wall; g.fillRect(0, HEAD, r.w, h - HEAD);
    g.fillStyle = p.shade; g.fillRect(r.w - 8, HEAD, 8, h - HEAD);
    // Balconied flats, with outdoor units and the odd plant pot.
    const cols = Math.max(1, Math.floor((r.w - 20) / 30));
    const margin = Math.round((r.w - cols * 30) / 2);
    // Painted block number, on a wall kept free of windows.
    const label = `${r.number}동`;
    g.font = FONT;
    g.textBaseline = 'top';
    const lw = Math.ceil(g.measureText(label).width);
    const lx = Math.round(r.w / 2 - lw / 2);
    for (let y = HEAD + 24; y < h; y += 26) {
      g.fillStyle = p.shade; g.fillRect(0, y - 6, r.w, 2);
      for (let c = 0; c < cols; c++) {
        const x = margin + c * 30 + 3;
        if (y === HEAD + 50 && x + 25 > lx - 4 && x < lx + lw + 4) continue;
        if (kind === 'construction') {
          // Unglazed openings, with a brace across some.
          g.fillStyle = p.trim; g.fillRect(x, y, 24, 15);
          g.fillStyle = '#35304f'; g.fillRect(x + 2, y + 2, 20, 13);
          if (rng.chance(0.4)) { g.fillStyle = district!.palette.accent; for (let k = 0; k < 20; k += 2) g.fillRect(x + 2 + k, y + 13 - Math.round(k * 0.55), 2, 1); }
          wins.push({ x: x + 6, y: y + 3, on: rng.next() * 1.6 });
          continue;
        }
        if (kind === 'highrise') {
          // A glass curtain wall.
          g.fillStyle = '#4a5f8a'; g.fillRect(x - 2, y - 3, 28, 20);
          g.fillStyle = '#7d9cc4'; g.fillRect(x - 1, y - 2, 4, 18);
          g.fillStyle = p.trim; g.fillRect(x + 12, y - 3, 1, 20);
          wins.push({ x: x + 1, y: y + 1, on: rng.next() });
          continue;
        }
        g.fillStyle = p.trim; g.fillRect(x, y, 24, 15);
        g.fillStyle = '#4a4a78'; g.fillRect(x + 1, y + 1, 11, 9); g.fillRect(x + 13, y + 1, 10, 9);
        g.fillStyle = '#e88f84'; g.fillRect(x + 2, y + 2, 4, 2); g.fillRect(x + 14, y + 2, 3, 2);
        g.fillStyle = p.rail; g.fillRect(x - 1, y + 10, 26, 1);
        for (let k = 0; k < 24; k += 3) g.fillRect(x + k, y + 11, 1, 4);
        wins.push({ x: x + 1, y: y + 1, on: rng.next() });
        if (kind === 'neon' && rng.chance(0.35)) {
          // A shop sign under the window.
          g.fillStyle = '#2a1c40'; g.fillRect(x, y + 15, 24, 5);
          g.fillStyle = rng.chance(0.5) ? district!.palette.accent : '#ff5fc8';
          for (let k = 2; k < 22; k += 5) g.fillRect(x + k, y + 16, 3, 3);
        } else if (rng.chance(0.2)) {
          g.fillStyle = '#e8e6ee'; g.fillRect(x + 15, y + 9, 9, 6);
          g.fillStyle = '#8c88a8'; g.fillRect(x + 17, y + 10, 4, 4);
        } else if (rng.chance(0.15)) {
          g.fillStyle = '#5fa356'; g.fillRect(x + 3, y + 6, 5, 4);
          g.fillStyle = '#b5573c'; g.fillRect(x + 4, y + 10, 3, 3);
        }
      }
    }
    g.fillStyle = p.trim;
    g.fillText(label, lx, HEAD + 51);
    // Muted rooftop scenery: never solid.
    const bg = '#6d4a72', bg2 = '#573a63';
    if (district && district.kind !== 'residential') this.roofScenery(g, rng, r.w, district);
    else for (let x = 14; x < r.w - 30; x += rng.int(48, 96)) {
      const kind = rng.int(0, 4);
      g.fillStyle = bg;
      if (kind === 0) { g.fillRect(x, HEAD - 40, 1, 40); g.fillRect(x - 6, HEAD - 38, 13, 1); g.fillRect(x - 4, HEAD - 33, 9, 1); g.fillRect(x - 3, HEAD - 28, 7, 1); }
      else if (kind === 1 && x < r.w - 60) {
        g.fillRect(x, HEAD - 26, 40, 26); g.fillStyle = bg2; g.fillRect(x - 2, HEAD - 29, 44, 4); g.fillRect(x + 26, HEAD - 18, 9, 18);
        wins.push({ x: x + 6, y: HEAD - 19, on: 0.2 });
      } else if (kind === 2) { for (let k = 0; k < 3; k++) { g.fillRect(x + k * 9, HEAD - 8, 8, 7); g.fillRect(x + k * 9 + 1, HEAD - 9, 6, 9); g.fillStyle = bg2; g.fillRect(x + k * 9 + 1, HEAD - 10, 6, 2); g.fillStyle = bg; } }
      else if (kind === 3) { g.fillRect(x + 4, HEAD - 12, 1, 12); g.fillRect(x, HEAD - 18, 8, 7); g.fillRect(x + 8, HEAD - 20, 2, 2); }
      else { g.fillRect(x, HEAD - 22, 2, 22); g.fillRect(x + 26, HEAD - 22, 2, 22); g.fillRect(x, HEAD - 21, 28, 1); g.fillStyle = bg2; g.fillRect(x + 5, HEAD - 20, 7, 9); g.fillRect(x + 15, HEAD - 20, 8, 7); }
    }
    // Green waterproofed deck and concrete lip: the bright line is what you run on.
    g.fillStyle = '#eafbd2'; g.fillRect(0, HEAD, r.w, 1);
    g.fillStyle = '#57b86a'; g.fillRect(0, HEAD + 1, r.w, 5);
    g.fillStyle = '#2f7d58'; g.fillRect(0, HEAD + 6, r.w, 2);
    for (let x = 6; x < r.w - 4; x += 13) g.fillRect(x, HEAD + 3, 5, 1);
    g.fillStyle = '#f2e7dc'; g.fillRect(0, HEAD + 8, r.w, 3);
    g.fillStyle = p.trim; g.fillRect(0, HEAD + 11, r.w, 2);

    const night = nightOf(day, '#0d0f38', 0.68, (n) => {
      n.fillStyle = '#c9ffd9'; n.fillRect(0, HEAD, r.w, 1);
      n.fillStyle = '#3f9a74'; n.fillRect(0, HEAD + 1, r.w, 4);
      for (const w of wins) {
        if (w.on > 0.55) continue;
        n.fillStyle = w.on < 0.35 ? '#ffd877' : w.on < 0.45 ? '#ffb15c' : '#a8e4ff';
        n.fillRect(w.x, w.y, 11, 9);
        if (w.on < 0.3) n.fillRect(w.x + 12, w.y, 10, 9);
        n.fillStyle = '#7a4c3c'; n.fillRect(w.x + 5, w.y, 1, 9);
      }
      n.fillStyle = '#ff7ad9'; n.font = FONT; n.textBaseline = 'top';
      n.fillText(label, lx, HEAD + 51);
    });
    const pair = { day, night };
    // Blocks the world dropped before they scrolled out of sight leave oldest first.
    if (this.roofs.size >= ROOF_CACHE) this.roofs.delete(this.roofs.keys().next().value!);
    this.roofs.set(r.id, pair);
    return pair;
  }

  /** What stands on a district's roofs. Never solid, so kept muted and behind the runner. */
  private roofScenery(g: Ctx, rng: Rng, width: number, d: District): void {
    const bg = blend(d.palette.mid, '#6d4a72', 0.35), dim = blend(d.palette.accent, bg, 0.45);
    const box = (x: number, y: number, w: number, h: number, c = bg) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    const sparse = this.quality === 'low';
    for (let x = 14; x < width - 44; x += rng.int(sparse ? 96 : 52, sparse ? 150 : 100)) {
      const first = rng.chance(0.5);
      if (d.kind === 'construction') {
        if (first) { box(x + 8, HEAD - 42, 2, 42); box(x, HEAD - 42, 38, 2); box(x + 32, HEAD - 40, 1, 14); box(x + 30, HEAD - 26, 5, 3, dim); }
        else { for (let k = 0; k < 3; k++) box(x + k * 2, HEAD - 3 - k * 5, 30 - k * 4, 3); box(x + 34, HEAD - 8, 6, 8, dim); box(x + 36, HEAD - 11, 2, 3, dim); }
      } else if (d.kind === 'neon') {
        if (first) { box(x + 3, HEAD - 12, 1, 12); box(x + 30, HEAD - 12, 1, 12); box(x, HEAD - 30, 36, 19); box(x + 3, HEAD - 27, 30, 2, dim); box(x + 7, HEAD - 21, 22, 2, dim); box(x + 11, HEAD - 16, 14, 2, dim); }
        else { box(x, HEAD - 38, 9, 38); for (let y = HEAD - 35; y < HEAD - 5; y += 8) box(x + 2, y, 5, 4, dim); }
      } else if (d.kind === 'riverside') {
        if (first) { box(x + 2, HEAD - 30, 1, 30); box(x, HEAD - 33, 5, 3, dim); box(x + 12, HEAD - 8, 14, 8); box(x + 15, HEAD - 11, 8, 3); }
        else { box(x, HEAD - 10, 37, 1); for (let k = 0; k <= 36; k += 6) box(x + k, HEAD - 10, 1, 10); }
      } else if (first) { box(x + 8, HEAD - 44, 1, 44); box(x + 5, HEAD - 30, 7, 1); box(x + 6, HEAD - 38, 5, 1); box(x + 8, HEAD - 46, 1, 2, dim); }
      else { box(x, HEAD - 12, 30, 12); box(x + 3, HEAD - 15, 24, 3); box(x + 11, HEAD - 10, 2, 8, dim); box(x + 18, HEAD - 10, 2, 8, dim); box(x + 13, HEAD - 7, 5, 2, dim); }
    }
  }

  private drawPair(p: Pair, x: number, y: number, n: number, alpha = 1): void {
    const g = this.g;
    g.globalAlpha = alpha;
    if (n < 1) g.drawImage(p.day, x, y);
    if (n > 0) { g.globalAlpha = n * alpha; g.drawImage(p.night, x, y); }
    g.globalAlpha = 1;
  }

  private drawLayers(theme: Theme, cx: number, cy: number, n: number, alpha: number): void {
    const g = this.g;
    for (const l of theme.layers) {
      const w = l.pair.day.width;
      const y = Math.round(this.H * l.base - l.pair.day.height * 0.45 - (cy + this.H * 0.64) * l.speed * 0.6);
      for (let x = -(((Math.round(cx * l.speed) % w) + w) % w); x < this.W; x += w) this.drawPair(l.pair, x, y, n, alpha);
      const foot = y + l.pair.day.height;
      if (foot < this.H) {
        g.globalAlpha = alpha;
        g.fillStyle = mix(hex(theme.palette?.near ?? '#4d265c'), hex('#0b0d2c'), n);
        g.fillRect(0, foot, this.W, this.H - foot);
        g.globalAlpha = 1;
      }
    }
  }

  /** Takes up the scenery of the district now under the runner, fading from the last one. */
  private turnTheme(district: District | null, dt: number): void {
    if (!this.theme || this.theme.kind !== (district?.kind ?? null)) {
      this.leaving = this.quality === 'low' ? null : this.theme;
      this.fade = this.leaving ? 0 : 1;
      this.theme = this.themeFor(district);
    }
    if (this.leaving && (this.fade += dt / FADE) >= 1) { this.leaving = null; this.fade = 1; }
  }

  // ---- Frame -------------------------------------------------------------

  onEvent(e: GameEvent, g: Game): void {
    const p = g.player;
    const burst = (n: number, x: number, y: number, colors: string[], speed: number, up = 0, grav = 260) => {
      const count = this.quality === 'low' ? Math.ceil(n / 3) : n;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up, life: 0, max: 0.3 + Math.random() * 0.35, color: colors[i % colors.length]!, size: Math.random() < 0.4 ? 2 : 1, g: grav });
      }
    };
    const pop = (x: number, y: number, text: string, color: string) => this.popups.push({ x, y, life: 0, text, color });
    switch (e.type) {
      case 'jump':
        this.squash = -0.1;
        burst(e.perfect ? 14 : 5, p.x + 4, p.y, e.perfect ? ['#7dfff0', '#ffffff', '#ffd85a'] : ['#e9dcd0'], e.perfect ? 110 : 45, 10);
        break;
      case 'land':
        this.squash = 0.1;
        if (e.speed > 120) burst(6, p.x + 5, p.y, ['#e9dcd0', '#c9b8c0'], 50, 8);
        if (e.speed > 380) this.shake = Math.max(this.shake, 1.5);
        break;
      case 'coin': if (e.kind === 'diamond') { burst(22, e.x, e.y, ['#6ee8ff', '#fff', '#2fa8e0'], 130); pop(e.x, e.y - 6, `다이아 +${e.points}`, '#8ff4ff'); break; }
        burst(e.kind === 'gold' ? 12 : 6, e.x, e.y, e.kind === 'gold' ? ['#ff7ad9', '#fff'] : ['#ffcf4a', '#fff6c0'], 80); break;
      case 'perfectBonus': pop(e.x, e.y - 6, `퍼펙트 +${e.points}`, '#7dfff0'); break;
      case 'airjump':
        this.squash = -0.1;
        burst(12, p.x + 5, p.y, ['#ffffff', '#8ff4ff', '#b8a8ff'], 90, -10, 60);
        break;
      case 'stomp':
        this.squash = 0.15;
        this.shake = Math.max(this.shake, 2.5);
        burst(18, e.x, e.y + 4, e.target === 'ac' ? ['#f4f1f8', '#bdb6d2', '#5a5480'] : e.target === 'drone' ? ['#e8465f', '#ffe14a', '#dfe9ff'] : ['#c9d0ea', '#9aa3c7', '#fff'], 130, 50);
        break;
      case 'stompBonus': pop(e.x - 8, e.y - 18, `밟기 +${e.points}`, '#ffe14a'); break;
      case 'power': burst(20, e.x, e.y, [powerColor(e.kind), '#fff'], 130); pop(e.x - 10, e.y - 12, `${POWER_NAMES[e.kind]}! +${e.points}`, powerColor(e.kind)); break;
      case 'dash': pop(e.x, e.y - 18, `질주 착지 +${e.points}`, '#ffd85a'); break;
      case 'mission': burst(30, p.x + 5, p.y - 20, ['#ffd85a', '#9be36b', '#7dfff0', '#fff'], 150, 40); pop(p.x - 14, p.y - 58, `미션 완료! ${missionText(e.mission)} +${e.points}`, '#9be36b'); break;
      case 'shielded': this.shake = Math.max(this.shake, 3); burst(24, e.x, e.y, ['#9be36b', '#fff6e0', '#fff'], 150, 30); pop(p.x - 6, p.y - 26, '안전모가 막았다!', '#9be36b'); break;
      case 'road': pop(e.x, e.y - 30, '자동차 주의! 점프로 피하세요', '#ffd85a'); break;
      case 'trafficHit': this.shake = 9; burst(30, e.x, e.y - 8, ['#ff5566', '#ffd85a', '#fff'], 170, 60); pop(e.x - 20, e.y - 30, '차량 충돌!', '#ff7a7a'); break;
      case 'roadExit': pop(e.x, e.y - 30, '옥상 복귀!', '#9be36b'); break;
      case 'speedup': pop(p.x - 10, p.y - 44, `속도 UP! Lv.${e.level}`, '#ffb84a'); break;
      case 'district': pop(p.x - 14, p.y - 58, `${e.district.name} 진입`, e.district.palette.accent); break;
      case 'districtGoal': burst(24, p.x + 5, p.y - 20, [e.district.palette.accent, '#ffd85a', '#fff'], 140, 40); pop(p.x - 14, p.y - 70, `구역 목표 달성 +${e.points}`, '#ffd85a'); break;
      case 'goal': burst(40, p.x + 6, p.y - 20, ['#ffd85a', '#7dfff0', '#ff7ad9', '#fff'], 170, 60); break;
      case 'risk': pop(e.x, e.y - 6, `${RISK_NAMES[e.kind]} +${e.points}`, '#ff9be6'); break;
      case 'stumble': this.shake = 4; burst(14, p.x + 10, p.y - 8, ['#fff', '#ff5566', '#ffcf4a'], 120, 40); pop(p.x, p.y - 22, '쿵!', '#ff7a7a'); break;
      case 'wall': this.shake = 5; burst(12, p.x + 10, p.y - 8, ['#e9dcd0', '#b98a7c'], 110, 20); break;
      case 'fell': this.shake = 6; break;
      case 'comboLost': if (e.combo >= 3) pop(p.x, p.y - 34, '콤보 끊김', '#b7b0d8'); break;
    }
  }

  draw(game: Game, dt: number, moving: boolean): void {
    const g = this.g, p = game.player;
    this.t += dt;
    const n = this.nightAt(game.distance);
    const target = p.lastRoofY * 0.65 + Math.min(p.y, p.lastRoofY + 60) * 0.35 - this.H * 0.64;
    this.camY += (target - this.camY) * Math.min(1, dt * 5);
    this.shake = Math.max(0, this.shake - dt * 14);
    const sh = this.shakeOn ? this.shake : 0;
    // The faster it goes, the more road ahead is shown.
    const pace = Math.max(0, Math.min(1, (paceSpeed(p.pace, p.x) - 130) / 170));
    const look = (this.W > this.H ? 0.25 : 0.18) - 0.07 * pace;
    const cx = Math.round(p.x - this.W * look + (Math.random() - 0.5) * sh * 2);
    const cy = Math.round(this.camY + (Math.random() - 0.5) * sh * 2);

    const district = game.district;
    this.turnTheme(district, dt);
    this.drawSky(n, game.distance);
    if (this.leaving) this.drawLayers(this.leaving, cx, cy, n, 1);
    this.drawLayers(this.theme!, cx, cy, n, this.leaving ? this.fade : 1);

    // Buildings and scaffolds first, then streets over the scaffold feet, then everything on top.
    const seen: Roof[] = [];
    for (const r of game.world.roofs) {
      const x = r.x - cx;
      if (x > this.W + 700 || roofEnd(r) - cx < -260) { if (x + r.w < -600) this.roofs.delete(r.id); continue; }
      seen.push(r);
      if (x > this.W || x + r.w < 0) continue;
      if (r.kind === 'scaffold') drawScaffold(g, x, Math.round(r.y - cy), r.w, ROAD_DEPTH + 60);
      else this.drawPair(this.roofArt(r, district ? districtAt(Math.max(0, (r.x - START_X) / PX_PER_M)) : null), x, r.y - HEAD - cy, n);
    }
    for (const r of seen) if (r.road) drawRoad(g, r.road, cx, cy, this.H, n);
    for (const r of seen) if (r.road) for (const car of roadCars(r.road, p.time)) {
      const x = Math.round(car.x - cx), y = Math.round(car.y - cy);
      if (x < -40 || x > this.W + 40) continue;
      g.fillStyle = '#140c2e'; g.fillRect(x - 1, y + 4, 34, 10); g.fillRect(x + 6, y - 1, 21, 7);
      g.fillStyle = ['#e94b61', '#ffd85a', '#73b5dc', '#d8dbe5'][car.color]!;
      g.fillRect(x, y + 5, 32, 7); g.fillRect(x + 7, y, 18, 6);
      g.fillStyle = '#29264b'; g.fillRect(x + 9, y + 1, 6, 5); g.fillRect(x + 17, y + 1, 6, 5);
      g.fillStyle = '#fff6c0'; g.fillRect(x, y + 7, 3, 3);
      g.fillStyle = '#140c2e'; g.fillRect(x + 4, y + 11, 6, 4); g.fillRect(x + 23, y + 11, 6, 4);
      g.fillStyle = '#b5afc9'; g.fillRect(x + 6, y + 12, 2, 2); g.fillRect(x + 25, y + 12, 2, 2);
    }
    if (game.world.goalX !== null) {
      const last = game.world.roofs[game.world.roofs.length - 1]!;
      drawFlag(g, Math.round(game.world.goalX - cx), Math.round(last.y - cy), this.t);
    }
    for (const r of seen) {
      const x = r.x - cx;
      if (r.road) drawRoadSign(g, r, x, Math.round(r.y - cy), this.t);
      for (const l of r.lines) {
        // Rope between the two roofs, with the quilt that can be stood on.
        const on = p.ground?.id === l.id ? 2 : 0;
        const lx = Math.round(l.x - cx), ly = Math.round(l.y - cy) + on;
        const ax = x + r.w - 4, bx = x + r.w + r.gap + 3;
        g.fillStyle = '#2a1c40';
        g.fillRect(ax, ly - 3, 2, r.y - cy - ly + 3);
        g.fillRect(bx, ly - 3, 2, Math.max(4, r.y + r.nextDy - cy - ly + 3));
        g.fillStyle = '#f5ead8'; g.fillRect(ax, ly, bx - ax, 1);
        drawQuilt(g, lx, ly, l.w, l.style, this.t);
      }
      for (const o of r.obstacles) {
        if (p.gone.includes(o.id)) continue;
        if (o.kind === 'ac') drawAc(g, Math.round(o.x - cx), Math.round(o.y - cy), this.t);
        else drawTank(g, Math.round(o.x - cx), Math.round(o.y - cy));
      }
      for (const c of r.coins) if (!c.taken) {
        if (c.kind === 'diamond') { drawDiamond(g, Math.round(c.x - cx - 5), Math.round(c.y - cy - 4 + Math.sin(this.t * 3) * 2), this.t); continue; }
        const f = Math.floor(this.t * 8 + c.x * 0.02) % 4;
        const s = (c.kind === 'gold' ? this.sprites.gold : this.sprites.coin)[f]!;
        g.drawImage(s, Math.round(c.x - cx - 3), Math.round(c.y - cy - 3 + Math.sin(this.t * 4 + c.x * 0.05)));
      }
    }

    for (const r of seen) for (const w of r.powers) {
      const x = w.x - cx;
      if (!w.taken && x > -12 && x < this.W + 12) drawPower(g, w.kind, x, w.y - cy, this.t);
    }
    for (const r of seen) for (const e of r.enemies) {
      if (p.gone.includes(e.id)) continue;
      const b = enemyBox(e, p.x);
      const ex = Math.round(b.x - cx), ey = Math.round(b.y - cy);
      if (ex > this.W - 4) {
        // Warn before it comes into view.
        if (e.x - p.x < Math.max(this.W, p.vx * 2.4)) drawWarning(g, this.W - 14, Math.max(60, Math.min(this.H - 12, ey + 5)), this.t);
      } else if (ex > -20) (e.kind === 'drone' ? drawDrone : drawPigeon)(g, ex, ey, this.t);
    }

    this.drawPlayer(game, cx, cy, dt, moving);
    this.drawFx(cx, cy, dt, n);
  }

  private drawPlayer(game: Game, cx: number, cy: number, dt: number, moving: boolean): void {
    const g = this.g, p = game.player;
    const boosted = p.boost >= 1 || p.boostTime > 0;
    if (moving) {
      this.trail.push({ x: p.x, y: p.y });
      if (this.trail.length > 10) this.trail.shift();
    }
    if (boosted && this.quality !== 'low') {
      this.trail.forEach((q, i) => {
        g.globalAlpha = (i / this.trail.length) * 0.4;
        g.fillStyle = ['#7dfff0', '#ffd85a', '#ff7ad9'][i % 3]!;
        g.fillRect(Math.round(q.x - cx), Math.round(q.y - cy - 12), 8, 9);
      });
      g.globalAlpha = 1;
    }
    this.squash *= Math.max(0, 1 - dt * 12);
    let s = this.sprites.run[0]!;
    if (!p.ground) s = p.vy < 0 ? this.sprites.jump : this.sprites.fall;
    else if (moving) s = this.sprites.run[Math.floor(p.x / 13) % 4]!;
    if (p.stumble > 0 && Math.floor(this.t * 20) % 2) g.globalAlpha = 0.45;
    if (canAirJump(p) && !p.ground && this.quality !== 'low') { g.fillStyle = '#8ff4ff'; g.fillRect(Math.round(p.x - cx) + 1, Math.round(p.y - cy) + 1, 2, 1); g.fillRect(Math.round(p.x - cx) + 7, Math.round(p.y - cy) + 1, 2, 1); }
    const w = Math.round(14 * (1 + this.squash * 1.5)), h = Math.round(16 * (1 - this.squash * 1.5));
    const px = Math.round(p.x - cx - 2 - (w - 14) / 2), py = Math.round(p.y - cy - h + 1);
    if (p.ground) { g.fillStyle = 'rgba(10,6,30,.35)'; g.fillRect(px + 1, Math.round(p.y - cy), 12, 1); }
    g.drawImage(s, px, py, w, h);
    if (p.vy < 0 && (p.jumping || p.holdTime >= HOLD_MAX)) {
      const fill = Math.min(1, p.holdTime / HOLD_MAX);
      g.fillStyle = '#140c2e'; g.fillRect(px - 5, py - 9, 25, 5);
      g.fillStyle = fill >= 0.99 ? '#ffd85a' : '#7dfff0'; g.fillRect(px - 4, py - 8, Math.round(23 * fill), 3);
    }
    // Scarf tail
    g.fillStyle = '#ff4d5e';
    for (let i = 0; i < 5; i++) {
      const yy = Math.sin(this.t * 14 - i) * (i * 0.4) - Math.max(-3, Math.min(3, p.vy / 120)) * (i / 4);
      g.fillRect(px + 2 - i * 2, Math.round(py + 7 + yy), 2, i < 3 ? 2 : 1);
    }
    g.globalAlpha = 1;
    this.drawAura(game, px, py);
    // Speed lines
    const fast = (p.vx - paceSpeed(p.pace, p.x)) / BOOST_SPEED + (timeRate(p) > 1 ? 3 : 0);
    if (moving && fast > 1.5 && this.quality === 'high') {
      g.fillStyle = 'rgba(255,255,255,.35)';
      for (let i = 0; i < fast * 2; i++) g.fillRect(Math.floor(Math.random() * this.W), Math.floor(Math.random() * this.H * 0.8), 14, 1);
    }
  }

  /** Shows which items are working on the runner. Blinks when one is about to end. */
  private drawAura(game: Game, px: number, py: number): void {
    const g = this.g, p = game.player, cx = px + 7, cy = py + 8;
    const shown = (left: number) => left > 1.5 || (left > 0 && Math.floor(this.t * 10) % 2 === 0);
    const ring = (r: number, color: string, n: number, spin: number) => {
      g.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.t * spin;
        g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 2, 2);
      }
    };
    if (p.shield) { g.fillStyle = '#9be36b'; g.fillRect(px + 2, py - 2, 10, 3); g.fillRect(px + 4, py - 4, 6, 2); ring(13, '#9be36b', 10, 1.5); }
    if (shown(game.magnetTime)) { const q = (this.t * 1.5) % 1; g.globalAlpha = 0.5 * q; ring(MAGNET_RANGE * (1 - q) * 0.6 + 8, '#ff5d6c', this.quality === 'low' ? 10 : 22, 0.5); g.globalAlpha = 1; }
    if (shown(game.doubleTime)) ring(10, '#ff9be6', 4, -5);
    if (shown(game.keepTime)) ring(17, '#ffb84a', 3, 3);
    for (let i = 0; i < p.airBonus; i++) { g.fillStyle = '#7dfff0'; g.fillRect(px + 3 + i * 5, py + 18, 3, 2); }
  }

  private drawFx(cx: number, cy: number, dt: number, n: number): void {
    const g = this.g;
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
    this.particles = this.particles.filter((q) => (q.life += dt) < q.max);
    for (const q of this.particles) {
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      g.fillStyle = q.color;
      g.fillRect(Math.round(q.x - cx), Math.round(q.y - cy), q.size, q.size);
    }
    this.popups = this.popups.filter((q) => (q.life += dt) < 0.9);
    g.font = FONT;
    g.textBaseline = 'alphabetic';
    for (const q of this.popups) {
      const x = Math.round(q.x - cx - 8), y = Math.round(q.y - cy - q.life * 24);
      g.globalAlpha = Math.min(1, (0.9 - q.life) * 4);
      g.fillStyle = '#1a1230';
      for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]] as const) g.fillText(q.text, x + a, y + b);
      g.fillStyle = q.color;
      g.fillText(q.text, x, y);
    }
    g.globalAlpha = 1;
    if (this.quality === 'high' && n > 0.5) {
      g.fillStyle = '#ffe9a8';
      for (let i = 0; i < 10; i++) {
        const x = (((i * 97 - cx * 0.6 + Math.sin(this.t + i) * 12) % this.W) + this.W) % this.W;
        g.globalAlpha = 0.25 + 0.25 * Math.sin(this.t * 3 + i * 2);
        g.fillRect(Math.round(x), Math.round(this.H * (0.35 + 0.05 * i) + Math.sin(this.t * 0.8 + i) * 8), 1, 1);
      }
      g.globalAlpha = 1;
    }
  }
}
