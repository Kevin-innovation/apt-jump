import { describe, expect, it } from 'vitest';
import { Bot } from '../src/bot';
import { Game, STOMP_POINTS } from '../src/game';
import {
  AIR_COOLDOWN, baseSpeed, DEFAULT_PACE, enemyBox, newPlayer, PH, PW, STEP, stepPlayer, type PhysEvent, type Player,
} from '../src/physics';
import { DIAMOND_HEIGHT, ENEMY_START, World, type Enemy, type Roof } from '../src/world';

const idle = { pressed: false, held: false };
const roof = (x: number, w: number, y: number, extra: Partial<Roof> = {}): Roof => ({
  id: x + 1000, kind: 'building', x, w, y, style: 0, seed: 1, number: 101, obstacles: [], lines: [], coins: [], powers: [], enemies: [],
  road: null, gap: 0, nextDy: 0, ...extra,
});
function grounded(roofs: Roof[], x = 0): Player {
  const p = newPlayer(x, 0);
  for (let i = 0; i < 30; i++) stepPlayer(p, idle, roofs, () => {});
  expect(p.ground).not.toBeNull();
  return p;
}
const bare = (): Game => {
  const g = new Game(3);
  for (const r of g.world.roofs) { r.coins = []; r.powers = []; r.obstacles = []; r.lines = []; r.enemies = []; }
  g.drain();
  return g;
};

describe('stomp', () => {
  const unit = { id: 7, kind: 'ac' as const, x: 190, y: -11, w: 16, h: 11 };
  function approach(jumpAt: number, hold: number) {
    const roofs = [roof(-100, 5000, 0, { obstacles: [unit] })];
    const p = grounded(roofs);
    const ev: PhysEvent[] = [];
    let pressed = -1;
    for (let i = 0; i < 260; i++) {
      const press = pressed < 0 && p.x >= jumpAt;
      if (press) pressed = i;
      stepPlayer(p, { pressed: press, held: pressed >= 0 && (i - pressed) * STEP < hold }, roofs, (e) => ev.push(e));
    }
    return { ev, p };
  }
  it('from above smashes the unit and bounces', () => {
    // Find a jump that comes down on it.
    const hits = [];
    for (let x = 60; x < 180; x += 4) { const r = approach(x, 0.3); if (r.ev.some((e) => e.type === 'stomp')) hits.push(r); }
    expect(hits.length).toBeGreaterThan(2);
    for (const r of hits) {
      expect(r.ev.some((e) => e.type === 'stumble')).toBe(false);
      expect(r.p.gone).toContain(7);
      expect(r.ev.filter((e) => e.type === 'land').length).toBeGreaterThan(0);
    }
  });
  it('from the side stumbles and leaves the unit standing', () => {
    const r = approach(9999, 0);
    expect(r.ev.filter((e) => e.type === 'stumble')).toHaveLength(1);
    expect(r.ev.some((e) => e.type === 'stomp')).toBe(false);
    expect(r.p.gone).not.toContain(7);
  });
  it('launches upward straight after contact', () => {
    const roofs = [roof(-100, 5000, 0, { obstacles: [{ ...unit, x: 0, w: 400 }] })];
    const p = newPlayer(20, -40);
    let up = 0;
    for (let i = 0; i < 60; i++) stepPlayer(p, idle, roofs, (e) => { if (e.type === 'stomp') up = p.vy; });
    expect(up).toBeLessThan(-150);
  });
  it('scores and adds to the combo once', () => {
    const g = bare();
    g.world.roofs[0]!.obstacles.push({ id: 9001, kind: 'ac', x: g.player.x, y: -11, w: 120, h: 11 });
    g.player.ground = null;
    g.player.y = -40;
    for (let i = 0; i < 60; i++) g.step(idle);
    expect(g.stomps).toBe(1);
    expect(g.bonus).toBe(STOMP_POINTS.ac);
    expect(g.combo).toBe(1);
  });
  it('never breaks a water tank', () => {
    const roofs = [roof(-100, 5000, 0, { obstacles: [{ id: 8, kind: 'tank', x: 0, y: -31, w: 300, h: 31 }] })];
    const p = newPlayer(20, -60);
    const ev: string[] = [];
    for (let i = 0; i < 60; i++) stepPlayer(p, idle, roofs, (e) => ev.push(e.type));
    expect(ev).toEqual(['land']);
  });
});

