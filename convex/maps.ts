import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { LIMITS, parseMap, serializeMap } from '../src/maps';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import { requirePlayer } from './users';

export const MAPS_PER_PLAYER = 20;
export const PAGE = 20;
const MIN_UPDATE_GAP = 3000;

/** Rebuilds an upload from only the fields a map has; anything unplayable is refused. */
function accept(json: string): { title: string; segments: number; json: string } {
  if (json.length > LIMITS.bytes) throw new ConvexError('맵이 너무 큽니다.');
  const { map, problems } = parseMap(json);
  if (!map || problems.length) throw new ConvexError(`맵을 게시할 수 없습니다: ${problems[0]?.text ?? ''}`);
  return { title: map.title, segments: map.segments.length, json: JSON.stringify(map) };
}

async function own(ctx: MutationCtx, id: Id<'maps'>): Promise<Doc<'maps'>> {
  const userId = await requirePlayer(ctx);
  const m = await ctx.db.get(id);
  if (!m || m.ownerId !== userId) throw new ConvexError('내가 올린 맵만 바꿀 수 있습니다.');
  return m;
}

export const publish = mutation({
  args: { json: v.string() },
  returns: v.id('maps'),
  handler: async (ctx, args) => {
    const ownerId = await requirePlayer(ctx);
    const m = accept(args.json);
    const mine = await ctx.db.query('maps').withIndex('by_owner', (q) => q.eq('ownerId', ownerId)).order('desc').take(MAPS_PER_PLAYER);
    if (mine.length >= MAPS_PER_PLAYER) throw new ConvexError(`맵은 ${MAPS_PER_PLAYER}개까지 게시할 수 있습니다.`);
    if (mine[0] && Date.now() - mine[0]._creationTime < MIN_UPDATE_GAP) throw new ConvexError('잠시 뒤 다시 시도해 주세요.');
    const bodyId = await ctx.db.insert('mapBodies', { json: m.json });
    return await ctx.db.insert('maps', { ownerId, title: m.title, segments: m.segments, bodyId, updatedAt: Date.now() });
  },
});

export const update = mutation({
  args: { id: v.id('maps'), json: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await own(ctx, args.id);
    const m = accept(args.json);
    if (Date.now() - old.updatedAt < MIN_UPDATE_GAP) throw new ConvexError('잠시 뒤 다시 시도해 주세요.');
    // Changed content is a new body, with times of its own; the old one stays for the times and runs made on it.
    const same = (await ctx.db.get(old.bodyId))?.json === m.json;
    const bodyId = same ? old.bodyId : await ctx.db.insert('mapBodies', { json: m.json });
    await ctx.db.patch(args.id, { title: m.title, segments: m.segments, bodyId, updatedAt: Date.now() });
    return null;
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

/** Titles and authors only, newest or oldest first, a small page at a time. Open to guests. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator, order: v.union(v.literal('new'), v.literal('old')) },
  handler: async (ctx, args) => {
    const me = await getAuthUserId(ctx);
    const opts = { ...args.paginationOpts, numItems: Math.max(1, Math.min(PAGE, Math.floor(args.paginationOpts.numItems) || PAGE)) };
    const r = await ctx.db.query('maps').withIndex('by_updated').order(args.order === 'new' ? 'desc' : 'asc').paginate(opts);
    const page = await Promise.all(r.page.map(async (m) => ({
      id: m._id, title: m.title, segments: m.segments, updatedAt: m.updatedAt, mine: m.ownerId === me,
      author: (await ctx.db.get(m.ownerId))?.nickname ?? '(탈퇴)',
      best: (await ctx.db.query('mapTimes').withIndex('by_body_time', (q) => q.eq('bodyId', m.bodyId)).first())?.timeMs ?? null,
    })));
    return { page, isDone: r.isDone, continueCursor: r.continueCursor };
  },
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
    return map && serializeMap(map);
  },
});
