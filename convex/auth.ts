import { setupConvexAuth } from '@convex-dev/auth/server';
import { setupGoogle } from '@convex-dev/auth/methods/google/server';
import { components, internal } from './_generated/api';

declare const process: { env: Record<string, string | undefined> };
/** Where sign-in may return to. A development deployment sets SITE_ORIGINS, comma separated. */
const origins = (process.env.SITE_ORIGINS ?? 'https://apt-jump-wine.vercel.app').split(',').map((s) => s.trim()).filter(Boolean);

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(auth, {
  component: components.authGoogle,
  allowedRedirectOrigins: origins,
}).attachUserCallbacks({ createUser: internal.users.createUser });
