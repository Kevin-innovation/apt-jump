import type { Obstacle, Roof } from './world';

// Units are virtual pixels and seconds. y grows downward; player.y is the feet.
export const STEP = 1 / 120;
export const PX_PER_M = 16;
export const PW = 10;
export const PH = 16;
export const GRAVITY = 1000;
export const HOLD_GRAVITY = 450;
export const JUMP_V = 290;
export const HOLD_MAX = 0.25;
export const CUT_V = 170;
export const MAX_FALL = 520;
export const COYOTE = 0.08;
export const BUFFER = 0.11;
/** A press this soon after touching down is a "perfect" jump. */
export const PERFECT_WINDOW = 0.18;
export const MAX_BOOST = 5;
export const BOOST_SPEED = 11;
export const LEDGE = 6;
export const LINE_SPRING = 1.08;
export const STUMBLE_TIME = 0.5;
export const STUMBLE_FACTOR = 0.55;
const ACCEL = 320;
/** Falling this far below the last roof ends the run. */
export const FALL_LIMIT = 150;

export function baseSpeed(x: number): number {
  return 118 + 80 * (1 - Math.exp(-Math.max(0, x) / 14000));
}

export type SurfaceKind = 'roof' | 'ac' | 'tank' | 'line';
export interface Surface { id: number; kind: SurfaceKind; x0: number; x1: number; y: number }

export interface Player {
  x: number; y: number; vx: number; vy: number;
  ground: Surface | null;
  groundTime: number;
  airTime: number;
  coyote: number;
  buffer: number;
  holdTime: number;
  jumping: boolean;
  boost: number;
  stumble: number;
  lastHit: number;
  crashed: boolean;
  lastRoofY: number;
  /** Was the latest touchdown a real landing (not a step-off)? */
  landedFromAir: boolean;
}

export interface JumpInput { pressed: boolean; held: boolean }

export type PhysEvent =
  | { type: 'jump'; perfect: boolean; boost: number }
  | { type: 'land'; surface: Surface; speed: number }
  | { type: 'stumble'; id: number }
  | { type: 'wall' }
  | { type: 'fell' };

export function newPlayer(x: number, y: number): Player {
  return {
    x, y, vx: baseSpeed(0), vy: 0, ground: null, groundTime: 1, airTime: 0, coyote: 0, buffer: 0,
    holdTime: 0, jumping: false, boost: 0, stumble: 0, lastHit: -1, crashed: false, lastRoofY: y,
    landedFromAir: false,
  };
}

/** Airtime of a fully held jump that ends dy below (+) or above (-) the take-off; 0 if too high. */
export function jumpTime(dy: number): number {
  let y = 0, vy = -JUMP_V, t = 0;
  let top = 0;
  while (t < 3) {
    vy = Math.min(MAX_FALL, vy + (t < HOLD_MAX ? HOLD_GRAVITY : GRAVITY) * STEP);
    y += vy * STEP;
    t += STEP;
    top = Math.min(top, y);
    if (vy > 0 && y >= dy) return top <= dy ? t : 0;
  }
  return t;
}
export function jumpReach(speed: number, dy: number): number { return jumpTime(dy) * speed; }

/** Height above take-off at time t of a fully held jump. */
export function jumpHeightAt(t: number): number {
  let y = 0, vy = -JUMP_V;
  for (let e = 0; e < t; e += STEP) {
    vy = Math.min(MAX_FALL, vy + (e < HOLD_MAX ? HOLD_GRAVITY : GRAVITY) * STEP);
    y += vy * STEP;
  }
  return -y;
}

const overlaps = (p: Player, x0: number, x1: number) => p.x + PW - 2 > x0 && p.x + 2 < x1;
const obsSurface = (o: Obstacle): Surface => ({ id: o.id, kind: o.kind, x0: o.x, x1: o.x + o.w, y: o.y });

function findLanding(p: Player, prevFeet: number, roofs: readonly Roof[]): Surface | null {
  let best: Surface | null = null;
  const consider = (s: Surface) => {
    if (prevFeet <= s.y + 0.01 && p.y >= s.y && overlaps(p, s.x0, s.x1) && (!best || s.y < best.y)) best = s;
  };
  for (const r of roofs) {
    // A roof's lines hang in the gap after it, so keep looking a little past its end.
    if (r.x > p.x + 60 || r.x + r.w < p.x - 260) continue;
    consider({ id: r.id, kind: 'roof', x0: r.x, x1: r.x + r.w, y: r.y });
    for (const o of r.obstacles) consider(obsSurface(o));
    for (const l of r.lines) consider({ id: l.id, kind: 'line', x0: l.x, x1: l.x + l.w, y: l.y });
  }
  return best;
}

