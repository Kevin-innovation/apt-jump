import { ACHIEVEMENTS, TITLES, type Title } from './achievements';
import './title-style.css';

/** How a title looks: a colour theme from what earns it, and how hard it is to earn. Looks only. */
export interface TitleLook { theme: string; rank: 1 | 2 | 3 | 4 | 5 | 6 }
export const RARITY = ['일반', '고급', '희귀', '영웅', '전설', '신화'] as const;

const FIXED: Record<string, TitleLook> = {
  runner: { theme: 'runs', rank: 1 },
  slipper: { theme: 'slides', rank: 2 },
  legend: { theme: 'all', rank: 3 },
  'duo-acrobat': { theme: 'duo', rank: 3 },
  'duo-hunter': { theme: 'duo', rank: 3 },
  'duo-marathon': { theme: 'duo', rank: 4 },
  'duo-showman': { theme: 'duo', rank: 4 },
  'duo-night': { theme: 'duo', rank: 4 },
  'duo-spotlight': { theme: 'duo', rank: 5 },
  crown: { theme: 'crown', rank: 6 },
};
const ALL_ROUNDER_RANK: readonly TitleLook['rank'][] = [2, 3, 4, 5, 5];

function lookOf(title: Title): TitleLook {
  const own = FIXED[title.id];
  if (own) return own;
  const around = /^all-rounder-(\d+)$/.exec(title.id);
  if (around) return { theme: 'all', rank: ALL_ROUNDER_RANK[Number(around[1]) - 1] ?? 5 };
  const tier = /^(.+)-tier\d+$/.exec(title.id);
  if (!tier) return { theme: 'runs', rank: 1 };
  // A stat's six tiers run from common to mythic in the order they're listed.
  const step = TITLES.filter((t) => t.id.startsWith(`${tier[1]}-tier`)).indexOf(title);
  return { theme: tier[1]!, rank: Math.min(6, Math.max(1, step + 1)) as TitleLook['rank'] };
}

const BY_ID = new Map(TITLES.map((t) => [t.id, lookOf(t)]));
const BY_NAME = new Map(TITLES.map((t) => [t.name, lookOf(t)]));

/** Classes for a title's plaque, found by id or, as the ranking carries it, by name. Empty when unknown. */
export function titleClasses(idOrName: string): string[] {
  const look = BY_ID.get(idOrName) ?? BY_NAME.get(idOrName);
  return look ? ['title-fx', `title-theme-${look.theme}`, `title-rank-${look.rank}`] : [];
}
export function titleLook(id: string): TitleLook | null { return BY_ID.get(id) ?? null; }

/** An achievement's rarity: how far up its own stat's ladder it stands, from 일반 at the foot to 신화 at the top. */
const ACHIEVEMENT_RANK = new Map<string, TitleLook['rank']>();
for (const stat of new Set(ACHIEVEMENTS.map((a) => a.stat))) {
  const ladder = ACHIEVEMENTS.filter((a) => a.stat === stat).sort((a, b) => a.goal - b.goal);
  ladder.forEach((a, i) => ACHIEVEMENT_RANK.set(a.id, (1 + Math.floor((i * RARITY.length) / ladder.length)) as TitleLook['rank']));
}
export function achievementRank(id: string): TitleLook['rank'] { return ACHIEVEMENT_RANK.get(id) ?? 1; }
