import { baseSpeed, jumpReach, newPlayer, PH, PW, PX_PER_M, STEP, stepPlayer, type JumpInput, type PhysEvent, type Player, type SurfaceKind } from './physics';
import { World } from './world';

export const COMBO_TIME = 4;
export const COIN_POINTS = 10;
export const PERFECT_POINTS = 25;
export const RISK_POINTS = 60;
export const FAR_POINTS = 40;
/** A gap this large a share of the longest unboosted jump counts as far. */
export const FAR_RATIO = 0.5;

export function multiplier(combo: number): number { return 1 + Math.min(4, Math.floor(combo / 5)); }

export type GameEvent =
  | PhysEvent
  | { type: 'coin'; value: number; points: number; x: number; y: number }
  | { type: 'perfectBonus'; points: number; x: number; y: number }
  | { type: 'risk'; kind: 'tank' | 'line' | 'far'; points: number; x: number; y: number }
  | { type: 'comboLost'; combo: number };

/** One run: physics plus scoring. Pure simulation, no DOM. */
export class Game {
  world: World;
  player: Player;
  dead = false;
  time = 0;
  bonus = 0;
  coins = 0;
  combo = 0;
  comboTimer = 0;
  maxCombo = 0;
  perfects = 0;
  risks = 0;
  private events: GameEvent[] = [];
  private startX = 60;
  private riskTaken = new Set<number>();
  private lastSurface: SurfaceKind = 'roof';

  constructor(public readonly seed: number) {
    this.world = new World(seed);
    this.player = newPlayer(this.startX, 0);
    this.world.ensure(0, 1400);
    stepPlayer(this.player, { pressed: false, held: false }, this.world.roofs, () => {});
  }

  get distance(): number { return Math.max(0, (this.player.x - this.startX) / PX_PER_M); }
  get score(): number { return Math.floor(this.distance) + this.bonus; }
  get mult(): number { return multiplier(this.combo); }

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

  private risk(kind: 'tank' | 'line' | 'far', base: number): void {
    this.risks++;
    this.addCombo();
    this.events.push({ type: 'risk', kind, points: this.award(base), x: this.player.x, y: this.player.y - PH });
  }

  /** Advance one fixed step. */
  step(input: JumpInput): void {
    if (this.dead) return;
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
        this.coins += c.value;
        this.addCombo();
        this.events.push({ type: 'coin', value: c.value, points: this.award(COIN_POINTS * c.value), x: c.x, y: c.y });
      }
    }
    this.world.ensure(p.x, p.x + 1400);
  }

  private onPhys(e: PhysEvent): void {
    const p = this.player;
    this.events.push(e);
    if (e.type === 'jump' && e.perfect) {
      this.perfects++;
      this.addCombo();
      this.events.push({ type: 'perfectBonus', points: this.award(PERFECT_POINTS), x: p.x, y: p.y - PH });
    } else if (e.type === 'land') {
      const { kind, id } = e.surface;
      if ((kind === 'tank' || kind === 'line') && !this.riskTaken.has(id)) {
        this.riskTaken.add(id);
        this.risk(kind, RISK_POINTS);
      } else if (kind === 'roof' && !this.riskTaken.has(id)) {
        this.riskTaken.add(id);
        const roofs = this.world.roofs;
        const prev = roofs[roofs.findIndex((r) => r.id === id) - 1];
        // Stepping across on the laundry is paid as the laundry route instead.
        if (prev && this.lastSurface !== 'line' && prev.gap >= FAR_RATIO * jumpReach(baseSpeed(prev.x + prev.w), prev.nextDy)) this.risk('far', FAR_POINTS);
      }
      this.lastSurface = kind;
    } else if (e.type === 'stumble' || e.type === 'wall') this.loseCombo();
    else if (e.type === 'fell') this.dead = true;
  }

  drain(): GameEvent[] { const e = this.events; this.events = []; return e; }
}
