import { mixSeed, Rng } from './rng';

/** One district is 400 m of running; five districts make one 2 km lap. */
export const DISTRICT_LENGTH = 400;
export const LAP_LENGTH = DISTRICT_LENGTH * 5;
/** The last metres of every lap are a golden rush: open roofs, rows of gold, points ×3. */
export const GOLDEN_LENGTH = 240;
export const GOLDEN_MULT = 3;
/** Whether a distance into an endless run lies in a lap's golden rush. */
export function inGolden(m: number): boolean { return m > 0 && m % LAP_LENGTH >= LAP_LENGTH - GOLDEN_LENGTH; }
/** Points for everything grow with the lap: ×1, ×1.5, ×2 … up to ×5 from the ninth. */
export function lapMultiplier(lap: number): number { return Math.min(5, 1 + 0.5 * (Math.max(1, lap) - 1)); }
/** Each lap puts the city in a higher gear: this much faster per lap, up to GEAR_MAX. */
export const GEAR_STEP = 0.07;
export const GEAR_MAX = 0.42;

export type DistrictKind = 'residential' | 'construction' | 'neon' | 'riverside' | 'highrise';
/**
 * From the second lap on, each lap changes one thing about the city, in turn: updrafts between roofs, a blackout that
 * pays double for coins, rain with puddles to slide through, and cracked roofs that give way under a runner who stays.
 */
export type LapEvent = 'none' | 'wind' | 'night' | 'rain' | 'crumble';
const LAP_EVENTS: readonly Exclude<LapEvent, 'none'>[] = ['wind', 'night', 'rain', 'crumble'];
export const LAP_EVENT_NAMES: Record<LapEvent, string> = { none: '', wind: '강풍', night: '정전', rain: '폭우', crumble: '균열' };
export const LAP_EVENT_TEXT: Record<LapEvent, string> = {
  none: '',
  wind: '상승 기류를 타고 하늘길로',
  night: '어둠 속 동전 점수 2배',
  rain: '물웅덩이에서 ↓ 물보라 가속',
  crumble: '금 간 옥상은 오래 서 있으면 무너져요',
};

/**
 * The order of one endless city, from its seed: each lap visits all five districts in its own order (the first lap
 * always opens on the gentle housing estate, and no district runs into itself across a lap's border), and the lap
 * events come round in an order of their own.
 */
export interface CityPlan { order(lap: number): readonly number[]; events: readonly Exclude<LapEvent, 'none'>[] }
const DISTRICT_COUNT = 5;
const shuffle = <T>(list: T[], rng: Rng): T[] => {
  for (let i = list.length - 1; i > 0; i--) { const j = rng.int(0, i); [list[i], list[j]] = [list[j]!, list[i]!]; }
  return list;
};
export function cityPlan(seed: number): CityPlan {
  const orders = new Map<number, number[]>();
  const order = (lap: number): number[] => {
    let o = orders.get(lap);
    if (o) return o;
    const rng = new Rng(mixSeed(seed, 1000 + lap));
    if (lap === 1) o = [0, ...shuffle([1, 2, 3, 4], rng)];
    else {
      o = shuffle([0, 1, 2, 3, 4], rng);
      if (o[0] === order(lap - 1)[DISTRICT_COUNT - 1]) [o[0], o[1]] = [o[1]!, o[0]!];
    }
    orders.set(lap, o);
    return o;
  };
  return { order, events: shuffle([...LAP_EVENTS], new Rng(mixSeed(seed, 999))) };
}
/** The fixed order: districts as listed, events as listed. Made maps and old tests read it. */
export const FIXED_PLAN: CityPlan = { order: () => [0, 1, 2, 3, 4], events: LAP_EVENTS };

export function lapEvent(lap: number, plan: CityPlan = FIXED_PLAN): LapEvent { return lap < 2 ? 'none' : plan.events[(lap - 2) % plan.events.length]!; }
export type DistrictGoalKind = 'coins' | 'perfects' | 'stomps' | 'risks';

export interface DistrictGoal {
  what: DistrictGoalKind;
  goal: number;
  reward: number;
  label: string;
}

