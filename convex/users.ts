import { getAuthUserId } from '@convex-dev/auth/server';
import { vGoogleProfile } from '@convex-dev/auth/methods/google/server';
import { ConvexError, v } from 'convex/values';
import { cleanNickname, nicknameKey } from '../src/nickname';
import type { Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';

/** The signed-in player, or an error. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const id = await getAuthUserId(ctx);
  if (id === null) throw new ConvexError('로그인이 필요합니다.');
  return id as Id<'users'>;
}

const taken = async (ctx: MutationCtx, key: string) => (await ctx.db.query('users').withIndex('by_nickKey', (q) => q.eq('nickKey', key)).first()) ?? null;

export const createUser = internalMutation({
  args: { method: v.object({ name: v.literal('google'), profile: vGoogleProfile }) },
  returns: v.id('users'),
  // A made-up nickname: nothing from the Google profile becomes public.
  handler: async (ctx) => {
    for (let i = 0; i < 20; i++) {
      const nickname = `주자${100000 + Math.floor(Math.random() * 900000)}`;
      const nickKey = nicknameKey(nickname);
      if (await taken(ctx, nickKey)) continue;
      return await ctx.db.insert('users', { nickname, nickKey });
    }
    throw new ConvexError('계정을 만들지 못했습니다. 다시 로그인해 주세요.');
  },
});

export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ nickname: v.string() })),
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    const user = id === null ? null : await ctx.db.get(id as Id<'users'>);
    return user && { nickname: user.nickname };
  },
});

export const setNickname = mutation({
  args: { nickname: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const id = await requireUser(ctx);
    const nickname = cleanNickname(args.nickname);
    if (nickname === null) throw new ConvexError('닉네임은 2~16자의 글자·숫자로 정해 주세요.');
    const nickKey = nicknameKey(nickname);
    if (nickKey.length < 2) throw new ConvexError('닉네임은 2~16자의 글자·숫자로 정해 주세요.');
    const other = await taken(ctx, nickKey);
    if (other && other._id !== id) throw new ConvexError('이미 쓰는 닉네임입니다.');
    await ctx.db.patch(id, { nickname, nickKey });
    return nickname;
  },
});
