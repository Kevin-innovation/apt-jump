import { useOauth, useSignInWithGoogle } from '@convex-dev/auth/methods/google/react';
import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react';
import { ConvexReactClient, useConvexAuth, useQuery } from 'convex/react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { SIM_VERSION } from '../replay';
import type { Account, Online } from './types';

const FLOW_ERRORS: Record<string, string> = {
  ACCESS_DENIED: '로그인을 취소했습니다.',
  EXPIRED: '로그인 시간이 지났습니다. 다시 시도해 주세요.',
  INVALID_FLOW: '로그인을 마치지 못했습니다. 다시 시도해 주세요.',
};

/** A small React root that only carries Convex Auth; the game's screens stay plain DOM. */
export function connect(url: string): Online {
  const client = new ConvexReactClient(url);
  let account: Account = { status: 'loading', nickname: null, error: null };
  const watchers: (() => void)[] = [];
  let doSignIn: () => Promise<string | null> = async () => '아직 준비 중입니다.';
  let doSignOut: () => Promise<void> = async () => {};
  let offset = 0;
  const set = (a: Account) => {
    if (a.status === account.status && a.nickname === account.nickname && a.error === account.error) return;
    account = a;
    watchers.forEach((f) => f());
  };

  function Bridge(): null {
    const { isLoading, isAuthenticated } = useConvexAuth();
    const me = useQuery(api.users.me, isAuthenticated ? {} : 'skip');
    const { signIn } = useSignInWithGoogle(api.auth);
    const { signOut } = useAuthActions();
    const { flowError } = useOauth();
    useEffect(() => {
      doSignIn = async () => {
        const r = await signIn();
        return r.status === 'redirect' ? null : '로그인을 시작하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
      };
      doSignOut = async () => { await signOut(); };
    }, [signIn, signOut]);
    useEffect(() => {
      const error = flowError ? (FLOW_ERRORS[flowError.error] ?? '로그인하지 못했습니다. 다시 시도해 주세요.') : null;
      if (isLoading || (isAuthenticated && me === undefined)) set({ status: 'loading', nickname: null, error });
      else if (isAuthenticated && me) set({ status: 'in', nickname: me.nickname, error: null });
      else set({ status: 'out', nickname: null, error });
    }, [isLoading, isAuthenticated, me, flowError]);
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
    signIn: async () => {
      const error = await doSignIn();
      if (error) set({ ...account, error });
    },
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
