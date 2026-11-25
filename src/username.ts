/** Cleans a sign-in id; null when it can't be one. Plain ASCII, so no two ids can look the same. */
export function cleanUsername(v: string): string | null {
  const s = v.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{3,19}$/.test(s) ? s : null;
}
/** Convex Auth's limits for a new password, shown before asking the server. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 100;
