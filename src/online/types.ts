import type { AchievementCatalog } from './achievementview';

/** What the game uses of the online side. The vanilla game never imports Convex or React itself. */
/** A finished week's reward: its place (1–3) if any, and whether it was for running often. */
export interface WeekReward { week: string; rank: number | null; steady: boolean; coins: number }
export interface DailyState {
  day: string; checkedIn: boolean; streak: number; reward: number;
  missions: { id: string; text: string; goal: number; progress: number; reward: number; done: boolean }[];
}
export interface ShopState { coins: number; owned: string[]; costume: string }
export interface BoardEntry { rank: number; nickname: string; title?: string | null; badge?: string | null; costume?: string; score: number; distance: number; mine: boolean }
export interface Board { top: BoardEntry[]; mine: { rank: number | null; score: number; distance: number } | null }
/** `bestBy` holds the best time (the first to reach it), shared by `bestTied` players in all. */
export interface SharedMapInfo { id: string; title: string; author: string; segments: number; mine: boolean; best: number | null; bestBy?: string | null; bestTied?: number; createdAt?: number; /** When an update last changed its content; absent if none has. */ contentUpdatedAt?: number; /** Verified completions counted so far. */ plays?: number }
export interface MapBoard { title: string; top: { rank: number; nickname: string; timeMs: number; mine: boolean }[]; mine: { rank: number | null; timeMs: number } | null }
export interface SharedPage { page: SharedMapInfo[]; isDone: boolean; continueCursor: string; /** Ids of all maps, on any page, with the most completions. */ mostPlayed?: string[] }

export interface Account {
  status: 'loading' | 'out' | 'in';
  /** Null while signed in only for an account that has yet to choose one. */
  nickname: string | null;
}

export interface AdminStats { members: number; signups7d: number; active7d: number; plays7d: number; playsToday: number; weeklyRecords: number; maps: number; suspended: number; cap: number }
export interface AdminMember {
  id: string; username: string | null; nickname: string | null; joinedAt: number; lastActiveAt: number | null; plays: number; suspended: boolean; admin: boolean;
  lastLoginAt: number | null; lastPlayAt: number | null; runs7d: number; weekBest: { score: number; distance: number } | null; coins: number; costumes: number;
}
export interface AdminDay { day: string; plays: number; signups: number; players: number; best: number }
export interface AdminTrends { days: AdminDay[]; recent: { at: number; nickname: string | null; userId: string; status: string }[]; coins: number; costumes: number; activeToday: number }
export interface AdminLogEntry { at: number; action: string; target: string; targetId: string; sessions: number; amount?: number; note?: string }
export interface AdminShop { coins: number; coinsEarned: number; owned: string[]; costume: string }
/** The admin page's calls. The server checks every one: these only carry them. */
export interface AdminApi {
  amI(): Promise<boolean>;
  stats(): Promise<AdminStats>;
  trends(): Promise<AdminTrends>;
  members(search: string, cursor: string | null): Promise<{ page: AdminMember[]; isDone: boolean; continueCursor: string }>;
  detail(id: string): Promise<{ member: AdminMember; sessions: number; shop: AdminShop }>;
  adjustCoins(id: string, delta: number): Promise<AdminShop>;
  revokeCostume(id: string, costume: string, refund: boolean): Promise<AdminShop>;
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
  /** A ranked run and the seeds of its first stretches of city. */
  start(): Promise<{ runId: string; seed: number; seeds: number[] }>;
  /** The run's stretch seeds released so far. */
  seeds(runId: string): Promise<number[]>;
  /** `coins` is what the run paid into the player's wallet. */
  finish(runId: string, replay: string): Promise<{ score: number; best: boolean; coins: number; daily: { text: string; reward: number }[] }>;
  /** Today's attendance and missions; null for a guest. */
  daily(): Promise<DailyState | null>;
  /** Week rewards not yet shown, and telling the server they have been. */
  rewards(): Promise<WeekReward[]>;
  seeRewards(): Promise<void>;
  checkIn(): Promise<{ streak: number; reward: number }>;
  /** The player's coins and costumes; null for a guest. */
  shop(): Promise<ShopState | null>;
  buy(id: string): Promise<ShopState>;
  wear(id: string): Promise<ShopState>;
  board(week: string): Promise<Board>;
  /** Anyone may look; only a signed-in player has progress and can wear a title. */
  catalog(): Promise<AchievementCatalog>;
  equip(titleId: string | null): Promise<void>;
  /** Shows an earned achievement as a badge by the title, or clears it with null. */
  equipBadge(achievementId: string | null): Promise<void>;
  listMaps(order: 'new' | 'old', cursor: string | null): Promise<SharedPage>;
  /** When the latest newly shared map went up, or null with none. */
  newestMap(): Promise<number | null>;
  getMap(id: string): Promise<string | null>;
  /** A ranked run of a published map: the server fixes the content, returned to be played. */
  mapStart(id: string): Promise<{ runId: string; json: string }>;
  mapFinish(runId: string, replay: string): Promise<{ timeMs: number; best: boolean }>;
  mapBoard(id: string): Promise<MapBoard | null>;
  /** The maker's run that shares a map (or, with `mapId`, a new version of it): finishing it is what publishes. */
  shareStart(json: string, mapId: string | null): Promise<{ runId: string; json: string }>;
  shareFinish(runId: string, replay: string): Promise<{ mapId: string; timeMs: number }>;
  /** Resolves to the name as stored. */
  renameMap(id: string, title: string): Promise<string>;
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
