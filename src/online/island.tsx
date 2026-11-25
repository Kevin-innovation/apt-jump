import { useSignInWithUsernamePassword } from '@convex-dev/auth/methods/username-password/react';
import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react';
import { ConvexReactClient, useConvexAuth, useQuery } from 'convex/react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { SIM_VERSION } from '../replay';
import { cleanUsername } from '../username';
import { errorText, Refusal, type Account, type Online } from './types';

const WRONG = '아이디나 비밀번호가 맞지 않습니다.';

/** A small React root that only carries Convex Auth; the game's screens stay plain DOM. */
export function connect(url: string): Online {
  // The game owns the leave warning so a scheduled upgrade can deliberately reload.
  const client = new ConvexReactClient(url, { unsavedChangesWarning: false });
  let pending = 0;
  const write = async <T,>(send: () => Promise<T>): Promise<T> => {
    pending++;
    try { return await send(); } finally { pending--; }
  };
  let account: Account = { status: 'loading', nickname: null };
  const watchers: (() => void)[] = [];
  type ReleaseInfo = { id: string; builtAt: number };
  let release: ReleaseInfo | null = null;
  let syncing: Promise<ReleaseInfo | null> | null = null;
  const ensureRelease = (): Promise<ReleaseInfo | null> => {
    if (release) return Promise.resolve(release);
    if (syncing) return syncing;
    syncing = client.action(api.ranking.syncRelease, {}).then(info => {
      release = info; watchers.forEach(f => f()); return info;
    }, () => null).finally(() => { syncing = null; });
    return syncing;
  };
  const notYet = async () => { throw new Refusal('아직 준비 중입니다. 잠시 뒤 다시 시도해 주세요.'); };
  let doSignIn: (username: string, password: string) => Promise<void> = notYet;
  let doSignUp: (username: string, password: string, nickname: string) => Promise<void> = notYet;
  let doSignOut: () => Promise<void> = async () => {};
  let offset = 0;
  const set = (a: Account) => {
    if (a.status === account.status && a.nickname === account.nickname) return;
    account = a;
    watchers.forEach((f) => f());
  };

  function Bridge(): null {
    const { isLoading, isAuthenticated } = useConvexAuth();
    const me = useQuery(api.users.me, isAuthenticated ? {} : 'skip');
    const { signIn } = useSignInWithUsernamePassword(api.auth);
    const { setSession, signOut } = useAuthActions();
    useEffect(() => {
      doSignIn = async (raw, password) => {
        const username = cleanUsername(raw);
        if (username === null) throw new Refusal(WRONG);
        const r = await signIn({ username, password });
        if (r.status === 'complete') return;
        if (r.userError.error === 'RATE_LIMITED') throw new Refusal('로그인을 너무 자주 시도했습니다. 1분쯤 뒤에 다시 해 주세요.');
        if (r.userError.error === 'OTHER_ERROR') throw new Refusal(errorText(r.userError.cause));
        throw new Refusal(WRONG);
      };
      doSignUp = async (username, password, nickname) => {
        const r = await client.mutation(api.users.signUp, { username, password, nickname });
        await setSession(r.tokens);
      };
      doSignOut = async () => { await signOut(); };
    }, [signIn, setSession, signOut]);
    useEffect(() => {
      if (isLoading || (isAuthenticated && me === undefined)) set({ status: 'loading', nickname: null });
      else if (isAuthenticated && me) set({ status: 'in', nickname: me.nickname });
      else set({ status: 'out', nickname: null });
    }, [isLoading, isAuthenticated, me]);
    return null;
  }

  const host = document.createElement('div');
  host.hidden = true;
  document.body.append(host);
  createRoot(host).render(
    <ConvexAuthProvider client={client} api={{ refreshSession: api.auth.refreshSession, signOut: api.auth.signOut, isAuthenticated: api.auth.isAuthenticated }}>
      <Bridge />
    </ConvexAuthProvider>,
  );
  client.mutation(api.ranking.clock, {}).then((t) => { offset = t - Date.now(); }, () => {});
  void ensureRelease();

  return {
    pending: () => pending > 0,
    account: () => account,
    release: () => release,
    onAccount: (f) => { watchers.push(f); },
    signIn: (username, password) => write(() => doSignIn(username, password)),
    signUp: (username, password, nickname) => write(() => doSignUp(username, password, nickname)),
    signOut: () => write(doSignOut),
    setNickname: (nickname) => write(() => client.mutation(api.users.setNickname, { nickname })),
    now: () => Date.now() + offset,
    start: () => write(async () => {
      if (!await ensureRelease()) throw new Refusal('새 난이도를 확인하는 중입니다. 잠시 뒤 다시 시작해 주세요.');
      return await client.mutation(api.ranking.start, { version: SIM_VERSION });
    }),
    finish: (runId, replay) => write(() => client.action(api.ranking.finish, { runId: runId as Id<'runs'>, replay })),
    board: async (week) => { await ensureRelease(); return await client.query(api.ranking.board, { week }); },
    listMaps: (order, cursor) => client.query(api.maps.list, { order, paginationOpts: { numItems: 10, cursor } }),
    getMap: (id) => client.query(api.maps.get, { id: id as Id<'maps'> }),
    publishMap: (json) => write(() => client.mutation(api.maps.publish, { json })),
    updateMap: async (id, json) => { await write(() => client.mutation(api.maps.update, { id: id as Id<'maps'>, json })); },
    removeMap: async (id) => { await write(() => client.mutation(api.maps.remove, { id: id as Id<'maps'> })); },
  };
}
