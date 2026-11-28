import { baseSpeed, CEILING, DEFAULT_PACE, ease, gearFactor, jumpHeightAt, jumpReach, jumpTime, PX_PER_M, roofEnd } from './physics';
import { cityPlan, districtAt, inGolden, lapEvent, type CityPlan, type DistrictKind, type LapEvent } from './progression';
import { POWER_KINDS, type Power, type PowerKind } from './items';
import { mixSeed, Rng } from './rng';

/** `bar` hangs overhead and is slid under; a `box` breaks when slid into or landed on. */
export interface Obstacle { id: number; kind: 'ac' | 'tank' | 'box' | 'bar'; x: number; y: number; w: number; h: number }
export interface Line { id: number; x: number; w: number; y: number; style: number }
export type CoinKind = 'coin' | 'gold' | 'diamond';
/** Floor spikes: touching them ends the run. Only made maps have them; the endless city never does. */
export interface Spike { id: number; x: number; y: number; w: number; h: number }
export const SPIKE_SIZE = { w: 16, h: 6 } as const;
export interface Coin { x: number; y: number; kind: CoinKind; taken: boolean }
/** x is where the runner meets it; y the middle of its movement (top of its box). */
export interface Enemy { id: number; kind: 'drone' | 'pigeon'; x: number; y: number; amp: number; phase: number; over?: boolean }
/**
 * A passage inside a marked building: a slide on the glass at `x` (`hatch` wide) breaks in, `y` is its floor, and a
 * ramp leads back up to the same roof.
 */
