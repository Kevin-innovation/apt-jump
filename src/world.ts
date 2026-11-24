import { baseSpeed, ease, jumpHeightAt, jumpReach, jumpTime, roofEnd } from './physics';
import { Rng } from './rng';

export interface Obstacle { id: number; kind: 'ac' | 'tank'; x: number; y: number; w: number; h: number }
export interface Line { id: number; x: number; w: number; y: number; style: number }
export type CoinKind = 'coin' | 'gold' | 'diamond';
export interface Coin { x: number; y: number; kind: CoinKind; taken: boolean }
/** x is where the runner meets it; y the middle of its movement (top of its box). */
export interface Enemy { id: number; kind: 'drone' | 'pigeon'; x: number; y: number; amp: number; phase: number }
/** A street under a run of scaffolds, with a ramp back up to the next building. */
export interface Road { id: number; x: number; y: number; rampStart: number; rampEnd: number; rampY: number }
export interface Roof {
  id: number; kind: 'building' | 'scaffold'; x: number; w: number; y: number; style: number; seed: number; number: number;
  obstacles: Obstacle[]; lines: Line[]; coins: Coin[]; enemies: Enemy[]; road: Road | null;
  /** Gap to the next roof and its height change. */
  gap: number; nextDy: number;
}
/** What a run needs from a city, generated or hand made. */
export interface City {
  roofs: Roof[];
  ensure(from: number, to: number): void;
  /** Crossing this ends the run in success; null for an endless city. */
  goalX: number | null;
}

/** Clear roof after an edge, for touching down. */
export const LANDING_ZONE = 130;
/** Clear roof before an edge: enough to regain full speed after a stumble. */
export const RUNUP_ZONE = 155;
export const START_ROOF = 640;
export const MAX_RISE = 40;
export const MAX_DROP = 48;
/** Nothing hostile moves before this point (about 220 m). */
export const ENEMY_START = 3500;
export const ROAD_START = 2000;
export const ROAD_DEPTH = 120;
/** Ramp pixels across for each pixel up. */
export const RAMP_RUN = 1.7;
/** Out of reach of a single jump from the roof, within reach of a double one. */
export const DIAMOND_HEIGHT = 120;
export const OBSTACLE_SIZE = { ac: { w: 16, h: 11 }, tank: { w: 36, h: 31 } } as const;

export function difficulty(x: number): number { return ease(x, 7500); }
export function enemyChance(x: number): number {
  return x < ENEMY_START ? 0 : 0.15 + 0.5 * ease(x - ENEMY_START, 9000);
}

