import { BOOST_RATE } from './items';
import type { Enemy, Obstacle, Roof } from './world';
import { roadCars } from './traffic';

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
export const AIR_JUMP_V = 240;
export const AIR_COOLDOWN = 3;
/** Share of the hold already used up when an air jump or stomp begins. */
const SECOND_HOLD = HOLD_MAX * 0.4;
export const STOMP_V = 210;
const STOMP_SLACK = 6;
const ACCEL = 320;
/** How far a runner may be off a surface and still be carried onto it (ramps). */
const SNAP = 8;
/** Falling this far below the last surface ends the run. */
export const FALL_LIMIT = 150;

/** half is the distance in pixels by which half the gain is reached. */
export interface Pace { base: number; gain: number; half?: number; stageGain?: number }
export const DEFAULT_PACE: Readonly<Pace> = { base: 140, gain: 180, half: 2400, stageGain: 22 };
// The simulation uses only basic arithmetic (no exp or sin), so a replay gives the same run on every engine.
/** Rises from 0 toward 1, halfway at `half`. */
export function ease(x: number, half: number): number { const u = Math.max(0, x); return u / (u + half); }
/** A smooth wave between -1 and 1 with period 1, like a sine. */
export function wave(t: number): number {
  const s = t - Math.floor(t);
  return s < 0.5 ? 16 * s * (0.5 - s) : -16 * (s - 0.5) * (1 - s);
}
export function paceSpeed(pace: Pace, x: number): number {
  const stages = Math.min(8, Math.floor(Math.max(0, x - 60) / (250 * PX_PER_M)));
  return pace.base + pace.gain * ease(x, pace.half ?? 6000) + stages * (pace.stageGain ?? 0);
}
/** Speed of an ordinary run at x, before any boost. */
export function baseSpeed(x: number): number { return paceSpeed(DEFAULT_PACE, x); }

export type SurfaceKind = 'roof' | 'scaffold' | 'ac' | 'tank' | 'line' | 'road' | 'ramp';
/** y is the height at x0; y1, when present, the height at x1 (a slope). */
export interface Surface { id: number; kind: SurfaceKind; x0: number; x1: number; y: number; y1?: number }

export interface Player {
  /** Simulation seconds, including speed effects. */
  time: number;
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
  airUsed: boolean;
  airCooldown: number;
  /** Air jumps from items, beyond the ordinary one. */
  airBonus: number;
  /** Seconds left of the speed item. */
  boostTime: number;
  /** Will take the next collision. */
  shield: boolean;
  /** Units and enemies already dealt with. Replaced, never mutated, so copies are safe. */
  gone: readonly number[];
  pace: Readonly<Pace>;
}

export interface JumpInput { pressed: boolean; held: boolean }

export type PhysEvent =
  | { type: 'jump'; perfect: boolean; boost: number }
  | { type: 'airjump' }
  | { type: 'shielded'; id: number; x: number; y: number }
  | { type: 'land'; surface: Surface; speed: number }
  | { type: 'stomp'; id: number; target: 'ac' | 'drone' | 'pigeon'; x: number; y: number }
  | { type: 'stumble'; id: number; by: 'ac' | 'tank' | 'drone' | 'pigeon' }
  | { type: 'wall' }
  | { type: 'trafficHit'; x: number; y: number }
  | { type: 'fell' };

