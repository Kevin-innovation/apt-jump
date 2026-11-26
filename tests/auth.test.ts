// @vitest-environment edge-runtime
// Real sign-up, sign-in and sessions: Convex Auth's own components run here, nothing is replaced.
import type { SignUpResult } from '@convex-dev/auth/methods/username-password/server';
import { registerPassword } from './password-component';
import { registerUsername } from '@convex-dev/auth/components/username/test';
import { registerCore, sessionIdentity } from '@convex-dev/auth/test';
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import { PRACTICE, serializeMap } from '../src/maps';
import { SIM_VERSION } from '../src/replay';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const PASSWORD = 'rooftop-runner-77';

function setup() {
  const t = convexTest(schema, modules);
  registerCore(t);
  registerPassword(t);
  registerUsername(t);
  registerRateLimiter(t);
  const join = async (username: string, nickname: string, password = PASSWORD) => {
    const r = await t.mutation(api.users.signUp, { username, password, nickname });
    return t.withIdentity(sessionIdentity(r.tokens));
  };
  const signIn = (username: string, password = PASSWORD) => t.mutation(api.auth.signInWithUsernamePassword, { username, password });
  return { t, join, signIn };
}
beforeAll(() => {
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://example.convex.cloud');
});

describe('sign-up', () => {
  it('makes a working session with the chosen nickname', async () => {
    const { join } = setup();
    const a = await join('Runner_1', ' 옥상  왕 ');
    expect(await a.query(api.users.me)).toEqual({ nickname: '옥상 왕' });
    expect(await a.mutation(api.ranking.start, { version: SIM_VERSION })).toMatchObject({ seed: expect.any(Number) });
  });
  it('keeps the id and password out of the players’ table, and never returns them', async () => {
    const { t, join } = setup();
    const a = await join('runner_1', '옥상왕');
    const rows = JSON.stringify(await t.run((ctx) => ctx.db.query('users').collect()));
    expect(rows).not.toMatch(/runner_1|rooftop|argon/);
    expect(JSON.stringify(await a.query(api.users.me))).not.toContain('runner_1');
  });
  it('refuses an id already used, whatever its case', async () => {
    const { t, join } = setup();
    await join('runner_1', '옥상왕');
    for (const id of ['runner_1', 'RUNNER_1', ' Runner_1 ']) await expect(join(id, '다른이름')).rejects.toThrow('이미 쓰는 아이디');
    expect(await t.run((ctx) => ctx.db.query('users').collect())).toHaveLength(1);
  });
  it.each(['', 'abc', '1runner', 'has space', '한글아이디', 'a'.repeat(21), 'x@example.com', 'a-b-c-d'])('refuses the id "%s"', async (id) => {
    await expect(setup().join(id, '옥상왕')).rejects.toThrow('아이디는');
  });
  it.each([['short77', '8자 이상'], ['p'.repeat(101), '100자까지'], [' spaced-out-77', '공백']])('refuses the password "%s"', async (password, why) => {
    const { t, join } = setup();
    await expect(join('runner_1', '옥상왕', password)).rejects.toThrow(why);
    expect(await t.run((ctx) => ctx.db.query('users').collect())).toEqual([]);
    await join('runner_1', '옥상왕'); // nothing was left behind
  });
  it.each(['12345678', 'abcdefgh', 'password', 'rooftopx', 'p'.repeat(100), '한글비밀번호입니다'])('takes any password of 8 to 100 characters, such as "%s", and signs in with it', async (password) => {
    const { t, join, signIn } = setup();
    const a = await join('runner_1', '옥상왕', password);
    expect(await a.query(api.users.me)).toEqual({ nickname: '옥상왕' });
    const r = await signIn('runner_1', password);
    if (r.status !== 'complete') throw new Error('not signed in');
    expect(await t.withIdentity(sessionIdentity(r.tokens)).query(api.users.me)).toEqual({ nickname: '옥상왕' });
    expect(await signIn('runner_1', `${password.slice(0, -1)}!`)).toMatchObject({ status: 'error', userError: { error: 'INVALID_CREDENTIALS' } });
  });
  it('refuses a nickname that is taken, bad, or the secret id, and leaves no account', async () => {
    const { join, signIn } = setup();
    await join('runner_1', '옥상왕');
    await expect(join('runner_2', '옥 상.왕')).rejects.toThrow('이미 쓰는 닉네임');
    await expect(join('runner_2', '<b>')).rejects.toThrow('닉네임은');
    await expect(join('runner_2', 'Runner 2')).rejects.toThrow('아이디와 다르게');
    expect(await signIn('runner_2')).toMatchObject({ status: 'error' });
    await join('runner_2', '옥상여왕');
  });
  it('is limited, so accounts can’t be made in bulk', async () => {
    const { t } = setup();
    let made = 0, refused = '';
    for (let i = 0; i < 60 && !refused; i++)
      await t.mutation(api.auth.signUpWithUsernamePassword, { username: `bulk${i}`, password: PASSWORD }).then(() => { made++; }, (e) => { refused = String(e); });
    expect(refused).toContain('가입이 몰리고');
    expect(made).toBeLessThanOrEqual(45);
  }, 60_000);
});