describe('air jump', () => {
  const flat = [roof(-100, 50000, 0)];
  function jumpTwice() {
    const p = grounded(flat);
    const ev: string[] = [];
    let top = 0;
    for (let i = 0; i < 130; i++) {
      stepPlayer(p, { pressed: i === 0 || i === 45, held: true }, flat, (e) => ev.push(e.type));
      top = Math.max(top, -p.y);
    }
    return { p, ev, top };
  }
  it('gives one extra rise per airtime', () => {
    const p = grounded(flat);
    const ev: string[] = [];
    for (let i = 0; i < 80; i++) stepPlayer(p, { pressed: i === 0 || i === 40 || i === 60, held: true }, flat, (e) => ev.push(e.type));
    expect(ev.filter((e) => e === 'airjump')).toHaveLength(1);
    expect(jumpTwice().top).toBeGreaterThan(100);
  });
  it('waits out its cooldown, counted on the ground too', () => {
    const { p } = jumpTwice();
    while (!p.ground) stepPlayer(p, idle, flat, () => {});
    const tryAgain = () => {
      const ev: string[] = [];
      stepPlayer(p, { pressed: true, held: true }, flat, (e) => ev.push(e.type));
      for (let i = 0; i < 30; i++) stepPlayer(p, { pressed: false, held: true }, flat, (e) => ev.push(e.type));
      stepPlayer(p, { pressed: true, held: true }, flat, (e) => ev.push(e.type));
      while (!p.ground) stepPlayer(p, idle, flat, (e) => ev.push(e.type));
      return ev.includes('airjump');
    };
    expect(p.airCooldown).toBeGreaterThan(0.5);
    expect(tryAgain()).toBe(false);
    for (let i = 0; i < AIR_COOLDOWN / STEP; i++) stepPlayer(p, idle, flat, () => {});
    expect(p.airCooldown).toBe(0);
    expect(tryAgain()).toBe(true);
  });
  it('answers a press on the ground in its first step', () => {
    const p = grounded(flat), ev: string[] = [];
    stepPlayer(p, { pressed: true, held: true }, flat, (e) => ev.push(e.type));
    expect(ev).toContain('jump');
    expect(p.vy).toBeLessThan(0);
  });
  it('jumps in the air at once while still some way above a roof', () => {
    // About 67 ms from touching down.
    const p = grounded(flat), ev: string[] = [];
    Object.assign(p, { y: -10, vy: 120, ground: null, coyote: 0, airUsed: false, airCooldown: 0, jumping: false });
    stepPlayer(p, { pressed: true, held: true }, flat, (e) => ev.push(e.type));
    expect(ev).toEqual(['airjump']);
    expect(p.vy).toBeLessThan(0);
  });
  it('is not wasted by a press just above a roof', () => {
    const p = grounded(flat);
    const ev: string[] = [];
    stepPlayer(p, { pressed: true, held: false }, flat, () => {});
    let pressed = false;
    for (let i = 0; i < 80; i++) {
      const press: boolean = !pressed && p.vy > 0 && -p.y < p.vy * STEP * 1.5;
      pressed ||= press;
      stepPlayer(p, { pressed: press, held: false }, flat, (e) => ev.push(e.type));
    }
    expect(ev).not.toContain('airjump');
    expect(ev).toContain('jump');
  });
  it('is what a diamond needs', () => {
    const reach = (second: boolean) => {
      const p = grounded(flat);
      let top = 0;
      for (let i = 0; i < 150; i++) {
        stepPlayer(p, { pressed: i === 0 || (second && i === 48), held: true }, flat, () => {});
        top = Math.max(top, -p.y + PH + 6);
      }
      return top;
    };
    expect(reach(false)).toBeLessThan(DIAMOND_HEIGHT - 5);
    expect(reach(true)).toBeGreaterThan(DIAMOND_HEIGHT + 5);
  });
});

