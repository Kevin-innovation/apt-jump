import { DASH_POINTS, MAGNET_RANGE, MAGNET_SPEED, MAX_AIR_BONUS, POWER_POINTS, POWER_TIME, RUSH_RANGE, type PowerKind } from './items';
import { missionAt, type Mission, type Tally } from './missions';
import {
  BOOST_SPEED, DEFAULT_PACE, gearAt, gearFactor, jumpReach, MAX_BOOST, newPlayer, paceSpeed, PH, PW, PX_PER_M, roofEnd, STEP, stepPlayer, STUMBLE_FACTOR,
  STUMBLE_TIME, timeRate, type JumpInput, type Pace, type PhysEvent, type Player, type SurfaceKind,
} from './physics';
import {
  DISTRICT_LENGTH, districtAt, gearMultiplier, GOLDEN_MULT, inGolden, LAP_LENGTH, MAX_GEAR, lapEvent as eventOfLap, tierAt, type District, type LapEvent,
} from './progression';
import { World, type City, type CoinKind, type SeedSource } from './world';

export const COMBO_TIME = 4;
/** A perfect jump buys a little more time than anything else. */
export const PERFECT_COMBO_TIME = 5;
/** From this combo the multiplier is full, and points fill the fever gauge instead. */
export const FEVER_COMBO = 20;
/** Base points (before any multiplier) that fill the gauge, and the seconds a fever doubles everything. */
export const FEVER_FILL = 1200;
export const FEVER_TIME = 8;
/**
 * A fever chains: filling the gauge again before it ends goes up a stage, ×2 → ×3 → ×4, each with a fresh clock.
 * During a fever the gauge fills this much faster, since the time is short.
 */
export const FEVER_MULTS = [1, 2, 3, 4] as const;
export const FEVER_NAMES = ['', '피버', '하이퍼 피버', '울트라 피버'] as const;
export const CHAIN_FILL = 3;
/** Combo saves held at most, and how many diamonds earn one. */
export const MAX_SAVES = 3;
export const DIAMONDS_PER_SAVE = 3;
/** A combo this long or longer is saved, and paid out at each district's border. */
export const SAVED_COMBO = 5;
export const CASH_COMBO = 10;
export const CASH_PER_COMBO = 5;
export const LAP_BONUS = 1000;
export const SPLASH_POINTS = 40;
/** Seconds a runner may stand on a cracked roof before it gives way. */
export const CRACK_TIME = 1;
export const COIN_VALUE: Record<CoinKind, number> = { coin: 1, gold: 5, diamond: 20 };
export const COIN_POINTS = 10;
export const PERFECT_POINTS = 25;
export const RISK_POINTS = 60;
export const FAR_POINTS = 40;
export const STOMP_POINTS = { ac: 30, box: 20, pigeon: 50, drone: 60 } as const;
/** Sliding under or through something; twice that inside a passage. */
export const SLIDE_POINTS = 30;
export const BREAKIN_POINTS = 80;
export const BREAKOUT_POINTS = 60;
/** A gap this large a share of the longest unboosted jump counts as far. */
export const FAR_RATIO = 0.5;
export const START_X = 60;
/** Base speed gained per speed level. */
export const LEVEL_SPEED = 15;

export function multiplier(combo: number): number { return 1 + Math.min(4, Math.floor(combo / 5)); }

export type RiskKind = 'tank' | 'line' | 'far' | 'inside';
export type GameEvent =
  | PhysEvent
  | { type: 'coin'; kind: CoinKind; points: number; x: number; y: number }
  | { type: 'perfectBonus'; points: number; x: number; y: number }
  | { type: 'stompBonus'; points: number; x: number; y: number }
  | { type: 'slideBonus'; what: 'dodge' | 'smash'; points: number; x: number; y: number }
  | { type: 'escape'; points: number; x: number; y: number }
  | { type: 'risk'; kind: RiskKind; points: number; x: number; y: number }
  | { type: 'power'; kind: PowerKind; points: number; x: number; y: number }
  | { type: 'dash'; points: number; x: number; y: number }
  | { type: 'mission'; mission: Mission; points: number }
  | { type: 'road'; x: number; y: number }
  | { type: 'roadExit'; x: number; y: number }
  | { type: 'speedup'; level: number }
  | { type: 'goal' }
  | { type: 'district'; district: District }
  | { type: 'districtGoal'; district: District; points: number }
  | { type: 'comboLost'; combo: number }
  | { type: 'comboSaved'; combo: number }
  | { type: 'saveGained'; saves: number }
  | { type: 'comboCash'; combo: number; points: number }
  | { type: 'fever'; level: number }
  | { type: 'lap'; lap: number; event: LapEvent; points: number }
  | { type: 'gear'; gear: number; mult: number; gained: number; up: boolean }
  | { type: 'golden' }
  | { type: 'goldenEnd'; points: number }
  | { type: 'splash'; points: number; x: number; y: number }
  | { type: 'crumble'; id: number; x: number; y: number }
  | { type: 'rush'; count: number };

