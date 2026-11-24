import { baseSpeed, jumpHeightAt, jumpReach, jumpTime } from './physics';
import { Rng } from './rng';

export interface Obstacle { id: number; kind: 'ac' | 'tank'; x: number; y: number; w: number; h: number }
export interface Line { id: number; x: number; w: number; y: number; style: number }
export interface Coin { x: number; y: number; value: 1 | 5; taken: boolean }
export interface Roof {
  id: number; x: number; w: number; y: number; style: number; seed: number; number: number;
  obstacles: Obstacle[]; lines: Line[]; coins: Coin[];
  /** Gap to the next roof and its height change. */
  gap: number; nextDy: number;
}

/** Clear roof after an edge, for touching down. */
export const LANDING_ZONE = 110;
/** Clear roof before an edge: enough to regain full speed after a stumble. */
export const RUNUP_ZONE = 135;
export const START_ROOF = 640;
export const MAX_RISE = 40;
export const MAX_DROP = 48;

export function difficulty(x: number): number { return 1 - Math.exp(-Math.max(0, x) / 11000); }

/** Deterministic city: each gap is sized from what an unboosted, fully held jump can cross. */
export class World {
  roofs: Roof[] = [];
  private rng: Rng;
  private nextId = 1;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    const first = this.blank(-200, START_ROOF + 200, 0);
    this.roofs.push(first);
    for (let i = 0; i < 6; i++) first.coins.push({ x: 300 + i * 16, y: -10, value: 1, taken: false });
    this.planGap(first);
  }

  private blank(x: number, w: number, y: number): Roof {
    const n = this.nextId++;
    return {
      id: n, x, w, y, style: this.rng.int(0, 4), seed: this.rng.int(1, 1e9), number: 100 + n,
      obstacles: [], lines: [], coins: [], gap: 0, nextDy: 0,
    };
  }

  private planGap(r: Roof): void {
    const edge = r.x + r.w;
    const d = difficulty(edge);
    let dy = Math.round(this.rng.range(-MAX_RISE, MAX_DROP) * (0.45 + 0.55 * d));
    if (r.y + dy < -80) dy = Math.abs(dy);
    if (r.y + dy > 80) dy = -Math.min(MAX_RISE, Math.abs(dy));
    const speed = baseSpeed(edge);
    const ratio = this.rng.range(0.34 + 0.14 * d, 0.56 + 0.24 * d);
    r.nextDy = dy;
    r.gap = Math.max(26, Math.round(jumpReach(speed, dy) * ratio));

    if (r.gap >= 56 && this.rng.chance(0.2 + 0.2 * d)) {
      const w = Math.max(28, Math.round(r.gap * 0.42));
      const y = r.y - 26 + Math.round(Math.min(0, dy) / 2);
      const x = Math.round(edge + r.gap * 0.28);
      r.lines.push({ id: this.nextId++, x, w, y, style: this.rng.int(0, 3) });
      for (let i = 0; i < 2; i++) r.coins.push({ x: x + w * (0.3 + i * 0.4), y: y - 12, value: 5, taken: false });
    } else if (this.rng.chance(0.6)) {
      const T = jumpTime(dy);
      const n = this.rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        const t = T * (0.15 + (0.7 * i) / (n - 1));
        r.coins.push({
          x: edge - 8 + speed * t * Math.min(1, ratio + 0.2), y: r.y - jumpHeightAt(t) - 6, value: 1, taken: false,
        });
      }
    }
  }

  private furnish(r: Roof): void {
    let x = r.x + LANDING_ZONE;
    const end = r.x + r.w - RUNUP_ZONE;
    const d = difficulty(r.x);
    let placed = false;
    while (x < end - 40 && this.rng.chance(placed ? 0.5 : 0.45 + 0.4 * d)) {
      const tank = this.rng.chance(0.4);
      const w = tank ? 36 : 16;
      const h = tank ? 31 : 11;
      const ox = Math.round(this.rng.range(x, Math.min(end - w, x + 50)));
      r.obstacles.push({ id: this.nextId++, kind: tank ? 'tank' : 'ac', x: ox, y: r.y - h, w, h });
      if (tank) {
        for (let i = 0; i < 2; i++) r.coins.push({ x: ox + 10 + i * 16, y: r.y - h - 12, value: 5, taken: false });
      } else if (this.rng.chance(0.6)) {
        for (let i = 0; i < 3; i++) r.coins.push({ x: ox - 8 + i * 16, y: r.y - (i === 1 ? 34 : 27), value: 1, taken: false });
      }
      placed = true;
      x = ox + w + 150;
    }
    if (!placed && this.rng.chance(0.65)) {
      const n = this.rng.int(3, 6);
      const start = r.x + this.rng.range(30, Math.max(31, r.w - n * 14 - 30));
      for (let i = 0; i < n; i++) r.coins.push({ x: start + i * 14, y: r.y - 10, value: 1, taken: false });
    }
  }

  /** Extend the city past `to` and forget what is well behind `from`. */
  ensure(from: number, to: number): void {
    let last = this.roofs[this.roofs.length - 1]!;
    while (last.x + last.w < to) {
      const x = last.x + last.w + last.gap;
      const d = difficulty(x);
      const w = Math.round(baseSpeed(x) * this.rng.range(1.35 - 0.2 * d, 2.9 - 0.9 * d));
      const wide = this.rng.chance(0.35 + 0.1 * d) ? LANDING_ZONE + RUNUP_ZONE + this.rng.int(60, 180) : 0;
      const r = this.blank(x, Math.max(w, wide), last.y + last.nextDy);
      this.furnish(r);
      this.planGap(r);
      this.roofs.push(r);
      last = r;
    }
    while (this.roofs.length > 2 && this.roofs[1]!.x + this.roofs[1]!.w < from - 400) this.roofs.shift();
  }
}
