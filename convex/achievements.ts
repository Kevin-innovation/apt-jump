import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import {
  ACHIEVEMENTS, PARTICIPANTS_KEY, TITLES, achievementValue, countKey,
  type AchievementTotals, type VerifiedRunStats,
} from '../src/achievements';
import type { Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requirePlayer } from './users';

/** Only the replay verifier supplies these numbers; clamp junk rather than trusting it. */
const clean = (n: number): number => Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

const progressOf = async (ctx: QueryCtx | MutationCtx, userId: Id<'users'>) =>
  ctx.db.query('achievementProgress').withIndex('by_user', (q) => q.eq('userId', userId)).unique();

const unlocksOf = async (ctx: QueryCtx | MutationCtx, userId: Id<'users'>) =>
  (await ctx.db.query('achievementUnlocks').withIndex('by_user', (q) => q.eq('userId', userId)).collect())
    .map((row) => row.achievementId);

const countOf = async (ctx: QueryCtx | MutationCtx, key: string) =>
  (await ctx.db.query('achievementCounts').withIndex('by_key', (q) => q.eq('key', key)).unique())?.count ?? 0;

async function bump(ctx: MutationCtx, key: string, by: number): Promise<void> {
  const row = await ctx.db.query('achievementCounts').withIndex('by_key', (q) => q.eq('key', key)).unique();
  if (row) await ctx.db.patch(row._id, { count: row.count + by });
  else await ctx.db.insert('achievementCounts', { key, count: by });
}

interface ProgressRow {
  runs: number; slides: number; stomps: number; perfects: number;
  maxScore: number; maxDistance: number; maxCombo: number;
}
const totalsOf = (row: ProgressRow): AchievementTotals => ({
  runs: row.runs, slides: row.slides, stomps: row.stomps, perfects: row.perfects,
  score: row.maxScore, distance: row.maxDistance, maxCombo: row.maxCombo,
});

/**
 * Called by ranking.settle with stats computed from a replay, never by a public mutation.
 * Ranking's own run state is what prevents settling the same run twice.
 */
export async function awardVerified(ctx: MutationCtx, userId: Id<'users'>, stats: VerifiedRunStats): Promise<void> {
  const row = await progressOf(ctx, userId);
  const value = {
    runs: (row?.runs ?? 0) + 1,
    slides: (row?.slides ?? 0) + clean(stats.slides),
    stomps: (row?.stomps ?? 0) + clean(stats.stomps),
    perfects: (row?.perfects ?? 0) + clean(stats.perfects),
    maxScore: Math.max(row?.maxScore ?? 0, clean(stats.score)),
    maxDistance: Math.max(row?.maxDistance ?? 0, clean(stats.distance)),
    maxCombo: Math.max(row?.maxCombo ?? 0, clean(stats.maxCombo)),
  };
  if (row) await ctx.db.patch(row._id, value);
  else {
    await ctx.db.insert('achievementProgress', { userId, ...value });
    // The denominator is verified players, counted once, at their first verified run.
    await bump(ctx, PARTICIPANTS_KEY, 1);
  }

  const have = new Set(await unlocksOf(ctx, userId));
  const totals = totalsOf(value);
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id) || achievementValue(a, totals) < a.goal) continue;
    await ctx.db.insert('achievementUnlocks', { userId, achievementId: a.id });
    await bump(ctx, countKey(a.id), 1);
  }
}

const entry = v.object({
  id: v.string(), name: v.string(), description: v.string(), unlocked: v.boolean(),
  progress: v.number(), goal: v.number(), earned: v.number(), percent: v.number(),
});

/** Public catalogue: guests may browse, but only the signed-in player's own row is shown. */
export const catalog = query({
  args: {},
  returns: v.object({
    participants: v.number(), achievements: v.array(entry),
    titles: v.array(v.object({ id: v.string(), name: v.string(), unlocked: v.boolean() })),
    equipped: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const id = (await getAuthUserId(ctx)) as Id<'users'> | null;
    const user = id ? await ctx.db.get(id) : null;
    const eligible = !!user?.nickname && !user.suspended;
    const [row, unlocked, counts, participants] = await Promise.all([
      eligible ? progressOf(ctx, id!) : Promise.resolve(null),
      eligible ? unlocksOf(ctx, id!) : Promise.resolve([] as string[]),
      ctx.db.query('achievementCounts').withIndex('by_key').collect(),
      countOf(ctx, PARTICIPANTS_KEY),
    ]);
    const have = new Set(unlocked);
    const earned = new Map(counts.map((c) => [c.key, c.count]));
    const totals = row ? totalsOf(row) : null;
    return {
      participants,
      achievements: ACHIEVEMENTS.map((a) => {
        const count = earned.get(countKey(a.id)) ?? 0;
        return {
          id: a.id, name: a.name, description: a.description,
          unlocked: have.has(a.id),
          progress: totals ? achievementValue(a, totals) : 0,
          goal: a.goal, earned: count,
          // Two decimals, so a single earner among many is never shown as 0%.
          percent: participants > 0 ? Math.round((count / participants) * 10000) / 100 : 0,
        };
      }),
      titles: TITLES.map((t) => ({ id: t.id, name: t.name, unlocked: t.requires.every((need) => have.has(need)) })),
      equipped: eligible && typeof user?.equippedTitle === 'string' ? user.equippedTitle : null,
    };
  },
});

/** Equips an earned title, or clears it with null. Requires a playable account. */
export const equip = mutation({
  args: { titleId: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { titleId }) => {
    const userId = await requirePlayer(ctx);
    if (titleId === null) {
      await ctx.db.patch(userId, { equippedTitle: undefined });
      return null;
    }
    const title = TITLES.find((t) => t.id === titleId);
    if (!title) throw new ConvexError('알 수 없는 칭호입니다.');
    const have = new Set(await unlocksOf(ctx, userId));
    if (!title.requires.every((need) => have.has(need))) throw new ConvexError('아직 얻지 못한 칭호입니다.');
    await ctx.db.patch(userId, { equippedTitle: title.id });
    return null;
  },
});