export interface Course { city: City; pace: Readonly<Pace>; startY: number }
/** The challenge of the district being run: counted from the moment it was entered. */
export interface DistrictGoal { district: District; current: number; goal: number; done: boolean }

/** One run: physics plus scoring. Pure simulation, no DOM. */
export class Game {
  world: City;
  player: Player;
  dead = false;
  deathCause: 'fall' | 'traffic' | null = null;
  finished = false;
  time = 0;
  bonus = 0;
  coins = 0;
  diamonds = 0;
  stomps = 0;
  /** Things slid under or broken by sliding, each counted once. */
  slides = 0;
  combo = 0;
  comboTimer = 0;
  /** The fever gauge, 0 to 1, and the seconds left of a fever. */
  fever = 0;
  feverTime = 0;
  /** The fever's stage while one is on: 1 ×2, 2 ×3, 3 ×4. */
  feverLevel = 0;
  /** Over a golden rush now, and the score when it began. */
  golden = false;
  private goldenFrom = 0;
  /** The marks passed (the gear, uncapped) and the score at the last one. */
  private tier = 1;
  private tierFrom = 0;
  /** What the gear's multiplier adds to the distance points, beyond one a metre. */
  private distExtra = 0;
  /** Each keeps a combo that would have ended. */
  comboSaves = 0;
  /** Cracked roofs that gave way, and puddles already splashed. */
  crumbled = new Set<number>();
  splashed = new Set<number>();
  maxCombo = 0;
  perfects = 0;
  risks = 0;
  level = 1;
  powers = 0;
  /** Missions finished; also which one is next. */
  missionsDone = 0;
  /** The tally when the current mission began: endless missions count from it. */
  private missionStart: Tally = { coins: 0, powers: 0, perfects: 0, stomps: 0, risks: 0, diamonds: 0, maxCombo: 0, distance: 0 };
  /** Seconds left of each item that isn't the runner's own. */
  magnetTime = 0;
  doubleTime = 0;
  keepTime = 0;
  private events: GameEvent[] = [];
  private riskTaken = new Set<number>();
  private lastSurface: SurfaceKind = 'roof';
  private onRoad = false;
  /** The district being run: its number, what the tally read on the way in, and whether its goal is paid. */
  private zone = { index: 0, from: {} as Partial<Tally>, done: false };

  /** A seed (or the server's seeds, stretch by stretch) plays the endless city; a course plays a made map. */
  constructor(source: number | SeedSource | Course) {
    const course = typeof source === 'object' ? source : { city: new World(source), pace: DEFAULT_PACE, startY: 0 };
    this.world = course.city;
    this.player = newPlayer(START_X, course.startY, course.pace);
    this.world.ensure(0, 1400);
    stepPlayer(this.player, { pressed: false, held: false }, this.world.roofs, () => {});
  }

