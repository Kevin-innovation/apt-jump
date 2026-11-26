import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { achievementReward, WELCOME_COINS } from '../src/achievements';
import { COSTUMES, DEFAULT_COSTUME } from '../src/shop';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { requirePlayer } from './users';

// The shop: the server alone moves coins, and sells only what the shared catalog lists, at its prices.

const state = v.object({ coins: v.number(), owned: v.array(v.string()), costume: v.string() });
type State = { coins: number; owned: string[]; costume: string };

function view(user: Doc<'users'>): State {
  const owned = user.owned ?? [];
  return { coins: user.coins ?? 0, owned: [DEFAULT_COSTUME, ...owned.filter((id) => id !== DEFAULT_COSTUME)], costume: user.costume ?? DEFAULT_COSTUME };
}

/** Pays a verified run's coins. Called by ranking.settle once per run, never by a page. */
export async function credit(ctx: MutationCtx, userId: Id<'users'>, coins: number): Promise<void> {
  const n = Number.isFinite(coins) && coins > 0 ? Math.floor(coins) : 0;
  if (!n) return;
  const user = await ctx.db.get(userId);
  if (!user) return;
  await ctx.db.patch(userId, { coins: (user.coins ?? 0) + n, coinsEarned: (user.coinsEarned ?? 0) + n });
}

/** The player's coins, costumes and the one worn; null for a guest. */
export const mine = query({
  args: {},
  returns: v.union(v.null(), state),
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    const user = id && (await ctx.db.get(id as Id<'users'>));
    return user ? view(user) : null;
  },
});

/** Buys a costume and puts it on. */
export const buy = mutation({
  args: { id: v.string() },
  returns: state,
  handler: async (ctx, { id }) => {
    const userId = await requirePlayer(ctx);
    const user = (await ctx.db.get(userId))!;
    const item = COSTUMES.find((c) => c.id === id);
    if (!item) throw new ConvexError('없는 상품입니다.');
    const owned = user.owned ?? [];
    if (item.price === 0 || owned.includes(id)) throw new ConvexError('이미 가지고 있어요.');
    const coins = user.coins ?? 0;
    if (coins < item.price) throw new ConvexError('코인이 모자라요.');
    await ctx.db.patch(userId, { coins: coins - item.price, owned: [...owned, id], costume: id });
    return view((await ctx.db.get(userId))!);
  },
});

/** Puts on a costume the player has. */
export const wear = mutation({
  args: { id: v.string() },
  returns: state,
  handler: async (ctx, { id }) => {
    const userId = await requirePlayer(ctx);
    const user = (await ctx.db.get(userId))!;
    if (id !== DEFAULT_COSTUME && !(user.owned ?? []).includes(id)) throw new ConvexError('가지고 있지 않은 코스튬이에요.');
    await ctx.db.patch(userId, { costume: id });
    return view((await ctx.db.get(userId))!);
  },
});

/**
 * Pays, once, what accounts from before the shop are owed: the welcome coins, and the reward of every achievement
 * already earned. Safe to run again: what was paid is marked. For the operator, from the CLI:
 *   npx convex run shop:backfill --prod
 */
export const backfill = internalMutation({
  args: {},
  returns: v.object({ welcomed: v.number(), rewards: v.number(), coins: v.number() }),
  handler: async (ctx) => {
    let welcomed = 0, rewards = 0, coins = 0;
    for (const user of await ctx.db.query('users').collect()) {
      if (user.welcomed) continue;
      await ctx.db.patch(user._id, { welcomed: true });
      await credit(ctx, user._id, WELCOME_COINS);
      welcomed++; coins += WELCOME_COINS;
    }
    for (const row of await ctx.db.query('achievementUnlocks').collect()) {
      if (row.paid) continue;
      const n = achievementReward(row.achievementId);
      await ctx.db.patch(row._id, { paid: true });
      await credit(ctx, row.userId, n);
      rewards++; coins += n;
    }
    return { welcomed, rewards, coins };
  },
});
