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

const comma = (n: number): string => n.toLocaleString('ko-KR');

/** The original eight goals keep their ids so stored unlocks stay meaningful. */
const CORE: readonly Achievement[] = [
  { id: 'first-run', name: '첫 발걸음', description: '검증된 일반 플레이를 한 번 완료하기', stat: 'runs', goal: 1 },
  { id: 'score-10000', name: '만 점의 벽', description: '일반 판에서 10,000점 넘기', stat: 'score', goal: 10000 },
  { id: 'distance-1000', name: '1km 러너', description: '일반 판에서 1,000m 달리기', stat: 'distance', goal: 1000 },
  { id: 'slide-1', name: '첫 미끄러지기', description: '장애물을 슬라이드로 한 번 통과하기', stat: 'slides', goal: 1 },
  { id: 'slide-10', name: '슬라이드 열 번', description: '장애물 슬라이드 성공 10회', stat: 'slides', goal: 10 },
  { id: 'stomp-10', name: '발밑의 도시', description: '적 밟기 10회', stat: 'stomps', goal: 10 },
  { id: 'combo-20', name: '끊기지 않는 흐름', description: '한 판에서 20콤보', stat: 'maxCombo', goal: 20 },
  { id: 'perfect-10', name: '착지의 달인', description: '퍼펙트 착지 10회', stat: 'perfects', goal: 10 },
];

interface Ladder {
  stat: AchievementStat;
  goals: readonly number[];
  name: (n: number) => string;
  description: (n: number) => string;
}

/** Deterministic milestone ladders: 72 more goals, still only from verified runs. */
const LADDERS: readonly Ladder[] = [
  { stat: 'runs', goals: [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 500],
    name: (n) => `러너 ${n}판`, description: (n) => `검증된 일반 플레이 ${n}회 완료` },
  { stat: 'score', goals: [20000, 30000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 750000],
    name: (n) => `점수 ${comma(n)}`, description: (n) => `일반 판에서 ${comma(n)}점` },
  { stat: 'distance', goals: [1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 25000, 30000],
    name: (n) => `거리 ${comma(n)}m`, description: (n) => `일반 판에서 ${comma(n)}m 달리기` },
  { stat: 'slides', goals: [2, 3, 5, 7, 15, 20, 30, 50, 75, 100],
    name: (n) => `슬라이드 ${n}회`, description: (n) => `장애물 슬라이드 성공 ${n}회` },
  { stat: 'stomps', goals: [20, 30, 50, 75, 100, 150, 200, 300, 500, 750],
    name: (n) => `밟기 ${n}회`, description: (n) => `적 밟기 ${n}회` },
  { stat: 'maxCombo', goals: [25, 30, 40, 50, 60, 75, 100, 125, 150, 200],
    name: (n) => `${n}콤보`, description: (n) => `한 판에서 ${n}콤보` },
  { stat: 'perfects', goals: [20, 30, 50, 75, 100, 150, 200, 300, 500, 750],
    name: (n) => `퍼펙트 ${n}회`, description: (n) => `퍼펙트 착지 ${n}회` },
];

export const ACHIEVEMENTS: readonly Achievement[] = [
  ...CORE,
  ...LADDERS.flatMap((ladder) => ladder.goals.map((goal) => ({
    id: `${ladder.stat}-${goal}`, name: ladder.name(goal), description: ladder.description(goal),
    stat: ladder.stat, goal,
  }))),
];

const STATS: readonly AchievementStat[] = ['runs', 'score', 'distance', 'slides', 'stomps', 'maxCombo', 'perfects'];
const LABEL: Record<AchievementStat, string> = {
  runs: '러너', score: '점수', distance: '거리', slides: '슬라이드', stomps: '밟기', maxCombo: '콤보', perfects: '퍼펙트',
};

const ladderIds = (stat: AchievementStat): readonly string[] =>
  ACHIEVEMENTS.filter((a) => a.stat === stat).sort((a, b) => a.goal - b.goal).map((a) => a.id);

/** 30 titles: the original three, per-stat tiers, and five cross-stat ranks. */
export const TITLES: readonly Title[] = [
  { id: 'runner', name: '새벽의 러너', requires: ['first-run'] },
  { id: 'slipper', name: '슬라이드 장인', requires: ['slide-1', 'slide-10', 'stomp-10'] },
  { id: 'legend', name: '도시의 전설', requires: ['score-10000', 'distance-1000', 'combo-20', 'perfect-10'] },
  ...STATS.flatMap((stat) => {
    const ids = ladderIds(stat);
    const marks = stat === 'runs' ? [1, 3, 5, 7] : [1, 3, 5];
    return marks.map((n) => ({ id: `${stat}-tier${n}`, name: `${LABEL[stat]} ${n}단계`, requires: ids.slice(0, n) }));
  }),
  ...[1, 3, 5, 7, 9].map((at, i) => ({
    id: `all-rounder-${i + 1}`,
    name: `올라운더 ${['I', 'II', 'III', 'IV', 'V'][i]}`,
    requires: STATS.map((stat) => ladderIds(stat)[at - 1]!).filter((id): id is string => !!id),
  })),
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
