import type { SignUpResult } from '@convex-dev/auth/methods/username-password/server';
import { WELCOME_COINS } from '../src/achievements';
import { getAuthUserId } from '@convex-dev/auth/server';
import { MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { ConvexError, v } from 'convex/values';
import { cleanNickname, nicknameKey } from '../src/nickname';
import { cleanUsername, SIGN_UP_ERRORS } from '../src/username';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';

// Guessing passwords is limited by the password component; this limits making accounts, however it is done.
const limiter = new RateLimiter(components.rateLimiter, {
  createAccount: { kind: 'token bucket', rate: 20, period: MINUTE, capacity: 40 },
});

/** The signed-in player, or an error. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const id = await getAuthUserId(ctx);
  if (id === null) throw new ConvexError('로그인이 필요합니다.');
  if ((await ctx.db.get(id))?.suspended) throw new ConvexError(SUSPENDED);
  return id;
}
export const SUSPENDED = '이용이 정지된 계정입니다. 운영자에게 문의해 주세요.';

/** Notes that a player did something, for the admin page. */
export async function touch(ctx: MutationCtx, id: Id<'users'>, played = false): Promise<void> {
  const user = await ctx.db.get(id);
  if (!user) return;
  await ctx.db.patch(id, { lastActiveAt: Date.now(), ...(played ? { plays: (user.plays ?? 0) + 1 } : {}) });
}
/** The signed-in player, who must have a public name. */
export async function requirePlayer(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const id = await requireUser(ctx);
  if (!(await ctx.db.get(id))?.nickname) throw new ConvexError('닉네임을 먼저 정해 주세요.');
  return id;
}

/** A nickname ready to store, or an error the player can read. */
async function claimNickname(ctx: MutationCtx, raw: string, self: Id<'users'> | null, username: string | null) {
  const nickname = cleanNickname(raw);
  const nickKey = nickname === null ? '' : nicknameKey(nickname);
  if (nickname === null || nickKey.length < 2) throw new ConvexError('닉네임은 2~16자의 글자·숫자로 정해 주세요.');
  if (username !== null && nickKey === nicknameKey(username)) throw new ConvexError('닉네임은 공개되므로 아이디와 다르게 정해 주세요.');
  const other = await ctx.db.query('users').withIndex('by_nickKey', (q) => q.eq('nickKey', nickKey)).first();
  if (other && other._id !== self) throw new ConvexError('이미 쓰는 닉네임입니다.');
  return { nickname, nickKey };
}

/** Called by Convex Auth for every new account. */
export const createUser = internalMutation({
  // Accounts are made by the game's sign-up (see auth.ts); Convex Auth's own name is kept for older ones.
  args: { method: v.object({ name: v.union(v.literal('usernamePasswordSignUp'), v.literal('usernamePassword')), profile: v.object({}) }) },
  returns: v.id('users'),
  handler: async (ctx) => {
    if (!(await limiter.limit(ctx, 'createAccount')).ok) throw new ConvexError('가입이 몰리고 있습니다. 잠시 뒤 다시 시도해 주세요.');
    // Every account starts with the welcome coins.
    return await ctx.db.insert('users', { lastActiveAt: Date.now(), coins: WELCOME_COINS, coinsEarned: WELCOME_COINS, welcomed: true });
  },
});

/** Called by Convex Auth for every sign-in: a suspended account gets no session. */
export const onSignIn = internalMutation({
  args: { method: v.object({ name: v.union(v.literal('usernamePasswordSignUp'), v.literal('usernamePassword')), profile: v.object({}) }), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    if ((await ctx.db.get(userId))?.suspended) throw new ConvexError(SUSPENDED);
    await touch(ctx, userId);
    return null;
  },
});


/**
 * Makes an account and its nickname together: everything here is one transaction, so a refusal leaves nothing behind.
 * Hashing and the session are Convex Auth's.
 */
export const signUp = mutation({
  args: { username: v.string(), password: v.string(), nickname: v.string() },
  handler: async (ctx, args): Promise<Extract<SignUpResult, { status: 'complete' }>> => {
    const username = cleanUsername(args.username);
    if (username === null) throw new ConvexError('아이디는 영문으로 시작하는 4~20자의 영문·숫자·밑줄로 정해 주세요.');
    const name = await claimNickname(ctx, args.nickname, null, username);
    // Typed here: auth.ts and this file refer to each other through the generated api, a cycle TypeScript can't type.
    const r = (await ctx.runMutation(api.auth.signUpWithUsernamePassword, { username, password: args.password })) as SignUpResult;
    if (r.status === 'error') throw new ConvexError(SIGN_UP_ERRORS[r.userError.error] ?? '가입하지 못했습니다. 입력한 내용을 확인해 주세요.');
    await ctx.db.patch(r.tokens.userId as Id<'users'>, name);
    return r;
  },
});

export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ nickname: v.union(v.null(), v.string()) })),
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    const user = id === null ? null : await ctx.db.get(id);
    return user && { nickname: user.nickname ?? null };
  },
});

export const setNickname = mutation({
  args: { nickname: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const id = await requireUser(ctx);
    // Convex Auth's own sign-up is reachable too, and takes any id: one this game wouldn't allow stays nameless.
    const username = await ctx.runQuery(components.authUsername.public.getUsername, { userId: id });
    if (username === null || cleanUsername(username) === null) throw new ConvexError('이 계정은 사용할 수 없습니다. 새로 가입해 주세요.');
    const name = await claimNickname(ctx, args.nickname, id, username);
    await ctx.db.patch(id, name);
    return name.nickname;
  },
});
