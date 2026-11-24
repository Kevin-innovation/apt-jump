import { Bot } from './bot';
import type { Game, GameEvent } from './game';
import type { Phase } from './main';
import type { JumpInput } from './physics';

export const CHECKS = [
  'title-shown', 'run-advances', 'long-press-jumps-higher', 'coin-scores', 'combo-multiplies', 'perfect-jump-boosts',
  'risk-route-bonus', 'picture-drawn', 'pause-freezes-run', 'resume-continues', 'fall-shows-result', 'restart-begins-fresh-run',
] as const;
type Check = (typeof CHECKS)[number];
/** Everything that has to be seen before the pause part starts. */
const PLAY_CHECKS = CHECKS.slice(1, 8);
const TIME_LIMIT = 150;

export interface Host {
  phase(): Phase;
  game(): Game;
  start(): void; pause(): void; resume(): void; restart(): void;
  visible(id: string): boolean;
  canvas: HTMLCanvasElement;
}

/** Plays the real game with ?patch-test=1 and reports only what it saw happen. */
export class PatchTest {
  private bot = new Bot();
  private done = new Set<Check>();
  private t0 = performance.now();
  private stage: 'title' | 'play' | 'paused' | 'resumed' | 'fall' | 'restarted' | 'end' = 'title';
  private stageAt = performance.now();
  private pausedX = 0;
  private apexes: number[] = [];
  private takeoff: number | null = null;
  private apex = 0;

  constructor(private h: Host) { this.bot.script = [0.02, 0.4]; }

  private pass(name: Check): void {
    if (this.done.has(name)) return;
    this.done.add(name);
    console.log(`pass ${name}`);
  }
  private fail(name: Check, why: string): void {
    if (this.done.has(name)) return;
    this.done.add(name);
    console.log(`fail ${name}: ${why}`);
    this.stage = 'end';
  }
  private go(s: PatchTest['stage']): void { this.stage = s; this.stageAt = performance.now(); }

  input(): JumpInput {
    if (this.stage === 'fall') return { pressed: false, held: false };
    this.bot.wantPerfect = !this.done.has('perfect-jump-boosts');
    this.bot.wantRisk = !this.done.has('risk-route-bonus');
    return this.bot.next(this.h.game());
  }

  onEvent(e: GameEvent): void {
    const g = this.h.game();
    if (e.type === 'jump') {
      this.takeoff = g.player.y;
      this.apex = 0;
    } else if (e.type === 'land') {
      if (this.takeoff !== null && this.apexes.length < 2) {
        this.apexes.push(this.apex);
        const [short, long] = this.apexes;
        if (short !== undefined && long !== undefined) {
          if (long > short + 20) this.pass('long-press-jumps-higher');
          else this.fail('long-press-jumps-higher', `short ${short.toFixed(1)}px, long ${long.toFixed(1)}px`);
        }
      }
      this.takeoff = null;
    } else if (e.type === 'coin') {
      if (g.coins > 0 && g.score >= e.points) this.pass('coin-scores');
    } else if (e.type === 'perfectBonus') {
      if (g.player.boost >= 1) this.pass('perfect-jump-boosts');
    } else if (e.type === 'risk') this.pass('risk-route-bonus');
    if (g.mult >= 2) this.pass('combo-multiplies');
  }

  /** Called after each simulated step. */
  afterStep(): void {
    if (this.takeoff !== null) this.apex = Math.max(this.apex, this.takeoff - this.h.game().player.y);
  }

  private colorsOnScreen(): number {
    const c = this.h.canvas;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 37) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return seen.size;
  }

  /** Called once a frame, after drawing. Times everything by the clock, not by frames. */
  frame(): void {
    if (this.stage === 'end') return;
    const now = performance.now(), since = (now - this.stageAt) / 1000;
    const h = this.h, g = h.game();
    if ((now - this.t0) / 1000 > TIME_LIMIT) {
      const missing = CHECKS.find((c) => !this.done.has(c));
      if (missing) this.fail(missing, `not seen within ${TIME_LIMIT} seconds`);
      return;
    }
    switch (this.stage) {
      case 'title':
        if (since < 2) break;
        if (!h.visible('title')) { this.fail('title-shown', 'the title screen is not visible'); break; }
        this.pass('title-shown');
        h.start();
        this.go('play');
        break;
      case 'play':
        if (h.phase() === 'result') {
          if (since > 1) { this.bot = new Bot(); this.takeoff = null; h.restart(); }
          break;
        }
        if (g.distance > 10) this.pass('run-advances');
        if (since > 3 && !this.done.has('picture-drawn') && this.colorsOnScreen() > 20) this.pass('picture-drawn');
        if (h.phase() === 'playing' && PLAY_CHECKS.every((c) => this.done.has(c))) {
          h.pause();
          this.pausedX = g.player.x;
          this.go('paused');
        }
        break;
      case 'paused':
        if (since < 1) break;
        if (g.player.x !== this.pausedX || h.phase() !== 'paused' || !h.visible('pause')) {
          this.fail('pause-freezes-run', `moved ${g.player.x - this.pausedX}px, phase ${h.phase()}`);
          break;
        }
        this.pass('pause-freezes-run');
        h.resume();
        this.go('resumed');
        break;
      case 'resumed':
        if (g.player.x > this.pausedX + 40 && h.phase() === 'playing') { this.pass('resume-continues'); this.go('fall'); }
        break;
      case 'fall':
        if (h.phase() !== 'result' || !h.visible('result')) break;
        if (!this.done.has('fall-shows-result')) { this.pass('fall-shows-result'); this.stageAt = now; break; }
        if (since > 1.5) { h.restart(); this.go('restarted'); }
        break;
      case 'restarted':
        if (h.phase() === 'playing' && g.coins === 0 && g.bonus === 0 && g.distance > 2 && g.distance < 15) {
          this.pass('restart-begins-fresh-run');
          this.go('end');
        }
        break;
    }
  }
}