  get over(): boolean { return this.dead || this.finished; }
  get distance(): number { return Math.max(0, (this.player.x - START_X) / PX_PER_M); }
  get score(): number { return Math.floor(this.distance + this.distExtra) + this.bonus; }
  /** The gear, from 1: endless runs only. */
  get gear(): number { return gearAt(this.player.pace, this.player.x); }
  /** What the gear does to every point: endless runs only. */
  get gearMult(): number { return this.world.goalX === null ? gearMultiplier(this.gear) : 1; }
  /** Everything a point is multiplied by besides the combo, the fever and items: the gear and a golden rush. */
  get scoreMult(): number { return this.gearMult * (this.golden ? GOLDEN_MULT : 1); }
  get mult(): number { return multiplier(this.combo); }
  /** The mission under way: endless runs only. */
  get mission(): Mission | null { return this.world.goalX === null ? missionAt(this.missionsDone, this.missionStart) : null; }
  /** What this lap does to the city: endless runs only. */
  get lapEvent(): LapEvent { const d = this.district; return d ? eventOfLap(d.lap, this.world.plan) : 'none'; }
  get tally(): Tally {
    return {
      coins: this.coins, powers: this.powers, perfects: this.perfects, stomps: this.stomps, risks: this.risks,
      diamonds: this.diamonds, maxCombo: this.maxCombo, distance: Math.floor(this.distance),
    };
  }
  /** The district under the runner: endless runs only. */
  get district(): District | null { return this.world.goalX === null ? districtAt(this.distance, this.world.plan) : null; }
  get districtGoal(): DistrictGoal | null {
    const district = this.district;
    if (!district) return null;
    // Past a border the step has yet to cross, nothing is counted for the new district.
    const same = district.index === this.zone.index;
    const { what, goal } = district.goal;
    const done = same && this.zone.done;
    const current = done ? goal : same ? Math.max(0, Math.min(goal, this.tally[what] - (this.zone.from[what] ?? 0))) : 0;
    return { district, current, goal, done };
  }
  /** Pays the district's goal once, then starts counting afresh in the next one. */
  private stepDistrict(): void {
    const district = this.district;
    if (!district) return;
    if (district.index !== this.zone.index) {
      // A long combo carried over a border is paid out, flat, by the lap.
      if (this.combo >= CASH_COMBO) {
        const points = this.combo * CASH_PER_COMBO * district.lap;
        this.bonus += points;
        this.events.push({ type: 'comboCash', combo: this.combo, points });
      }
      const lapBefore = Math.floor(this.zone.index / (LAP_LENGTH / DISTRICT_LENGTH)) + 1;
      this.zone = { index: district.index, from: this.tally, done: false };
      this.events.push({ type: 'district', district });
      if (district.lap > lapBefore) {
        const points = LAP_BONUS * lapBefore;
        this.bonus += points;
        this.events.push({ type: 'lap', lap: district.lap, event: eventOfLap(district.lap, this.world.plan), points });
        this.startFever();
      }
      return;
    }
    const { what, goal, reward } = district.goal;
    if (!this.zone.done && this.tally[what] - (this.zone.from[what] ?? 0) >= goal) {
      // A flat reward, as for missions.
      this.zone.done = true;
      this.bonus += reward;
      this.events.push({ type: 'districtGoal', district, points: reward });
    }
  }
  /** Seconds left of an item's effect, or how many are held of those that wait. */
  effect(kind: PowerKind): number {
    const p = this.player;
    switch (kind) {
      case 'boost': return p.boostTime;
      case 'magnet': return this.magnetTime;
      case 'double': return this.doubleTime;
      case 'keep': return this.keepTime;
      case 'shield': return p.shield ? 1 : 0;
      case 'recharge': return p.airBonus;
      case 'glider': return p.glideTime;
      case 'slowmo': return p.slowTime;
      case 'hook': return p.hook ? 1 : 0;
      // Shown by the combo (the fever and the saves), or over at once.
      case 'fever': case 'amulet': case 'rush': return 0;
    }
  }
  /** Share of a made map already run, 0 to 1. */
  get progress(): number | null {
    const g = this.world.goalX;
    return g === null ? null : Math.max(0, Math.min(1, (this.player.x - START_X) / (g - START_X)));
  }

