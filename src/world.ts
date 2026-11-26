import { baseSpeed, ease, jumpHeightAt, jumpReach, jumpTime, PX_PER_M, roofEnd } from './physics';
import { districtAt, type DistrictKind } from './progression';
import { POWER_KINDS, type Power, type PowerKind } from './items';
import { Rng } from './rng';

export interface Obstacle { id: number; kind: 'ac' | 'tank'; x: number; y: number; w: number; h: number }
export interface Line { id: number; x: number; w: number; y: number; style: number }
export type CoinKind = 'coin' | 'gold' | 'diamond';
export interface Coin { x: number; y: number; kind: CoinKind; taken: boolean }
/** x is where the runner meets it; y the middle of its movement (top of its box). */
export interface Enemy { id: number; kind: 'drone' | 'pigeon'; x: number; y: number; amp: number; phase: number }
/** A street under a run of scaffolds, with a ramp back up to the next building. */
export interface Road { id: number; x: number; y: number; rampStart: number; rampEnd: number; rampY: number; traffic?: boolean }
export interface Roof {
  id: number; kind: 'building' | 'scaffold'; x: number; w: number; y: number; style: number; seed: number; number: number;
  obstacles: Obstacle[]; lines: Line[]; coins: Coin[]; powers: Power[]; enemies: Enemy[]; road: Road | null;
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
export function landingZone(x: number): number { return Math.round(baseSpeed(x) * 0.54); }
/** Clear roof before an edge: enough to regain full speed after a stumble. */
export function runupZone(x: number): number { return Math.round(baseSpeed(x) * 0.66); }
export const START_ROOF = 480;
export const MAX_RISE = 40;
export const MAX_DROP = 48;
/** Nothing hostile moves before this point (about 80 m). */
export const ENEMY_START = 1300;
export const ROAD_START = 1300;
export const ROAD_DEPTH = 120;
/** Ramp pixels across for each pixel up. */
export const RAMP_RUN = 1.7;
/** Out of reach of a single jump from the roof, within reach of a double one. */
export const DIAMOND_HEIGHT = 120;
export const OBSTACLE_SIZE = { ac: { w: 16, h: 11 }, tank: { w: 36, h: 31 } } as const;

export function difficulty(x: number): number { return ease(x, 2600); }
export function enemyChance(x: number): number {
  return x < ENEMY_START ? 0 : 0.22 + 0.65 * ease(x - ENEMY_START, 2500);
}

/** No gap asks for more of a single jump than this. */
export const MAX_GAP_RATIO = 0.88;

/** How a district builds: factors and additions on the plain city. */
interface Profile {
  /** Roof width. */ width: number;
  /** Added to a gap's share of the jump. */ gap: number;
  /** Height changes between roofs. */ rise: number;
  /** Added to the chance of something more standing on a roof. */ busy: number;
  /** Chance of a hostile one among those. */ enemy: number;
  /** Share of water tanks among obstacles. */ tank: number;
  /** Added to the chance of laundry across a wide gap. */ line: number;
  /** Roofs between streets at most, the chance of one sooner, and scaffolds added over it. */
  roadEvery: number; roadChance: number; scaffolds: number;
}
const PLAIN: Profile = { width: 1, gap: 0, rise: 1, busy: 0, enemy: 1, tank: 0.4, line: 0, roadEvery: 7, roadChance: 0.08, scaffolds: 0 };
export const PROFILES: Record<DistrictKind, Profile> = {
  residential: { ...PLAIN, width: 1.15 },
  construction: { ...PLAIN, tank: 0.5, roadEvery: 5, roadChance: 0.2, scaffolds: 1 },
  neon: { ...PLAIN, busy: 0.05, enemy: 1.5 },
  riverside: { ...PLAIN, gap: 0.07, rise: 0.35, line: 0.2 },
  highrise: { ...PLAIN, width: 0.95, rise: 1.4, busy: 0.08, tank: 0.7 },
};

/**
 * The district a point lies in, and where in its rhythm: pressure builds through the second half and lets up just
 * before the next one. From the second lap everything presses a little harder, up to a limit.
 */
function zoneAt(x: number) {
  const d = districtAt(Math.max(0, (x - 60) / PX_PER_M));
  const rest = d.progress >= 0.85;
  const surge = !rest && d.progress >= 0.5;
  return { profile: PROFILES[d.kind], rest, surge, lap: Math.min(0.06, (d.lap - 1) * 0.03) };
}

/** Deterministic city: each gap is sized from what an unboosted, fully held single jump can cross. */
export class World implements City {
  roofs: Roof[] = [];
  readonly goalX = null;
  private rng: Rng;
  private nextId = 1;
  private sinceRoad = 0;
  private sinceDiamond = 0;
  private sincePower = 0;
  /** Item kinds still to deal: each comes round once before any comes again. */
  private bag: PowerKind[] = [];
  /** Scaffolds still to build over the current road, and the roof that owns it. */
  private scaffolds = 0;
  private roadOwner: Roof | null = null;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    const first = this.blank(-200, START_ROOF + 200, 0);
    this.roofs.push(first);
    for (let i = 0; i < 6; i++) this.coin(first, 200 + i * 16, -10);
    this.planGap(first);
  }

