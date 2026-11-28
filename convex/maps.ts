import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { timeOf, verifyMapReplay } from '../src/mapreplay';
import { cleanTitle, LIMITS, parseMap, serializeMap, type GameMap } from '../src/maps';
import { MAX_REPLAY, SIM_VERSION } from '../src/replay';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { isValidation } from './maptimes';
import { requirePlayer, touch } from './users';

export const MAPS_PER_PLAYER = 20;
export const PAGE = 20;
/** The most maps named as tied for most completed: far above any real tie, it keeps the read bounded. */
const TOP_TIES = 1000;
const MIN_UPDATE_GAP = 3000;
const RUN_LIFE = 2 * 3_600_000;
const START_WINDOW = 10 * 60_000;
const STARTS_PER_WINDOW = 60;
/** Clock and network slack when comparing a run's length with the time it took. */
const SLACK = 4000;
const REFRESH = '게임이 업데이트되었습니다. 새로고침해 주세요.';
const NOT_MINE = '내가 올린 맵만 바꿀 수 있습니다.';
const FULL = `맵은 ${MAPS_PER_PLAYER}개까지 게시할 수 있습니다.`;
/** A course without its name: what times belong to. */
const course = (m: GameMap) => JSON.stringify({ ...m, title: '' });
const mapsOf = (ctx: QueryCtx | MutationCtx, ownerId: Id<'users'>) =>
  ctx.db.query('maps').withIndex('by_owner', (q) => q.eq('ownerId', ownerId)).order('desc').take(MAPS_PER_PLAYER);

/** Rebuilds an upload from only the fields a map has; anything the game can't build is refused. */
function accept(json: string): GameMap {
  if (json.length > LIMITS.bytes) throw new ConvexError('맵이 너무 큽니다.');
  const { map, problems } = parseMap(json);
  if (!map || problems.length) throw new ConvexError(`맵을 게시할 수 없습니다: ${problems[0]?.text ?? ''}`);
  return map;
}

async function own(ctx: MutationCtx, id: Id<'maps'>): Promise<Doc<'maps'>> {
  const userId = await requirePlayer(ctx);
  const m = await ctx.db.get(id);
  if (!m || m.ownerId !== userId) throw new ConvexError(NOT_MINE);
  return m;
}

// Publishing without finishing the map is gone. These answer pages from before that, which still call them.
export const publish = mutation({
  args: { json: v.string() },
  returns: v.id('maps'),
  handler: async (): Promise<Id<'maps'>> => { throw new ConvexError(REFRESH); },
});
export const update = mutation({
  args: { id: v.id('maps'), json: v.string() },
  returns: v.null(),
  handler: async (): Promise<null> => { throw new ConvexError(REFRESH); },
});

/**
 * Starts the maker's run that shares a map, new or (with `mapId`) a new version of one already shared. The content is
 * kept aside; nothing anyone else sees changes until the run is verified. Only the newest such run counts.
 */
