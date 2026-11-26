/** Cleans a sign-in id; null when it can't be one. Plain ASCII, so no two ids can look the same. */
export function cleanUsername(v: string): string | null {
  const s = v.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{3,19}$/.test(s) ? s : null;
}
/** A new password's length, counted in characters: no other rule but no spaces at either end. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 100;

/** What a player reads for each refusal of Convex Auth's. */
export const SIGN_UP_ERRORS: Record<string, string> = {
  PASSWORD_TOO_SHORT: `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`,
  PASSWORD_TOO_LONG: `비밀번호는 ${PASSWORD_MAX}자까지입니다.`,
  PASSWORD_HAS_SURROUNDING_WHITESPACE: '비밀번호 앞뒤에는 공백을 둘 수 없습니다.',
  PASSWORD_TOO_COMMON: '너무 흔한 비밀번호입니다(예: 12345678, password). 다른 것으로 정해 주세요.',
  USERNAME_TAKEN: '이미 쓰는 아이디입니다.',
};