describe('sign-in', () => {
  it('works with the right password, in any case of the id', async () => {
    const { t, join, signIn } = setup();
    await join('runner_1', '옥상왕');
    const r = await signIn('RUNNER_1');
    if (r.status !== 'complete') throw new Error('not signed in');
    expect(await t.withIdentity(sessionIdentity(r.tokens)).query(api.users.me)).toEqual({ nickname: '옥상왕' });
  });
  it('refuses a wrong password, then slows guessing down', async () => {
    const { join, signIn } = setup();
    await join('runner_1', '옥상왕');
    const errors: string[] = [];
    for (let i = 0; i < 6; i++) { const r = await signIn('runner_1', `wrong-password-${i}`); errors.push(r.status === 'error' ? r.userError.error : r.status); }
    expect(errors.slice(0, 5)).toEqual(Array(5).fill('INVALID_CREDENTIALS'));
    expect(errors[5]).toBe('RATE_LIMITED');
  });
  it('ends with signing out', async () => {
    const { t, join, signIn } = setup();
    await join('runner_1', '옥상왕');
    const r = await signIn('runner_1');
    if (r.status !== 'complete') throw new Error('not signed in');
    const a = t.withIdentity(sessionIdentity(r.tokens));
    await a.mutation(api.auth.signOut, { refreshToken: r.tokens.refreshToken });
    expect(await a.query(api.users.me)).toBeNull();
    await expect(a.mutation(api.ranking.start, { version: SIM_VERSION })).rejects.toThrow('로그인');
  });
});

it('a nickname changes only its owner, and stays unique', async () => {
  const { join } = setup();
  const a = await join('runner_a', '에이'), b = await join('runner_b', '비이');
  expect(await a.mutation(api.users.setNickname, { nickname: '  옥상  대장 ' })).toBe('옥상 대장');
  expect(await a.query(api.users.me)).toEqual({ nickname: '옥상 대장' });
  expect(await b.query(api.users.me)).toEqual({ nickname: '비이' });
  await expect(b.mutation(api.users.setNickname, { nickname: '옥상대장' })).rejects.toThrow('이미 쓰는');
  await a.mutation(api.users.setNickname, { nickname: '옥상.대장' });
  for (const bad of ['가', 'x'.repeat(17), 'me@example.com', '<b>hi</b>', '   ', '__', 'a'.repeat(100)])
    await expect(a.mutation(api.users.setNickname, { nickname: bad })).rejects.toThrow();
});

it('the board shows nicknames, as they are now, and no ids', async () => {
  const { t, join } = setup();
  const a = await join('runner_a', '에이');
  const [user] = await t.run((ctx) => ctx.db.query('users').collect());
  await t.run((ctx) => ctx.db.insert('scores', { week: '2026-11-23', release: 'initial', version: SIM_VERSION, userId: user!._id, score: 10, distance: 9, achievedAt: 1 }));
  expect((await t.query(api.ranking.board, { week: '2026-11-23' })).top).toEqual([{ rank: 1, nickname: '에이', title: null, score: 10, distance: 9, mine: false }]);
  await a.mutation(api.users.setNickname, { nickname: '새이름' });
  expect((await a.query(api.ranking.board, { week: '2026-11-23' })).top).toEqual([{ rank: 1, nickname: '새이름', title: null, score: 10, distance: 9, mine: true }]);
});

describe('an account made past the game’s own sign-up', () => {
  const bare = async (username: string) => {
    const s = setup();
    const r = (await s.t.mutation(api.auth.signUpWithUsernamePassword, { username, password: PASSWORD })) as SignUpResult;
    if (r.status !== 'complete') throw new Error('not made');
    return { ...s, a: s.t.withIdentity(sessionIdentity(r.tokens)) };
  };
  it('can do nothing online until it has a nickname', async () => {
    const { a } = await bare('runner_1');
    expect(await a.query(api.users.me)).toEqual({ nickname: null });
    await expect(a.mutation(api.ranking.start, { version: SIM_VERSION })).rejects.toThrow('닉네임을 먼저');
    await expect(a.mutation(api.maps.publish, { json: serializeMap(PRACTICE) })).rejects.toThrow('닉네임을 먼저');
    await expect(a.mutation(api.users.setNickname, { nickname: 'RUNNER-1' })).rejects.toThrow('아이디와 다르게');
    expect(await a.mutation(api.users.setNickname, { nickname: '옥상왕' })).toBe('옥상왕');
    await a.mutation(api.ranking.start, { version: SIM_VERSION });
  });
  it('never gets a nickname with an id the game wouldn’t allow', async () => {
    const { a } = await bare('관리자 😀');
    await expect(a.mutation(api.users.setNickname, { nickname: '옥상왕' })).rejects.toThrow('새로 가입');
  });
  it('can’t take an id that differs only in case', async () => {
    const { t } = await bare('Runner_1');
    expect(await t.mutation(api.auth.signUpWithUsernamePassword, { username: 'rUNNER_1', password: PASSWORD })).toMatchObject({ status: 'error', userError: { error: 'USERNAME_TAKEN' } });
    await expect(t.mutation(api.users.signUp, { username: 'runner_1', password: PASSWORD, nickname: '옥상왕' })).rejects.toThrow('이미 쓰는 아이디');
  });
});
