import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { achievementById, titleById } from '../src/achievements';
import { STEP } from '../src/physics';
import { MAX_REPLAY, pauseAllowanceMs, releasedSeeds, SEGMENT_SEEDS, SIM_VERSION, verifyReplay } from '../src/replay';
import { isWeekKey, weekKey } from '../src/week';
import { awardVerified } from './achievements';
import { credit } from './shop';
import { recordDaily } from './daily';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, mutation, query, type QueryCtx, type MutationCtx } from './_generated/server';
import { requirePlayer, requireUser, touch } from './users';

export const TOP = 50;
/** Ranks past this are shown as "this or lower". */
const RANK_CAP = 1000;
const RUN_LIFE = 2 * 3_600_000;
const START_WINDOW = 10 * 60_000;
const STARTS_PER_WINDOW = 60;
/** Clock and network slack when comparing a run's length with the time it took. */
const SLACK = 4000;
/** The page waits longer than this for a run (START_WAIT in main.ts). */
const MANIFEST_WAIT = 4000;

const RESTARTED = '이번 주 순위가 새로 시작됐어요. 다시 달려 주세요.';

const state = (ctx: QueryCtx | MutationCtx) => ctx.db.query('leaderboardState').withIndex('by_key', q => q.eq('key', 'current')).unique();
async function activeRelease(ctx: QueryCtx | MutationCtx): Promise<string> {
  return (await state(ctx))?.release ?? 'initial';
}
/** Records of `week` achieved before this don't count: 0 unless an operator started that week afresh. */
export async function weekCutoff(ctx: QueryCtx | MutationCtx, week: string): Promise<number> {
  const s = await state(ctx);
  return s?.resetWeek === week ? s.resetAt ?? 0 : 0;
}
/** Whether a run was issued before the latest fresh start, and so can't be handed in. */
async function outdated(ctx: MutationCtx, startedAt: number): Promise<boolean> {
  return startedAt < ((await state(ctx))?.resetAt ?? 0);
}

/**
 * Starts the running week's board afresh, once. For the operator only, from the CLI: no page can call it, and no deploy
 * or release does. Nothing is deleted. Runs issued earlier can no longer be handed in.
 *   npx convex run ranking:resetCurrentWeek '{"week":"YYYY-MM-DD"}' --prod
 * `week` must name the week now running (its Monday in Korea). Asking again changes nothing.
 */
export const resetCurrentWeek = internalMutation({
  args: { week: v.string() },
  returns: v.object({ week: v.string(), resetAt: v.number(), applied: v.boolean() }),
  handler: async (ctx, { week }) => {
    const now = Date.now();
    if (week !== weekKey(now)) throw new ConvexError(`이번 주(${weekKey(now)})만 초기화할 수 있습니다.`);
    const old = await state(ctx);
    if (old?.resetWeek === week) return { week, resetAt: old.resetAt!, applied: false };
    if (old) await ctx.db.patch(old._id, { resetWeek: week, resetAt: now });
    else await ctx.db.insert('leaderboardState', { key: 'current', release: 'initial', builtAt: 0, resetWeek: week, resetAt: now });
    return { week, resetAt: now, applied: true };
  },
});

/**
 * Notes the newest production release, for the page's update notice; the ranking doesn't depend on it. Only this
 * server's trusted manifest is read: clients supply no release id.
 */
export const syncRelease = action({
  args: {},
  returns: v.object({ id: v.string(), builtAt: v.number() }),
  handler: async (ctx): Promise<{ id: string; builtAt: number }> => {
    const response = await fetch('https://apt-jump-wine.vercel.app/version.json', { cache: 'no-store', signal: AbortSignal.timeout(MANIFEST_WAIT) });
    if (!response.ok) throw new ConvexError('새 버전을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string' || !/^[a-f0-9]{12}-[a-z0-9]+$/.test(data.id)) throw new ConvexError('새 버전 정보를 확인하지 못했습니다.');
    const builtAt = parseInt(data.id.slice(data.id.lastIndexOf('-') + 1), 36);
    if (!Number.isSafeInteger(builtAt) || builtAt < 1 || builtAt > Date.now() + 60_000) throw new ConvexError('새 버전 시간이 잘못되었습니다.');
    return await ctx.runMutation(internal.ranking.activateRelease, { id: data.id, builtAt });
  },
});