export interface Route { id: number; x: number; hatch: number; y: number; rampStart: number; rampEnd: number }
/** A street under a run of scaffolds, with a ramp back up to the next building. */
/** spacing: room between cars, wider in a higher gear so they come no more often (made maps keep the usual). */
export interface Road { id: number; x: number; y: number; rampStart: number; rampEnd: number; rampY: number; traffic?: boolean; spacing?: number }
/** Rising air in a gap: it lifts a runner inside its column up to `top`. */
export interface Vent { x: number; w: number; top: number }
/** Water on a roof: sliding through it splashes for points and speed. */
export interface Puddle { id: number; x: number; w: number }
export interface Roof {
  id: number; kind: 'building' | 'scaffold'; x: number; w: number; y: number; style: number; seed: number; number: number;
  obstacles: Obstacle[]; lines: Line[]; coins: Coin[]; powers: Power[]; enemies: Enemy[]; road: Road | null; route?: Route;
  vent?: Vent; puddles?: Puddle[]; spikes?: Spike[];
  /** Gives way under a runner who stays on it too long. */
  cracked?: boolean;
  /** Part of a golden rush: points ×3 over it and its gap. */
  golden?: boolean;
  /** Gap to the next roof and its height change. */
  gap: number; nextDy: number;
}
/** What a run needs from a city, generated or hand made. */
export interface City {
  roofs: Roof[];
  ensure(from: number, to: number): void;
  /** Crossing this ends the run in success; null for an endless city. */
  goalX: number | null;
  /** The order of districts and lap events of an endless city. */
  plan?: CityPlan;
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
export const OBSTACLE_SIZE = { ac: { w: 16, h: 11 }, tank: { w: 36, h: 31 }, box: { w: 14, h: 12 }, bar: { w: 24, h: 150 } } as const;
/** Room under something overhead: more than a sliding body, less than a standing one. */
export const BAR_GAP = 10;
/** Crates and overhead things start here (about 35 m), marked buildings a little later. */
export const SLIDE_START = 620;
/** Seconds of running between two things to slide at. */
export const SLIDE_SPACING = 1.15;
export const ROUTE_START = 1500;
export const ROUTE_DEPTH = 48;
export const HATCH_W = 44;
/** How high above the lower roof an updraft carries. */
export const VENT_HEIGHT = 90;

export function difficulty(x: number): number { return ease(x, 2600); }

/**
 * The city is built in stretches this long, each from its own seed. A ranked run gets each seed from the server only
 * shortly before anyone could reach it, so no run can be planned far ahead.
 */
export const SEGMENT = 4000;
/** Where a seed comes from: a stretch's number gives its seed, or null when it isn't known yet. */
export type SeedSource = (segment: number) => number | null;
/** The seeds of an unranked city, all from one: the first is that seed itself. */
export function segmentSeed(seed: number, k: number): number { return mixSeed(seed, k); }
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
function zoneAt(x: number, plan: CityPlan) {
  const d = districtAt(Math.max(0, (x - 60) / PX_PER_M), plan);
  const rest = d.progress >= 0.85;
  const surge = !rest && d.progress >= 0.5;
  // Each lap presses harder, up to the fifth.
  return {
    profile: PROFILES[d.kind], kind: d.kind, rest, surge, lap: Math.min(0.12, (d.lap - 1) * 0.03), event: lapEvent(d.lap, plan) as LapEvent,
    golden: inGolden(Math.max(0, (x - 60) / PX_PER_M)),
  };
}

/**
 * A marked building's passage from its glass at `start`: the floor and the ramp back up, a crate, a duct and a
 * crate inside, spaced by the time each slide takes, and gold for the way. Ids come from `id`, in that order.
 * Shared by the endless city and made maps.
 */
export function passage(start: number, y: number, speed: number, id: () => number): { route: Route; obstacles: Obstacle[]; coins: Coin[] } {
  const run = Math.round(speed * (0.6 + SLIDE_SPACING * 2 + 0.5));
  const ramp = Math.round(ROUTE_DEPTH * RAMP_RUN);
  const floor = y + ROUTE_DEPTH;
  const route = { id: id(), x: start, hatch: HATCH_W, y: floor, rampStart: start + HATCH_W + run, rampEnd: start + HATCH_W + run + ramp };
  const obstacles: Obstacle[] = [], coins: Coin[] = [];
  (['box', 'bar', 'box'] as const).forEach((kind, i) => {
    const size = OBSTACLE_SIZE[kind], ox = Math.round(start + HATCH_W + speed * (0.6 + SLIDE_SPACING * i));
    const top = y + CEILING;
    obstacles.push(kind === 'bar' ? { id: id(), kind, x: ox, y: top, w: size.w, h: floor - BAR_GAP - top }
      : { id: id(), kind, x: ox, y: floor - size.h, ...size });
    for (let k = 0; k < 2; k++) coins.push({ x: ox + 36 + k * 16, y: floor - 8, kind: 'gold', taken: false });
  });
  // The roof stays an easy run.
  for (let i = 0; i < 5; i++) coins.push({ x: start + 70 + i * 18, y: y - 10, kind: 'coin', taken: false });
  return { route, obstacles, coins };
}
/** Clear roof a passage needs from its glass on, at this speed: the way through and a run-up after it. */
export function passageLength(speed: number): number {
  return HATCH_W + Math.round(speed * (0.6 + SLIDE_SPACING * 2 + 0.5)) + Math.round(ROUTE_DEPTH * RAMP_RUN) + Math.round(speed * 0.66) + 40;
}

/** Deterministic city: each gap is sized from what an unboosted, fully held single jump can cross. */
export class World implements City {
  roofs: Roof[] = [];
  readonly goalX = null;
  private rng: Rng;
  private segment = 0;
  private seeds: SeedSource;
  /** A stretch was built without its seed: the run can't be checked against the server's city. */
  fallback = false;
  /** Which district comes when and what each lap brings, from the first seed. */
  readonly plan: CityPlan;
  private nextId = 1;
  private sinceRoad = 0;
  private sinceDiamond = 0;
  private sincePower = 0;
  private sinceRoute = 0;
  /** Item kinds still to deal: each comes round once before any comes again. */
  private bag: PowerKind[] = [];
  /** Scaffolds still to build over the current road, and the roof that owns it. */
  private scaffolds = 0;
  private roadOwner: Roof | null = null;

