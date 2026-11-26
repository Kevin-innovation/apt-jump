import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Only a public nickname. The id and password hash live in Convex Auth's own components.
  // A bare account, made without users.signUp, has no nickname and can't play online.
  // suspended: set by the admin; such an account can't sign in or do anything online. lastActiveAt, plays: for the admin page.
  users: defineTable({
    nickname: v.optional(v.string()), nickKey: v.optional(v.string()),
    suspended: v.optional(v.boolean()), lastActiveAt: v.optional(v.number()), plays: v.optional(v.number()),
    // Id of an earned title, chosen by the player; read by the leaderboard through a pure lookup.
    equippedTitle: v.optional(v.string()),
    // The shop: coins from verified weekly runs (balance and all ever earned), costumes bought and the one worn.
    coins: v.optional(v.number()), coinsEarned: v.optional(v.number()),
    owned: v.optional(v.array(v.string())), costume: v.optional(v.string()),
    // The welcome coins were paid; the earned achievement shown as a badge by the title.
    welcomed: v.optional(v.boolean()), badge: v.optional(v.string()),
  }).index('by_nickKey', ['nickKey']).index('by_lastActive', ['lastActiveAt']),

  // One issued run. It can be handed in once, by the player it was issued to.
  runs: defineTable({
    userId: v.id('users'), seed: v.number(), version: v.number(), release: v.optional(v.string()), startedAt: v.number(),
    // The city's stretch seeds, handed out as the run goes (seed is the first). Absent on runs from before them.
    seeds: v.optional(v.array(v.number())),
    status: v.union(v.literal('open'), v.literal('claimed'), v.literal('done'), v.literal('rejected')),
  }).index('by_user_started', ['userId', 'startedAt']),

  // Players' bests by week. A week has one board over every row, whatever its version or release (kept only as a note);
  // a player with several rows is shown by the highest. Rows are never deleted.
  scores: defineTable({
    week: v.string(), version: v.optional(v.number()), release: v.optional(v.string()), userId: v.id('users'), score: v.number(), distance: v.number(), achievedAt: v.number(),
  }).index('by_board_score', ['week', 'version', 'score']).index('by_board_user', ['week', 'version', 'userId'])
    .index('by_release_score', ['week', 'release', 'version', 'score']).index('by_release_user', ['week', 'release', 'version', 'userId'])
    .index('by_week_score', ['week', 'score']).index('by_week_user_score', ['week', 'userId', 'score']),
  // release/builtAt: the newest production build, for the update notice. resetWeek/resetAt: an operator's fresh start of
  // one week, whose records achieved before resetAt stay stored but are on no board (ranking.resetCurrentWeek).
  leaderboardState: defineTable({ key: v.string(), release: v.string(), builtAt: v.number(), resetWeek: v.optional(v.string()), resetAt: v.optional(v.number()) }).index('by_key', ['key']),

  // What a list needs; the map itself is read one at a time.
  maps: defineTable({
    ownerId: v.id('users'), title: v.string(), segments: v.number(), bodyId: v.id('mapBodies'), updatedAt: v.number(),
  }).index('by_owner', ['ownerId']).index('by_updated', ['updatedAt']),
  // A map's content. A change makes a new one, so that times always belong to what was played.
  mapBodies: defineTable({ json: v.string() }),

  // One issued run of a published map, fixed to a content; handed in once.
  mapRuns: defineTable({
    userId: v.id('users'), mapId: v.id('maps'), bodyId: v.id('mapBodies'), version: v.number(), startedAt: v.number(),
    status: v.union(v.literal('open'), v.literal('claimed'), v.literal('done'), v.literal('rejected')),
  }).index('by_user_started', ['userId', 'startedAt']),
  // Each player's fastest completion of each content of a map, for all time.
  mapTimes: defineTable({
    mapId: v.id('maps'), bodyId: v.id('mapBodies'), userId: v.id('users'), timeMs: v.number(), achievedAt: v.number(),
  }).index('by_body_time', ['bodyId', 'timeMs']).index('by_body_user', ['bodyId', 'userId']),

  // Runs started each day (KST date), for the admin page: runs themselves are cleared after a day.
  dailyStats: defineTable({ day: v.string(), plays: v.number() }).index('by_day', ['day']),
  // What the admin did. Never a password, hash, token or session id.
  adminLog: defineTable({
    adminId: v.id('users'), targetId: v.id('users'), targetName: v.string(),
    action: v.union(v.literal('resetPassword'), v.literal('suspend'), v.literal('unsuspend'), v.literal('revokeSessions')),
    sessions: v.number(),
  }),

  // Progress starts with the first verified normal run after this update; old scores are never backfilled.
  achievementProgress: defineTable({
    userId: v.id('users'), runs: v.number(), slides: v.number(), stomps: v.number(), perfects: v.number(),
    maxScore: v.number(), maxDistance: v.number(), maxCombo: v.number(),
  }).index('by_user', ['userId']),
  // One row per earned achievement and player. Unlocks are never removed.
  // `paid`: its coin reward has been paid (unlocks from before rewards are paid once by shop.backfill).
  achievementUnlocks: defineTable({ userId: v.id('users'), achievementId: v.string(), paid: v.optional(v.boolean()) })
    .index('by_user', ['userId']).index('by_user_achievement', ['userId', 'achievementId']),
  // 'participants' and one row per achievement id: the denominator and numerator of the earned percentage.
  achievementCounts: defineTable({ key: v.string(), count: v.number() }).index('by_key', ['key']),
});
