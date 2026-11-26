import { TITLES, type Title } from './achievements';
import './title-style.css';

/** How a title looks: a colour theme from what earns it, and how hard it is to earn. Looks only. */
export interface TitleLook { theme: string; rank: 1 | 2 | 3 | 4 }
export const RARITY = ['일반', '희귀', '영웅', '전설'] as const;

const ORIGINAL: Record<string, TitleLook> = {
  runner: { theme: 'runs', rank: 1 },
  slipper: { theme: 'slides', rank: 2 },
  legend: { theme: 'all', rank: 3 },
};
const TIER_RANK: Record<string, TitleLook['rank']> = { '1': 1, '3': 2, '5': 3, '7': 4 };
const ALL_ROUNDER_RANK: readonly TitleLook['rank'][] = [2, 3, 3, 4, 4];

function lookOf(title: Title): TitleLook {
  const own = ORIGINAL[title.id];
  if (own) return own;
  const around = /^all-rounder-(\d+)$/.exec(title.id);
  if (around) return { theme: 'all', rank: ALL_ROUNDER_RANK[Number(around[1]) - 1] ?? 4 };
  const tier = /^(.+)-tier(\d+)$/.exec(title.id);
  return tier ? { theme: tier[1]!, rank: TIER_RANK[tier[2]!] ?? 4 } : { theme: 'runs', rank: 1 };
}

const BY_ID = new Map(TITLES.map((t) => [t.id, lookOf(t)]));
const BY_NAME = new Map(TITLES.map((t) => [t.name, lookOf(t)]));

/** Classes for a title's plaque, found by id or, as the ranking carries it, by name. Empty when unknown. */
export function titleClasses(idOrName: string): string[] {
  const look = BY_ID.get(idOrName) ?? BY_NAME.get(idOrName);
  return look ? ['title-fx', `title-theme-${look.theme}`, `title-rank-${look.rank}`] : [];
}
export function titleLook(id: string): TitleLook | null { return BY_ID.get(id) ?? null; }
