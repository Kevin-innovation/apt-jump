import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { nicknameKey } from '../src/nickname';
import { SIM_VERSION } from '../src/replay';
import { PASSWORD_MAX, PASSWORD_MIN, SIGN_UP_ERRORS } from '../src/username';
import { weekKey } from '../src/week';
import { components } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';

/** The one admin: the account that owns this sign-in id in Convex Auth's username component. */
export const ADMIN_USERNAME = 'kvkvkv';
const DAY = 24 * 3_600_000;
/** Counts stop here, shown as "this or more": together they stay inside Convex's read limit for one query. */
const COUNT_CAP = 2_000;
const NOT_ADMIN = '관리자만 쓸 수 있습니다.';

/**
 * The caller, if the server's session belongs to the account that owns ADMIN_USERNAME, or an error.
 * Nothing the page sends (a nickname, a flag, a user id) is trusted: the session decides who calls, and the username
 * component decides who owns the id.
 */
async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const me = await getAuthUserId(ctx);
  if (me === null) throw new ConvexError('로그인이 필요합니다.');
  const owner = await ctx.runQuery(components.authUsername.public.getUserIdByUsername, { username: ADMIN_USERNAME });
  if (owner === null || owner !== me) throw new ConvexError(NOT_ADMIN);
  return me;
}

async function count(q: AsyncIterable<unknown>): Promise<number> {
  let n = 0;
  for await (const _ of q) if (++n >= COUNT_CAP) break;
  return n;
}

/** Whether the caller is the admin: only decides whether the page shows the admin button. */
export const amI = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    try { await requireAdmin(ctx); return true; } catch { return false; }
  },
});

const statsShape = v.object({
  members: v.number(), signups7d: v.number(), active7d: v.number(), plays7d: v.number(), playsToday: v.number(),
  weeklyRecords: v.number(), maps: v.number(), suspended: v.number(), cap: v.number(),
});

export const stats = query({
  args: {},
  returns: statsShape,
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now(), weekAgo = now - 7 * DAY;
    const days = new Set(Array.from({ length: 7 }, (_, i) => new Date(now + 9 * 3_600_000 - i * DAY).toISOString().slice(0, 10)));
    let plays7d = 0, playsToday = 0;
    for (const d of await ctx.db.query('dailyStats').withIndex('by_day', (q) => q.gte('day', [...days].sort()[0]!)).collect()) {
      if (!days.has(d.day)) continue;
      plays7d += d.plays;
      if (d.day === new Date(now + 9 * 3_600_000).toISOString().slice(0, 10)) playsToday = d.plays;
    }
    const release = (await ctx.db.query('leaderboardState').withIndex('by_key', (q) => q.eq('key', 'current')).unique())?.release ?? 'initial';
    let suspended = 0;
    let seen = 0;
    for await (const u of ctx.db.query('users')) { if (u.suspended) suspended++; if (++seen >= COUNT_CAP) break; }
    return {
      members: await count(ctx.db.query('users')),
      signups7d: await count(ctx.db.query('users').withIndex('by_creation_time', (q) => q.gte('_creationTime', weekAgo))),
      active7d: await count(ctx.db.query('users').withIndex('by_lastActive', (q) => q.gte('lastActiveAt', weekAgo))),
      plays7d, playsToday,
      weeklyRecords: await count(ctx.db.query('scores').withIndex('by_release_score', (q) => q.eq('week', weekKey(now)).eq('release', release).eq('version', SIM_VERSION))),
      maps: await count(ctx.db.query('maps')),
      suspended,
      cap: COUNT_CAP,
    };
  },
});

const memberShape = v.object({
  id: v.id('users'), username: v.union(v.null(), v.string()), nickname: v.union(v.null(), v.string()),
  joinedAt: v.number(), lastActiveAt: v.union(v.null(), v.number()), plays: v.number(), suspended: v.boolean(), admin: v.boolean(),
});

async function member(ctx: QueryCtx, u: Doc<'users'>, adminId: Id<'users'>) {
  return {
    id: u._id,
    username: await ctx.runQuery(components.authUsername.public.getUsername, { userId: u._id }),
    nickname: u.nickname ?? null,
    joinedAt: u._creationTime,
    lastActiveAt: u.lastActiveAt ?? null,
    plays: u.plays ?? 0,
    suspended: !!u.suspended,
    admin: u._id === adminId,
  };
}

/** Newest first, a page at a time; or, with search, the account with that id and the nicknames that start with it. */
export const members = query({
  args: { search: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(memberShape), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { search, paginationOpts }) => {
    const adminId = await requireAdmin(ctx);
    const s = search.trim();
    if (s) {
      if (s.length > 32) throw new ConvexError('검색어가 너무 깁니다.');
      const found = new Map<Id<'users'>, Doc<'users'>>();
      const byId = await ctx.runQuery(components.authUsername.public.getUserIdByUsername, { username: s.toLowerCase() });
      const named = byId && await ctx.db.get(byId as Id<'users'>);
      if (named) found.set(named._id, named);
      const key = nicknameKey(s);
      if (key) {
        for (const u of await ctx.db.query('users').withIndex('by_nickKey', (q) => q.gte('nickKey', key).lt('nickKey', `${key}￿`)).take(20))
          found.set(u._id, u);
      }
      return { page: await Promise.all([...found.values()].map((u) => member(ctx, u, adminId))), isDone: true, continueCursor: '' };
    }
    const r = await ctx.db.query('users').order('desc').paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 50) });
    return { page: await Promise.all(r.page.map((u) => member(ctx, u, adminId))), isDone: r.isDone, continueCursor: r.continueCursor };
  },
});