describe('speed', () => {
  it('climbs noticeably and stays under its ceiling', () => {
    const at = (m: number) => baseSpeed(m * 16);
    expect(at(250)).toBeGreaterThan(at(0) * 1.3);
    expect(at(1000)).toBeGreaterThan(at(0) * 1.65);
    for (let m = 0; m < 20000; m += 50) {
      expect(at(m + 50)).toBeGreaterThan(at(m));
      expect(at(m)).toBeLessThan(DEFAULT_PACE.base + DEFAULT_PACE.gain + 8 * DEFAULT_PACE.stageGain!);
    }
  });
});

describe('enemies', () => {
  const enemies = (seeds: number, to: number) => {
    const out: { e: Enemy; r: Roof }[] = [];
    for (let s = 1; s <= seeds; s++) { const w = new World(s); w.ensure(0, to); for (const r of w.roofs) for (const e of r.enemies) out.push({ e, r }); }
    return out;
  };
  it('stay away from the opening and grow more common', () => {
    const all = enemies(60, 40000);
    expect(Math.min(...all.map((a) => a.e.x))).toBeGreaterThan(ENEMY_START);
    const count = (a: number, b: number) => all.filter(({ e }) => e.x >= a && e.x < b).length;
    // Encounters per second matter: at late speeds, each kilometre is crossed much sooner.
    expect(count(30000, 34000) * baseSpeed(32000)).toBeGreaterThan(count(ENEMY_START, ENEMY_START + 4000) * baseSpeed(ENEMY_START + 2000) * 1.5);
    expect(all.some(({ e }) => e.kind === 'drone')).toBe(true);
    expect(all.some(({ e }) => e.kind === 'pigeon')).toBe(true);
  });

  it('can always be passed cleanly, with time to choose', () => {
    let worst = 99, n = 0;
    for (const { e, r } of enemies(30, 40000)) {
      const roofs = [{ ...r, obstacles: [], coins: [], enemies: [e], lines: [], road: null }];
      let ways = 0;
      // Staying down, or any of several jumps begun at different distances.
      for (const lead of [-1, 90, 75, 60, 45, 30]) for (const hold of [0.1, 0.3]) {
        const p = newPlayer(Math.max(r.x, e.x - 125), r.y);
        stepPlayer(p, idle, roofs, () => {});
        p.vx = baseSpeed(p.x);
        let bad = false, at = -1;
        for (let i = 0; i < 400 && p.x < e.x + 60; i++) {
          const press = at < 0 && lead > 0 && p.x >= e.x - lead;
          if (press) at = i;
          stepPlayer(p, { pressed: press, held: at >= 0 && (i - at) * STEP < hold }, roofs, (ev) => { if (ev.type === 'stumble') bad = true; });
        }
        if (!bad) ways++;
      }
      worst = Math.min(worst, ways);
      n++;
    }
    expect(n).toBeGreaterThan(50);
    expect(worst).toBeGreaterThanOrEqual(2); // Late difficulty narrows the window, but retains alternative clean jumps.
  });

  const pigeon: Enemy = { id: 5, kind: 'pigeon', x: 160, y: -13, amp: 0, phase: 0 };
  it('trip the runner from the side and are then gone', () => {
    const roofs = [roof(-100, 5000, 0, { enemies: [pigeon] })];
    const p = grounded(roofs);
    const ev: string[] = [];
    for (let i = 0; i < 240; i++) stepPlayer(p, idle, roofs, (e) => ev.push(e.type));
    expect(ev.filter((e) => e === 'stumble')).toHaveLength(1);
    expect(p.gone).toContain(5);
  });
  it('are beaten from above, for points', () => {
    let stomped = 0;
    for (let x = 30; x < 90; x += 3) {
      const roofs = [roof(-100, 5000, 0, { enemies: [{ ...pigeon, x }] })];
      const p = newPlayer(20, -50);
      const ev: string[] = [];
      for (let i = 0; i < 90; i++) stepPlayer(p, idle, roofs, (e) => ev.push(e.type));
      if (!ev.includes('stomp')) continue;
      stomped++;
      expect(ev).not.toContain('stumble');
      expect(p.gone).toContain(5);
    }
    expect(stomped).toBeGreaterThan(3);
  });
  it('move only with the runner, so a replay always matches', () => {
    expect(enemyBox(pigeon, 50)).toEqual(enemyBox(pigeon, 50));
    expect(enemyBox(pigeon, 50).x).toBeGreaterThan(pigeon.x);
    expect(Math.abs(enemyBox(pigeon, pigeon.x).x - pigeon.x)).toBeLessThan(PW);
  });
});

