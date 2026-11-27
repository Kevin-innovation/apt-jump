import { mixSeed, Rng } from './rng';

/**
 * Daily missions and attendance, shared by the page and the server. A day is a date in Korea; its three missions
 * are the same for everyone, drawn from the date alone.
 */
const DAY = 86_400_000;
const KST = 9 * 3_600_000;
/** The date in Korea of a moment, e.g. 2026-11-27. */
export function dayKey(t: number): string { return new Date(Math.floor((t + KST) / DAY) * DAY).toISOString().slice(0, 10); }
/** The day before a date. */
export function dayBefore(key: string): string { return new Date(Date.parse(key) - DAY).toISOString().slice(0, 10); }

/** What verified runs add up over a day. bestScore is the best single run, the others totals. */
export type DailyStat = 'runs' | 'distance' | 'perfects' | 'stomps' | 'slides' | 'coins' | 'bestScore';
export type DailyTally = Record<DailyStat, number>;
export const EMPTY_TALLY: DailyTally = { runs: 0, distance: 0, perfects: 0, stomps: 0, slides: 0, coins: 0, bestScore: 0 };

export interface DailyMission { id: string; stat: DailyStat; goal: number; reward: number; text: string }

const POOL: { stat: DailyStat; goals: readonly [number, number, number]; text: (n: string) => string }[] = [
  { stat: 'runs', goals: [3, 5, 8], text: (n) => `순위 판 ${n}번 달리기` },
  { stat: 'distance', goals: [1500, 3000, 6000], text: (n) => `모두 합쳐 ${n}m 달리기` },
  { stat: 'perfects', goals: [20, 50, 100], text: (n) => `퍼펙트 ${n}번` },
  { stat: 'stomps', goals: [8, 20, 40], text: (n) => `밟기 ${n}번` },
  { stat: 'slides', goals: [8, 20, 40], text: (n) => `슬라이드 ${n}번` },
  { stat: 'coins', goals: [150, 400, 900], text: (n) => `동전 ${n}개 모으기` },
  { stat: 'bestScore', goals: [60000, 200000, 500000], text: (n) => `한 판에 ${n}점` },
];
/** Coins for the easy, middle and hard mission of a day. */
export const DAILY_REWARDS = [200, 350, 600] as const;

/** The day's three missions: three different kinds, one of each difficulty. */
export function dailyMissions(day: string): DailyMission[] {
  const rng = new Rng(mixSeed(Number(day.replaceAll('-', '')), 7));
  const kinds = POOL.map((_, i) => i);
  for (let i = kinds.length - 1; i > 0; i--) { const j = rng.int(0, i); [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!]; }
  return [0, 1, 2].map((level) => {
    const p = POOL[kinds[level]!]!, goal = p.goals[level]!;
    return { id: `${day}:${p.stat}`, stat: p.stat, goal, reward: DAILY_REWARDS[level]!, text: p.text(goal.toLocaleString('ko-KR')) };
  });
}

/** Coins for checking in on the nth day in a row; a week's round starts again on the eighth. */
export const STREAK_REWARDS = [100, 150, 200, 250, 300, 400, 700] as const;
export const streakReward = (streak: number): number => STREAK_REWARDS[(Math.max(1, streak) - 1) % STREAK_REWARDS.length]!;