/** One member, with how many sessions it holds (never the sessions themselves). */
export const memberDetail = query({
  args: { id: v.id('users') },
  returns: v.object({ member: memberShape, sessions: v.number() }),
  handler: async (ctx, { id }) => {
    const adminId = await requireAdmin(ctx);
    const u = await ctx.db.get(id);
    if (!u) throw new ConvexError('회원을 찾을 수 없습니다.');
    const sessions = await ctx.runQuery(components.auth.public.listSessions, { userId: id });
    return { member: await member(ctx, u, adminId), sessions: sessions.length };
  },
});

/** Ends a member's sessions, all but `keep`. Returns how many ended. */
async function endSessions(ctx: MutationCtx, userId: Id<'users'>, keep: string | null): Promise<number> {
  const all = await ctx.runQuery(components.auth.public.listSessions, { userId });
  const ids = all.map((s) => s.sessionId).filter((s) => s !== keep);
  return ids.length ? (await ctx.runMutation(components.auth.public.revokeSessions, { sessionIds: ids })).length : 0;
}

async function target(ctx: MutationCtx, id: Id<'users'>): Promise<Doc<'users'>> {
  const u = await ctx.db.get(id);
  if (!u) throw new ConvexError('회원을 찾을 수 없습니다.');
  return u;
}
/** The admin's own session is kept when the admin acts on their own account. */
async function ownSession(ctx: MutationCtx, adminId: Id<'users'>, id: Id<'users'>): Promise<string | null> {
  return id === adminId ? (await ctx.auth.getUserIdentity())?.subject ?? null : null;
}
const log = (ctx: MutationCtx, adminId: Id<'users'>, u: Doc<'users'>, action: Doc<'adminLog'>['action'], sessions: number) =>
  ctx.db.insert('adminLog', { adminId, targetId: u._id, targetName: u.nickname ?? '(닉네임 없음)', action, sessions });

/** Sets a new password (stored by the password component, as at sign-up) and ends the member's sessions. */
export const resetPassword = mutation({
  args: { id: v.id('users'), password: v.string() },
  returns: v.object({ sessions: v.number() }),
  handler: async (ctx, { id, password }) => {
    const adminId = await requireAdmin(ctx);
    const u = await target(ctx, id);
    const length = [...password].length;
    if (length < PASSWORD_MIN) throw new ConvexError(SIGN_UP_ERRORS.PASSWORD_TOO_SHORT!);
    if (length > PASSWORD_MAX) throw new ConvexError(SIGN_UP_ERRORS.PASSWORD_TOO_LONG!);
    if (/^\s|\s$/u.test(password)) throw new ConvexError(SIGN_UP_ERRORS.PASSWORD_HAS_SURROUNDING_WHITESPACE!);
    if ((await ctx.runQuery(components.authUsername.public.getUsername, { userId: id })) === null) throw new ConvexError('로그인 아이디가 없는 계정입니다.');
    const set = await ctx.runMutation(components.authPassword.public._internal_dangerous_setPassword, { userId: id, password, minimumLength: PASSWORD_MIN });
    if (!set.success) throw new ConvexError(SIGN_UP_ERRORS[set.userError.error] ?? '비밀번호를 바꾸지 못했습니다.');
    const sessions = await endSessions(ctx, id, await ownSession(ctx, adminId, id));
    await log(ctx, adminId, u, 'resetPassword', sessions);
    return { sessions };
  },
});

/** Suspends (ending every session) or restores a member. The admin can't suspend themselves. */
export const setSuspended = mutation({
  args: { id: v.id('users'), suspended: v.boolean() },
  returns: v.object({ sessions: v.number() }),
  handler: async (ctx, { id, suspended }) => {
    const adminId = await requireAdmin(ctx);
    if (id === adminId) throw new ConvexError('관리자 계정은 정지할 수 없습니다.');
    const u = await target(ctx, id);
    await ctx.db.patch(id, { suspended });
    const sessions = suspended ? await endSessions(ctx, id, null) : 0;
    await log(ctx, adminId, u, suspended ? 'suspend' : 'unsuspend', sessions);
    return { sessions };
  },
});

/** Signs a member out everywhere (the admin's own current session is kept). */
export const revokeSessions = mutation({
  args: { id: v.id('users') },
  returns: v.object({ sessions: v.number() }),
  handler: async (ctx, { id }) => {
    const adminId = await requireAdmin(ctx);
    const u = await target(ctx, id);
    const sessions = await endSessions(ctx, id, await ownSession(ctx, adminId, id));
    await log(ctx, adminId, u, 'revokeSessions', sessions);
    return { sessions };
  },
});

export const logs = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({ at: v.number(), action: v.string(), target: v.string(), targetId: v.id('users'), sessions: v.number() })),
    isDone: v.boolean(), continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    const r = await ctx.db.query('adminLog').order('desc').paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 50) });
    return { page: r.page.map((l) => ({ at: l._creationTime, action: l.action, target: l.targetName, targetId: l.targetId, sessions: l.sessions })), isDone: r.isDone, continueCursor: r.continueCursor };
  },
});