describe('street', () => {
  it('appears on some gaps only, each with a ramp that meets the next building', () => {
    let roads = 0, plain = 0;
    for (let s = 1; s <= 40; s++) {
      const w = new World(s);
      w.ensure(0, 30000);
      w.roofs.forEach((r, i) => {
        if (!r.road) { if (r.kind === 'building') plain++; return; }
        roads++;
        const d = r.road;
        const next = w.roofs.slice(i + 1).find((q) => q.kind === 'building')!;
        expect(w.roofs[i + 1]!.kind).toBe('scaffold');
        expect(d.rampEnd).toBe(next.x);
        expect(d.rampY).toBe(next.y);
        expect(d.rampStart - d.x).toBeGreaterThan(120);
        for (const q of w.roofs.slice(i + 1, w.roofs.indexOf(next))) expect(d.y - q.y).toBeGreaterThan(40);
      });
    }
    expect(roads).toBeGreaterThan(60);
    expect(plain).toBeGreaterThan(roads * 3);
  });

  it('catches a fall, and the ramp leads back to the roofs without a press', () => {
    let tried = 0;
    for (let s = 1; s <= 30; s++) {
      const w = new World(s);
      w.ensure(0, 12000);
      const i = w.roofs.findIndex((r) => r.road);
      const owner = w.roofs[i]!;
      const d = owner.road!;
      for (const r of w.roofs) { r.obstacles = []; r.enemies = []; if (r.road) r.road.traffic = false; }
      const p = newPlayer(owner.x + owner.w - 30, owner.y);
      const ev: string[] = [];
      let landed = '';
      for (let k = 0; k < 120 * 20 && p.x < d.rampEnd + 40; k++)
        stepPlayer(p, idle, w.roofs, (e) => { ev.push(e.type); if (e.type === 'land') landed = e.surface.kind; });
      expect(landed).toBe('road');
      expect(ev).not.toContain('fell');
      expect(ev).not.toContain('wall');
      expect(p.ground?.kind).toBe('roof');
      expect(p.y).toBe(d.rampY);
      tried++;
    }
    expect(tried).toBe(30);
  });

  it('can be jumped along without getting stuck', () => {
    for (let s = 1; s <= 10; s++) for (const every of [40, 70, 90, 110, 130, 160]) {
      const w = new World(s);
      w.ensure(0, 12000);
      const owner = w.roofs.find((r) => r.road)!;
      const d = owner.road!;
      for (const r of w.roofs) { r.obstacles = []; r.enemies = []; r.lines = []; if (r.road) r.road.traffic = false; }
      const p = newPlayer(owner.x + owner.w - 30, owner.y);
      let bad = '';
      for (let k = 0; k < 120 * 20 && p.x < d.rampEnd + 10 && !bad; k++) {
        const on = p.ground?.kind === 'road' || p.ground?.kind === 'ramp';
        stepPlayer(p, { pressed: on && k % every === 0, held: true }, w.roofs, (e) => { if (e.type === 'fell' || e.type === 'wall') bad = e.type; });
      }
      expect(bad).toBe('');
    }
  });
});

it('a demanding player uses every move and still survives', () => {
  let stomps = 0, diamonds = 0, deaths = 0;
  for (let s = 1; s <= 12; s++) {
    const g = new Game(s);
    const b = new Bot();
    b.want.add('stomp');
    b.wantDiamond = true;
    while (!g.dead && g.time < 90) { g.step(b.next(g)); g.drain(); }
    stomps += g.stomps; diamonds += g.diamonds; deaths += Number(g.dead);
  }
  expect(stomps).toBeGreaterThan(20);
  expect(diamonds).toBeGreaterThan(5);
  expect(deaths).toBeLessThanOrEqual(2);
}, 30_000);
