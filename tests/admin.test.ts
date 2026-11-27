import { costumeById } from '../src/shop';
// @vitest-environment edge-runtime
// The admin page's server side, with real sign-up, sign-in and sessions: nothing of Convex Auth is replaced.
import { registerUsername } from '@convex-dev/auth/components/username/test';
import { registerCore, sessionIdentity } from '@convex-dev/auth/test';
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import schema from '../convex/schema';
import { SIM_VERSION } from '../src/replay';
import { registerPassword } from './password-component';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const PASSWORD = 'rooftop-runner-77';

function setup() {
  const t = convexTest(schema, modules);
  registerCore(t); registerPassword(t); registerUsername(t); registerRateLimiter(t);
  const join = async (username: string, nickname: string) => {
    const r = await t.mutation(api.users.signUp, { username, password: PASSWORD, nickname });
    return { as: t.withIdentity(sessionIdentity(r.tokens)), id: r.tokens.userId as Id<'users'>, tokens: r.tokens };
  };
  const signIn = (username: string, password = PASSWORD) => t.mutation(api.auth.signInWithUsernamePassword, { username, password });
  return { t, join, signIn };
}
beforeAll(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://example.convex.cloud');
});

const page = { numItems: 10, cursor: null };
type As = Pick<ReturnType<typeof setup>['t'], 'query' | 'mutation'>;
/** Every admin call, against one member. */
const calls = (as: As, id: Id<'users'>) => [
  () => as.query(api.admin.stats, {}),
  () => as.query(api.admin.trends, {}),
  () => as.query(api.admin.members, { search: '', paginationOpts: page }),
  () => as.query(api.admin.members, { search: 'runner', paginationOpts: page }),
  () => as.query(api.admin.memberDetail, { id }),
  () => as.query(api.admin.logs, { paginationOpts: page }),
  () => as.mutation(api.admin.resetPassword, { id, password: 'new-password' }),
  () => as.mutation(api.admin.setSuspended, { id, suspended: true }),
  () => as.mutation(api.admin.revokeSessions, { id }),
  () => as.mutation(api.admin.adjustCoins, { id, delta: 100 }),
  () => as.mutation(api.admin.revokeCostume, { id, costume: 'neon', refund: true }),
];

