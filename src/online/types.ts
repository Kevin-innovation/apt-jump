/** What the game uses of the online side. The vanilla game never imports Convex or React itself. */
export interface BoardEntry { rank: number; nickname: string; score: number; distance: number; mine: boolean }
export interface Board { top: BoardEntry[]; mine: { rank: number | null; score: number; distance: number } | null }
export interface SharedMapInfo { id: string; title: string; author: string; segments: number; mine: boolean; best: number | null }
export interface MapBoard { title: string; top: { rank: number; nickname: string; timeMs: number; mine: boolean }[]; mine: { rank: number | null; timeMs: number } | null }
export interface SharedPage { page: SharedMapInfo[]; isDone: boolean; continueCursor: string }

export interface Account {
  status: 'loading' | 'out' | 'in';
  /** Null while signed in only for an account that has yet to choose one. */
  nickname: string | null;
}

export interface AdminStats { members: number; signups7d: number; active7d: number; plays7d: number; playsToday: number; weeklyRecords: number; maps: number; suspended: number; cap: number }
export interface AdminMember { id: string; username: string | null; nickname: string | null; joinedAt: number; lastActiveAt: number | null; plays: number; suspended: boolean; admin: boolean }
export interface AdminLogEntry { at: number; action: string; target: string; targetId: string; sessions: number }
/** The admin page's calls. The server checks every one: these only carry them. */
export interface AdminApi {
  amI(): Promise<boolean>;
  stats(): Promise<AdminStats>;
  members(search: string, cursor: string | null): Promise<{ page: AdminMember[]; isDone: boolean; continueCursor: string }>;
  detail(id: string): Promise<{ member: AdminMember; sessions: number }>;
  resetPassword(id: string, password: string): Promise<{ sessions: number }>;
  setSuspended(id: string, suspended: boolean): Promise<{ sessions: number }>;
  revokeSessions(id: string): Promise<{ sessions: number }>;
  logs(cursor: string | null): Promise<{ page: AdminLogEntry[]; isDone: boolean; continueCursor: string }>;
}

export interface Online {
  admin: AdminApi;
  /** Whether a player-initiated write is still being sent. */
  pending(): boolean;
  account(): Account;
  release(): { id: string; builtAt: number } | null;
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
  board(week: string): Promise<Board>;
  listMaps(order: 'new' | 'old', cursor: string | null): Promise<SharedPage>;
  getMap(id: string): Promise<string | null>;
  /** A ranked run of a published map: the server fixes the content, returned to be played. */
  mapStart(id: string): Promise<{ runId: string; json: string }>;
  mapFinish(runId: string, replay: string): Promise<{ timeMs: number; best: boolean }>;
  mapBoard(id: string): Promise<MapBoard | null>;
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
