import { BOOST_RATE, GLIDE_FALL, SLOW_RATE } from './items';
import type { Enemy, Obstacle, Roof } from './world';
import { roadCars } from './traffic';
import { GEAR_MAX, gearOf } from './progression';

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
/** The longest a press waits for a landing while an air jump is ready: any longer is felt as lag. */
export const LAND_WAIT = STEP * 2;
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
/** Feet this far under a top still count as having come from above. */
const STOMP_SLACK = 6;
/** How much wider than its body a thing's top is for a stomp. */
const STOMP_PAD = 4;
/** A slide: how long it lasts, the low body's height, the rest before the next, and how early a press is kept. */
export const SLIDE_TIME = 0.65;
export const SLIDE_H = 7;
export const SLIDE_COOLDOWN = 0.35;
export const SLIDE_BUFFER = 0.15;
/** Cars can't hurt for this long after dropping to a street: the time to see what is coming. */
export const ROAD_GRACE = 0.9;
export const CAR_H = 15;
/** The ceiling of a passage lies this far under its roof's top. */
export const CEILING = 6;
const ACCEL = 320;
/** How far a runner may be off a surface and still be carried onto it (ramps). */
const SNAP = 8;
/** Falling this far below the last surface ends the run. */
export const FALL_LIMIT = 150;
/** An updraft pushes up this hard, up to this rising speed. */
export const UPDRAFT = 2400;
export const VENT_RISE = 260;

/** half is the distance in pixels by which half the gain is reached. */
/** lapGear: how much faster each gear of an endless run is (made maps have no gears). */
export interface Pace { base: number; gain: number; half?: number; stageGain?: number; lapGear?: number }
// A brisk start (base) with the same top pace as before: what the start gained, the climb gives back.
export const DEFAULT_PACE: Readonly<Pace> = { base: 200, gain: 120, half: 2400, stageGain: 22, lapGear: 0.04 };
// The simulation uses only basic arithmetic (no exp or sin), so a replay gives the same run on every engine.
/** Rises from 0 toward 1, halfway at `half`. */
export function ease(x: number, half: number): number { const u = Math.max(0, x); return u / (u + half); }
/** A smooth wave between -1 and 1 with period 1, like a sine. */
export function wave(t: number): number {
  const s = t - Math.floor(t);
  return s < 0.5 ? 16 * s * (0.5 - s) : -16 * (s - 0.5) * (1 - s);
}
/** The gear, from 1: endless runs only. */
export function gearAt(pace: Pace, x: number): number { return pace.lapGear ? gearOf(Math.max(0, x - 60) / PX_PER_M) : 1; }
/** How much faster the gear makes the pace. */
export function gearFactor(pace: Pace, x: number): number { return 1 + Math.min(GEAR_MAX, (gearAt(pace, x) - 1) * (pace.lapGear ?? 0)); }
export function paceSpeed(pace: Pace, x: number): number {
  const stages = Math.min(8, Math.floor(Math.max(0, x - 60) / (250 * PX_PER_M)));
  return (pace.base + pace.gain * ease(x, pace.half ?? 6000) + stages * (pace.stageGain ?? 0)) * gearFactor(pace, x);
}
/** Speed of an ordinary run at x, before any boost. */
export function baseSpeed(x: number): number { return paceSpeed(DEFAULT_PACE, x); }

export type SurfaceKind = 'roof' | 'scaffold' | 'ac' | 'tank' | 'box' | 'line' | 'road' | 'ramp' | 'floor';
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
  /** Seconds left of the glider and of slow motion; and a wire hook kept for the next fall. */
  glideTime: number;
  slowTime: number;
  hook: boolean;
  /** Units and enemies already dealt with. Replaced, never mutated, so copies are safe. */
  gone: readonly number[];
  /** Seconds left of the slide; above zero the body is low. */
  slide: number;
  slideCooldown: number;
  slideBuffer: number;
  /** The overhead obstacle being slid under, and those already paid or run into. */
  under: number;
  passed: readonly number[];
  /** The roof whose passage the runner is in, or 0. */
  inside: number;
  /** The street being run, the seconds its cars still can't hurt, and the cars passing through meanwhile. */
  road: number;
  grace: number;
  spared: readonly number[];
  pace: Readonly<Pace>;
}

export interface JumpInput { pressed: boolean; held: boolean; slide?: boolean }

