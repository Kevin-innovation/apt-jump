import { Bot } from './bot';
import type { Game, GameEvent } from './game';
import type { Phase } from './main';
import type { JumpInput } from './physics';

/** Patch allows twelve. */
export const CHECKS = [
  'title-shown', 'long-press-jumps-higher', 'coin-combo-multiplies', 'perfect-jump-boosts', 'stomp-breaks-unit',
  'double-jump-gets-diamond', 'enemy-stomped', 'road-returns-to-roof', 'custom-map-finishes', 'pause-and-resume',
  'fall-shows-result', 'restart-begins-fresh-run',
] as const;
type Check = (typeof CHECKS)[number];
/** What the practice map has to show; a run that misses some is played again. */
const COURSE_CHECKS = CHECKS.slice(1, 9);
const TIME_LIMIT = 170;

export interface Host {
  phase(): Phase;
  game(): Game;
  /** Plays the built-in made map. */
  startMap(): void;
  startEndless(): void;
  pause(): void; resume(): void; restart(): void;
  visible(id: string): boolean;
  canvas: HTMLCanvasElement;
}

/** Plays the real game with ?patch-test=1 and reports only what it saw happen. */
export class PatchTest {
  private bot = new Bot();
  private done = new Set<Check>();
  private t0 = performance.now();
  private stage: 'title' | 'map' | 'endless' | 'paused' | 'resumed' | 'fall' | 'restarted' | 'end' = 'title';
  private stageAt = performance.now();
  private pausedX = 0;
  private apexes: number[] = [];
  private takeoff: number | null = null;
  private apex = 0;
  private airUsed = false;
  private wasOnRoad = false;

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
    const b = this.bot, need = (c: Check) => !this.done.has(c);
    b.wantPerfect = need('perfect-jump-boosts');
    b.want.clear();
    if (need('stomp-breaks-unit') || need('enemy-stomped')) b.want.add('stomp');
    b.wantDiamond = need('double-jump-gets-diamond');
    b.wantRoad = need('road-returns-to-roof');
    return b.next(this.h.game());
  }

  onEvent(e: GameEvent): void {
    const g = this.h.game();
    switch (e.type) {
      case 'jump':
        this.takeoff = g.player.y;
        this.apex = 0;
        this.airUsed = false;
        break;
      case 'airjump': this.airUsed = true; break;
      case 'land':
        if (this.takeoff !== null && this.apexes.length < 2 && !this.airUsed) {
          this.apexes.push(this.apex);
          const [short, long] = this.apexes;
          if (short !== undefined && long !== undefined) {
            if (long > short + 20) this.pass('long-press-jumps-higher');
            else this.fail('long-press-jumps-higher', `short ${short.toFixed(1)}px, long ${long.toFixed(1)}px`);
          }
        }
        this.takeoff = null;
        break;
      case 'coin':
        if (e.kind === 'diamond' && this.airUsed && g.diamonds > 0) this.pass('double-jump-gets-diamond');
        if (g.mult >= 2 && g.score >= e.points) this.pass('coin-combo-multiplies');
        break;
      case 'perfectBonus': if (g.player.boost >= 1) this.pass('perfect-jump-boosts'); break;
      case 'stomp':
        if (g.player.vy < 0 && g.player.gone.includes(e.id)) this.pass(e.target === 'ac' ? 'stomp-breaks-unit' : 'enemy-stomped');
        break;
      case 'road': this.wasOnRoad = true; break;
      case 'roadExit': if (this.wasOnRoad && g.player.ground?.kind === 'roof') this.pass('road-returns-to-roof'); break;
      case 'goal': if (g.finished) this.pass('custom-map-finishes'); break;
    }
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
      case 'title': {
        if (since < 2) break;
        const colors = this.colorsOnScreen();
        if (!h.visible('title') || colors <= 20) { this.fail('title-shown', `visible ${h.visible('title')}, ${colors} colours drawn`); break; }
        this.pass('title-shown');
        h.startMap();
        this.go('map');
        break;
      }
      case 'map':
        if (h.phase() !== 'result' || since < 1) break;
        if (COURSE_CHECKS.every((c) => this.done.has(c))) { h.startEndless(); this.bot = new Bot(); this.go('endless'); break; }
        this.bot = new Bot();
        if (this.apexes.length < 2) { this.apexes = []; this.bot.script = [0.02, 0.4]; }
        this.takeoff = null;
        this.wasOnRoad = false;
        h.restart();
        break;
      case 'endless':
        if (g.distance < 15) break;
        h.pause();
        this.pausedX = g.player.x;
        this.go('paused');
        break;
      case 'paused':
        if (since < 1) break;
        if (g.player.x !== this.pausedX || h.phase() !== 'paused' || !h.visible('pause')) {
          this.fail('pause-and-resume', `moved ${g.player.x - this.pausedX}px, phase ${h.phase()}`);
          break;
        }
        h.resume();
        this.go('resumed');
        break;
      case 'resumed':
        if (g.player.x > this.pausedX + 40 && h.phase() === 'playing') { this.pass('pause-and-resume'); this.go('fall'); }
        break;
      case 'fall':
        if (h.phase() !== 'result' || !h.visible('result') || !g.dead) break;
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
