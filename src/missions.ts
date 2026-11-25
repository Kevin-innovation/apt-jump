/** What a run counts. Every mission is about one of these. */
export interface Tally {
  coins: number; powers: number; perfects: number; stomps: number; risks: number; diamonds: number; maxCombo: number; distance: number;
}
export interface Mission { what: keyof Tally; goal: number; reward: number }

const m = (what: keyof Tally, goal: number, reward: number): Mission => ({ what, goal, reward });
/** Done one after another within a run; counts from before a mission began count too. */
export const MISSIONS: readonly Mission[] = [
  m('coins', 15, 50), m('powers', 2, 80), m('perfects', 3, 100), m('distance', 250, 120), m('maxCombo', 10, 150),
  m('stomps', 2, 150), m('risks', 5, 200), m('powers', 8, 200), m('coins', 120, 250), m('diamonds', 1, 300),
  m('distance', 800, 350), m('maxCombo', 25, 400), m('perfects', 20, 450), m('stomps', 12, 500), m('powers', 25, 600),
  m('distance', 2000, 800), m('coins', 600, 1000), m('diamonds', 8, 1200),
];
const WORDS: Record<keyof Tally, (n: number) => string> = {
  coins: (n) => `동전 ${n}개`, powers: (n) => `아이템 ${n}개`, perfects: (n) => `퍼펙트 ${n}번`, stomps: (n) => `밟기 ${n}번`,
  risks: (n) => `위험 보너스 ${n}번`, diamonds: (n) => `다이아 ${n}개`, maxCombo: (n) => `${n}콤보`, distance: (n) => `${n}m 달리기`,
};
export const missionText = (x: Mission) => WORDS[x.what](x.goal);

/** Medals for a run's score, best first. */
export const MEDALS = [
  { name: '다이아 메달', score: 40000 }, { name: '금메달', score: 15000 }, { name: '은메달', score: 5000 }, { name: '동메달', score: 1500 },
] as const;
export function medalFor(score: number): string | null { return MEDALS.find((x) => score >= x.score)?.name ?? null; }
/** The medal above this score, if there is one. */
export function nextMedal(score: number): { name: string; left: number } | null {
  const up = [...MEDALS].reverse().find((x) => score < x.score);
  return up ? { name: up.name, left: up.score - score } : null;
}
