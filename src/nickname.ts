/** Cleans a nickname; null when it can't be one. Shared by the page and the server. */
export function cleanNickname(v: string): string | null {
  if (v.length > 64) return null;
  const s = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  if (n < 2 || n > 16) return null;
  // Letters and digits of any script and a few joiners; no "@", so no email addresses.
  return /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(s) ? s : null;
}
/** Two nicknames with the same key count as the same. */
export const nicknameKey = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[ _.-]/g, '');
