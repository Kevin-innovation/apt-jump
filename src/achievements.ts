/** Stats a server-verified normal run contributes. Nothing here accepts a client's own numbers. */
export interface VerifiedRunStats {
  score: number;
  distance: number;
  /** Successful slides: a real obstacle avoided or broken, not a key press. */
  slides: number;
  stomps: number;
  maxCombo: number;
  perfects: number;
}

export type AchievementStat = 'runs' | keyof VerifiedRunStats;

export interface Achievement {
  id: string;
  name: string;
  description: string;
  stat: AchievementStat;
  goal: number;
}

export interface Title {
  id: string;
  name: string;
  requires: readonly string[];
}

/** Accumulated counters: totals for counts, bests for scores. */
export interface AchievementTotals extends VerifiedRunStats {
  runs: number;
}

/** Eight goals, all from verified normal runs; creator maps never contribute. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-run', name: '첫 발걸음', description: '검증된 일반 플레이를 한 번 완료하기', stat: 'runs', goal: 1 },
  { id: 'score-10000', name: '만 점의 벽', description: '일반 판에서 10,000점 넘기', stat: 'score', goal: 10000 },
  { id: 'distance-1000', name: '1km 러너', description: '일반 판에서 1,000m 달리기', stat: 'distance', goal: 1000 },
  { id: 'slide-1', name: '첫 미끄러지기', description: '장애물을 슬라이드로 한 번 통과하기', stat: 'slides', goal: 1 },
  { id: 'slide-10', name: '슬라이드 열 번', description: '장애물 슬라이드 성공 10회', stat: 'slides', goal: 10 },
  { id: 'stomp-10', name: '발밑의 도시', description: '적 밟기 10회', stat: 'stomps', goal: 10 },
  { id: 'combo-20', name: '끊기지 않는 흐름', description: '한 판에서 20콤보', stat: 'maxCombo', goal: 20 },
  { id: 'perfect-10', name: '착지의 달인', description: '퍼펙트 착지 10회', stat: 'perfects', goal: 10 },
];

export const TITLES: readonly Title[] = [
  { id: 'runner', name: '새벽의 러너', requires: ['first-run'] },
  { id: 'slipper', name: '슬라이드 장인', requires: ['slide-1', 'slide-10', 'stomp-10'] },
  { id: 'legend', name: '도시의 전설', requires: ['score-10000', 'distance-1000', 'combo-20', 'perfect-10'] },
];

/** Pure lookup for the leaderboard: it only reads an id stored on the user. */
export function titleById(id: string | null | undefined): Title | null {
  return TITLES.find((t) => t.id === id) ?? null;
}

/** Clamped so a catalog row can show progress without leaking past its goal. */
export function achievementValue(a: Achievement, totals: AchievementTotals): number {
  const value = totals[a.stat];
  return Number.isFinite(value) ? Math.min(a.goal, Math.max(0, Math.floor(value))) : 0;
}

export const PARTICIPANTS_KEY = 'participants';
export const countKey = (achievementId: string): string => `achievement:${achievementId}`;
