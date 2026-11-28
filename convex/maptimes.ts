import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { timeOf, verifyMapReplay } from '../src/mapreplay';
import { parseMap, serializeMap } from '../src/maps';
import { MAX_REPLAY, SIM_VERSION } from '../src/replay';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, mutation, query } from './_generated/server';
import { requirePlayer, touch } from './users';

// Best completion times of published maps. They belong to one version of a map's content (its bodyId), for all time.
const TOP = 50;
const RANK_CAP = 1000;
const RUN_LIFE = 2 * 3_600_000;
const START_WINDOW = 10 * 60_000;
const STARTS_PER_WINDOW = 60;
/** Clock and network slack when comparing a run's length with the time it took. */
const SLACK = 4000;

/** Issues a run of a published map, fixed to the content it has now, which is returned to be played. */
export const start = mutation({
  args: { mapId: v.id('maps'), version: v.number() },
  returns: v.object({ runId: v.id('mapRuns'), json: v.string() }),
  handler: async (ctx, { mapId, version }) => {
    const userId = await requirePlayer(ctx);
    if (version !== SIM_VERSION) throw new ConvexError('게임이 업데이트되었습니다. 새로고침해 주세요.');
    const map = await ctx.db.get(mapId);
    const body = map && (await ctx.db.get(map.bodyId));
    const parsed = body && parseMap(body.json).map;
    if (!map || !parsed) throw new ConvexError('맵을 찾을 수 없습니다.');
    const now = Date.now();
    const recent = await ctx.db.query('mapRuns').withIndex('by_user_started', (q) => q.eq('userId', userId)).order('desc').take(STARTS_PER_WINDOW);
    if (recent.length >= STARTS_PER_WINDOW && recent[recent.length - 1]!.startedAt > now - START_WINDOW)
      throw new ConvexError('너무 자주 시작했습니다. 잠시 뒤 다시 해 주세요.');
    // Only the newest run counts, and a few old tickets are cleared as new ones come.
    for (const r of recent) if (r.status === 'open') await ctx.db.patch(r._id, { status: 'rejected' });
    const old = await ctx.db.query('mapRuns').withIndex('by_user_started', (q) => q.eq('userId', userId).lt('startedAt', now - 24 * 3_600_000)).take(5);
    for (const r of old) await ctx.db.delete(r._id);
    const runId = await ctx.db.insert('mapRuns', { userId, mapId, bodyId: map.bodyId, version, startedAt: now, status: 'open' });
    await touch(ctx, userId, true);
    return { runId, json: serializeMap({ ...parsed, title: map.title }) };
  },
});

/** Takes a run out of circulation before anything is computed, so it can't be handed in twice. */
export const claim = internalMutation({
  args: { runId: v.id('mapRuns') },
  returns: v.object({ json: v.union(v.null(), v.string()), elapsed: v.number() }),
  handler: async (ctx, { runId }) => {
    const userId = await requirePlayer(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== userId) throw new ConvexError('기록을 찾을 수 없습니다.');
    if (run.status !== 'open') throw new ConvexError('이미 제출했거나 무효가 된 기록입니다.');
    const elapsed = Date.now() - run.startedAt;
    const late = elapsed > RUN_LIFE || run.version !== SIM_VERSION;
    const body = await ctx.db.get(run.bodyId);
    await ctx.db.patch(runId, { status: 'claimed' });
    return { json: body?.json ?? null, elapsed: late ? -1 : elapsed };
  },
});

