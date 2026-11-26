// Mounted as "authPassword", as Convex Auth's own was, so that the stored passwords stay where they are.
// Copied from Convex Auth 2.1.0 (@convex-dev/auth, src/components/password), Copyright Convex, Inc.,
// Apache License 2.0: LICENSES/convex-dev_auth-Apache-2.0.txt. Source: https://github.com/get-convex/convex-auth
// Unchanged for 아파트 점프 but for import paths: only validation.ts differs (marked "Changed:").
import { defineComponent } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

/**
 * The password component.
 *
 * Securely stores and verifies passwords, keyed only by an opaque `userId`. It
 * holds no email/username and knows nothing about the identity behind a user id
 * — intentionally reusable in any context. The app owns the users table and
 * maps its own identifiers onto the `userId` it passes in.
 *
 * Mounts the rate-limiter component to throttle `verifyPassword` per user id.
 */
const component = defineComponent("authPassword");
component.use(rateLimiter);

export default component;