/** One fixed step. Mutates p only, so a planner can run it on a copy. */
export function stepPlayer(p: Player, input: JumpInput, roofs: readonly Roof[], emit: (e: PhysEvent) => void): void {
  const dt = STEP;
  p.buffer = Math.max(0, p.buffer - dt);
  p.stumble = Math.max(0, p.stumble - dt);

  if (p.ground) {
    p.groundTime += dt;
    if (p.groundTime > PERFECT_WINDOW) p.boost = Math.max(0, p.boost - 6 * dt);
  } else {
    p.airTime += dt;
    p.coyote = Math.max(0, p.coyote - dt);
  }

  const speedTarget = () => (baseSpeed(p.x) + p.boost * BOOST_SPEED) * (p.stumble > 0 ? STUMBLE_FACTOR : 1);

  if (input.pressed) p.buffer = BUFFER;
  if ((p.ground !== null || p.coyote > 0) && !p.crashed && p.buffer > 0) {
    // A buffered press still jumps, but only a fresh press after touchdown earns the boost.
    const perfect = input.pressed && p.ground !== null && p.landedFromAir && p.groundTime <= PERFECT_WINDOW;
    if (perfect) {
      p.boost = Math.min(MAX_BOOST, Math.floor(p.boost) + 1);
      p.vx = Math.max(p.vx, speedTarget());
    }
    p.vy = -JUMP_V * (p.ground?.kind === 'line' ? LINE_SPRING : 1);
    p.ground = null;
    p.coyote = 0; p.buffer = 0; p.holdTime = 0; p.airTime = 0; p.jumping = true; p.landedFromAir = false;
    emit({ type: 'jump', perfect, boost: p.boost });
  }

  if (!p.ground) {
    let g = GRAVITY;
    if (p.jumping) {
      if (!input.held) {
        if (p.vy < -CUT_V) p.vy = -CUT_V;
        p.jumping = false;
      } else if (p.holdTime < HOLD_MAX) {
        g = HOLD_GRAVITY;
        p.holdTime += dt;
      } else p.jumping = false;
    }
    p.vy = Math.min(MAX_FALL, p.vy + g * dt);
  }

  if (p.crashed) p.vx = 0;
  else {
    const target = speedTarget();
    p.vx = p.vx < target ? Math.min(target, p.vx + ACCEL * dt) : Math.max(target, p.vx - ACCEL * 2 * dt);
  }
  const prevRight = p.x + PW;
  const prevFeet = p.y;
  p.x += p.vx * dt;
  if (!p.ground) p.y += p.vy * dt;

  // Building sides are solid; a near miss is lifted onto the ledge.
  let lifted = false;
  if (!p.ground && !p.crashed) {
    for (const r of roofs) {
      if (prevRight - 2 > r.x + 0.01 || p.x + PW - 2 <= r.x || p.y <= r.y) continue;
      if (p.y - r.y <= LEDGE && p.vy >= 0) { p.y = r.y; lifted = true; break; }
      if (prevFeet <= r.y) continue; // came over the corner: the landing check handles it
      p.x = r.x - PW + 2; p.vx = 0; p.crashed = true; p.jumping = false;
      p.vy = Math.max(p.vy, 0);
      emit({ type: 'wall' });
      break;
    }
  }

  if (p.ground) {
    if (!overlaps(p, p.ground.x0, p.ground.x1)) {
      p.ground = null; p.coyote = COYOTE; p.airTime = 0; p.vy = 0; p.jumping = false;
    }
  } else if (p.vy >= 0 && !p.crashed) {
    const s = findLanding(p, lifted ? p.y : prevFeet, roofs);
    if (s) {
      const speed = p.vy;
      p.landedFromAir = p.airTime > 0.12;
      p.y = s.y; p.vy = 0; p.ground = s; p.jumping = false; p.groundTime = 0;
      if (s.kind === 'roof') p.lastRoofY = s.y;
      emit({ type: 'land', surface: s, speed });
    }
  }

  // Obstacle fronts trip the runner once each.
  if (!p.crashed) {
    for (const r of roofs) {
      if (r.x > p.x + 60 || r.x + r.w < p.x - 60) continue;
      for (const o of r.obstacles) {
        if (o.id === p.lastHit || p.x + PW - 2 <= o.x || p.x + 2 >= o.x + o.w) continue;
        if (p.y > o.y + LEDGE && p.y - PH < o.y + o.h) {
          p.lastHit = o.id; p.stumble = STUMBLE_TIME; p.boost = 0; p.vx *= STUMBLE_FACTOR;
          emit({ type: 'stumble', id: o.id });
        }
      }
    }
  }

  if (p.y > p.lastRoofY + FALL_LIMIT) emit({ type: 'fell' });
}