export function newPlayer(x: number, y: number, pace: Readonly<Pace> = DEFAULT_PACE): Player {
  return {
    time: 0, x, y, vx: paceSpeed(pace, 0), vy: 0, ground: null, groundTime: 1, airTime: 0, coyote: 0, buffer: 0,
    holdTime: 0, jumping: false, boost: 0, stumble: 0, lastHit: -1, crashed: false, lastRoofY: y,
    landedFromAir: false, airUsed: false, airCooldown: 0, airBonus: 0, boostTime: 0, shield: false, gone: [], pace,
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

export interface Box { x: number; y: number; w: number; h: number }
/** Where an enemy is depends only on how far the runner has got, so a map always plays the same. */
export function enemyBox(e: Enemy, px: number): Box {
  if (e.kind === 'drone') return { x: e.x, y: e.y + e.amp * wave(px / 180 + e.phase), w: 16, h: 10 };
  const ahead = Math.max(-80, Math.min(240, (e.x - px) * 0.6));
  return { x: e.x + ahead, y: e.y + 2 * wave(px / 63), w: 14, h: 9 };
}

/** Right-hand end of everything that belongs to a roof, its road included. */
export function roofEnd(r: Roof): number { return Math.max(r.x + r.w, r.road ? r.road.rampEnd : 0) + (r.lines.length ? r.gap : 0); }

export function surfaceY(s: Surface, x: number): number {
  if (s.y1 === undefined) return s.y;
  const t = Math.max(0, Math.min(1, (x - s.x0) / (s.x1 - s.x0)));
  return s.y + (s.y1 - s.y) * t;
}

const overlaps = (p: Player, x0: number, x1: number) => p.x + PW - 2 > x0 && p.x + 2 < x1;
const obsSurface = (o: Obstacle): Surface => ({ id: o.id, kind: o.kind, x0: o.x, x1: o.x + o.w, y: o.y });

function eachSurface(p: Player, roofs: readonly Roof[], visit: (s: Surface) => void): void {
  for (const r of roofs) {
    if (r.x > p.x + 80 || roofEnd(r) < p.x - 80) continue;
    visit({ id: r.id, kind: r.kind === 'scaffold' ? 'scaffold' : 'roof', x0: r.x, x1: r.x + r.w, y: r.y });
    for (const o of r.obstacles) if (!p.gone.includes(o.id)) visit(obsSurface(o));
    for (const l of r.lines) visit({ id: l.id, kind: 'line', x0: l.x, x1: l.x + l.w, y: l.y });
    if (r.road) {
      const d = r.road;
      visit({ id: d.id, kind: 'road', x0: d.x, x1: d.rampStart, y: d.y });
      visit({ id: d.id, kind: 'ramp', x0: d.rampStart, x1: d.rampEnd, y: d.y, y1: d.rampY });
    }
  }
}

function findLanding(p: Player, prevFeet: number, prevX: number, roofs: readonly Roof[], rampsOnly = false): Surface | null {
  let best: Surface | null = null, bestY = 0;
  const half = PW / 2;
  eachSurface(p, roofs, (s) => {
    if ((rampsOnly && s.kind !== 'ramp') || !overlaps(p, s.x0, s.x1)) return;
    const y = surfaceY(s, p.x + half);
    if (prevFeet <= surfaceY(s, prevX + half) + 0.01 && p.y >= y && (!best || y < bestY)) { best = s; bestY = y; }
  });
  return best;
}

/** The surface a runner is carried onto without leaving the ground, if any. */
function carry(p: Player, roofs: readonly Roof[], rampsOnly: boolean): Surface | null {
  const c = p.x + PW / 2;
  let best: Surface | null = null, bestD = SNAP;
  eachSurface(p, roofs, (s) => {
    if (rampsOnly && s.kind !== 'ramp') return;
    if (s.kind === 'line' || s.kind === 'ac' || s.kind === 'tank') return;
    if (c < s.x0 || c > s.x1) return;
    const d = Math.abs(surfaceY(s, c) - p.y);
    if (d <= bestD) { best = s; bestD = d; }
  });
  return best;
}

function landsSoon(p: Player, roofs: readonly Roof[]): boolean {
  if (p.vy <= 0) return false;
  const t = BUFFER * 0.9;
  const ahead: Player = { ...p, x: p.x + p.vx * t, y: p.y + p.vy * t + 0.5 * GRAVITY * t * t };
  return findLanding(ahead, p.y, p.x, roofs) !== null;
}

/** How fast time passes for the runner. */
export function timeRate(p: Player): number { return p.boostTime > 0 ? BOOST_RATE : 1; }
export function canAirJump(p: Player): boolean { return (!p.airUsed && p.airCooldown <= 0) || p.airBonus > 0; }

/** One fixed step. Mutates p only, so a planner can run it on a copy. */
export function stepPlayer(p: Player, input: JumpInput, roofs: readonly Roof[], emit: (e: PhysEvent) => void): void {
  const dt = STEP * timeRate(p);
  p.time += dt;
  p.boostTime = Math.max(0, p.boostTime - STEP);
  p.buffer = Math.max(0, p.buffer - dt);
  p.stumble = Math.max(0, p.stumble - dt);
  p.airCooldown = Math.max(0, p.airCooldown - dt);

  if (p.ground) {
    p.groundTime += dt;
    if (p.groundTime > PERFECT_WINDOW) p.boost = Math.max(0, p.boost - 6 * dt);
  } else {
    p.airTime += dt;
    p.coyote = Math.max(0, p.coyote - dt);
  }

  const speedTarget = () => (paceSpeed(p.pace, p.x) + p.boost * BOOST_SPEED) * (p.stumble > 0 ? STUMBLE_FACTOR : 1);

  if (input.pressed) p.buffer = BUFFER;
  const grounded = p.ground !== null || p.coyote > 0;
  if (grounded && !p.crashed && p.buffer > 0) {
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
  } else if (input.pressed && !p.crashed && canAirJump(p) && !landsSoon(p, roofs)) {
    // A press just above a roof is a buffered jump, not a wasted air jump.
    p.vy = -AIR_JUMP_V;
    if (!p.airUsed && p.airCooldown <= 0) { p.airUsed = true; p.airCooldown = AIR_COOLDOWN; }
    else p.airBonus--;
    p.buffer = 0; p.holdTime = SECOND_HOLD; p.jumping = true;
    emit({ type: 'airjump' });
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
  const prevX = p.x;
  const prevRight = p.x + PW;
  const prevFeet = p.y;
  p.x += p.vx * dt;
  if (!p.ground) p.y += p.vy * dt;

  // Building sides are solid; a near miss is lifted onto the ledge. Scaffolds have no sides.
  let lifted = false;
  if (!p.crashed) {
    for (const r of roofs) {
      if (r.kind === 'scaffold' || prevRight - 2 > r.x + 0.01 || p.x + PW - 2 <= r.x || p.y <= r.y) continue;
      if (p.y - r.y <= LEDGE) { p.y = r.y; lifted = p.vy >= 0; break; }
      if (!p.ground && prevFeet <= r.y) continue; // came over the corner: the landing check handles it
      p.x = r.x - PW + 2; p.vx = 0; p.crashed = true; p.jumping = false; p.ground = null;
      p.vy = Math.max(p.vy, 0);
      emit({ type: 'wall' });
      break;
    }
  }

  const bounce = () => {
    p.vy = -STOMP_V; p.ground = null; p.coyote = 0; p.airTime = 0; p.landedFromAir = false;
    p.jumping = input.held; p.holdTime = SECOND_HOLD;
  };
  const remove = (id: number) => { p.gone = [...p.gone.slice(-39), id]; };

  if (p.ground) {
    const next = carry(p, roofs, overlaps(p, p.ground.x0, p.ground.x1));
    if (next) p.ground = next;
    if (next || overlaps(p, p.ground.x0, p.ground.x1)) {
      p.y = surfaceY(p.ground, p.x + PW / 2);
      p.lastRoofY = p.ground.kind === 'line' || p.ground.kind === 'ac' || p.ground.kind === 'tank' ? p.lastRoofY : p.y;
    } else {
      p.ground = null; p.coyote = COYOTE; p.airTime = 0; p.vy = 0; p.jumping = false;
    }
  } else if (!p.crashed) {
    // A ramp can also catch up with a fast runner who is still rising, so it counts then too.
    const s = findLanding(p, lifted ? p.y : prevFeet, lifted ? p.x : prevX, roofs, p.vy < 0);
    if (s && s.kind === 'ac') {
      // Landing on an outdoor unit from above smashes it.
      p.y = s.y;
      remove(s.id);
      bounce();
      emit({ type: 'stomp', id: s.id, target: 'ac', x: (s.x0 + s.x1) / 2, y: s.y });
    } else if (s) {
      const speed = p.vy;
      p.landedFromAir = p.airTime > 0.12;
      p.y = surfaceY(s, p.x + PW / 2);
      p.vy = 0; p.ground = s; p.jumping = false; p.groundTime = 0; p.airUsed = false; p.coyote = 0;
      if (s.kind !== 'line' && s.kind !== 'tank') p.lastRoofY = p.y;
      emit({ type: 'land', surface: s, speed });
    }
  }

  if (!p.crashed) touchHazards(p, prevFeet, roofs, emit, bounce, remove);
  if (!p.crashed) for (const r of roofs) {
    if (!r.road || p.x + PW < r.road.x || p.x > r.road.rampStart) continue;
    for (const car of roadCars(r.road, p.time)) {
      if (p.x + PW - 1 <= car.x || p.x + 1 >= car.x + car.w || p.y <= car.y || p.y - PH + 1 >= car.y + car.h) continue;
      // Cars are lethal even with a helmet; they cannot be stomped.
      p.crashed = true; p.vx = 0; p.jumping = false;
      emit({ type: 'trafficHit', x: p.x, y: p.y });
      break;
    }
  }
  if (p.y > p.lastRoofY + FALL_LIMIT) emit({ type: 'fell' });
}

function touchHazards(
  p: Player, prevFeet: number, roofs: readonly Roof[], emit: (e: PhysEvent) => void,
  bounce: () => void, remove: (id: number) => void,
): void {
  const trip = (id: number, by: 'ac' | 'tank' | 'drone' | 'pigeon') => {
    if (p.shield) {
      p.shield = false;
      remove(id);
      emit({ type: 'shielded', id, x: p.x + PW / 2, y: p.y - PH / 2 });
      return;
    }
    p.lastHit = id; p.stumble = STUMBLE_TIME; p.boost = 0; p.vx *= STUMBLE_FACTOR;
    emit({ type: 'stumble', id, by });
  };
  for (const r of roofs) {
    if (r.x > p.x + 300 || roofEnd(r) < p.x - 300) continue;
    for (const e of r.enemies) {
      if (p.gone.includes(e.id)) continue;
      const b = enemyBox(e, p.x);
      if (p.x + PW - 1 <= b.x || p.x + 1 >= b.x + b.w || p.y <= b.y || p.y - PH + 2 >= b.y + b.h) continue;
      remove(e.id);
      if (!p.ground && p.vy > 0 && prevFeet <= b.y + STOMP_SLACK) {
        p.y = Math.min(p.y, b.y);
        bounce();
        emit({ type: 'stomp', id: e.id, target: e.kind, x: b.x + b.w / 2, y: b.y });
      } else if (p.stumble <= 0) trip(e.id, e.kind);
    }
    // Obstacle sides trip the runner once each, never while already stumbling.
    for (const o of r.obstacles) {
      if (o.id === p.lastHit || p.stumble > 0 || p.gone.includes(o.id)) continue;
      if (p.x + PW - 2 <= o.x || p.x + 2 >= o.x + o.w) continue;
      if (p.y > o.y + LEDGE && p.y - PH < o.y + o.h) trip(o.id, o.kind);
    }
  }
}
