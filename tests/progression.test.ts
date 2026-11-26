import { describe, expect, it } from 'vitest';
import { baseSpeed, jumpReach } from '../src/physics';
import { districtAt } from '../src/progression';
import { ENEMY_START, MAX_GAP_RATIO, World } from '../src/world';

const city = (seed: number) => { const w = new World(seed); w.ensure(0, 60_000); return w; };

describe('districts', () => {
  it('turn every 400 m and start a second lap at 2 km', () => {
    expect([0, 399, 400, 2000].map((m) => districtAt(m).index)).toEqual([0, 0, 1, 5]);
    expect([districtAt(0).kind, districtAt(400).kind, districtAt(2000).kind]).toEqual(['residential', 'construction', 'residential']);
    expect(districtAt(2000).lap).toBe(2);
  });
  it('build the same city from the same seed', () => {
    expect(city(7).roofs).toEqual(city(7).roofs);
  });
  it('never ask for more than a single jump gives, and start without enemies', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { roofs } = city(seed);
      for (const r of roofs) {
        const limit = Math.floor(jumpReach(baseSpeed(r.x + r.w), r.nextDy) * MAX_GAP_RATIO);
        // Street scaffolds and the shortest gaps have floors of their own.
        expect(r.gap).toBeLessThanOrEqual(Math.max(limit, r.road || r.kind === 'scaffold' ? 70 : 26));
        for (const e of r.enemies) expect(e.x).toBeGreaterThanOrEqual(ENEMY_START);
      }
    }
  });
});
