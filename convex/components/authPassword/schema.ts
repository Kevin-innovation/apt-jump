// Unchanged: the same table and index as Convex Auth's, so existing rows are read as they are.
// Copied from Convex Auth 2.1.0 (@convex-dev/auth, src/components/password), Copyright Convex, Inc.,
// Apache License 2.0: LICENSES/convex-dev_auth-Apache-2.0.txt. Source: https://github.com/get-convex/convex-auth
// Unchanged for 아파트 점프 but for import paths: only validation.ts differs (marked "Changed:").
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  passwords: defineTable({
    userId: v.string(),
    passwordHashPHC: v.string(), // format: https://github.com/C2SP/C2SP/blob/main/phc-strings.md
  }).index("by_userId", ["userId"]),
});