  private addCombo(): void {
    this.combo++;
    this.comboTimer = COMBO_TIME;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
  }
  /** A save keeps a combo worth keeping; nothing keeps one through a crash. */
  private loseCombo(fatal = false): void {
    if (!fatal && this.comboSaves > 0 && this.combo >= SAVED_COMBO) {
      this.comboSaves--;
      this.comboTimer = COMBO_TIME;
      this.events.push({ type: 'comboSaved', combo: this.combo });
      return;
    }
    if (this.combo > 0) this.events.push({ type: 'comboLost', combo: this.combo });
    this.combo = 0; this.comboTimer = 0; this.fever = 0;
    // A chain falls back to its first stage; the fever itself runs on.
    if (this.feverLevel > 1) this.feverLevel = 1;
  }
  private gainSave(): void {
    if (this.comboSaves >= MAX_SAVES) return;
    this.comboSaves++;
    this.events.push({ type: 'saveGained', saves: this.comboSaves });
  }
  /** Starts a fever, or with `up` takes a running one a stage higher; the clock starts over either way. */
  private startFever(up = false): void {
    this.fever = 0;
    this.feverLevel = this.feverTime > 0 ? Math.min(FEVER_MULTS.length - 1, this.feverLevel + (up ? 1 : 0)) : 1;
    this.feverTime = FEVER_TIME;
    this.events.push({ type: 'fever', level: this.feverLevel });
  }
  private award(base: number): number {
    const fever = this.feverTime > 0 ? FEVER_MULTS[this.feverLevel]! : 1;
    const pts = Math.round(base * this.mult * (this.doubleTime > 0 ? 2 : 1) * fever * this.scoreMult);
    this.bonus += pts;
    // With the multiplier full, points fill the fever gauge; during a fever, faster, toward the next stage.
    // A golden rush pays on its own: it doesn't fill the gauge, so a chain is earned on ordinary roofs.
    if (!this.golden && this.combo >= FEVER_COMBO && (this.feverTime <= 0 || this.feverLevel < FEVER_MULTS.length - 1)) {
      this.fever += (base / FEVER_FILL) * (this.feverTime > 0 ? CHAIN_FILL : 1);
      if (this.fever >= 1) this.startFever(true);
    }
    return pts;
  }
  /** Everything ahead that stands in the way, and every enemy, turns into gold where it was. */
  private rush(): void {
    const p = this.player, from = p.x + 24, to = p.x + RUSH_RANGE;
    let count = 0;
    for (const r of this.world.roofs) {
      if (r.x > to || roofEnd(r) < from) continue;
      r.obstacles = r.obstacles.filter((o) => {
        if (o.x + o.w < from || o.x > to || p.gone.includes(o.id)) return true;
        r.coins.push({ x: o.x + o.w / 2, y: o.kind === 'bar' ? o.y + o.h - 2 : o.y + o.h / 2, kind: 'gold', taken: false });
        count++;
        return false;
      });
      r.enemies = r.enemies.filter((e) => {
        if (e.x < from || e.x > to || p.gone.includes(e.id)) return true;
        r.coins.push({ x: e.x + 8, y: e.y + 4, kind: 'gold', taken: false });
        count++;
        return false;
      });
    }
    this.events.push({ type: 'rush', count });
  }
  private risk(kind: RiskKind, base: number): void {
    this.risks++;
    this.addCombo();
    this.events.push({ type: 'risk', kind, points: this.award(base), x: this.player.x, y: this.player.y - PH });
  }

  private use(kind: PowerKind): void {
    const p = this.player, time = POWER_TIME[kind];
    switch (kind) {
      case 'boost': p.boostTime = time; break;
      case 'magnet': this.magnetTime = time; break;
      case 'double': this.doubleTime = time; break;
      case 'keep': this.keepTime = time; if (this.combo > 0) this.comboTimer = COMBO_TIME; break;
      case 'shield': p.shield = true; break;
      case 'recharge': p.airCooldown = 0; p.airUsed = false; p.airBonus = Math.min(MAX_AIR_BONUS, p.airBonus + 1); break;
      case 'glider': p.glideTime = time; break;
      case 'slowmo': p.slowTime = time; break;
      case 'fever': this.startFever(); break;
      case 'amulet': this.gainSave(); break;
      case 'rush': this.rush(); break;
      case 'hook': p.hook = true; break;
    }
  }

