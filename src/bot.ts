import type { Game } from './game';
import { PW, STEP, stepPlayer, type JumpInput, type Player } from './physics';

interface Plan { hold: number; risk: boolean }

/** Test-only autopilot: plans each jump by running the real physics on a copy of the player. */
export class Bot {
  private holdLeft = 0;
  private wait = 0;
  wantRisk = false;
  wantPerfect = false;
  /** Hold lengths for the next jumps, taken before planning starts. */
  script: number[] = [];

  next(g: Game): JumpInput {
    const p = g.player;
    if (this.holdLeft > 0) {
      this.holdLeft -= STEP;
      return { pressed: false, held: this.holdLeft > 0 };
    }
    const idle = { pressed: false, held: false };
    if (!p.ground) return idle;
    if (this.script.length) return p.groundTime < 0.4 ? idle : this.press(this.script.shift()!);
    this.wait -= STEP;
    if (this.wait > 0) return idle;
    this.wait = 0.016;

    const perfect = this.wantPerfect && p.landedFromAir && p.groundTime > 0.03 && p.groundTime < 0.16;
    const must = this.danger(g) < p.vx * 0.08 + 6;
    if (!perfect && !must && !this.wantRisk) return idle;
    const plan = this.plan(g, !must);
    if (!plan) return must ? this.press(0.3) : idle;
    return plan.risk || must || perfect ? this.press(plan.hold) : idle;
  }

  private press(hold: number): JumpInput {
    this.holdLeft = hold;
    return { pressed: true, held: true };
  }

  /** Pixels until the surface ends or an obstacle begins. */
  private danger(g: Game): number {
    const p = g.player;
    let d = p.ground!.x1 - p.x;
    for (const r of g.world.roofs) for (const o of r.obstacles) {
      if (o.x > p.x && p.y > o.y + 6 && p.y - 16 < o.y + o.h) d = Math.min(d, o.x - p.x - PW);
    }
    return d;
  }

  private plan(g: Game, needRoom: boolean): Plan | null {
    let best: Plan | null = null;
    let bestRoom = needRoom ? 60 : -1;
    for (const hold of [0.02, 0.08, 0.14, 0.2, 0.3]) {
      const c: Player = { ...g.player };
      let bad = false, landed = '', left = hold;
      for (let i = 0; i < 240 && !bad && !landed; i++) {
        stepPlayer(c, { pressed: i === 0, held: left > 0 }, g.world.roofs, (e) => {
          if (e.type === 'stumble' || e.type === 'wall' || e.type === 'fell') bad = true;
          else if (e.type === 'land') landed = e.surface.kind;
        });
        left -= STEP;
      }
      if (bad || !landed) continue;
      const risky = landed === 'tank' || landed === 'line';
      if (risky && this.wantRisk) return { hold, risk: true };
      const room = Math.min(c.ground!.x1 - c.x, 120);
      if (room > bestRoom) { bestRoom = room; best = { hold, risk: false }; }
    }
    return best;
  }
}