export type PhysEvent =
  | { type: 'jump'; perfect: boolean; boost: number }
  | { type: 'airjump' }
  | { type: 'shielded'; id: number; x: number; y: number }
  | { type: 'land'; surface: Surface; speed: number }
  | { type: 'stomp'; id: number; target: 'ac' | 'box' | 'drone' | 'pigeon'; x: number; y: number }
  | { type: 'stumble'; id: number; by: 'ac' | 'tank' | 'box' | 'bar' | 'drone' | 'pigeon' }
  | { type: 'slide' }
  | { type: 'dive' }
  | { type: 'smash'; id: number; inside: boolean; x: number; y: number }
  | { type: 'dodge'; id: number; inside: boolean; x: number; y: number }
  | { type: 'breakin'; id: number; x: number; y: number }
  | { type: 'breakout'; x: number; y: number }
  | { type: 'wall' }
  | { type: 'trafficHit'; x: number; y: number }
  | { type: 'hooked'; x: number; y: number; tx: number; ty: number }
  | { type: 'fell' };

export function newPlayer(x: number, y: number, pace: Readonly<Pace> = DEFAULT_PACE): Player {
  return {
    time: 0, x, y, vx: paceSpeed(pace, 0), vy: 0, ground: null, groundTime: 1, airTime: 0, coyote: 0, buffer: 0,
    holdTime: 0, jumping: false, boost: 0, stumble: 0, lastHit: -1, crashed: false, lastRoofY: y,
    landedFromAir: false, airUsed: false, airCooldown: 0, airBonus: 0, boostTime: 0, shield: false, glideTime: 0, slowTime: 0, hook: false, gone: [], pace,
    slide: 0, slideCooldown: 0, slideBuffer: 0, under: 0, passed: [], inside: 0, road: 0, grace: 0, spared: [],
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
const obsSurface = (o: Obstacle): Surface => ({ id: o.id, kind: o.kind as Exclude<Obstacle['kind'], 'bar'>, x0: o.x, x1: o.x + o.w, y: o.y });
export function bodyHeight(p: Player): number { return p.slide > 0 ? SLIDE_H : PH; }
/** Whether standing up here would put the runner into something overhead. */
function lowCeiling(p: Player, roofs: readonly Roof[]): boolean {
  for (const r of roofs) for (const o of r.obstacles)
    if (o.kind === 'bar' && overlaps(p, o.x, o.x + o.w) && p.y > o.y + LEDGE && p.y - PH < o.y + o.h && p.y - SLIDE_H >= o.y + o.h) return true;
  return false;
}
/** Whether a street lies under an airborne runner, with room left to come down to it. */
function overStreet(p: Player, roofs: readonly Roof[]): boolean {
  return roofs.some((r) => r.road && p.x + PW > r.road.x && p.x < r.road.rampStart - 40 && p.y < r.road.y - CAR_H * 2);
}

function eachSurface(p: Player, roofs: readonly Roof[], visit: (s: Surface) => void): void {
  for (const r of roofs) {
    if (r.x > p.x + 80 || roofEnd(r) < p.x - 80) continue;
    const w = p.inside === r.id ? r.route : null;
    if (w) {
      // Inside, the passage and its way up replace the roof.
      visit({ id: w.id, kind: 'floor', x0: w.x, x1: w.rampStart, y: w.y });
      visit({ id: w.id, kind: 'ramp', x0: w.rampStart, x1: w.rampEnd, y: w.y, y1: r.y });
    } else visit({ id: r.id, kind: r.kind === 'scaffold' ? 'scaffold' : 'roof', x0: r.x, x1: r.x + r.w, y: r.y });
    for (const o of r.obstacles) if (o.kind !== 'bar' && !p.gone.includes(o.id)) visit(obsSurface(o));
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
    if (s.kind === 'line' || s.kind === 'ac' || s.kind === 'tank' || s.kind === 'box') return;
    if (c < s.x0 || c > s.x1) return;
    const d = Math.abs(surfaceY(s, c) - p.y);
    if (d <= bestD) { best = s; bestD = d; }
  });
  return best;
}

/** Whether the runner is about to touch down: only then does a press wait for the roof instead of jumping in the air. */
function landsSoon(p: Player, roofs: readonly Roof[]): boolean {
  if (p.vy <= 0) return false;
  const t = LAND_WAIT;
  const ahead: Player = { ...p, x: p.x + p.vx * t, y: p.y + p.vy * t + 0.5 * GRAVITY * t * t };
  return findLanding(ahead, p.y, p.x, roofs) !== null;
}

/** How fast time passes for the runner. */
export function timeRate(p: Player): number { return (p.boostTime > 0 ? BOOST_RATE : 1) * (p.slowTime > 0 ? SLOW_RATE : 1); }
/** Whether rising air lifts the runner here: inside a vent's column, below its top. */
export function inUpdraft(p: Player, roofs: readonly Roof[]): boolean {
  return roofs.some((r) => r.vent !== undefined && p.x + PW > r.vent.x && p.x < r.vent.x + r.vent.w && p.y > r.vent.top);
}
/** Whether a street lies under the runner anywhere along it: falling there is a drop, not a fall. */
function streetUnder(p: Player, roofs: readonly Roof[]): boolean {
  return roofs.some((r) => r.road && p.x + PW > r.road.x && p.x < r.road.rampEnd);
}
export function canAirJump(p: Player): boolean { return (!p.airUsed && p.airCooldown <= 0) || p.airBonus > 0; }

/** One fixed step. Mutates p only, so a planner can run it on a copy. */
export function stepPlayer(p: Player, input: JumpInput, roofs: readonly Roof[], emit: (e: PhysEvent) => void): void {
  const dt = STEP * timeRate(p);
  p.time += dt;
  p.boostTime = Math.max(0, p.boostTime - STEP);
  p.glideTime = Math.max(0, p.glideTime - STEP);
  p.slowTime = Math.max(0, p.slowTime - STEP);
  p.buffer = Math.max(0, p.buffer - dt);
  p.stumble = Math.max(0, p.stumble - dt);
  p.airCooldown = Math.max(0, p.airCooldown - dt);
  p.slideCooldown = Math.max(0, p.slideCooldown - dt);
  p.slideBuffer = Math.max(0, p.slideBuffer - dt);
  p.grace = Math.max(0, p.grace - dt);

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
    p.slide = 0; p.slideBuffer = 0;
    emit({ type: 'jump', perfect, boost: p.boost });
  } else if (input.pressed && !p.crashed && canAirJump(p) && !landsSoon(p, roofs)) {
    // A press just above a roof is a buffered jump, not a wasted air jump.
    p.vy = -AIR_JUMP_V;
    if (!p.airUsed && p.airCooldown <= 0) { p.airUsed = true; p.airCooldown = AIR_COOLDOWN; }
    else p.airBonus--;
    p.buffer = 0; p.holdTime = SECOND_HOLD; p.jumping = true;
    p.slideBuffer = 0;
    emit({ type: 'airjump' });
  }

  // A jump pressed in the same step wins over a slide.
  if (input.slide && !input.pressed && !p.crashed) {
    p.slideBuffer = SLIDE_BUFFER;
    // In the air above a street, down means dropping to it.
    if (!p.ground && overStreet(p, roofs)) { p.vy = MAX_FALL; p.jumping = false; emit({ type: 'dive' }); }
  }
  if (p.slide > 0) {
    p.slide -= dt;
    if (p.slide <= 0) {
      // Never stand up into what is overhead.
      if (lowCeiling(p, roofs)) p.slide = dt;
      else { p.slide = 0; p.slideCooldown = SLIDE_COOLDOWN; }
    }
  } else if (p.ground && !p.crashed && p.slideBuffer > 0 && p.slideCooldown <= 0) {
    p.slide = SLIDE_TIME; p.slideBuffer = 0;
    emit({ type: 'slide' });
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
    if (inUpdraft(p, roofs)) p.vy = Math.max(-VENT_RISE, p.vy - UPDRAFT * dt);
    else {
      p.vy = Math.min(MAX_FALL, p.vy + g * dt);
      // A held glider, once the jump itself is spent, only drifts down.
      if (p.glideTime > 0 && input.held && !p.jumping && p.vy > GLIDE_FALL) p.vy = GLIDE_FALL;
    }
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
    p.vy = -STOMP_V; p.ground = null; p.coyote = 0; p.airTime = 0; p.landedFromAir = false; p.slide = 0;
    p.jumping = input.held; p.holdTime = SECOND_HOLD;
  };
  const remove = (id: number) => { p.gone = [...p.gone.slice(-39), id]; };

  if (p.ground) {
    const next = carry(p, roofs, overlaps(p, p.ground.x0, p.ground.x1));
    if (next) p.ground = next;
    if (next || overlaps(p, p.ground.x0, p.ground.x1)) {
      p.y = surfaceY(p.ground, p.x + PW / 2);
      p.lastRoofY = ['line', 'ac', 'tank', 'box'].includes(p.ground.kind) ? p.lastRoofY : p.y;
    } else {
      p.ground = null; p.coyote = COYOTE; p.airTime = 0; p.vy = 0; p.jumping = false; p.slide = 0;
    }
  } else if (!p.crashed) {
    // A ramp can also catch up with a fast runner who is still rising, so it counts then too.
    const s = findLanding(p, lifted ? p.y : prevFeet, lifted ? p.x : prevX, roofs, p.vy < 0);
    if (s && (s.kind === 'ac' || s.kind === 'box')) {
      // Landing on an outdoor unit or a crate from above smashes it.
      p.y = s.y;
      remove(s.id);
      bounce();
      emit({ type: 'stomp', id: s.id, target: s.kind, x: (s.x0 + s.x1) / 2, y: s.y });
    } else if (s) {
      const speed = p.vy;
      p.landedFromAir = p.airTime > 0.12;
      p.y = surfaceY(s, p.x + PW / 2);
      p.vy = 0; p.ground = s; p.jumping = false; p.groundTime = 0; p.airUsed = false; p.coyote = 0;
      if (s.kind !== 'line' && s.kind !== 'tank') p.lastRoofY = p.y;
      emit({ type: 'land', surface: s, speed });
    }
  }

  if (!p.crashed) passage(p, roofs, emit);
  if (!p.crashed) touchHazards(p, prevFeet, prevX, roofs, emit, bounce, remove);
  if (!p.crashed) traffic(p, roofs, emit);
  if (p.hook) hook(p, roofs, emit);
  if (p.y > p.lastRoofY + FALL_LIMIT) emit({ type: 'fell' });
}