export const activateRelease = internalMutation({
  args: { id: v.string(), builtAt: v.number() },
  returns: v.object({ id: v.string(), builtAt: v.number() }),
  handler: async (ctx, { id, builtAt }) => {
    const old = await ctx.db.query('leaderboardState').withIndex('by_key', q => q.eq('key', 'current')).unique();
    // A delayed response from an older deployment must not replace a newer one.
    if (old && old.builtAt >= builtAt) return { id: old.release, builtAt: old.builtAt };
    if (old) await ctx.db.patch(old._id, { release: id, builtAt });
    else await ctx.db.insert('leaderboardState', { key: 'current', release: id, builtAt });
    return { id, builtAt };
  },
});

/** A player's highest row of a week among those that count. */
async function bestOf(ctx: QueryCtx | MutationCtx, week: string, userId: Id<'users'>, cutoff: number) {
  for await (const r of ctx.db.query('scores').withIndex('by_week_user_score', (q) => q.eq('week', week).eq('userId', userId)).order('desc'))
    if (r.achievedAt >= cutoff) return r;
  return null;
}

export const clock = mutation({ args: {}, returns: v.number(), handler: async () => Date.now() });

/** Issues a run: the server picks the city, and starts timing. Only the first stretches are known at the start. */
export const start = mutation({
  args: { version: v.number() },
  returns: v.object({ runId: v.id('runs'), seed: v.number(), seeds: v.array(v.number()) }),
  handler: async (ctx, { version }) => {
    const userId = await requirePlayer(ctx);
    if (version !== SIM_VERSION) throw new ConvexError('게임이 업데이트되었습니다. 새로고침해 주세요.');
    const now = Date.now();
    const recent = await ctx.db.query('runs').withIndex('by_user_started', (q) => q.eq('userId', userId)).order('desc').take(STARTS_PER_WINDOW);
    if (recent.length >= STARTS_PER_WINDOW && recent[recent.length - 1]!.startedAt > now - START_WINDOW)
      throw new ConvexError('너무 자주 시작했습니다. 잠시 뒤 다시 해 주세요.');
    // Only the newest run counts, and a few old rows are cleared as new ones come.
    for (const r of recent) if (r.status === 'open') await ctx.db.patch(r._id, { status: 'rejected' });
    const old = await ctx.db.query('runs').withIndex('by_user_started', (q) => q.eq('userId', userId).lt('startedAt', now - 24 * 3_600_000)).take(5);
    for (const r of old) await ctx.db.delete(r._id);
    const seeds = Array.from({ length: SEGMENT_SEEDS }, () => Math.floor(Math.random() * 2 ** 31));
    const seed = seeds[0]!;
    const release = await activeRelease(ctx);
    const runId = await ctx.db.insert('runs', { userId, seed, seeds, version, release, startedAt: now, status: 'open' });
    await touch(ctx, userId, true);
    const day = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
    const today = await ctx.db.query('dailyStats').withIndex('by_day', (q) => q.eq('day', day)).unique();
    if (today) await ctx.db.patch(today._id, { plays: today.plays + 1 });
    else await ctx.db.insert('dailyStats', { day, plays: 1 });
    return { runId, seed, seeds: seeds.slice(0, releasedSeeds(0)) };
  },
});