  private blank(x: number, w: number, y: number, kind: Roof['kind'] = 'building'): Roof {
    const n = this.nextId++;
    return {
      id: n, kind, x, w, y, style: this.rng.int(0, 4), seed: this.rng.int(1, 1e9), number: 100 + n,
      obstacles: [], lines: [], coins: [], powers: [], enemies: [], road: null, gap: 0, nextDy: 0,
    };
  }
  private coin(r: Roof, x: number, y: number, kind: CoinKind = 'coin'): void { r.coins.push({ x, y, kind, taken: false }); }

  private power(r: Roof, x: number, y: number): void {
    if (!this.bag.length) {
      this.bag = [...POWER_KINDS];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        [this.bag[i], this.bag[j]] = [this.bag[j]!, this.bag[i]!];
      }
    }
    r.powers.push({ id: this.nextId++, kind: this.bag.pop()!, x: Math.round(x), y, taken: false });
    r.coins = r.coins.filter((c) => c.kind === 'diamond' || Math.abs(c.x - x) > 16 || Math.abs(c.y - y) > 20);
    this.sincePower = 0;
  }

  /** A rare pickup: one every four to six roofs. */
  private maybePower(r: Roof): void {
    this.sincePower++;
    if (this.sincePower < 4 || (this.sincePower < 6 && !this.rng.chance(0.25))) return;
    // Low enough to run through, or a short hop up, before anything stands in the way.
    const room = Math.min(landingZone(r.x), r.w - 30);
    this.power(r, r.x + this.rng.range(0.45, 0.9) * room, r.y - (this.rng.chance(0.6) ? 14 : 38));
  }

  private planGap(r: Roof): void {
    const edge = r.x + r.w;
    const d = difficulty(edge);
    const overRoad = this.scaffolds > 0 || this.roadOwner !== null;
    const z = zoneAt(edge);
    let dy = Math.round(this.rng.range(-MAX_RISE, MAX_DROP) * (0.45 + 0.55 * d) * z.profile.rise * (z.rest ? 0.5 : 1));
    dy = Math.max(-MAX_RISE, Math.min(MAX_DROP, dy));
    if (overRoad) dy = Math.round(this.rng.range(-18, 18)); // keep scaffolds clear of the street
    if (r.y + dy < -80) dy = Math.abs(dy);
    if (r.y + dy > 80) dy = -Math.min(MAX_RISE, Math.abs(dy));
    const speed = baseSpeed(edge);
    const pressure = Math.min(1, Math.max(0, edge - 4000) / 20000);
    const ratio = this.rng.range(0.38 + 0.14 * d + 0.12 * pressure, 0.6 + 0.2 * d + 0.08 * pressure);
    const reach = jumpReach(speed, dy);
    const share = ratio + z.profile.gap + z.lap + (z.rest ? -0.08 : z.surge ? 0.04 : 0);
    r.nextDy = dy;
    r.gap = Math.max(overRoad ? 70 : 26, Math.min(Math.floor(reach * MAX_GAP_RATIO), Math.round(reach * share)));

    if (!overRoad && r.gap >= 56 && this.rng.chance(0.2 + 0.2 * d + z.profile.line)) {
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
        this.coin(r, edge - 8 + speed * t * Math.min(1, share + 0.2), r.y - jumpHeightAt(t) - 6);
      }
    }
  }

  private furnish(r: Roof): void {
    let x = r.x + landingZone(r.x);
    const end = r.x + r.w - runupZone(r.x + r.w);
    const speed = baseSpeed(r.x);
    const d = difficulty(r.x);
    const z = zoneAt(r.x);
    const more = z.profile.busy + z.lap + (z.rest ? -0.3 : z.surge ? 0.08 : 0);
    const chance = (base: number) => Math.max(0, Math.min(0.95, base + more));
    let placed = false;
    while (x < end - 40 && this.rng.chance(chance(placed ? 0.5 + 0.2 * d : 0.6 + 0.35 * d))) {
      const room = Math.min(end - 40, x + 50);
      // None at all before ENEMY_START, whatever the district.
      const hostile = enemyChance(x) * z.profile.enemy * (z.rest ? 0.4 : z.surge ? 1.15 : 1);
      if (this.rng.chance(Math.min(0.95, hostile))) {
        const ex = Math.round(this.rng.range(x, room));
        const drone = this.rng.chance(0.5);
        r.enemies.push({
          id: this.nextId++, kind: drone ? 'drone' : 'pigeon', x: ex, y: r.y - (drone ? 30 : 13),
          amp: drone ? this.rng.int(6, 14) : 0, phase: this.rng.next(),
        });
        x = ex + Math.round(speed * (0.85 - 0.22 * d));
      } else {
        const kind = this.rng.chance(z.profile.tank) ? 'tank' : 'ac';
        const { w, h } = OBSTACLE_SIZE[kind];
        const ox = Math.round(this.rng.range(x, Math.max(x, Math.min(room, end - w))));
        r.obstacles.push({ id: this.nextId++, kind, x: ox, y: r.y - h, w, h });
        if (kind === 'tank') for (let i = 0; i < 2; i++) this.coin(r, ox + 10 + i * 16, r.y - h - 12, 'gold');
        else if (this.rng.chance(0.6)) for (let i = 0; i < 3; i++) this.coin(r, ox - 8 + i * 16, r.y - (i === 1 ? 34 : 27));
        x = ox + w + Math.round(speed * (0.8 - 0.2 * d));
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
    const z = zoneAt(r.x);
    // No new street in a district's breather.
    if (r.x < ROAD_START || z.rest || (this.sinceRoad < z.profile.roadEvery && !this.rng.chance(z.profile.roadChance))) return;
    this.sinceRoad = 0;
    this.roadOwner = r;
    this.scaffolds = this.rng.int(3, 4) + z.profile.scaffolds;
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
      this.maybePower(r);
      this.scaffolds--;
      this.planGap(r);
      this.roofs.push(r);
      return;
    }
    const z = zoneAt(x);
    const w = Math.round(speed * this.rng.range(1.2 - 0.2 * d, 2.3 - 0.7 * d) * z.profile.width * (z.rest ? 1.2 : 1));
    const wide = this.rng.chance(0.6 + 0.3 * d) ? landingZone(x) + runupZone(x + 600) + this.rng.int(60, 200) : 0;
    const r = this.blank(x, Math.max(w, wide), y);
    this.closeRoad(r);
    this.furnish(r);
    this.maybePower(r);
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
