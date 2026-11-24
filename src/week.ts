const DAY = 86_400_000;
const KST = 9 * 3_600_000;

/** Days since 1970 of the Monday (Korean time) that begins the week of t. */
function monday(t: number): number {
  const d = Math.floor((t + KST) / DAY);
  return d - ((d + 3) % 7); // 1970-01-01 was a Thursday
}
/** Ranking week of a moment: the date of its Monday in Korea, e.g. 2026-11-23. */
export function weekKey(t: number): string { return new Date(monday(t) * DAY).toISOString().slice(0, 10); }
/** When the week of t ends: next Monday 00:00 in Korea. */
export function weekEnd(t: number): number { return (monday(t) + 7) * DAY - KST; }
export const isWeekKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
