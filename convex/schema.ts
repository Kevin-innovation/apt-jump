import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Only a public nickname. The id and password hash live in Convex Auth's own components.
  // A bare account, made without users.signUp, has no nickname and can't play online.
  // suspended: set by the admin; such an account can't sign in or do anything online. lastActiveAt, plays: for the admin page.
  users: defineTable({
    nickname: v.optional(v.string()), nickKey: v.optional(v.string()),
    suspended: v.optional(v.boolean()), lastActiveAt: v.optional(v.number()), plays: v.optional(v.number()),
  }).index('by_nickKey', ['nickKey']).index('by_lastActive', ['lastActiveAt']),

  // One issued run. It can be handed in once, by the player it was issued to.
  runs: defineTable({
    userId: v.id('users'), seed: v.number(), version: v.number(), release: v.optional(v.string()), startedAt: v.number(),
    status: v.union(v.literal('open'), v.literal('claimed'), v.literal('done'), v.literal('rejected')),
  }).index('by_user_started', ['userId', 'startedAt']),

  // Each player's best of each week, for one version of the game's rules: scores made under others never mix.
  // Past weeks and versions stay. Rows from before versions were recorded have none, and are on no board.
  scores: defineTable({
    week: v.string(), version: v.optional(v.number()), release: v.optional(v.string()), userId: v.id('users'), score: v.number(), distance: v.number(), achievedAt: v.number(),
  }).index('by_board_score', ['week', 'version', 'score']).index('by_board_user', ['week', 'version', 'userId'])
    .index('by_release_score', ['week', 'release', 'version', 'score']).index('by_release_user', ['week', 'release', 'version', 'userId']),
  leaderboardState: defineTable({ key: v.string(), release: v.string(), builtAt: v.number() }).index('by_key', ['key']),

  // What a list needs; the map itself is read one at a time.
  maps: defineTable({
    ownerId: v.id('users'), title: v.string(), segments: v.number(), bodyId: v.id('mapBodies'), updatedAt: v.number(),
  }).index('by_owner', ['ownerId']).index('by_updated', ['updatedAt']),
  mapBodies: defineTable({ json: v.string() }),

  // Runs started each day (KST date), for the admin page: runs themselves are cleared after a day.
  dailyStats: defineTable({ day: v.string(), plays: v.number() }).index('by_day', ['day']),
  // What the admin did. Never a password, hash, token or session id.
  adminLog: defineTable({
    adminId: v.id('users'), targetId: v.id('users'), targetName: v.string(),
    action: v.union(v.literal('resetPassword'), v.literal('suspend'), v.literal('unsuspend'), v.literal('revokeSessions')),
    sessions: v.number(),
  }),
});