/** A runner caught below the next roof's top, short of it, is pulled up onto it once. Never on a street. */
function hook(p: Player, roofs: readonly Roof[], emit: (e: PhysEvent) => void): void {
  if (p.ground || p.vy <= 0 || streetUnder(p, roofs)) return;
  const next = roofs.find((r) => r.x + r.w > p.x + PW);
  if (!next || p.x + PW - 2 > next.x || p.y <= next.y + 4) return;
  p.hook = false;
  p.y = next.y - 30; p.vy = -140; p.crashed = false; p.jumping = false;
  p.vx = Math.max(p.vx, paceSpeed(p.pace, p.x) * 0.8);
  p.lastRoofY = next.y; p.airUsed = false; p.airCooldown = 0;
  emit({ type: 'hooked', x: p.x + PW / 2, y: p.y - PH / 2, tx: next.x + 2, ty: next.y });
}

/** Breaking into a marked roof's passage, its ceiling, and coming out at the far end. */
function passage(p: Player, roofs: readonly Roof[], emit: (e: PhysEvent) => void): void {
  const c = p.x + PW / 2;
  for (const r of roofs) {
    const w = r.route;
    if (!w) continue;
    if (p.inside === r.id) {
      if (c >= w.rampEnd) {
        p.inside = 0; p.y = r.y; p.vy = 0; p.lastRoofY = r.y; p.jumping = false;
        p.ground = { id: r.id, kind: 'roof', x0: r.x, x1: r.x + r.w, y: r.y };
        emit({ type: 'breakout', x: p.x, y: p.y });
      } else if (c < w.rampStart && p.y - bodyHeight(p) < r.y + CEILING) {
        p.y = r.y + CEILING + bodyHeight(p); p.vy = Math.max(0, p.vy); p.jumping = false;
      }
    } else if (!p.inside && p.slide > 0 && p.ground?.id === r.id && p.ground.kind === 'roof' && c >= w.x && c <= w.x + w.hatch) {
      // Only a slide goes through the glass: running or jumping over it stays on the roof.
      p.inside = r.id; p.ground = null; p.slide = 0; p.coyote = 0; p.airTime = 0; p.jumping = false;
      p.y = r.y + CEILING + PH; p.vy = 60; p.lastRoofY = w.y;
      emit({ type: 'breakin', id: w.id, x: c, y: r.y });
    }
  }
}

