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
  const client = new ConvexReactClient(url);
  let account: Account = { status: 'loading', nickname: null };
  const watchers: (() => void)[] = [];
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

  return {
    account: () => account,
    onAccount: (f) => { watchers.push(f); },
    signIn: (username, password) => doSignIn(username, password),
    signUp: (username, password, nickname) => doSignUp(username, password, nickname),
    signOut: () => doSignOut(),
    setNickname: (nickname) => client.mutation(api.users.setNickname, { nickname }),
    now: () => Date.now() + offset,
    start: () => client.mutation(api.ranking.start, { version: SIM_VERSION }),
    finish: (runId, replay) => client.action(api.ranking.finish, { runId: runId as Id<'runs'>, replay }),
    board: (week) => client.query(api.ranking.board, { week }),
    listMaps: (order, cursor) => client.query(api.maps.list, { order, paginationOpts: { numItems: 10, cursor } }),
    getMap: (id) => client.query(api.maps.get, { id: id as Id<'maps'> }),
    publishMap: (json) => client.mutation(api.maps.publish, { json }),
    updateMap: async (id, json) => { await client.mutation(api.maps.update, { id: id as Id<'maps'>, json }); },
    removeMap: async (id) => { await client.mutation(api.maps.remove, { id: id as Id<'maps'> }); },
  };
}
