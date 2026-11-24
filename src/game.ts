import {
  DEFAULT_PACE, jumpReach, newPlayer, paceSpeed, PH, PW, PX_PER_M, STEP, stepPlayer,
  type JumpInput, type Pace, type PhysEvent, type Player, type SurfaceKind,
} from './physics';
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
  | { type: 'road'; x: number; y: number }
  | { type: 'roadExit'; x: number; y: number }
  | { type: 'speedup'; level: number }
  | { type: 'goal' }
  | { type: 'comboLost'; combo: number };

export interface Course { city: City; pace: Readonly<Pace>; startY: number }

/** One run: physics plus scoring. Pure simulation, no DOM. */
export class Game {
  world: City;
  player: Player;
  dead = false;
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
  private events: GameEvent[] = [];
  private riskTaken = new Set<number>();
  private lastSurface: SurfaceKind = 'roof';
  private onRoad = false;

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
    const pts = base * this.mult;
    this.bonus += pts;
    return pts;
  }
  private risk(kind: RiskKind, base: number): void {
    this.risks++;
    this.addCombo();
    this.events.push({ type: 'risk', kind, points: this.award(base), x: this.player.x, y: this.player.y - PH });
  }

  /** Advance one fixed step. */
  step(input: JumpInput): void {
    if (this.over) return;
    this.time += STEP;
    const p = this.player;
    stepPlayer(p, input, this.world.roofs, (e) => this.onPhys(e));
    if (this.dead) return;

    if (this.combo > 0) {
      this.comboTimer -= STEP;
      if (this.comboTimer <= 0) this.loseCombo();
    }
    for (const r of this.world.roofs) {
      if (r.x > p.x + 60) break;
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
      case 'fell': this.dead = true; break;
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