function traffic(p: Player, roofs: readonly Roof[], emit: (e: PhysEvent) => void): void {
  // Back up on anything but the street: the next drop is a new arrival.
  if (p.road && p.ground && p.ground.kind !== 'road' && p.ground.kind !== 'ramp') { p.road = 0; p.spared = []; }
  for (const r of roofs) {
    const d = r.road;
    if (!d || p.x + PW < d.x || p.x > d.rampStart || p.y <= d.y - CAR_H * 2) continue;
    if (p.road !== d.id) { p.road = d.id; p.grace = ROAD_GRACE; p.spared = []; }
    const cars = roadCars(d, p.time);
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const hit = !(p.x + PW - 1 <= car.x || p.x + 1 >= car.x + car.w || p.y <= car.y || p.y - bodyHeight(p) + 1 >= car.y + car.h);
      if (!hit) { if (p.spared.includes(i)) p.spared = p.spared.filter((n) => n !== i); continue; }
      // A car met while arriving passes through, until the two have parted.
      if (p.grace > 0 || p.spared.includes(i)) { if (!p.spared.includes(i)) p.spared = [...p.spared, i]; continue; }
      // Cars are lethal even with a helmet; they cannot be stomped.
      p.crashed = true; p.vx = 0; p.jumping = false;
      emit({ type: 'trafficHit', x: p.x, y: p.y });
      return;
    }
  }
}

