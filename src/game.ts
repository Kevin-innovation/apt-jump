import { DASH_POINTS, MAGNET_RANGE, MAGNET_SPEED, MAX_AIR_BONUS, POWER_POINTS, POWER_TIME, type PowerKind } from './items';
import { MISSIONS, type Mission, type Tally } from './missions';
import {
  DEFAULT_PACE, jumpReach, newPlayer, paceSpeed, PH, PW, PX_PER_M, STEP, stepPlayer, timeRate,
  type JumpInput, type Pace, type PhysEvent, type Player, type SurfaceKind,
} from './physics';
import { districtAt, type District } from './progression';
import { World, type City, type CoinKind } from './world';

export const COMBO_TIME = 4;
export const COIN_VALUE: Record<CoinKind, number> = { coin: 1, gold: 5, diamond: 20 };
export const COIN_POINTS = 10;
export const PERFECT_POINTS = 25;
export const RISK_POINTS = 60;
export const FAR_POINTS = 40;
export const STOMP_POINTS = { ac: 30, pigeon: 50, drone: 60 } as const;
/** A gap this large a share of the longest unboosted jump counts as far. */
export const FAR_RATIO = 0.5;
export const START_X = 60;
/** Base speed gained per speed level. */
export const LEVEL_SPEED = 15;

export function multiplier(combo: number): number { return 1 + Math.min(4, Math.floor(combo / 5)); }

export type RiskKind = 'tank' | 'line' | 'far';
export type GameEvent =
  | PhysEvent
  | { type: 'coin'; kind: CoinKind; points: number; x: number; y: number }
  | { type: 'perfectBonus'; points: number; x: number; y: number }
  | { type: 'stompBonus'; points: number; x: number; y: number }
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
  | { type: 'comboLost'; combo: number };

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
  combo = 0;
  comboTimer = 0;
  maxCombo = 0;
  perfects = 0;
  risks = 0;
  level = 1;
  powers = 0;
  /** Missions finished; also which one is next. */
  missionsDone = 0;
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

  /** A seed plays the endless city, a course plays a made map. */
  constructor(source: number | Course) {
    const course = typeof source === 'number' ? { city: new World(source), pace: DEFAULT_PACE, startY: 0 } : source;
    this.world = course.city;
    this.player = newPlayer(START_X, course.startY, course.pace);
    this.world.ensure(0, 1400);
    stepPlayer(this.player, { pressed: false, held: false }, this.world.roofs, () => {});
  }

  get over(): boolean { return this.dead || this.finished; }
  get distance(): number { return Math.max(0, (this.player.x - START_X) / PX_PER_M); }
  get score(): number { return Math.floor(this.distance) + this.bonus; }
  get mult(): number { return multiplier(this.combo); }
  /** The mission under way: endless runs only. */
  get mission(): Mission | null { return this.world.goalX === null ? MISSIONS[this.missionsDone] ?? null : null; }
  get tally(): Tally {
    return {
      coins: this.coins, powers: this.powers, perfects: this.perfects, stomps: this.stomps, risks: this.risks,
      diamonds: this.diamonds, maxCombo: this.maxCombo, distance: Math.floor(this.distance),
    };
  }
  /** The district under the runner: endless runs only. */
  get district(): District | null { return this.world.goalX === null ? districtAt(this.distance) : null; }
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
      this.zone = { index: district.index, from: this.tally, done: false };
      this.events.push({ type: 'district', district });
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
  private loseCombo(): void {
    if (this.combo > 0) this.events.push({ type: 'comboLost', combo: this.combo });
    this.combo = 0; this.comboTimer = 0;
  }
  private award(base: number): number {
    const pts = base * this.mult * (this.doubleTime > 0 ? 2 : 1);
    this.bonus += pts;
    return pts;
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
    stepPlayer(p, input, this.world.roofs, (e) => this.onPhys(e));
    if (this.dead) return;
    this.magnetTime = Math.max(0, this.magnetTime - STEP);
    this.doubleTime = Math.max(0, this.doubleTime - STEP);
    this.keepTime = Math.max(0, this.keepTime - STEP);

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
        if (c.kind === 'diamond') this.diamonds++;
        this.addCombo();
        this.events.push({ type: 'coin', kind: c.kind, points: this.award(COIN_POINTS * COIN_VALUE[c.kind]), x: c.x, y: c.y });
      }
    }
    if (this.onRoad && p.ground && p.ground.kind !== 'road' && p.ground.kind !== 'ramp') {
      this.onRoad = false;
      this.events.push({ type: 'roadExit', x: p.x, y: p.y });
    }
    const level = 1 + Math.floor((paceSpeed(p.pace, p.x) - p.pace.base) / LEVEL_SPEED);
    if (level > this.level) {
      this.level = level;
      this.events.push({ type: 'speedup', level });
    }
    const mission = this.mission;
    if (mission && this.tally[mission.what] >= mission.goal) {
      // A flat reward: the combo and the score item don't change it.
      this.missionsDone++;
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

  private onPhys(e: PhysEvent): void {
    const p = this.player;
    this.events.push(e);
    switch (e.type) {
      case 'jump':
        if (!e.perfect) break;
        this.perfects++;
        this.addCombo();
        this.events.push({ type: 'perfectBonus', points: this.award(PERFECT_POINTS), x: p.x, y: p.y - PH });
        break;
      case 'stomp':
        this.stomps++;
        this.addCombo();
        this.events.push({ type: 'stompBonus', points: this.award(STOMP_POINTS[e.target]), x: e.x, y: e.y });
        break;
      case 'land': this.onLand(e.surface.kind, e.surface.id); break;
      case 'stumble': case 'wall': this.loseCombo(); break;
      case 'trafficHit': this.loseCombo(); this.deathCause = 'traffic'; this.dead = true; break;
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
