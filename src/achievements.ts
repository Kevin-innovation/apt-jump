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

/**
 * Goals added on top of a ladder later, with their rarity fixed: so the ladder's own rarities (and the rewards
 * already paid by them) stay as they were. Scores grew several times over with gears in 3.0.
 */
const EXTRA: readonly (Achievement & { rank: number })[] = [
  [1_000_000, 5], [2_000_000, 6], [3_000_000, 6], [5_000_000, 6],
].map(([goal, rank]) => ({ id: `score-${goal}`, name: `점수 ${comma(goal!)}`, description: `일반 판에서 ${comma(goal!)}점`, stat: 'score' as const, goal: goal!, rank: rank! }));

export const ACHIEVEMENTS: readonly Achievement[] = [
  ...CORE,
  ...LADDERS.flatMap((ladder) => ladder.goals.map((goal) => ({
    id: `${ladder.stat}-${goal}`, name: ladder.name(goal), description: ladder.description(goal),
    stat: ladder.stat, goal,
  }))),
  ...EXTRA.map(({ rank: _rank, ...a }) => a),
];

const STATS: readonly AchievementStat[] = ['runs', 'score', 'distance', 'slides', 'stomps', 'maxCombo', 'perfects'];

const ladderIds = (stat: AchievementStat): readonly string[] =>
  ACHIEVEMENTS.filter((a) => a.stat === stat).sort((a, b) => a.goal - b.goal).map((a) => a.id);

/**
 * Six tiers per stat: a tier's number is how many goals of its ladder it asks for.
 * Ids and requirements of the first 30 titles never change: players have them equipped.
 */
const TIER_MARKS: Record<AchievementStat, readonly number[]> = {
  runs: [1, 3, 5, 7, 10, 13], score: [1, 3, 5, 7, 9, 11], distance: [1, 3, 5, 7, 9, 11], slides: [1, 3, 5, 7, 9, 11],
  stomps: [1, 3, 5, 7, 9, 11], maxCombo: [1, 3, 5, 7, 9, 11], perfects: [1, 3, 5, 7, 9, 11],
};
const TIER_NAMES: Record<AchievementStat, readonly string[]> = {
  runs: ['동네 러너', '출근길 단골', '계단 마니아', '옥상 순찰대', '잠들지 않는 발', '도시의 심장'],
  score: ['점수 수집가', '하이스코어러', '스코어 헌터', '숫자의 마술사', '전광판 점령자', '점수의 신'],
  distance: ['산책 러너', '장거리 러너', '지평선 추적자', '끝없는 질주', '도시 횡단자', '지도 밖의 러너'],
  slides: ['미끄럼 초보', '슬라이더', '바닥 스치기', '틈새 장인', '그림자 미끄럼', '마찰 제로'],
  stomps: ['발도장', '쿵쿵 러너', '지붕 위 망치', '실외기 파괴자', '비둘기의 공포', '발밑의 지배자'],
  maxCombo: ['리듬 타기', '연속 동작', '흐름의 주인', '콤보 장인', '폭주 기관', '무한 연쇄'],
  perfects: ['착지 연습생', '깔끔한 착지', '정밀 착지', '깃털 착지', '무중력 발끝', '완벽주의자'],
};
/** Two stats at once: [id, name, stat, stat, how far up each ladder]. */
const DUOS: readonly [string, string, AchievementStat, AchievementStat, number][] = [
  ['duo-acrobat', '곡예사', 'slides', 'maxCombo', 5],
  ['duo-hunter', '옥상 사냥꾼', 'stomps', 'perfects', 5],
  ['duo-marathon', '마라토너', 'runs', 'distance', 7],
  ['duo-showman', '쇼맨', 'score', 'maxCombo', 7],
  ['duo-night', '야간 질주자', 'slides', 'distance', 7],
  ['duo-spotlight', '스포트라이트', 'score', 'perfects', 9],
];

/** 57 titles: the original three, six tiers per stat, five cross-stat ranks, six pairs and a crown. */
export const TITLES: readonly Title[] = [
  { id: 'runner', name: '새벽의 러너', requires: ['first-run'] },
  { id: 'slipper', name: '슬라이드 장인', requires: ['slide-1', 'slide-10', 'stomp-10'] },
  { id: 'legend', name: '도시의 전설', requires: ['score-10000', 'distance-1000', 'combo-20', 'perfect-10'] },
  ...STATS.flatMap((stat) => {
    const ids = ladderIds(stat);
    return TIER_MARKS[stat].map((n, i) => ({ id: `${stat}-tier${n}`, name: TIER_NAMES[stat][i]!, requires: ids.slice(0, n) }));
  }),
  ...[1, 3, 5, 7, 9].map((at, i) => ({
    id: `all-rounder-${i + 1}`,
    name: `올라운더 ${['I', 'II', 'III', 'IV', 'V'][i]}`,
    requires: STATS.map((stat) => ladderIds(stat)[at - 1]!).filter((id): id is string => !!id),
  })),
  ...DUOS.map(([id, name, a, b, n]) => ({ id, name, requires: [...ladderIds(a).slice(0, n), ...ladderIds(b).slice(0, n)] })),
  { id: 'crown', name: '아파트의 왕', requires: ACHIEVEMENTS.map((a) => a.id) },
];

/** An achievement's rarity, 1 (일반) to 6 (신화): how far up its own stat's ladder it stands. */
const RANKS = 6;
const ACHIEVEMENT_RANK = new Map<string, number>();
const extraIds = new Set(EXTRA.map((a) => a.id));
for (const stat of new Set(ACHIEVEMENTS.map((a) => a.stat))) {
  const ladder = ACHIEVEMENTS.filter((a) => a.stat === stat && !extraIds.has(a.id)).sort((a, b) => a.goal - b.goal);
  ladder.forEach((a, i) => ACHIEVEMENT_RANK.set(a.id, 1 + Math.floor((i * RANKS) / ladder.length)));
}
for (const a of EXTRA) ACHIEVEMENT_RANK.set(a.id, a.rank);
export function achievementRank(id: string): 1 | 2 | 3 | 4 | 5 | 6 {
  return (ACHIEVEMENT_RANK.get(id) ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
}
/** Coins paid once for earning an achievement, by its rarity. */
export const ACHIEVEMENT_REWARD = [0, 50, 100, 200, 400, 800, 1500] as const;
export const achievementReward = (id: string): number => ACHIEVEMENT_REWARD[achievementRank(id)];
/** Coins every account starts with. */
export const WELCOME_COINS = 300;
export const achievementById = (id: string | null | undefined): Achievement | null => ACHIEVEMENTS.find((a) => a.id === id) ?? null;

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