function touchHazards(
  p: Player, prevFeet: number, prevX: number, roofs: readonly Roof[], emit: (e: PhysEvent) => void,
  bounce: () => void, remove: (id: number) => void,
): void {
  const note = (id: number) => { p.passed = [...p.passed.slice(-39), id]; };
  const trip = (id: number, by: Extract<PhysEvent, { type: 'stumble' }>['by'], midair = false) => {
    if (p.shield) {
      p.shield = false;
      remove(id);
      emit({ type: 'shielded', id, x: p.x + PW / 2, y: p.y - PH / 2 });
      return;
    }
    p.lastHit = id; p.boost = 0;
    // Hit above a gap, speed is kept: it costs the combo, not the landing.
    if (!midair) { p.stumble = STUMBLE_TIME; p.vx *= STUMBLE_FACTOR; }
    emit({ type: 'stumble', id, by });
  };
  for (const r of roofs) {
    if (r.x > p.x + 300 || roofEnd(r) < p.x - 300) continue;
    for (const e of r.enemies) {
      if (p.gone.includes(e.id)) continue;
      const b = enemyBox(e, p.x), was = enemyBox(e, prevX);
      // A stomp is judged over the whole step: feet that were above the top and have reached it, on a slightly wider top.
      const stomped = !p.ground && p.vy > 0 && prevFeet <= was.y + STOMP_SLACK && p.y >= b.y
        && p.x + PW + STOMP_PAD > Math.min(b.x, was.x) && prevX - STOMP_PAD < Math.max(b.x, was.x) + b.w;
      if (stomped) {
        remove(e.id);
        p.y = Math.min(p.y, b.y);
        bounce();
        emit({ type: 'stomp', id: e.id, target: e.kind, x: b.x + b.w / 2, y: b.y });
        continue;
      }
      if (p.x + PW - 1 <= b.x || p.x + 1 >= b.x + b.w || p.y <= b.y || p.y - bodyHeight(p) + 2 >= b.y + b.h) continue;
      remove(e.id);
      if (p.stumble <= 0) trip(e.id, e.kind, e.over === true && !p.ground);
    }
    // Obstacle sides trip the runner once each, never while already stumbling.
    for (const o of r.obstacles) {
      if (p.gone.includes(o.id)) continue;
      const inside = p.inside === r.id;
      if (o.kind === 'bar' && p.under === o.id && p.x + 2 >= o.x + o.w) {
        // Out the other side without having touched it.
        p.under = 0;
        if (!p.passed.includes(o.id)) { note(o.id); emit({ type: 'dodge', id: o.id, inside, x: o.x + o.w / 2, y: o.y + o.h }); }
        continue;
      }
      if (p.x + PW - 2 <= o.x || p.x + 2 >= o.x + o.w) continue;
      const level = o.kind === 'box' ? p.y > o.y : p.y > o.y + LEDGE;
      if (o.kind === 'box' && p.slide > 0 && level && p.y - bodyHeight(p) < o.y + o.h) {
        remove(o.id);
        emit({ type: 'smash', id: o.id, inside, x: o.x + o.w / 2, y: o.y });
        continue;
      }
      if (!level || p.y - bodyHeight(p) >= o.y + o.h) {
        if (o.kind === 'bar' && p.slide > 0 && p.y > o.y + o.h) p.under = o.id;
        continue;
      }
      if (o.id === p.lastHit || p.stumble > 0) continue;
      note(o.id);
      trip(o.id, o.kind);
    }
  }
}
