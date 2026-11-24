import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Only a nickname: the Google profile and email are not kept.
  users: defineTable({ nickname: v.string(), nickKey: v.string() }).index('by_nickKey', ['nickKey']),

  // One issued run. It can be handed in once, by the player it was issued to.
  runs: defineTable({
    userId: v.id('users'), seed: v.number(), version: v.number(), startedAt: v.number(),
    status: v.union(v.literal('open'), v.literal('claimed'), v.literal('done'), v.literal('rejected')),
  }).index('by_user_started', ['userId', 'startedAt']),

  // Each player's best of each week. Past weeks stay.
  scores: defineTable({
    week: v.string(), userId: v.id('users'), score: v.number(), distance: v.number(), achievedAt: v.number(),
  }).index('by_week_score', ['week', 'score']).index('by_week_user', ['week', 'userId']),

  // What a list needs; the map itself is read one at a time.
  maps: defineTable({
    ownerId: v.id('users'), title: v.string(), segments: v.number(), bodyId: v.id('mapBodies'), updatedAt: v.number(),
  }).index('by_owner', ['ownerId']).index('by_updated', ['updatedAt']),
  mapBodies: defineTable({ json: v.string() }),
});
