// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { MutationCtx } from '../convex/_generated/server';
import schema from '../convex/schema';
import { awardVerified } from '../convex/achievements';
import { ACHIEVEMENTS, TITLES, type VerifiedRunStats } from '../src/achievements';

// Same identity shortcut as the other Convex tests; the real auth flows live in auth.test.ts.
vi.mock('@convex-dev/auth/server', async (original) => ({
  ...(await original<object>()),
  getAuthUserId: async (ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) =>
    (await ctx.auth.getUserIdentity())?.subject ?? null,
}));

const modules = import.meta.glob('../convex/**/*.{ts,js}');
// api.d.ts is generated without the new module until codegen runs; runtime anyApi resolves it.
const ach = (api as any).achievements;

const HIGH: VerifiedRunStats = { score: 12000, distance: 1200, slides: 6, stomps: 11, maxCombo: 21, perfects: 10 };
const LOW: VerifiedRunStats = { score: 100, distance: 100, slides: 0, stomps: 0, maxCombo: 1, perfects: 0 };

async function setup() {
  const t = convexTest(schema, modules);
  const player = async (fields: Record<string, unknown> = {}) => {
    const id = await t.run((ctx) => ctx.db.insert('users', { nickname: '테스터', nickKey: 'tester', ...fields } as never));
    return { id, as: t.withIdentity({ subject: id }) };
  };
  const award = (p: { id: string }, stats: VerifiedRunStats) =>
    t.run((ctx) => awardVerified(ctx as unknown as MutationCtx, p.id as Id<'users'>, stats));
  return { t, player, award };
}

describe('achievements', () => {
  it('refuses forged claims and players who cannot play', async () => {
    const { t, player } = await setup();
    const guest = await t.query(ach.catalog, {});
    expect(ACHIEVEMENTS).toHaveLength(80);
    expect(TITLES).toHaveLength(57);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(80);
    expect(new Set(TITLES.map((x) => x.id)).size).toBe(57);
    expect(new Set(TITLES.map((x) => x.name)).size).toBe(57);
    // Players have these equipped: they must keep existing.
    const stats = ['runs', 'score', 'distance', 'slides', 'stomps', 'maxCombo', 'perfects'];
    const kept = ['runner', 'slipper', 'legend', 'runs-tier7', ...stats.flatMap((s) => [1, 3, 5].map((n) => `${s}-tier${n}`)),
      ...[1, 2, 3, 4, 5].map((n) => `all-rounder-${n}`)];
    expect(kept).toHaveLength(30);
    expect(TITLES.map((x) => x.id)).toEqual(expect.arrayContaining(kept));
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(TITLES.every((x) => x.requires.every((need) => ids.has(need)))).toBe(true);
    expect(guest.achievements).toHaveLength(80);
    expect(guest.titles).toHaveLength(57);
    expect(guest.participants).toBe(0);
    expect(guest.achievements.find((a: { id: string }) => a.id === 'first-run'))
      .toMatchObject({ unlocked: false, progress: 0, earned: 0, percent: 0 });
    expect(guest.titles.every((x: { unlocked: boolean }) => !x.unlocked)).toBe(true);
    await expect(t.mutation(ach.equip, { titleId: 'runner' })).rejects.toThrow('로그인');

    const bare = await player({ nickname: undefined, nickKey: undefined });
    await expect(bare.as.mutation(ach.equip, { titleId: 'runner' })).rejects.toThrow('닉네임');
    const banned = await player({ suspended: true });
    await expect(banned.as.mutation(ach.equip, { titleId: 'runner' })).rejects.toThrow('정지');
    const a = await player();
    await expect(a.as.mutation(ach.equip, { titleId: 'not-a-title' })).rejects.toThrow('알 수 없는');
    await expect(a.as.mutation(ach.equip, { titleId: 'legend' })).rejects.toThrow('아직 얻지 못한');
  });

  it('accumulates only verified runs and counts each player and unlock once', async () => {
    const { t, player, award } = await setup();
    const a = await player(), b = await player();
    await award(a, HIGH);
    await award(a, HIGH); // a second verified run: totals grow, unlocks and denominator do not
    await award(b, LOW);
    const own = await a.as.query(ach.catalog, {});
    const row = await t.run((ctx) => ctx.db.query('achievementProgress').withIndex('by_user', (q) => q.eq('userId', a.id)).unique());
    expect(row).toMatchObject({ runs: 2, slides: 12, stomps: 22, perfects: 20, maxScore: 12000, maxDistance: 1200, maxCombo: 21 });
    expect(own.achievements.find((x: { id: string }) => x.id === 'slide-10')).toMatchObject({ unlocked: true, progress: 10 });
    expect(own.participants).toBe(2);

    const list = (await t.query(ach.catalog, {})).achievements;
    expect(list.find((x: { id: string }) => x.id === 'first-run')).toMatchObject({ earned: 2, percent: 100 });
    expect(list.find((x: { id: string }) => x.id === 'slide-10')).toMatchObject({ earned: 1, percent: 50 });
    expect(list.find((x: { id: string }) => x.id === 'score-10000')).toMatchObject({ earned: 1, percent: 50 });
    expect((await b.as.query(ach.catalog, {})).achievements.find((x: { id: string }) => x.id === 'slide-10'))
      .toMatchObject({ unlocked: false });

    const c = await player();
    await award(c, LOW);
    const rare = await t.query(ach.catalog, {});
    expect(rare.participants).toBe(3);
    expect(rare.achievements.find((x: { id: string }) => x.id === 'score-10000'))
      .toMatchObject({ earned: 1, percent: 33.33 });
  });

  it('unlocks titles from earned achievements and equips only those', async () => {
    const { player, award } = await setup();
    const a = await player();
    await award(a, { ...HIGH, slides: 12 }); // one verified run that clears the original goals
    const before = await a.as.query(ach.catalog, {});
    for (const id of ['runner', 'slipper', 'legend', 'all-rounder-1']) {
      expect(before.titles.find((x: { id: string }) => x.id === id)).toMatchObject({ unlocked: true });
    }
    expect(before.titles.find((x: { id: string }) => x.id === 'all-rounder-5')).toMatchObject({ unlocked: false });
    for (let i = 0; i < 9; i++) await award(a, HIGH); // ten verified runs unlock the third runs tier
    const after = await a.as.query(ach.catalog, {});
    expect(after.titles.find((x: { id: string }) => x.id === 'runs-tier3')).toMatchObject({ unlocked: true });
    expect(after.equipped).toBeNull();
    expect(await a.as.mutation(ach.equip, { titleId: 'legend' })).toBeNull();
    expect((await a.as.query(ach.catalog, {})).equipped).toBe('legend');
    expect(await a.as.mutation(ach.equip, { titleId: null })).toBeNull();
    expect((await a.as.query(ach.catalog, {})).equipped).toBeNull();
  });
});
