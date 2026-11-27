import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { isWeekKey, weekKey } from '../src/week';
import type { Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { weekCutoff } from './ranking';
import { credit } from './shop';

/** Coins for a week's first, second and third (a tie shares the place and its coins). */
export const PLACE_COINS = [5000, 3000, 2000] as const;
/** Coins for everyone who ran this many verified runs in the week. */
export const STEADY_COINS = 300;
export const STEADY_RUNS = 10;

/** The seven day keys of a week, from its Monday. */
function daysOf(week: string): string[] {
  const t = Date.parse(week);
  return Array.from({ length: 7 }, (_, i) => new Date(t + i * 86_400_000).toISOString().slice(0, 10));
}

/** Pays a finished week once: the places from its board, and the steady runners from their daily tallies. */
export async function payWeek(ctx: MutationCtx, week: string): Promise<number> {
  if (await ctx.db.query('weeklyRewards').withIndex('by_week', (q) => q.eq('week', week)).first()) return 0;
  const pay = new Map<Id<'users'>, { rank?: number; steady: boolean; coins: number }>();
  // The top three places, best first, a player once, equal scores sharing a place.
  const cutoff = await weekCutoff(ctx, week);
  const seen = new Set<Id<'users'>>();
  let place = 0, last = -1, count = 0;
  for await (const r of ctx.db.query('scores').withIndex('by_week_score', (q) => q.eq('week', week)).order('desc')) {
    if (r.achievedAt < cutoff || seen.has(r.userId)) continue;
    seen.add(r.userId);
    count++;
    if (r.score !== last) { place = count; last = r.score; }
    if (place > PLACE_COINS.length) break;
    pay.set(r.userId, { rank: place, steady: false, coins: PLACE_COINS[place - 1]! });
  }
  // Steady runners: verified runs over the week's seven days.
  const days = new Set(daysOf(week));
  const runs = new Map<Id<'users'>, number>();
  for await (const d of ctx.db.query('dailyProgress')) if (days.has(d.day)) runs.set(d.userId, (runs.get(d.userId) ?? 0) + d.runs);
  for (const [userId, n] of runs) {
    if (n < STEADY_RUNS) continue;
    const p = pay.get(userId) ?? { steady: false, coins: 0 };
    pay.set(userId, { ...p, steady: true, coins: p.coins + STEADY_COINS });
  }
  for (const [userId, p] of pay) {
    await credit(ctx, userId, p.coins);
    await ctx.db.insert('weeklyRewards', { week, userId, ...(p.rank ? { rank: p.rank } : {}), steady: p.steady, coins: p.coins, seen: false });
  }
  return pay.size;
}

/**
 * Run by the cron just after Monday 00:00 in Korea: pays the week that has just ended. An operator may name a
 * finished week (one the cron missed); a week still under way is never paid.
 */
export const payLastWeek = internalMutation({
  args: { week: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, { week }) => {
    const ended = weekKey(Date.now() - 6 * 3_600_000);
    if (week !== undefined && (!isWeekKey(week) || week > ended || week === weekKey(Date.now()))) throw new ConvexError('끝난 주만 정산할 수 있습니다.');
    return payWeek(ctx, week ?? ended);
  },
});

const reward = v.object({ week: v.string(), rank: v.union(v.null(), v.number()), steady: v.boolean(), coins: v.number() });

/** Week rewards the signed-in player hasn't been told about yet. */
export const unseen = query({
  args: {},
  returns: v.array(reward),
  handler: async (ctx) => {
    const id = (await getAuthUserId(ctx)) as Id<'users'> | null;
    if (!id) return [];
    const rows = await ctx.db.query('weeklyRewards').withIndex('by_user_seen', (q) => q.eq('userId', id).eq('seen', false)).take(10);
    return rows.map((r) => ({ week: r.week, rank: r.rank ?? null, steady: r.steady, coins: r.coins }));
  },
});

/** The player has seen their rewards. */
export const markSeen = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const id = (await getAuthUserId(ctx)) as Id<'users'> | null;
    if (!id) return null;
    for (const r of await ctx.db.query('weeklyRewards').withIndex('by_user_seen', (q) => q.eq('userId', id).eq('seen', false)).take(10)) await ctx.db.patch(r._id, { seen: true });
    return null;
  },
});
