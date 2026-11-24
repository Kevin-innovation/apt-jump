import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { STEP } from '../src/physics';
import { MAX_REPLAY, SIM_VERSION, verifyReplay } from '../src/replay';
import { isWeekKey, weekKey } from '../src/week';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, mutation, query } from './_generated/server';
import { requireUser } from './users';

export const TOP = 50;
/** Ranks past this are shown as "this or lower". */
const RANK_CAP = 1000;
const RUN_LIFE = 2 * 3_600_000;
const START_WINDOW = 10 * 60_000;
const STARTS_PER_WINDOW = 60;
/** Clock and network slack when comparing a run's length with the time it took. */
const SLACK = 4000;

export const clock = mutation({ args: {}, returns: v.number(), handler: async () => Date.now() });

/** Issues a run: the server picks the city, and starts timing. */
export const start = mutation({
  args: { version: v.number() },
  returns: v.object({ runId: v.id('runs'), seed: v.number() }),
  handler: async (ctx, { version }) => {
    const userId = await requireUser(ctx);
    if (version !== SIM_VERSION) throw new ConvexError('게임이 업데이트되었습니다. 새로고침해 주세요.');
    const now = Date.now();
    const recent = await ctx.db.query('runs').withIndex('by_user_started', (q) => q.eq('userId', userId)).order('desc').take(STARTS_PER_WINDOW);
    if (recent.length >= STARTS_PER_WINDOW && recent[recent.length - 1]!.startedAt > now - START_WINDOW)
      throw new ConvexError('너무 자주 시작했습니다. 잠시 뒤 다시 해 주세요.');
    // Only the newest run counts, and a few old rows are cleared as new ones come.
    for (const r of recent) if (r.status === 'open') await ctx.db.patch(r._id, { status: 'rejected' });
    const old = await ctx.db.query('runs').withIndex('by_user_started', (q) => q.eq('userId', userId).lt('startedAt', now - 24 * 3_600_000)).take(5);
    for (const r of old) await ctx.db.delete(r._id);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const runId = await ctx.db.insert('runs', { userId, seed, version, startedAt: now, status: 'open' });
    return { runId, seed };
  },
});

/** Takes a run out of circulation before anything is computed, so it can't be handed in twice. */
export const claim = internalMutation({
  args: { runId: v.id('runs') },
  returns: v.object({ seed: v.number(), elapsed: v.number() }),
  handler: async (ctx, { runId }) => {
    const userId = await requireUser(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== userId) throw new ConvexError('기록을 찾을 수 없습니다.');
    if (run.status !== 'open') throw new ConvexError('이미 제출했거나 무효가 된 기록입니다.');
    const elapsed = Date.now() - run.startedAt;
    const late = elapsed > RUN_LIFE || run.version !== SIM_VERSION;
    await ctx.db.patch(runId, { status: 'claimed' });
    return { seed: run.seed, elapsed: late ? -1 : elapsed };
  },
});

export const settle = internalMutation({
  args: { runId: v.id('runs'), result: v.union(v.null(), v.object({ score: v.number(), distance: v.number() })) },
  returns: v.object({ best: v.boolean() }),
  handler: async (ctx, { runId, result }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== 'claimed') return { best: false };
    await ctx.db.patch(runId, { status: result ? 'done' : 'rejected' });
    if (!result) return { best: false };
    const now = Date.now();
    const week = weekKey(now);
    const old = await ctx.db.query('scores').withIndex('by_week_user', (q) => q.eq('week', week).eq('userId', run.userId)).unique();
    if (old && old.score >= result.score) return { best: false };
    if (old) await ctx.db.patch(old._id, { ...result, achievedAt: now });
    else await ctx.db.insert('scores', { week, userId: run.userId, ...result, achievedAt: now });
    return { best: true };
  },
});

/** Hands in a run. The score comes from replaying it here, never from the page. */
export const finish = action({
  args: { runId: v.id('runs'), replay: v.string() },
  returns: v.object({ score: v.number(), best: v.boolean() }),
  handler: async (ctx, { runId, replay }): Promise<{ score: number; best: boolean }> => {
    if (replay.length > MAX_REPLAY) throw new ConvexError('기록이 너무 깁니다.');
    const run: { seed: number; elapsed: number } = await ctx.runMutation(internal.ranking.claim, { runId });
    const verdict = run.elapsed < 0 ? null : verifyReplay(run.seed, replay);
    const real = verdict?.ok && verdict.steps * STEP * 1000 <= run.elapsed + SLACK;
    if (!verdict?.ok || !real) {
      await ctx.runMutation(internal.ranking.settle, { runId, result: null });
      throw new ConvexError(run.elapsed < 0 ? '너무 오래된 기록입니다.' : '확인되지 않는 기록이라 등록하지 않았습니다.');
    }
    const saved: { best: boolean } = await ctx.runMutation(internal.ranking.settle, { runId, result: { score: verdict.score, distance: verdict.distance } });
    return { score: verdict.score, best: saved.best };
  },
});

const entry = v.object({ rank: v.number(), nickname: v.string(), score: v.number(), distance: v.number(), mine: v.boolean() });

/** The page names the week, so a cached answer can never outlive it. */
export const board = query({
  args: { week: v.string() },
  returns: v.object({ top: v.array(entry), mine: v.union(v.null(), v.object({ rank: v.union(v.null(), v.number()), score: v.number(), distance: v.number() })) }),
  handler: async (ctx, { week }) => {
    if (!isWeekKey(week)) throw new ConvexError('잘못된 주간입니다.');
    const me = (await getAuthUserId(ctx)) as Id<'users'> | null;
    const rows = await ctx.db.query('scores').withIndex('by_week_score', (q) => q.eq('week', week)).order('desc').take(TOP);
    const top: { rank: number; nickname: string; score: number; distance: number; mine: boolean }[] = [];
    for (const r of rows) {
      const user = await ctx.db.get(r.userId);
      // Equal scores share a rank.
      const prev: (typeof top)[number] | undefined = top[top.length - 1];
      top.push({ rank: prev && prev.score === r.score ? prev.rank : top.length + 1, nickname: user?.nickname ?? '(탈퇴)', score: r.score, distance: r.distance, mine: r.userId === me });
    }
    const own = me && (await ctx.db.query('scores').withIndex('by_week_user', (q) => q.eq('week', week).eq('userId', me)).unique());
    let mine = null;
    if (own) {
      const above = await ctx.db.query('scores').withIndex('by_week_score', (q) => q.eq('week', week).gt('score', own.score)).take(RANK_CAP);
      mine = { rank: above.length < RANK_CAP ? above.length + 1 : null, score: own.score, distance: own.distance };
    }
    return { top, mine };
  },
});