/** Deterministic city: each gap is sized from what an unboosted, fully held single jump can cross. */
export class World implements City {
  roofs: Roof[] = [];
  readonly goalX = null;
  private rng: Rng;
  private nextId = 1;
  private sinceRoad = 0;
  private sinceDiamond = 0;
  /** Scaffolds still to build over the current road, and the roof that owns it. */
  private scaffolds = 0;
  private roadOwner: Roof | null = null;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    const first = this.blank(-200, START_ROOF + 200, 0);
    this.roofs.push(first);
    for (let i = 0; i < 6; i++) this.coin(first, 300 + i * 16, -10);
    this.planGap(first);
  }

  private blank(x: number, w: number, y: number, kind: Roof['kind'] = 'building'): Roof {
    const n = this.nextId++;
    return {
      id: n, kind, x, w, y, style: this.rng.int(0, 4), seed: this.rng.int(1, 1e9), number: 100 + n,
      obstacles: [], lines: [], coins: [], enemies: [], road: null, gap: 0, nextDy: 0,
    };
  }
  private coin(r: Roof, x: number, y: number, kind: CoinKind = 'coin'): void { r.coins.push({ x, y, kind, taken: false }); }

  private planGap(r: Roof): void {
    const edge = r.x + r.w;
    const d = difficulty(edge);
    const overRoad = this.scaffolds > 0 || this.roadOwner !== null;
    let dy = Math.round(this.rng.range(-MAX_RISE, MAX_DROP) * (0.45 + 0.55 * d));
    if (overRoad) dy = Math.round(this.rng.range(-18, 18)); // keep scaffolds clear of the street
    if (r.y + dy < -80) dy = Math.abs(dy);
    if (r.y + dy > 80) dy = -Math.min(MAX_RISE, Math.abs(dy));
    const speed = baseSpeed(edge);
    const ratio = this.rng.range(0.34 + 0.14 * d, 0.56 + 0.24 * d);
    r.nextDy = dy;
    r.gap = Math.max(overRoad ? 70 : 26, Math.round(jumpReach(speed, dy) * ratio));

    if (!overRoad && r.gap >= 56 && this.rng.chance(0.2 + 0.2 * d)) {
      const w = Math.max(28, Math.round(r.gap * 0.42));
      const y = r.y - 26 + Math.round(Math.min(0, dy) / 2);
      const x = Math.round(edge + r.gap * 0.28);
      r.lines.push({ id: this.nextId++, x, w, y, style: this.rng.int(0, 3) });
      for (let i = 0; i < 2; i++) this.coin(r, x + w * (0.3 + i * 0.4), y - 12, 'gold');
    } else if (this.rng.chance(0.6)) {
      const T = jumpTime(dy);
      const n = this.rng.int(3, 5);
      for (let i = 0; i < n; i++) {
        const t = T * (0.15 + (0.7 * i) / (n - 1));
        this.coin(r, edge - 8 + speed * t * Math.min(1, ratio + 0.2), r.y - jumpHeightAt(t) - 6);
      }
    }
  }

  private furnish(r: Roof): void {
    let x = r.x + LANDING_ZONE;
    const end = r.x + r.w - RUNUP_ZONE;
    const d = difficulty(r.x);
    let placed = false;
    while (x < end - 40 && this.rng.chance(placed ? 0.5 : 0.45 + 0.4 * d)) {
      const room = Math.min(end - 40, x + 50);
      if (this.rng.chance(enemyChance(x))) {
        const ex = Math.round(this.rng.range(x, room));
        const drone = this.rng.chance(0.5);
        r.enemies.push({
          id: this.nextId++, kind: drone ? 'drone' : 'pigeon', x: ex, y: r.y - (drone ? 30 : 13),
          amp: drone ? this.rng.int(6, 14) : 0, phase: this.rng.next(),
        });
        x = ex + 190;
      } else {
        const kind = this.rng.chance(0.4) ? 'tank' : 'ac';
        const { w, h } = OBSTACLE_SIZE[kind];
        const ox = Math.round(this.rng.range(x, Math.max(x, Math.min(room, end - w))));
        r.obstacles.push({ id: this.nextId++, kind, x: ox, y: r.y - h, w, h });
        if (kind === 'tank') for (let i = 0; i < 2; i++) this.coin(r, ox + 10 + i * 16, r.y - h - 12, 'gold');
        else if (this.rng.chance(0.6)) for (let i = 0; i < 3; i++) this.coin(r, ox - 8 + i * 16, r.y - (i === 1 ? 34 : 27));
        x = ox + w + 170;
      }
      placed = true;
    }
    if (!placed) {
      this.sinceDiamond++;
      if (r.w > 300 && (this.sinceDiamond >= 5 || this.rng.chance(0.35))) {
        this.sinceDiamond = 0;
        this.coin(r, Math.round(r.x + r.w * 0.5), r.y - DIAMOND_HEIGHT, 'diamond');
      } else if (this.rng.chance(0.65)) {
        const n = this.rng.int(3, 6);
        const start = r.x + this.rng.range(30, Math.max(31, r.w - n * 14 - 30));
        for (let i = 0; i < n; i++) this.coin(r, start + i * 14, r.y - 10);
      }
    }
  }

  /** Decide whether a road starts after r, before its gap is planned. */
  private maybeRoad(r: Roof): void {
    this.sinceRoad++;
    if (r.x < ROAD_START || (this.sinceRoad < 7 && !this.rng.chance(0.08))) return;
    this.sinceRoad = 0;
    this.roadOwner = r;
    this.scaffolds = this.rng.int(3, 4);
    const x = r.x + r.w;
    r.road = { id: this.nextId++, x, y: r.y + ROAD_DEPTH, rampStart: x, rampEnd: x, rampY: r.y };
  }

  private closeRoad(next: Roof): void {
    const owner = this.roadOwner;
    if (!owner?.road) return;
    const d = owner.road;
    d.rampEnd = next.x;
    d.rampY = next.y;
    d.rampStart = Math.round(next.x - (d.y - next.y) * RAMP_RUN);
    for (let i = 0; i < 6; i++) this.coin(owner, d.x + 140 + i * 18, d.y - 10);
    this.roadOwner = null;
  }

  private addNext(): void {
    const last = this.roofs[this.roofs.length - 1]!;
    const x = last.x + last.w + last.gap;
    const y = last.y + last.nextDy;
    const d = difficulty(x);
    const speed = baseSpeed(x);
    if (this.scaffolds > 0) {
      const r = this.blank(x, Math.round(speed * this.rng.range(0.95, 1.25)), y, 'scaffold');
      if (this.rng.chance(0.6)) for (let i = 0; i < 4; i++) this.coin(r, x + 30 + i * 16, y - 10);
      this.scaffolds--;
      this.planGap(r);
      this.roofs.push(r);
      return;
    }
    const w = Math.round(speed * this.rng.range(1.35 - 0.2 * d, 2.9 - 0.9 * d));
    const wide = this.rng.chance(0.35 + 0.1 * d) ? LANDING_ZONE + RUNUP_ZONE + this.rng.int(60, 180) : 0;
    const r = this.blank(x, Math.max(w, wide), y);
    this.closeRoad(r);
    this.furnish(r);
    this.maybeRoad(r);
    this.planGap(r);
    this.roofs.push(r);
  }

  /** Extend the city past `to` and forget what is well behind `from`. */
  ensure(from: number, to: number): void {
    for (;;) {
      const last = this.roofs[this.roofs.length - 1]!;
      // Never leave a road without its ramp.
      if (last.x + last.w >= to && !this.roadOwner) break;
      this.addNext();
    }
    while (this.roofs.length > 2 && roofEnd(this.roofs[0]!) < from - 500) this.roofs.shift();
  }
}