describe('the admin page', () => {
  it('refuses guests and members, even one named after the admin', async () => {
    const { t, join } = setup();
    const a = await join('runner_a', '에이');
    const posing = await join('kvkvkv_2', 'kvkvkv');
    for (const as of [t, a.as, posing.as]) {
      expect(await as.query(api.admin.amI, {})).toBe(false);
      for (const call of calls(as, a.id)) await expect(call()).rejects.toThrow(/로그인|관리자만/);
    }
    // Nothing was changed by the refused calls.
    expect(await t.run((ctx) => ctx.db.query('adminLog').collect())).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(a.id)))?.suspended).toBeUndefined();
  });

  it('is open to the account with the id kvkvkv, and to no other', async () => {
    const { join } = setup();
    const admin = await join('KvKvKv', '운영자');
    const a = await join('runner_a', '에이');
    expect(await admin.as.query(api.admin.amI, {})).toBe(true);
    await a.as.mutation(api.ranking.start, { version: SIM_VERSION });
    const stats = await admin.as.query(api.admin.stats, {});
    expect(stats).toMatchObject({ members: 2, signups7d: 2, active7d: 2, plays7d: 1, playsToday: 1, suspended: 0 });
    const list = await admin.as.query(api.admin.members, { search: '', paginationOpts: page });
    expect(list.page.map((m) => [m.username, m.nickname, m.admin, m.plays])).toEqual([['runner_a', '에이', false, 1], ['kvkvkv', '운영자', true, 0]]);
    expect((await admin.as.query(api.admin.members, { search: 'RUNNER_A', paginationOpts: page })).page.map((m) => m.nickname)).toEqual(['에이']);
    expect((await admin.as.query(api.admin.members, { search: '에', paginationOpts: page })).page.map((m) => m.nickname)).toEqual(['에이']);
    expect(await admin.as.query(api.admin.memberDetail, { id: a.id })).toMatchObject({ sessions: 1, member: { nickname: '에이' } });
    // When each last signed in and played, and the last 14 days with today's play.
    const [ra] = list.page;
    expect(ra).toMatchObject({ runs7d: 0, weekBest: null, coins: expect.any(Number), costumes: 0 });
    expect(ra!.lastLoginAt).toBeGreaterThan(0);
    expect(ra!.lastPlayAt).toBeGreaterThan(0);
    expect(list.page[1]!.lastPlayAt).toBeNull();
    const trends = await admin.as.query(api.admin.trends, {});
    expect(trends.days).toHaveLength(14);
    expect(trends.days[13]).toMatchObject({ plays: 1, signups: 2 });
    expect(trends.recent).toEqual([expect.objectContaining({ nickname: '에이', status: 'open' })]);
  });

  it('gives and takes coins, never below zero, and takes a costume back with or without a refund', async () => {
    const { join } = setup();
    const admin = await join('kvkvkv', '운영자');
    const a = await join('runner_a', '에이');
    const start = (await a.as.query(api.shop.mine, {}))!.coins;
    const price = costumeById('neon').price;
    expect(await admin.as.mutation(api.admin.adjustCoins, { id: a.id, delta: price })).toMatchObject({ coins: start + price });
    await a.as.mutation(api.shop.buy, { id: 'neon' });
    expect((await admin.as.query(api.admin.memberDetail, { id: a.id })).shop).toEqual({ coins: start, coinsEarned: start + price, owned: ['neon'], costume: 'neon' });
    expect(await admin.as.mutation(api.admin.revokeCostume, { id: a.id, costume: 'neon', refund: true })).toEqual({ coins: start + price, coinsEarned: start + price, owned: [], costume: 'courier' });
    await expect(admin.as.mutation(api.admin.revokeCostume, { id: a.id, costume: 'neon', refund: false })).rejects.toThrow('가지고 있지 않은');
    expect(await admin.as.mutation(api.admin.adjustCoins, { id: a.id, delta: -10_000_00 })).toMatchObject({ coins: 0 });
    await expect(admin.as.mutation(api.admin.adjustCoins, { id: a.id, delta: 1.5 })).rejects.toThrow('정수');
    const logs = (await admin.as.query(api.admin.logs, { paginationOpts: page })).page;
    expect(logs.map((l) => [l.action, l.amount, l.note ?? null])).toEqual([['coins', -(start + price), null], ['revokeCostume', price, 'neon'], ['coins', price, null]]);
  });

  it('resets a password: the new one signs in, the old one and old sessions stop working', async () => {
    const { t, join, signIn } = setup();
    const admin = await join('kvkvkv', '운영자');
    const a = await join('runner_a', '에이');
    await expect(admin.as.mutation(api.admin.resetPassword, { id: a.id, password: 'short' })).rejects.toThrow('8자 이상');
    expect(await admin.as.mutation(api.admin.resetPassword, { id: a.id, password: 'abcdefgh' })).toEqual({ sessions: 1 });
    expect(await a.as.query(api.users.me)).toBeNull();
    await expect(a.as.mutation(api.ranking.start, { version: SIM_VERSION })).rejects.toThrow('로그인');
    expect(await signIn('runner_a')).toMatchObject({ status: 'error', userError: { error: 'INVALID_CREDENTIALS' } });
    const r = await signIn('runner_a', 'abcdefgh');
    if (r.status !== 'complete') throw new Error('not signed in');
    expect(await t.withIdentity(sessionIdentity(r.tokens)).query(api.users.me)).toEqual({ nickname: '에이' });
    // The admin resetting their own password keeps the session they did it from.
    await admin.as.mutation(api.admin.resetPassword, { id: admin.id, password: 'another-pass' });
    expect(await admin.as.query(api.admin.amI, {})).toBe(true);
  });

  it('suspends: sessions end, sign-in and play are refused, and restoring lets the member back', async () => {
    const { join, signIn, t } = setup();
    const admin = await join('kvkvkv', '운영자');
    const a = await join('runner_a', '에이');
    await expect(admin.as.mutation(api.admin.setSuspended, { id: admin.id, suspended: true })).rejects.toThrow('정지할 수 없');
    expect(await admin.as.mutation(api.admin.setSuspended, { id: a.id, suspended: true })).toEqual({ sessions: 1 });
    expect(await a.as.query(api.users.me)).toBeNull();
    await expect(signIn('runner_a')).rejects.toThrow('정지된 계정');
    expect((await admin.as.query(api.admin.stats, {})).suspended).toBe(1);
    await admin.as.mutation(api.admin.setSuspended, { id: a.id, suspended: false });
    const r = await signIn('runner_a');
    if (r.status !== 'complete') throw new Error('not signed in');
    await t.withIdentity(sessionIdentity(r.tokens)).mutation(api.ranking.start, { version: SIM_VERSION });
    const logs = await admin.as.query(api.admin.logs, { paginationOpts: page });
    expect(logs.page.map((l) => l.action)).toEqual(['unsuspend', 'suspend']);
  });

  it('a session kept by a suspended member does nothing online', async () => {
    const { join, t } = setup();
    const a = await join('runner_a', '에이');
    // As if the suspension came while a request was on its way: the flag alone refuses.
    await t.run((ctx) => ctx.db.patch(a.id, { suspended: true }));
    await expect(a.as.mutation(api.ranking.start, { version: SIM_VERSION })).rejects.toThrow('정지된 계정');
    await expect(a.as.mutation(api.users.setNickname, { nickname: '새이름' })).rejects.toThrow('정지된 계정');
  });

  it('never answers with a password, hash, token or session id', async () => {
    const { join, t } = setup();
    const admin = await join('kvkvkv', '운영자');
    const a = await join('runner_a', '에이');
    await admin.as.mutation(api.admin.resetPassword, { id: a.id, password: 'secret-word-1' });
    await admin.as.mutation(api.admin.revokeSessions, { id: a.id });
    const answers = JSON.stringify([
      await admin.as.query(api.admin.stats, {}),
      await admin.as.query(api.admin.members, { search: '', paginationOpts: page }),
      await admin.as.query(api.admin.memberDetail, { id: a.id }),
      await admin.as.query(api.admin.logs, { paginationOpts: page }),
      await t.run((ctx) => ctx.db.query('adminLog').collect()),
    ]);
    for (const secret of [PASSWORD, 'secret-word-1', '$argon2', '$scrypt', a.tokens.accessToken, a.tokens.refreshToken, admin.tokens.refreshToken])
      expect(answers).not.toContain(secret);
    expect(answers).not.toMatch(/session[A-Z]?[a-z]*Id|token/i);
  });
});