export const settle = internalMutation({
  args: { runId: v.id('mapRuns'), steps: v.union(v.null(), v.number()) },
  returns: v.object({ best: v.boolean() }),
  handler: async (ctx, { runId, steps }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== 'claimed') return { best: false };
    await ctx.db.patch(runId, { status: steps === null ? 'rejected' : 'done' });
    if (steps === null) return { best: false };
    // Every verified finish counts, a best or not; the status above lets each run in once.
    const map = await ctx.db.get(run.mapId);
    if (map) await ctx.db.patch(map._id, { plays: (map.plays ?? 0) + 1 });
    const row = { timeMs: timeOf(steps), achievedAt: Date.now() };
    const old = await ctx.db.query('mapTimes').withIndex('by_body_user', (q) => q.eq('bodyId', run.bodyId).eq('userId', run.userId)).first();
    if (old && old.timeMs <= row.timeMs) return { best: false };
    if (old) await ctx.db.patch(old._id, row);
    else await ctx.db.insert('mapTimes', { mapId: run.mapId, bodyId: run.bodyId, userId: run.userId, ...row });
    return { best: true };
  },
});

/** Hands in a run. The time comes from replaying it here, never from the page. */
export const finish = action({
  args: { runId: v.id('mapRuns'), replay: v.string() },
  returns: v.object({ timeMs: v.number(), best: v.boolean() }),
  handler: async (ctx, { runId, replay }): Promise<{ timeMs: number; best: boolean }> => {
    if (replay.length > MAX_REPLAY) throw new ConvexError('기록이 너무 깁니다.');
    const run: { json: string | null; elapsed: number } = await ctx.runMutation(internal.maptimes.claim, { runId });
    const map = run.json === null ? null : parseMap(run.json).map;
    const verdict = run.elapsed < 0 || !map ? null : verifyMapReplay(map, replay);
    // The game can't have run for longer than has passed since the run was issued.
    if (!verdict?.ok || timeOf(verdict.steps) > run.elapsed + SLACK) {
      await ctx.runMutation(internal.maptimes.settle, { runId, steps: null });
      throw new ConvexError(run.elapsed < 0 ? '너무 오래된 기록입니다.' : !map ? '내려간 맵의 기록입니다.' : '확인되지 않는 기록이라 등록하지 않았습니다.');
    }
    const saved: { best: boolean } = await ctx.runMutation(internal.maptimes.settle, { runId, steps: verdict.steps });
    return { timeMs: timeOf(verdict.steps), best: saved.best };
  },
});

const entry = v.object({ rank: v.number(), nickname: v.string(), timeMs: v.number(), mine: v.boolean() });

/** The fastest runs of a map as it is now. Open to guests. */
export const board = query({
  args: { mapId: v.id('maps') },
  returns: v.union(v.null(), v.object({ title: v.string(), top: v.array(entry), mine: v.union(v.null(), v.object({ rank: v.union(v.null(), v.number()), timeMs: v.number() })) })),
  handler: async (ctx, { mapId }) => {
    const map = await ctx.db.get(mapId);
    if (!map) return null;
    const me = (await getAuthUserId(ctx)) as Id<'users'> | null;
    // Among equal times, whoever got there first is listed first.
    const rows = (await ctx.db.query('mapTimes').withIndex('by_body_time', (q) => q.eq('bodyId', map.bodyId)).take(TOP))
      .sort((a, b) => a.timeMs - b.timeMs || a.achievedAt - b.achievedAt);
    const top: { rank: number; nickname: string; timeMs: number; mine: boolean }[] = [];
    for (const r of rows) {
      const user = await ctx.db.get(r.userId);
      // Equal times share a rank.
      const prev: (typeof top)[number] | undefined = top[top.length - 1];
      top.push({ rank: prev && prev.timeMs === r.timeMs ? prev.rank : top.length + 1, nickname: user?.nickname ?? '(탈퇴)', timeMs: r.timeMs, mine: r.userId === me });
    }
    const own = me && (await ctx.db.query('mapTimes').withIndex('by_body_user', (q) => q.eq('bodyId', map.bodyId).eq('userId', me)).first());
    let mine = null;
    if (own) {
      const faster = await ctx.db.query('mapTimes').withIndex('by_body_time', (q) => q.eq('bodyId', map.bodyId).lt('timeMs', own.timeMs)).take(RANK_CAP);
      mine = { rank: faster.length < RANK_CAP ? faster.length + 1 : null, timeMs: own.timeMs };
    }
    return { title: map.title, top, mine };
  },
});