  constructor(seed: number | SeedSource) {
    const s0 = typeof seed === 'number' ? seed : seed(0);
    this.seeds = typeof seed === 'number' ? (k) => segmentSeed(seed, k) : seed;
    if (s0 === null) this.fallback = true;
    this.rng = new Rng(s0 ?? 0);
    this.plan = cityPlan(s0 ?? 0);
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
      ...(inGolden(Math.max(0, (x - 60) / PX_PER_M)) ? { golden: true } : {}),
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

  /** A pickup every three to five roofs. */
  private maybePower(r: Roof): void {
    this.sincePower++;
    if (this.sincePower < 3 || (this.sincePower < 5 && !this.rng.chance(0.3))) return;
    // Low enough to run through, or a short hop up, before anything stands in the way.
    const room = Math.min(landingZone(r.x), r.w - 30);
    this.power(r, r.x + this.rng.range(0.45, 0.9) * room, r.y - (this.rng.chance(0.6) ? 14 : 38));
  }

  private planGap(r: Roof): void {
    const edge = r.x + r.w;
    const d = difficulty(edge);
    const overRoad = this.scaffolds > 0 || this.roadOwner !== null;
    const z = zoneAt(edge, this.plan);
    if (z.golden && !overRoad) { this.goldenGap(r, edge); return; }
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
    // Now and then a drone hovers low in the middle of a modest gap, to be stomped across.
    const hover = !overRoad && !z.rest && edge >= ENEMY_START && r.gap >= 44 && r.gap <= reach * 0.72 && this.rng.chance(0.3 * ease(edge - ENEMY_START, 6000));
    if (hover) r.enemies.push({
      id: this.nextId++, kind: 'drone', over: true, x: Math.round(edge + r.gap / 2 - 8), y: Math.min(r.y, r.y + dy) - 22, amp: 3, phase: this.rng.next(),
    });

    // Rising air over a gap: often in a windy lap, now and then otherwise. A way up to gold over the rooftops.
    if (!overRoad && !hover && edge >= ROUTE_START && r.gap >= 50 && this.rng.chance(z.event === 'wind' ? 0.5 : 0.06)) {
      const top = Math.min(r.y, r.y + dy) - VENT_HEIGHT;
      r.vent = { x: edge + 4, w: r.gap - 8, top };
      for (let i = 0; i < 4; i++) this.coin(r, Math.round(edge + r.gap * (0.1 + i * 0.3)), top + 6 + (i % 2) * 10, 'gold');
    } else if (!overRoad && !hover && r.gap >= 56 && this.rng.chance(0.2 + 0.2 * d + z.profile.line)) {
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

  /** A golden rush: short, level hops with an arc of gold over each. */
  private goldenGap(r: Roof, edge: number): void {
    let dy = Math.round(this.rng.range(-16, 16));
    if (r.y + dy < -80 || r.y + dy > 80) dy = -dy;
    const speed = baseSpeed(edge), reach = jumpReach(speed, dy), share = this.rng.range(0.3, 0.42);
    r.nextDy = dy;
    r.gap = Math.max(26, Math.round(reach * share));
    const T = jumpTime(dy);
    for (let i = 0; i < 3; i++) {
      const t = T * (0.2 + (0.6 * i) / 2);
      this.coin(r, edge - 8 + speed * t * Math.min(1, share + 0.2), r.y - jumpHeightAt(t) - 6, i === 1 ? 'gold' : 'coin');
    }
  }
  /** A golden rush roof: open, a row of coins, now and then a diamond up where a double jump reaches. */
  private goldenRoof(x: number, y: number, speed: number): Roof {
    const r = this.blank(x, Math.round(speed * this.rng.range(1.1, 1.6)), y);
    for (let cx = x + 30; cx < x + r.w - 20; cx += 72) this.coin(r, cx, y - 10);
    if (this.rng.chance(0.45)) this.coin(r, x + Math.round(r.w * 0.5), y - 118, 'diamond');
    return r;
  }

  private furnish(r: Roof): void {
    let x = r.x + landingZone(r.x);
    const end = r.x + r.w - runupZone(r.x + r.w);
    const speed = baseSpeed(r.x);
    const d = difficulty(r.x);
    const z = zoneAt(r.x, this.plan);
    const more = z.profile.busy + z.lap + (z.rest ? -0.3 : z.surge ? 0.08 : 0);
    const chance = (base: number) => Math.max(0, Math.min(0.95, base + more));
    let placed = false;
    let slid = -Infinity;
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
        let kind: Obstacle['kind'] = x >= SLIDE_START && this.rng.chance(0.42) ? (this.rng.chance(0.55) ? 'bar' : 'box') : this.rng.chance(z.profile.tank) ? 'tank' : 'ac';
        // Something overhead needs a longer look after whatever had to be jumped, and a second slide has to wait for
        // the first and its rest to be over. Where that doesn't fit, something to jump stands instead.
        let from = kind === 'bar' && placed ? x + Math.round(speed * 0.3) : x;
        if (kind === 'bar' || kind === 'box') {
          if (from < slid + Math.round(speed * SLIDE_SPACING) || from > end - OBSTACLE_SIZE[kind].w) { kind = 'ac'; from = x; }
          else slid = from + 50;
        }
        const { w, h } = OBSTACLE_SIZE[kind];
        const ox = Math.round(this.rng.range(from, Math.max(from, Math.min(from + 50, end - w))));
        r.obstacles.push({ id: this.nextId++, kind, x: ox, y: kind === 'bar' ? r.y - BAR_GAP - h : r.y - h, w, h });
        if (kind === 'bar') for (let i = 0; i < 2; i++) this.coin(r, ox + 4 + i * 16, r.y - 4);
        else if (kind === 'tank') for (let i = 0; i < 2; i++) this.coin(r, ox + 10 + i * 16, r.y - h - 12, 'gold');
        else if (this.rng.chance(0.6)) for (let i = 0; i < 3; i++) this.coin(r, ox - 8 + i * 16, r.y - (i === 1 ? 34 : 27));
        x = ox + w + Math.round(speed * (0.8 - 0.2 * d));
      }
      placed = true;
    }
    // Rain leaves water in the clear stretch just past the edge, where nothing else stands.
    if (z.event === 'rain' && this.rng.chance(0.7)) {
      const w = 40, px = Math.round(r.x + this.rng.range(0.15, 0.45) * Math.max(0, landingZone(r.x) - w));
      r.puddles = [{ id: this.nextId++, x: px, w }];
    }
    // The end of each lap's last district pays a line of gold for the way through.
    if (z.rest && z.kind === 'highrise') for (let i = 0; i < 8; i++) this.coin(r, Math.round(r.x + 40 + i * 22), r.y - 40, 'gold');
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

  /**
   * A marked building with two ways through: its clear roof, or the passage under it, which pays more and has things
   * in it to slide into and under.
   */
  private routeBuilding(x: number, y: number): Roof {
    const speed = baseSpeed(x);
    const lead = landingZone(x) + 70;
    const run = Math.round(speed * (0.6 + SLIDE_SPACING * 2 + 0.5));
    const ramp = Math.round(ROUTE_DEPTH * RAMP_RUN);
    const w = lead + HATCH_W + run + ramp + runupZone(x + lead + run + 400) + 40;
    const r = this.blank(x, w, y);
    const p = passage(x + lead, y, speed, () => this.nextId++);
    r.route = p.route;
    r.obstacles.push(...p.obstacles);
    r.coins.push(...p.coins);
    return r;
  }

  /** Decide whether a road starts after r, before its gap is planned. */
  private maybeRoad(r: Roof): void {
    this.sinceRoad++;
    const z = zoneAt(r.x, this.plan);
    // No new street in a district's breather.
    if (r.x < ROAD_START || z.rest || z.golden || zoneAt(r.x + r.w + 2400, this.plan).golden || (this.sinceRoad < z.profile.roadEvery && !this.rng.chance(z.profile.roadChance))) return;
    this.sinceRoad = 0;
    this.roadOwner = r;
    this.scaffolds = this.rng.int(3, 4) + z.profile.scaffolds;
    const x = r.x + r.w;
    const spacing = Math.round(245 * gearFactor(DEFAULT_PACE, x));
    r.road = { id: this.nextId++, x, y: r.y + ROAD_DEPTH, rampStart: x, rampEnd: x, rampY: r.y, ...(spacing > 245 ? { spacing } : {}) };
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

  /** From a stretch's first roof on, everything is drawn from that stretch's seed. */
  private enter(x: number): void {
    const k = Math.floor(Math.max(0, x) / SEGMENT);
    if (k <= this.segment) return;
    this.segment = k;
    const s = this.seeds(k);
    if (s === null) this.fallback = true;
    this.rng = new Rng(s ?? segmentSeed(k, k));
  }

  private addNext(): void {
    const last = this.roofs[this.roofs.length - 1]!;
    const x = last.x + last.w + last.gap;
    this.enter(x);
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
    const z = zoneAt(x, this.plan);
    if (z.golden && !this.roadOwner) {
      const r = this.goldenRoof(x, y, speed);
      this.maybePower(r);
      this.planGap(r);
      this.roofs.push(r);
      return;
    }
    this.sinceRoute++;
    if (x >= ROUTE_START && !z.rest && !z.golden && this.sinceRoute >= 8 && (this.sinceRoute >= 13 || this.rng.chance(0.25))) {
      this.sinceRoute = 0;
      this.sincePower++; // as long as two roofs
      const marked = this.routeBuilding(x, y);
      this.closeRoad(marked);
      this.maybePower(marked);
      this.planGap(marked);
      this.roofs.push(marked);
      return;
    }
    const w = Math.round(speed * this.rng.range(1.2 - 0.2 * d, 2.3 - 0.7 * d) * z.profile.width * (z.rest ? 1.2 : 1));
    const wide = this.rng.chance(0.6 + 0.3 * d) ? landingZone(x) + runupZone(x + 600) + this.rng.int(60, 200) : 0;
    const r = this.blank(x, Math.max(w, wide), y);
    if (z.event === 'crumble' && !z.rest && !this.roadOwner && this.rng.chance(0.4)) r.cracked = true;
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
