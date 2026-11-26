# 도전과제 / 칭호 구현 (apt-jump/achievements)

## 허용 범위 내 변경 파일
- 신규 `src/achievements.ts`
- 신규 `convex/achievements.ts`
- `convex/schema.ts` (기존 필드·테이블·인덱스 변경 없이 추가만)
- 신규 `tests/achievements.test.ts`
- 이 보고서. 다른 소스/UI/ranking/backend 파일은 수정하지 않았습니다.

## `src/achievements.ts` 공개 API
- `interface VerifiedRunStats { score:number; distance:number; slides:number; stomps:number; maxCombo:number; perfects:number }` — 서버가 리플레이로 검증한 값만 담는 타입.
- `type AchievementStat = 'runs' | keyof VerifiedRunStats`
- `interface Achievement { id:string; name:string; description:string; stat:AchievementStat; goal:number }`
- `interface Title { id:string; name:string; requires: readonly string[] }`
- `interface AchievementTotals extends VerifiedRunStats { runs:number }`
- `const ACHIEVEMENTS: readonly Achievement[]` (8개)
  - `first-run` runs 1 / `score-10000` score 10000 / `distance-1000` distance 1000
  - `slide-1` slides 1 / `slide-10` slides 10 / `stomp-10` stomps 10 / `combo-20` maxCombo 20 / `perfect-10` perfects 10
- `const TITLES: readonly Title[]` (3개)
  - `runner` requires `['first-run']`
  - `slipper` requires `['slide-1','slide-10','stomp-10']`
  - `legend` requires `['score-10000','distance-1000','combo-20','perfect-10']`
- `titleById(id: string | null | undefined): Title | null` — 리더보드가 사용자 필드만 읽어 표시하는 pure lookup.
- `achievementValue(a: Achievement, totals: AchievementTotals): number` — 목표로 clamp한 진행값.
- `PARTICIPANTS_KEY = 'participants'`, `countKey(id) => 'achievement:${id}'`.

## `convex/achievements.ts` 공개 함수/반환
- **`awardVerified(ctx: MutationCtx, userId: Id<'users'>, stats: VerifiedRunStats): Promise<void>`**
  - 일반 함수(plain async helper)이며 public mutation/action이 아닙니다. 클라이언트 숫자로 해금할 수 있는 엔드포인트는 없습니다.
  - `ranking.settle`이 검증 성공(`result !== null`) 시 같은 트랜잭션에서 호출할 예정입니다. 중복 정산 방지는 ranking의 run 상태가 담당합니다.
  - 누적: `runs+1`, `slides/stomps/perfects` 합산, `score/distance/maxCombo`는 최고값 갱신. 비정수·음수·비유한 수는 0으로 정리합니다.
  - 분모: 최초 수상(첫 검증 플레이) 때 `achievementCounts['participants']` 1 증가. 분자: 새 해금 1건당 `achievementCounts['achievement:<id>']` 1 증가. 해금과 카운트는 한 번만 증가합니다.
- **`catalog` query** — `args: {}`, guest 열람 가능.
  - 반환: `{ participants:number; achievements:[{ id:string; name:string; description:string; unlocked:boolean; progress:number; goal:number; earned:number; percent:number }]; titles:[{ id:string; name:string; unlocked:boolean }]; equipped:string|null }`
  - `percent = Math.round(earned/participants*10000)/100` (소수 둘째 자리까지; 분모 0이면 0).
  - 로그인·닉네임·정지 상태를 확인해 자기 행만 표시하고, 게스트는 `unlocked=false`, `progress=0`, `equipped=null`로 카탈로그만 봅니다.
- **`equip` mutation** — `args: { titleId: string | null }`, `returns: null`.
  - `requirePlayer`로 로그인/닉네임/정지 계정 차단. 알 수 없는 id와 미해금 칭호는 `ConvexError`로 거절. `null`은 장착 해제.
  - 해금 여부는 서버의 `achievementUnlocks`로 검증합니다(클라이언트가 요구 목록을 보낼 수 없음).

## 스키마 추가 (기존 정의 불변)
- `users.equippedTitle?: string`
- `achievementProgress` `{ userId, runs, slides, stomps, perfects, maxScore, maxDistance, maxCombo }`, index `by_user`
- `achievementUnlocks` `{ userId, achievementId }`, indexes `by_user`, `by_user_achievement`
- `achievementCounts` `{ key, count }`, index `by_key`

## 통합 시 주의
- 도전과제는 이번 업데이트 이후 **검증된 일반 모드 플레이**부터 집계됩니다. 기존 점수_backfill 없음, 제작자 맵(`mapRuns`)은 호출하지 않습니다.
- `stats.slides`는 단순 키 입력이 아닌 장애물 실제 회피/파괴로 검증된 서버 값이어야 합니다(리플레이 검증기가 제공).
- 리더보드는 `user.equippedTitle`을 읽어 `titleById()`로 표시하면 됩니다.
- `convex/_generated/api.d.ts`의 모듈 목록은 생성 파일이라 허용 범위 밖이라 수정하지 않았습니다. 런타임 `anyApi`는 새 모듈을 찾지만, 통합 시 root가 codegen/갱신해야 `api.achievements.*` 타입이 생깁니다. focused test는 `api` any-cast를 사용했습니다.

## 검증
- `npx vitest run tests/achievements.test.ts` → 3/3 통과 (변조·권한 거절 / 누적·중복 카운트·획득률 / 칭호 해금·장착·해제).
- `npm run build` 1회 성공(기존 Convex `"use client"` 번들 경고만).
- `npx tsc --noEmit -p convex` 1회 성공. 전체 suite/브라우저 검증은 하지 않았습니다.

## 상태
- 커밋/푸시/배포 없이 freeze. root가 통합·codegen·커밋을 담당합니다.
