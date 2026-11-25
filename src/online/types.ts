/** What the game uses of the online side. The vanilla game never imports Convex or React itself. */
export interface BoardEntry { rank: number; nickname: string; score: number; distance: number; mine: boolean }
export interface Board { top: BoardEntry[]; previousVersion?: number; mine: { rank: number | null; score: number; distance: number } | null }
export interface SharedMapInfo { id: string; title: string; author: string; segments: number; mine: boolean }
export interface SharedPage { page: SharedMapInfo[]; isDone: boolean; continueCursor: string }

export interface Account {
  status: 'loading' | 'out' | 'in';
  /** Null while signed in only for an account that has yet to choose one. */
  nickname: string | null;
}

export interface Online {
  /** Whether a player-initiated write is still being sent. */
  pending(): boolean;
  account(): Account;
  onAccount(f: () => void): void;
  /** These two reject with a message fit to show. */
  signIn(username: string, password: string): Promise<void>;
  signUp(username: string, password: string, nickname: string): Promise<void>;
  signOut(): Promise<void>;
  setNickname(v: string): Promise<string>;
  /** Server's clock, in milliseconds. */
  now(): number;
  start(): Promise<{ runId: string; seed: number }>;
  finish(runId: string, replay: string): Promise<{ score: number; best: boolean }>;
  board(week: string, version?: number): Promise<Board>;
  listMaps(order: 'new' | 'old', cursor: string | null): Promise<SharedPage>;
  getMap(id: string): Promise<string | null>;
  publishMap(json: string): Promise<string>;
  updateMap(id: string, json: string): Promise<void>;
  removeMap(id: string): Promise<void>;
}

/** A refusal in words the player can read. */
export class Refusal extends Error {
  constructor(readonly data: string) { super(data); }
}

/** Text safe to show for a failed call: the server's own message, or a plain one. */
export function errorText(e: unknown): string {
  const data = (e as { data?: unknown } | null)?.data;
  return typeof data === 'string' ? data : '온라인에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
}

/** Address of the online service, or null when this build has none. */
export function onlineUrl(raw: string | undefined, dev: boolean): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    // A local development address must never end up in a real build.
    if (u.protocol === 'https:' || (dev && u.protocol === 'http:')) return raw;
  } catch { /* not an address */ }
  return null;
}
