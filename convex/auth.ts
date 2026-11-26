import { setupUsernamePassword, type SignUpResult } from '@convex-dev/auth/methods/username-password/server';
import { setupConvexAuth } from '@convex-dev/auth/server';
import type { FunctionReference, RegisteredMutation } from 'convex/server';
import { ConvexError, v, type PropertyValidators } from 'convex/values';
import { PASSWORD_MAX, PASSWORD_MIN, SIGN_UP_ERRORS } from '../src/username';
import { components, internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

// Signing in is Convex Auth's own, unchanged.
export const { signInWithUsernamePassword } = setupUsernamePassword(auth, {
  component: components.authPassword,
  usernameComponent: components.authUsername,
}).attachUserCallbacks({ createUser: internal.users.createUser, onSignIn: internal.users.onSignIn });

type Tokens = Extract<SignUpResult, { status: 'complete' }>['tokens'];
type SignUpArgs = { username: string; password: string };
type SignUpCtx = MutationCtx & { convexAuth: { completeSignUp(a: { profile: Record<string, never>; authenticatedBy: object }): Promise<Tokens> } };
type SignUpMutation = RegisteredMutation<'public', SignUpArgs, Promise<SignUpResult>>;
/** Convex Auth's builder for a sign-in method's own functions (in its types as internal, see DEVELOPMENT.md). */
type BindMethod = (o: { name: string; createUser: FunctionReference<'mutation', 'internal'>; onSignIn: FunctionReference<'mutation', 'internal'> }) => {
  authMutation(fn: { args: PropertyValidators; handler: (ctx: SignUpCtx, args: SignUpArgs) => Promise<SignUpResult> }): SignUpMutation;
};
const bindMethod = (auth as unknown as { bindMethod: BindMethod }).bindMethod;

const refuse = (code: string): never => { throw new ConvexError(SIGN_UP_ERRORS[code] ?? '가입하지 못했습니다. 입력한 내용을 확인해 주세요.'); };

/**
 * Convex Auth's username-password sign-up fixes a 10-character minimum; the game asks for 8 and nothing else.
 * These are its steps with that one number changed. The username is stored by Convex Auth's username component, and
 * the password hashed and stored by the game's copy of its password component (components/authPassword), which drops
 * only its list of common passwords: the game's one rule is the length.
 */
export const signUpWithUsernamePassword: SignUpMutation = bindMethod({ name: 'usernamePasswordSignUp', createUser: internal.users.createUser, onSignIn: internal.users.onSignIn }).authMutation({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, { username, password }): Promise<SignUpResult> => {
    // Refusals before the account exists are answered as Convex Auth's own sign-up answers them.
    const length = [...password].length;
    if (length < PASSWORD_MIN) return { status: 'error', userError: { error: 'PASSWORD_TOO_SHORT', minimumLength: PASSWORD_MIN } };
    if (length > PASSWORD_MAX) return { status: 'error', userError: { error: 'PASSWORD_TOO_LONG', maximumLength: PASSWORD_MAX } };
    if (/^\s|\s$/u.test(password)) return { status: 'error', userError: { error: 'PASSWORD_HAS_SURROUNDING_WHITESPACE' } };
    if ((await ctx.runQuery(components.authUsername.public.getUserIdByUsername, { username })) !== null)
      return { status: 'error', userError: { error: 'USERNAME_TAKEN' } };
    // From here on a refusal throws, so that no part of the account is kept.
    const tokens = await ctx.convexAuth.completeSignUp({ profile: {}, authenticatedBy: components.authPassword });
    const named = await ctx.runMutation(components.authUsername.public.setUsername, { userId: tokens.userId, username });
    if (!named.success) refuse(named.userError.error);
    const set = await ctx.runMutation(components.authPassword.public._internal_dangerous_setPassword, { userId: tokens.userId, password, minimumLength: PASSWORD_MIN });
    if (!set.success) refuse(set.userError.error);
    return { status: 'complete', tokens };
  },
});
