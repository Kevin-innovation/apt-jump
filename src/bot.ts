import type { Game } from './game';
import { DIAMOND_HEIGHT } from './world';
import { canAirJump, STEP, stepPlayer, type JumpInput, type Player } from './physics';

type Goal = 'risk' | 'stomp';
interface Plan { hold: number; wanted: boolean }
interface Outcome { bad: boolean; landed: string; stomped: boolean; player: Player }
const IDLE: JumpInput = { pressed: false, held: false };

/** Autopilot for tests and the title demo: plans by running the real physics on a copy of the player. */
export class Bot {
  private holdLeft = 0;
  private wait = 0;
  wantPerfect = false;
  /** Jump early when that would land on a risky spot, or on something to smash. */
  want = new Set<Goal>();
  /** Drop onto the street at the next chance. */
  wantRoad = false;
  /** Use the air jump under a diamond. */
  wantDiamond = false;
  /** Hold lengths for the next jumps, taken before planning starts. */
  script: number[] = [];

  next(g: Game): JumpInput {
    const p = g.player;
    if (this.holdLeft > 0) {
      this.holdLeft -= STEP;
      if (this.holdLeft > 0) return { pressed: false, held: true };
      return IDLE;
    }
    if (!p.ground) return this.inAir(g);
    if (this.script.length) return p.groundTime < 0.4 ? IDLE : this.press(this.script.shift()!);
    this.wait -= STEP;
    if (this.wait > 0) return IDLE;
    this.wait = 0.016;

    if (this.wantDiamond && this.diamondAhead(g) !== null) {
      const d = this.diamondAhead(g)!;
      const lead = p.vx * 0.7;
      if (p.airCooldown <= 0 && d < lead && d > lead - 14) return this.press(0.3);
    }
    const idle = this.run(g, 0, 0.24, false);
    const leaving = this.run(g, 0, 0.07, false).player.ground === null;
    const road = this.wantRoad && g.world.roofs.some((r) => r.road && r.road.x >= p.x - 4 && r.road.x < p.x + 60);
    const must = (idle.bad || leaving) && !(road && leaving);
    const onStreet = p.ground.kind === 'road' || p.ground.kind === 'ramp';
    if (onStreet && !idle.bad) return IDLE;
    const perfect = this.wantPerfect && p.landedFromAir && p.groundTime > 0.03 && p.groundTime < 0.16;
    if (!perfect && !must && !this.want.size) return IDLE;
    const plan = this.plan(g, !must);
    if (!plan) return leaving && !road ? this.press(0.3) : IDLE;
    return plan.wanted || must || perfect ? this.press(plan.hold) : IDLE;
  }

  private press(hold: number): JumpInput {
    this.holdLeft = hold;
    return { pressed: true, held: true };
  }

  private diamondAhead(g: Game): number | null {
    const p = g.player;
    for (const r of g.world.roofs) for (const c of r.coins)
      if (c.kind === 'diamond' && !c.taken && c.x > p.x && c.x < p.x + 400 && Math.abs(c.y - (p.lastRoofY - DIAMOND_HEIGHT)) < 20) return c.x - p.x;
    return null;
  }

  private inAir(g: Game): JumpInput {
    const p = g.player;
    if (!canAirJump(p)) return IDLE;
    if (this.wantDiamond && p.vy > -40 && p.vy < 60) {
      const d = this.diamondAhead(g);
      if (d !== null && d < p.vx * 0.5) return this.press(0.3);
    }
    if (p.vy > 60 && !(this.wantRoad) && this.run(g, -1, 1.6, true).bad) return this.press(0.3);
    return IDLE;
  }

  /** hold < 0: no press at all; hold 0: no press; otherwise press now and hold that long. */
  private run(g: Game, hold: number, seconds: number, stopOnLand: boolean): Outcome {
    const c: Player = { ...g.player };
    const out: Outcome = { bad: false, landed: '', stomped: false, player: c };
    let left = hold;
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps && !out.bad && !(stopOnLand && out.landed); i++) {
      stepPlayer(c, { pressed: i === 0 && hold > 0, held: left > 0 }, g.world.roofs, (e) => {
        if (e.type === 'stumble' || e.type === 'wall' || e.type === 'fell') out.bad = true;
        else if (e.type === 'land') out.landed = e.surface.kind;
        else if (e.type === 'stomp') out.stomped = true;
      });
      left -= STEP;
    }
    return out;
  }

  private plan(g: Game, needRoom: boolean): Plan | null {
    let best: Plan | null = null;
    let bestRoom = needRoom ? 60 : -1;
    for (const hold of [0.02, 0.08, 0.14, 0.2, 0.3]) {
      const o = this.run(g, hold, 2, true);
      if (o.bad || !o.landed) continue;
      const risky = o.landed === 'tank' || o.landed === 'line';
      if ((risky && this.want.has('risk')) || (o.stomped && this.want.has('stomp'))) return { hold, wanted: true };
      let room = Math.min(o.player.ground!.x1 - o.player.x, 120);
      if (o.landed === 'road') room = 0;
      if (room > bestRoom) { bestRoom = room; best = { hold, wanted: false }; }
    }
    return best;
  }
}