/** The stretch seeds of an open run released so far: one more every few seconds, never ahead of the clock. */
export const seeds = mutation({
  args: { runId: v.id('runs') },
  returns: v.array(v.number()),
  handler: async (ctx, { runId }) => {
    const userId = await requireUser(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== userId || run.status !== 'open' || !run.seeds) throw new ConvexError('기록을 찾을 수 없습니다.');
    return run.seeds.slice(0, releasedSeeds(Date.now() - run.startedAt));
  },
});

/** Takes a run out of circulation before anything is computed, so it can't be handed in twice. */
export const claim = internalMutation({
  args: { runId: v.id('runs') },
  returns: v.object({ seed: v.number(), seeds: v.union(v.null(), v.array(v.number())), elapsed: v.number() }),
  handler: async (ctx, { runId }) => {
    const userId = await requireUser(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== userId) throw new ConvexError('기록을 찾을 수 없습니다.');
    if (run.status !== 'open') throw new ConvexError('이미 제출했거나 무효가 된 기록입니다.');
    if (await outdated(ctx, run.startedAt)) throw new ConvexError(RESTARTED);
    const elapsed = Date.now() - run.startedAt;
    // -1: too old to check; -2: begun before a change to how runs play, so it can't be checked the same way.
    const late = elapsed > RUN_LIFE, stale = run.version !== SIM_VERSION;
    await ctx.db.patch(runId, { status: 'claimed' });
    return { seed: run.seed, seeds: run.seeds ?? null, elapsed: stale ? -2 : late ? -1 : elapsed };
  },
});

const runStats = v.object({ score: v.number(), distance: v.number(), slides: v.number(), stomps: v.number(), maxCombo: v.number(), perfects: v.number() });

export const settle = internalMutation({
  args: { runId: v.id('runs'), result: v.union(v.null(), v.object({ score: v.number(), distance: v.number(), stats: v.optional(runStats), coins: v.optional(v.number()) })) },
  returns: v.object({ best: v.boolean(), daily: v.array(v.object({ text: v.string(), reward: v.number() })) }),
  handler: async (ctx, { runId, result }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== 'claimed') return { best: false, daily: [] };
    // A fresh start between the claim and now.
    if (result && await outdated(ctx, run.startedAt)) throw new ConvexError(RESTARTED);
    await ctx.db.patch(runId, { status: result ? 'done' : 'rejected' });
    if (!result) return { best: false, daily: [] };
    const { stats, coins, ...scored } = result;
    // Every verified run counts toward achievements and pays its coins, a best or not; the status above lets each run in once.
    if (stats) await awardVerified(ctx, run.userId, stats);
    if (coins) await credit(ctx, run.userId, coins);
    const daily = stats ? await recordDaily(ctx, run.userId, stats, coins ?? 0) : [];
    const now = Date.now();
    const week = weekKey(now);
    const old = await bestOf(ctx, week, run.userId, await weekCutoff(ctx, week));
    if (old && old.score >= scored.score) return { best: false, daily };
    const row = { release: run.release, version: run.version, ...scored, achievedAt: now };
    if (old) await ctx.db.patch(old._id, row);
    else await ctx.db.insert('scores', { week, userId: run.userId, ...row });
    return { best: true, daily };
  },
});