export const shareStart = mutation({
  args: { json: v.string(), mapId: v.optional(v.string()), version: v.number() },
  returns: v.object({ runId: v.id('mapShares'), json: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requirePlayer(ctx);
    if (args.version !== SIM_VERSION) throw new ConvexError(REFRESH);
    const map = accept(args.json);
    const now = Date.now();
    // A map taken down since this device last saw it is shared as a new one.
    const id = args.mapId === undefined ? null : ctx.db.normalizeId('maps', args.mapId);
    const target = id && (await ctx.db.get(id));
    if (target) {
      if (target.ownerId !== userId) throw new ConvexError(NOT_MINE);
      if (now - target.updatedAt < MIN_UPDATE_GAP) throw new ConvexError('잠시 뒤 다시 시도해 주세요.');
    } else {
      const mine = await mapsOf(ctx, userId);
      // At the limit, only a map that is already up (an answer that never arrived) may be handed in again.
      if (mine.length >= MAPS_PER_PLAYER && !(await same(ctx, mine, map))) throw new ConvexError(FULL);
      if (mine[0] && now - mine[0]._creationTime < MIN_UPDATE_GAP) throw new ConvexError('잠시 뒤 다시 시도해 주세요.');
    }
    const recent = await ctx.db.query('mapShares').withIndex('by_user_started', (q) => q.eq('userId', userId)).order('desc').take(STARTS_PER_WINDOW);
    if (recent.length >= STARTS_PER_WINDOW && recent[recent.length - 1]!.startedAt > now - START_WINDOW)
      throw new ConvexError('너무 자주 시작했습니다. 잠시 뒤 다시 해 주세요.');
    for (const r of recent) if (r.status === 'open' || r.status === 'claimed') await ctx.db.patch(r._id, { status: 'rejected', json: undefined });
    const old = await ctx.db.query('mapShares').withIndex('by_user_started', (q) => q.eq('userId', userId).lt('startedAt', now - 24 * 3_600_000)).take(5);
    for (const r of old) await ctx.db.delete(r._id);
    const json = JSON.stringify(map);
    const runId = await ctx.db.insert('mapShares', { userId, ...(target ? { targetId: target._id } : {}), json, version: args.version, startedAt: now, status: 'open' });
    await touch(ctx, userId, true);
    return { runId, json: serializeMap(map) };
  },
});

/** The one of these maps that is this very map, name and course, if any. */
async function same(ctx: QueryCtx | MutationCtx, maps: Doc<'maps'>[], map: GameMap): Promise<Doc<'maps'> | null> {
  for (const m of maps) {
    if (m.title !== map.title) continue;
    const body = await ctx.db.get(m.bodyId);
    const had = body && parseMap(body.json).map;
    if (had && course(had) === course(map)) return m;
  }
  return null;
}

const shared = v.object({ mapId: v.id('maps'), timeMs: v.number() });
type Shared = { mapId: Id<'maps'>; timeMs: number };

/**
 * Takes a share run to be checked. One already published answers with what it published; one claimed but never
 * settled (the check broke off) may be claimed again, judged by the time of the first claim.
 */
export const shareClaim = internalMutation({
  args: { runId: v.id('mapShares') },
  returns: v.object({ done: v.union(v.null(), shared), json: v.union(v.null(), v.string()), elapsed: v.number() }),
  handler: async (ctx, { runId }) => {
    const userId = await requirePlayer(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== userId) throw new ConvexError('기록을 찾을 수 없습니다.');
    if (run.status === 'done') return { done: { mapId: run.mapId!, timeMs: run.timeMs! }, json: null, elapsed: 0 };
    if (run.status === 'rejected') throw new ConvexError('무효가 된 기록입니다. 「공유」를 눌러 다시 달려 주세요.');
    const claimedAt = run.claimedAt ?? Date.now();
    await ctx.db.patch(runId, { status: 'claimed', claimedAt });
    const elapsed = claimedAt - run.startedAt;
    const late = elapsed > RUN_LIFE || run.version !== SIM_VERSION;
    return { done: null, json: run.json ?? null, elapsed: late ? -1 : elapsed };
  },
});

/**
 * Publishes a verified run's map, in one transaction; or, with null steps, voids the run. The run only proves the map
 * can be finished: it is no record and counts as no completion. Returns why when nothing was published (a throw would
 * also undo voiding the run).
 */
export const shareSettle = internalMutation({
  args: { runId: v.id('mapShares'), steps: v.union(v.null(), v.number()) },
  returns: v.object({ done: v.union(v.null(), shared), why: v.string() }),
  handler: async (ctx, { runId, steps }): Promise<{ done: Shared | null; why: string }> => {
    const run = await ctx.db.get(runId);
    if (run?.status === 'done') return { done: { mapId: run.mapId!, timeMs: run.timeMs! }, why: '' };
    if (!run || run.status !== 'claimed') return { done: null, why: '무효가 된 기록입니다. 「공유」를 눌러 다시 달려 주세요.' };
    const refuse = async (why: string) => {
      await ctx.db.patch(runId, { status: 'rejected', json: undefined });
      return { done: null, why };
    };
    const map = run.json === undefined ? null : parseMap(run.json).map;
    if (steps === null || !map) return refuse('확인되지 않는 기록이라 공유하지 않았습니다.');
    const userId = run.userId, now = Date.now(), json = JSON.stringify(map);
    let target: Doc<'maps'> | null = null;
    if (run.targetId) {
      target = await ctx.db.get(run.targetId);
      if (!target || target.ownerId !== userId) return refuse('달리는 동안 공유가 취소된 맵이라 올리지 않았습니다.');
    } else {
      const mine = await mapsOf(ctx, userId);
      target = await same(ctx, mine, map);
      if (!target && mine.length >= MAPS_PER_PLAYER) return refuse(FULL);
    }
    let mapId: Id<'maps'>;
    if (target) {
      // The same course keeps its content and times; a changed one gets its own, and the old stays for its times.
      const body = await ctx.db.get(target.bodyId);
      const had = body && parseMap(body.json).map;
      const bodyId = had && course(had) === course(map) ? target.bodyId : await ctx.db.insert('mapBodies', { json });
      // A name given while this run was under way is newer than the one in it.
      const title = (target.renamedAt ?? 0) > run.startedAt ? target.title : map.title;
      mapId = target._id;
      await ctx.db.patch(mapId, { title, segments: map.segments.length, bodyId, updatedAt: now, ...(bodyId === target.bodyId ? {} : { contentUpdatedAt: now }) });
    } else {
      const bodyId = await ctx.db.insert('mapBodies', { json });
      mapId = await ctx.db.insert('maps', { ownerId: userId, title: map.title, segments: map.segments.length, bodyId, updatedAt: now, plays: 0 });
    }
    const timeMs = timeOf(steps);
    await ctx.db.patch(runId, { status: 'done', mapId, timeMs, json: undefined });
    return { done: { mapId, timeMs }, why: '' };
  },
});

/** Hands the maker's run in. It is played again here: only one that reaches the goal publishes the map. */
export const shareFinish = action({
  args: { runId: v.id('mapShares'), replay: v.string() },
  returns: shared,
  handler: async (ctx, { runId, replay }): Promise<Shared> => {
    if (replay.length > MAX_REPLAY) throw new ConvexError('기록이 너무 깁니다.');
    const run: { done: Shared | null; json: string | null; elapsed: number } = await ctx.runMutation(internal.maps.shareClaim, { runId });
    if (run.done) return run.done;
    const map = run.json === null ? null : parseMap(run.json).map;
    const verdict = run.elapsed < 0 || !map ? null : verifyMapReplay(map, replay);
    // The game can't have run for longer than has passed since the run was issued.
    const steps = verdict?.ok && timeOf(verdict.steps) <= run.elapsed + SLACK ? verdict.steps : null;
    const saved: { done: Shared | null; why: string } = await ctx.runMutation(internal.maps.shareSettle, { runId, steps });
    if (!saved.done) throw new ConvexError(run.elapsed < 0 ? '너무 오래된 기록입니다. 「공유」를 눌러 다시 달려 주세요.' : saved.why);
    return saved.done;
  },
});

/** The owner gives a shared map another name. Its content, and so its times, stay as they are. */
export const rename = mutation({
  args: { id: v.id('maps'), title: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const m = await own(ctx, args.id);
    const title = args.title.length > 200 ? '' : cleanTitle(args.title);
    if (!title) throw new ConvexError('맵 이름이 없거나 너무 깁니다.');
    if (Date.now() - (m.renamedAt ?? 0) < MIN_UPDATE_GAP) throw new ConvexError('잠시 뒤 다시 시도해 주세요.');
    await ctx.db.patch(args.id, { title, renamedAt: Date.now() });
    return title;
  },
});

export const remove = mutation({
  args: { id: v.id('maps') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const m = await own(ctx, args.id);
    await ctx.db.delete(m.bodyId);
    await ctx.db.delete(args.id);
    return null;
  },
});

/** Titles and authors only, newest, oldest or most completed first, a small page at a time. Open to guests. */
/** A map's best time and who holds it: the first to reach it, and how many share it. */
async function fastest(ctx: QueryCtx, map: Doc<'maps'>): Promise<{ best: number | null; bestBy: string | null; bestTied: number }> {
  const bodyId = map.bodyId;
  // At most one of the rows is the maker's old verification run, so two are enough to find the first real one.
  let top: Doc<'mapTimes'> | undefined;
  for (const r of await ctx.db.query('mapTimes').withIndex('by_body_time', (q) => q.eq('bodyId', bodyId)).take(2))
    if (!(await isValidation(ctx, r, map.ownerId))) { top = r; break; }
  if (!top) return { best: null, bestBy: null, bestTied: 0 };
  const best = top.timeMs;
  const tied: Doc<'mapTimes'>[] = [];
  for (const r of await ctx.db.query('mapTimes').withIndex('by_body_time', (q) => q.eq('bodyId', bodyId).eq('timeMs', best)).take(51))
    if (tied.length < 50 && !(await isValidation(ctx, r, map.ownerId))) tied.push(r);
  const first = tied.reduce((a, b) => (b.achievedAt < a.achievedAt ? b : a), top);
  return { best, bestBy: (await ctx.db.get(first.userId))?.nickname ?? '(탈퇴)', bestTied: tied.length };
}

/** Every map sharing the highest count of completions among all shared maps; none while nothing has been finished. */
async function mostPlayed(ctx: QueryCtx): Promise<Id<'maps'>[]> {
  const most = (await ctx.db.query('maps').withIndex('by_plays').order('desc').first())?.plays ?? 0;
  if (most <= 0) return [];
  return (await ctx.db.query('maps').withIndex('by_plays', (q) => q.eq('plays', most)).take(TOP_TIES)).map((m) => m._id);
}

export const list = query({
  args: { paginationOpts: paginationOptsValidator, order: v.union(v.literal('new'), v.literal('old'), v.literal('popular')) },
  handler: async (ctx, args) => {
    const me = await getAuthUserId(ctx);
    const opts = { ...args.paginationOpts, numItems: Math.max(1, Math.min(PAGE, Math.floor(args.paginationOpts.numItems) || PAGE)) };
    // Popular: most completions first. A map without a count sorts below every number, so it comes last.
    const r = args.order === 'popular'
      ? await ctx.db.query('maps').withIndex('by_plays').order('desc').paginate(opts)
      : await ctx.db.query('maps').withIndex('by_updated').order(args.order === 'new' ? 'desc' : 'asc').paginate(opts);
    const page = await Promise.all(r.page.map(async (m) => ({
      id: m._id, title: m.title, segments: m.segments, updatedAt: m.updatedAt, createdAt: m._creationTime, mine: m.ownerId === me, plays: m.plays ?? 0,
      ...(m.contentUpdatedAt === undefined ? {} : { contentUpdatedAt: m.contentUpdatedAt }),
      author: (await ctx.db.get(m.ownerId))?.nickname ?? '(탈퇴)',
      ...(await fastest(ctx, m)),
    })));
    // Judged over all maps, not this page: a page is only the latest changed.
    return { page, isDone: r.isDone, continueCursor: r.continueCursor, mostPlayed: await mostPlayed(ctx) };
  },
});

/**
 * When the latest newly shared map first went up (an update or a new name doesn't change that), for the title's NEW
 * label. The page judges its age: a query's own clock isn't live. Open to guests.
 */
export const newest = query({
  args: {},
  returns: v.union(v.null(), v.number()),
  handler: async (ctx) => (await ctx.db.query('maps').order('desc').first())?._creationTime ?? null,
});

/** One map, as the same JSON a map file holds. Open to guests. */
export const get = query({
  args: { id: v.id('maps') },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.id);
    const body = m && (await ctx.db.get(m.bodyId));
    if (!body) return null;
    const { map } = parseMap(body.json);
    // The name is the one it has now; the stored content keeps the name it was shared with.
    return map && serializeMap({ ...map, title: m.title });
  },
});