export interface DistrictPalette {
  sky: readonly string[];
  far: string;
  mid: string;
  near: string;
  accent: string;
  wall: string;
}

export interface District {
  /** Absolute district number, starting at zero (does not reset each lap). */
  index: number;
  kind: DistrictKind;
  name: string;
  /** One-based lap; rises every 2 km. */
  lap: number;
  /** Fraction through the current district, from 0 to 1. */
  progress: number;
  /** Metres left in the current district. */
  remaining: number;
  goal: DistrictGoal;
  palette: DistrictPalette;
}

interface DistrictData {
  kind: DistrictKind;
  name: string;
  goal: DistrictGoal;
  palette: DistrictPalette;
}

const GOAL_LABEL: Record<DistrictGoalKind, (n: number) => string> = {
  coins: (n) => `동전 ${n}개 모으기`,
  perfects: (n) => `퍼펙트 ${n}번`,
  stomps: (n) => `밟기 ${n}번`,
  risks: (n) => `위험 보너스 ${n}번`,
};

const goal = (what: DistrictGoalKind, n: number, reward: number): DistrictGoal =>
  ({ what, goal: n, reward, label: GOAL_LABEL[what](n) });

/** Fixed cycle: quiet streets, dusty work, bright shops, open water, glass towers. */
const DISTRICTS: readonly DistrictData[] = [
  {
    kind: 'residential',
    name: '주택가',
    goal: goal('coins', 20, 100),
    palette: { sky: ['#79b9e8', '#b9dcf0', '#f5dfc0'], far: '#9ab0b8', mid: '#8b8d86', near: '#6e756f', accent: '#f2b36b', wall: '#d8a888' },
  },
  {
    kind: 'construction',
    name: '공사장',
    goal: goal('perfects', 2, 140),
    palette: { sky: ['#c9a778', '#e3c493', '#f3ddb6'], far: '#a68f76', mid: '#9b8265', near: '#6f6357', accent: '#f5c440', wall: '#b99a72' },
  },
  {
    kind: 'neon',
    name: '네온상가',
    goal: goal('stomps', 2, 180),
    palette: { sky: ['#1b1745', '#452368', '#9b3d6a'], far: '#3c2a63', mid: '#352151', near: '#24193b', accent: '#ff5fc8', wall: '#5b3b70' },
  },
  {
    kind: 'riverside',
    name: '강변',
    goal: goal('risks', 3, 210),
    palette: { sky: ['#4d8eb8', '#93c4d0', '#f0d3ad'], far: '#7d9fb0', mid: '#5e8697', near: '#3f6475', accent: '#8ce0d6', wall: '#a9b9b3' },
  },
  {
    kind: 'highrise',
    name: '초고층',
    goal: goal('coins', 30, 250),
    palette: { sky: ['#2b4a7a', '#6e8ebe', '#c6d6ea'], far: '#6c82a5', mid: '#4c6286', near: '#2f4162', accent: '#8de8ff', wall: '#7f96b8' },
  },
];

function lapGoal(g: DistrictGoal, lap: number): DistrictGoal {
  return lap === 1 ? g : goal(g.what, Math.round(g.goal * (1 + 0.5 * (lap - 1))), g.reward * lap);
}

/** Pure lookup on a city's plan: no time, no state of its own. */
export function districtAt(distance: number, plan: CityPlan = FIXED_PLAN): District {
  const metres = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const index = Math.floor(metres / DISTRICT_LENGTH);
  const data = DISTRICTS[plan.order(Math.floor(index / DISTRICTS.length) + 1)[index % DISTRICTS.length]!]!;
  const start = index * DISTRICT_LENGTH;
  return {
    index,
    kind: data.kind,
    name: data.name,
    lap: Math.floor(index / DISTRICTS.length) + 1,
    progress: Math.min(1, (metres - start) / DISTRICT_LENGTH),
    remaining: Math.max(0, start + DISTRICT_LENGTH - metres),
    // Each lap asks a little more and pays a lap's worth more.
    goal: lapGoal(data.goal, Math.floor(index / DISTRICTS.length) + 1),
    palette: data.palette,
  };
}