/** Hands in a run. The score comes from replaying it here, never from the page. */
export const finish = action({
  args: { runId: v.id('runs'), replay: v.string() },
  returns: v.object({ score: v.number(), best: v.boolean(), coins: v.number(), daily: v.array(v.object({ text: v.string(), reward: v.number() })) }),
  handler: async (ctx, { runId, replay }): Promise<{ score: number; best: boolean; coins: number; daily: { text: string; reward: number }[] }> => {
    if (replay.length > MAX_REPLAY) throw new ConvexError('기록이 너무 깁니다.');
    const run: { seed: number; seeds: number[] | null; elapsed: number } = await ctx.runMutation(internal.ranking.claim, { runId });
    const verdict = run.elapsed < 0 ? null : verifyReplay(run.seeds ?? run.seed, replay);
    const gameMs = verdict?.ok ? verdict.steps * STEP * 1000 : 0;
    const real = verdict?.ok && gameMs <= run.elapsed + SLACK;
    // A run that took far longer than it lasted was stopped to be worked out, not paused for a moment.
    const paced = !run.seeds || run.elapsed <= gameMs + pauseAllowanceMs(gameMs) + SLACK;
    if (!verdict?.ok || !real || !paced) {
      await ctx.runMutation(internal.ranking.settle, { runId, result: null });
      throw new ConvexError(run.elapsed === -2 ? '게임 규칙이 업데이트되어 이번 판은 순위에 오르지 않았어요. 새 버전으로 다시 달려 주세요.' : run.elapsed < 0 ? '너무 오래된 기록입니다.' : verdict?.ok && real ? '일시정지가 너무 길어 순위에 등록하지 않았습니다.' : '확인되지 않는 기록이라 등록하지 않았습니다.');
    }
    const saved: { best: boolean; daily: { text: string; reward: number }[] } = await ctx.runMutation(internal.ranking.settle, { runId, result: { score: verdict.score, distance: verdict.distance, stats: verdict.stats, coins: verdict.coins } });
    return { score: verdict.score, best: saved.best, coins: verdict.coins, daily: saved.daily };
  },
});

const entry = v.object({ rank: v.number(), nickname: v.string(), title: v.optional(v.union(v.string(), v.null())), badge: v.optional(v.union(v.string(), v.null())), costume: v.optional(v.string()), score: v.number(), distance: v.number(), mine: v.boolean() });

/** One board a week, for every version of the game: it starts afresh only on Monday 00:00 in Korea. */
export const board = query({
  // `version` is still accepted from older pages, and selects nothing.
  args: { week: v.string(), version: v.optional(v.number()) },
  returns: v.object({ top: v.array(entry), mine: v.union(v.null(), v.object({ rank: v.union(v.null(), v.number()), score: v.number(), distance: v.number() })) }),
  handler: async (ctx, { week }) => {
    if (!isWeekKey(week)) throw new ConvexError('잘못된 주간입니다.');
    const me = (await getAuthUserId(ctx)) as Id<'users'> | null;
    const top: { rank: number; nickname: string; title: string | null; badge: string | null; costume?: string; score: number; distance: number; mine: boolean }[] = [];
    // Best first, so a player's first row is their highest and the rest are passed over.
    const seen = new Set<Id<'users'>>();
    const cutoff = await weekCutoff(ctx, week);
    for await (const r of ctx.db.query('scores').withIndex('by_week_score', (q) => q.eq('week', week)).order('desc')) {
      if (r.achievedAt < cutoff || seen.has(r.userId)) continue;
      seen.add(r.userId);
      const user = await ctx.db.get(r.userId);
      // Equal scores share a rank.
      const prev: (typeof top)[number] | undefined = top[top.length - 1];
      top.push({ rank: prev && prev.score === r.score ? prev.rank : top.length + 1, nickname: user?.nickname ?? '(탈퇴)', title: titleById(user?.equippedTitle)?.name ?? null, badge: achievementById(user?.badge)?.id ?? null, costume: user?.costume, score: r.score, distance: r.distance, mine: r.userId === me });
      if (top.length >= TOP) break;
    }
    const own = me && (await bestOf(ctx, week, me, cutoff));
    let mine = null;
    if (own) {
      const above = new Set<Id<'users'>>();
      let read = 0;
      for await (const r of ctx.db.query('scores').withIndex('by_week_score', (q) => q.eq('week', week).gt('score', own.score))) {
        if (r.achievedAt >= cutoff) above.add(r.userId);
        if (++read >= RANK_CAP) break;
      }
      mine = { rank: read < RANK_CAP ? above.size + 1 : null, score: own.score, distance: own.distance };
    }
    return { top, mine };
  },
});