  /** Draws nearby coins in. Diamonds stay put: they are for double jumps. */
  private pull(): void {
    const p = this.player, cx = p.x + PW / 2, cy = p.y - PH / 2;
    for (const r of this.world.roofs) {
      if (r.x > p.x + MAGNET_RANGE + 60) break;
      for (const c of r.coins) {
        if (c.taken || c.kind === 'diamond') continue;
        const dx = cx - c.x, dy = cy - c.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > MAGNET_RANGE || d < 1) continue;
        const k = Math.min(1, (MAGNET_SPEED * STEP) / d);
        c.x += dx * k;
        c.y += dy * k;
      }
    }
  }

  /** Advance one fixed step. */
  step(input: JumpInput): void {
    if (this.over) return;
    this.time += STEP;
    const p = this.player;
    const rate = timeRate(p);
    const x0 = p.x;
    stepPlayer(p, input, this.world.roofs, (e) => this.onPhys(e));
    if (this.dead) return;
    // Distance pays one point a metre, times the lap and a golden rush.
    if (p.x > x0) this.distExtra += ((p.x - x0) / PX_PER_M) * (this.scoreMult - 1);
    this.stepGolden();
    this.stepGear();
    this.magnetTime = Math.max(0, this.magnetTime - STEP);
    this.doubleTime = Math.max(0, this.doubleTime - STEP);
    this.keepTime = Math.max(0, this.keepTime - STEP);
    this.feverTime = Math.max(0, this.feverTime - STEP);
    if (this.feverTime <= 0) this.feverLevel = 0;

    // Counted in the runner's simulation time.
    if (this.combo > 0 && this.keepTime <= 0) {
      this.comboTimer -= STEP * rate;
      if (this.comboTimer <= 0) this.loseCombo();
    }
    if (this.magnetTime > 0 && !p.crashed) this.pull();
    for (const r of this.world.roofs) {
      if (r.x > p.x + MAGNET_RANGE + 60) break;
      for (const w of r.powers) {
        if (w.taken || w.x < p.x - 8 || w.x > p.x + PW + 8 || w.y < p.y - PH - 9 || w.y > p.y + 9) continue;
        w.taken = true;
        this.powers++;
        this.use(w.kind);
        this.addCombo();
        this.events.push({ type: 'power', kind: w.kind, points: this.award(POWER_POINTS), x: w.x, y: w.y });
      }
      for (const c of r.coins) {
        if (c.taken || c.x < p.x - 5 || c.x > p.x + PW + 5 || c.y < p.y - PH - 6 || c.y > p.y + 5) continue;
        c.taken = true;
        this.coins += COIN_VALUE[c.kind];
        if (c.kind === 'diamond' && ++this.diamonds % DIAMONDS_PER_SAVE === 0) this.gainSave();
        this.addCombo();
        // In a blackout every coin is worth twice as much.
        const base = COIN_POINTS * COIN_VALUE[c.kind] * (this.lapEvent === 'night' ? 2 : 1);
        this.events.push({ type: 'coin', kind: c.kind, points: this.award(base), x: c.x, y: c.y });
      }
    }
    this.underfoot();
    if (this.onRoad && p.ground && p.ground.kind !== 'road' && p.ground.kind !== 'ramp') {
      this.onRoad = false;
      this.events.push({ type: 'roadExit', x: p.x, y: p.y });
    }
    // The speed level leaves out the lap's gear, which the lap itself announces.
    const level = 1 + Math.floor((paceSpeed(p.pace, p.x) / gearFactor(p.pace, p.x) - p.pace.base) / LEVEL_SPEED);
    if (level > this.level) {
      this.level = level;
      this.events.push({ type: 'speedup', level });
    }
    const mission = this.mission;
    if (mission && this.tally[mission.what] >= mission.goal) {
      // A flat reward: the combo and the score item don't change it.
      this.missionsDone++;
      this.missionStart = this.tally;
      this.bonus += mission.reward;
      this.events.push({ type: 'mission', mission, points: mission.reward });
    }
    this.stepDistrict();
    if (this.world.goalX !== null && p.x >= this.world.goalX && !p.crashed) {
      this.finished = true;
      this.events.push({ type: 'goal' });
      return;
    }
    this.world.ensure(p.x, p.x + 1400);
  }

  /** Each mark passed: a new gear (until the last) and what the stretch since the last one paid. */
  private stepGear(): void {
    if (this.world.goalX !== null) return;
    const tier = tierAt(this.distance);
    if (tier <= this.tier) return;
    const up = Math.min(MAX_GEAR, tier) > Math.min(MAX_GEAR, this.tier);
    this.tier = tier;
    const gained = this.score - this.tierFrom;
    this.tierFrom = this.score;
    this.events.push({ type: 'gear', gear: this.gear, mult: this.gearMult, gained, up });
  }

  /** Over a golden roof or its gap: points ×3. Its start and end are told, the end with what it paid. */
  private stepGolden(): void {
    const x = this.player.x;
    const r = this.world.roofs.find((q) => x >= q.x && x < q.x + q.w + q.gap);
    // In the endless city a rush ends at the gear's mark, even halfway along a roof.
    const golden = !!r?.golden && (this.world.goalX !== null || inGolden(this.distance));
    if (golden === this.golden) return;
    this.golden = golden;
    if (golden) { this.goldenFrom = this.score; this.events.push({ type: 'golden' }); }
    else this.events.push({ type: 'goldenEnd', points: this.score - this.goldenFrom });
  }

  /** A cracked roof gives way under a runner who stays; a slide through a puddle splashes forward. */
  private underfoot(): void {
    const p = this.player, s = p.ground;
    if (!s || s.kind !== 'roof') return;
    const r = this.world.roofs.find((q) => q.id === s.id);
    if (!r) return;
    if (r.cracked && !this.crumbled.has(r.id) && p.groundTime > CRACK_TIME) {
      this.crumbled.add(r.id);
      p.stumble = STUMBLE_TIME; p.vx *= STUMBLE_FACTOR; p.boost = 0;
      this.events.push({ type: 'crumble', id: r.id, x: p.x + PW / 2, y: p.y });
      this.loseCombo();
    }
    if (p.slide <= 0 || !r.puddles) return;
    for (const w of r.puddles) {
      if (this.splashed.has(w.id) || p.x + PW <= w.x || p.x >= w.x + w.w) continue;
      this.splashed.add(w.id);
      p.boost = Math.min(MAX_BOOST, Math.floor(p.boost) + 1);
      p.vx = Math.max(p.vx, paceSpeed(p.pace, p.x) + p.boost * BOOST_SPEED);
      this.addCombo();
      this.events.push({ type: 'splash', points: this.award(SPLASH_POINTS), x: w.x + w.w / 2, y: r.y });
    }
  }

  private onPhys(e: PhysEvent): void {
    const p = this.player;
    this.events.push(e);
    switch (e.type) {
      case 'jump':
        if (!e.perfect) break;
        this.perfects++;
        this.addCombo();
        this.comboTimer = PERFECT_COMBO_TIME;
        this.events.push({ type: 'perfectBonus', points: this.award(PERFECT_POINTS), x: p.x, y: p.y - PH });
        break;
      case 'stomp':
        this.stomps++;
        this.addCombo();
        this.events.push({ type: 'stompBonus', points: this.award(STOMP_POINTS[e.target]), x: e.x, y: e.y });
        break;
      case 'smash': case 'dodge':
        this.slides++;
        this.addCombo();
        this.events.push({ type: 'slideBonus', what: e.type, points: this.award(SLIDE_POINTS * (e.inside ? 2 : 1)), x: e.x, y: e.y });
        break;
      case 'breakin': this.risk('inside', BREAKIN_POINTS); break;
      case 'breakout':
        this.addCombo();
        this.events.push({ type: 'escape', points: this.award(BREAKOUT_POINTS), x: e.x, y: e.y - PH });
        break;
      case 'land': this.onLand(e.surface.kind, e.surface.id); break;
      case 'stumble': case 'wall': this.loseCombo(); break;
      case 'trafficHit': this.loseCombo(true); this.deathCause = 'traffic'; this.dead = true; break;
      case 'fell': this.deathCause = 'fall'; this.dead = true; break;
    }
  }

  private onLand(kind: SurfaceKind, id: number): void {
    const p = this.player;
    if (kind === 'road' && !this.onRoad) {
      this.onRoad = true;
      this.events.push({ type: 'road', x: p.x, y: p.y });
    }
    if (!this.riskTaken.has(id)) {
      if (kind === 'tank' || kind === 'line') {
        this.riskTaken.add(id);
        this.risk(kind, RISK_POINTS);
      } else if (kind === 'roof' || kind === 'scaffold') {
        this.riskTaken.add(id);
        if (p.boostTime > 0) this.events.push({ type: 'dash', points: this.award(DASH_POINTS), x: p.x, y: p.y - PH });
        const roofs = this.world.roofs;
        const prev = roofs[roofs.findIndex((r) => r.id === id) - 1];
        // Crossing on laundry is paid as the laundry route; coming up from the street isn't a far jump.
        const direct = this.lastSurface !== 'line' && this.lastSurface !== 'road' && this.lastSurface !== 'ramp';
        if (prev && direct && prev.gap >= FAR_RATIO * jumpReach(paceSpeed(p.pace, prev.x + prev.w), prev.nextDy) && prev.gap > 0)
          this.risk('far', FAR_POINTS);
      }
    }
    this.lastSurface = kind;
  }

  drain(): GameEvent[] { const e = this.events; this.events = []; return e; }
}
