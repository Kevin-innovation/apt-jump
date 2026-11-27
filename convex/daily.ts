import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import type { VerifiedRunStats } from '../src/achievements';
import { dailyMissions, dayBefore, dayKey, EMPTY_TALLY, streakReward, type DailyTally } from '../src/daily';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { credit } from './shop';
import { requirePlayer } from './users';

// Attendance and the day's missions. The server's clock decides the day; only verified runs count.

const clean = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const progressOf = (ctx: QueryCtx | MutationCtx, userId: Id<'users'>, day: string) =>
  ctx.db.query('dailyProgress').withIndex('by_user_day', (q) => q.eq('userId', userId).eq('day', day)).unique();
const tallyOf = (row: Doc<'dailyProgress'> | null): DailyTally => row
  ? { runs: row.runs, distance: row.distance, perfects: row.perfects, stomps: row.stomps, slides: row.slides, coins: row.coins, bestScore: row.bestScore }
  : EMPTY_TALLY;
/** The streak a check-in today would make. */
const nextStreak = (user: Doc<'users'>, today: string) => (user.checkInDay === dayBefore(today) ? (user.streak ?? 0) + 1 : 1);

const mission = v.object({ id: v.string(), text: v.string(), goal: v.number(), progress: v.number(), reward: v.number(), done: v.boolean() });

/** Today's attendance and missions for the signed-in player; null for a guest. */
export const mine = query({
  args: {},
  returns: v.union(v.null(), v.object({
    day: v.string(), checkedIn: v.boolean(), streak: v.number(), reward: v.number(), missions: v.array(mission),
  })),
  handler: async (ctx) => {
    const id = (await getAuthUserId(ctx)) as Id<'users'> | null;
    const user = id && (await ctx.db.get(id));
    if (!user?.nickname) return null;
    const day = dayKey(Date.now());
    const row = await progressOf(ctx, user._id, day);
    const tally = tallyOf(row), paid = new Set(row?.paid ?? []);
    const checkedIn = user.checkInDay === day;
    // Checked in: the streak so far; not yet: the one today would make, and what it pays.
    const streak = checkedIn ? user.streak ?? 1 : nextStreak(user, day);
    return {
      day, checkedIn, streak, reward: streakReward(streak),
      missions: dailyMissions(day).map((m) => ({ id: m.id, text: m.text, goal: m.goal, reward: m.reward, progress: Math.min(m.goal, tally[m.stat]), done: paid.has(m.id) })),
    };
  },
});

/** Claims today's attendance: once a day, more for each day in a row. */
export const checkIn = mutation({
  args: {},
  returns: v.object({ streak: v.number(), reward: v.number() }),
  handler: async (ctx) => {
    const userId = await requirePlayer(ctx);
    const user = (await ctx.db.get(userId))!;
    const day = dayKey(Date.now());
    if (user.checkInDay === day) throw new ConvexError('오늘 출석 보상은 이미 받았어요.');
    const streak = nextStreak(user, day), reward = streakReward(streak);
    await ctx.db.patch(userId, { checkInDay: day, streak });
    await credit(ctx, userId, reward);
    return { streak, reward };
  },
});

/**
 * Adds a verified run to the day's tally and pays any mission it completes. Called by ranking.settle once per run.
 * Returns the missions completed just now.
 */
export async function recordDaily(ctx: MutationCtx, userId: Id<'users'>, stats: VerifiedRunStats, coins: number): Promise<{ text: string; reward: number }[]> {
  const day = dayKey(Date.now());
  const row = await progressOf(ctx, userId, day);
  const before = tallyOf(row);
  const tally: DailyTally = {
    runs: before.runs + 1, distance: before.distance + clean(stats.distance), perfects: before.perfects + clean(stats.perfects),
    stomps: before.stomps + clean(stats.stomps), slides: before.slides + clean(stats.slides), coins: before.coins + clean(coins),
    bestScore: Math.max(before.bestScore, clean(stats.score)),
  };
  const paid = new Set(row?.paid ?? []), done: { text: string; reward: number }[] = [];
  for (const m of dailyMissions(day)) {
    if (paid.has(m.id) || tally[m.stat] < m.goal) continue;
    paid.add(m.id);
    await credit(ctx, userId, m.reward);
    done.push({ text: m.text, reward: m.reward });
  }
  if (row) await ctx.db.patch(row._id, { ...tally, paid: [...paid] });
  else await ctx.db.insert('dailyProgress', { userId, day, ...tally, paid: [...paid] });
  return done;
}
