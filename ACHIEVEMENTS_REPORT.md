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
- `const ACHIEVEMENTS: readonly Achievement[]` (**80개**; 오리지널 8개 id 유지 + 결정论的 사다리 72개)
  - 원래 8개: `first-run` runs 1 / `score-10000` 10000점 / `distance-1000` 1000m / `slide-1` 슬라이드 1 / `slide-10` 슬라이드 10 / `stomp-10` 밟기 10 / `combo-20` 20콤보 / `perfect-10` 퍼펙트 10
  - 사다리(각 스탯별 누적/최고값 마일스톤): runs 12단계(5~500판), score 10단계(2만~75만점), distance 10단계(1500/2000/3000/5000/7500/10000/15000/20000/25000/30000 m; 30분/실제 속도 상한 고려해 기존 75k 제안을 현실 범위로 조정), slides 10단계(2~100회), stomps 10단계(20~750회), maxCombo 10단계(25~200콤보), perfects 10단계(20~750회)
  - 사다리 id는 `<stat>-<goal>` (예: `slides-15`, `maxCombo-100`). 기존 해금 row가 깨지지 않도록 `first-run`, `slide-10` 등 원래 id는 그대로입니다.
- `const TITLES: readonly Title[]` (**30개**; 오리지널 3개 + 스탯별 22개 + 종합 5개)
  - 원래 3개: `runner`=`['first-run']`, `slipper`=`['slide-1','slide-10','stomp-10']`, `legend`=`['score-10000','distance-1000','combo-20','perfect-10']`
  - 스탯별 `<stat>-tier<n>`: runs는 4단계(1/3/5/7번째 마일스톤), 나머지 6스탯은 3단계(1/3/5번째 마일스톤). `requires`는 해당 스탯의 낮은 목표부터 누적.
  - 종합 `all-rounder-1`~`5` (I~V): 7개 스탯의 1/3/5/7/9번째 마일스톤을 각각 요구. 모든 요구 id는 존재하며 서버가 `requires` 전체를 검증합니다.
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
- `npx vitest run tests/achievements.test.ts` → 3/3 통과 (80/30 cardinality·요구 id 무결성·변조/권한 거절 / 누적·중복 카운트·획득률 / 확장 칭호 해금·장착·해제).
- `npm run build` 1회 성공(기존 Convex `"use client"` 번들 경고만).
- `npx tsc --noEmit -p convex` 1회 성공. 전체 suite/브라우저 검증은 하지 않았습니다.

## 상태
- 커밋/푸시/배포 없이 freeze. root가 통합·codegen·커밋을 담당합니다.

## 후속 SUB: 도전과제 화면 모듈 (추가분)
- 신규 `src/online/achievementview.ts`, `src/online/achievementview.css`만 추가. 기존 파일·스키마·게임·UI는 건드리지 않았습니다.
- `export interface AchievementCatalog { participants:number; achievements:{ id:string; name:string; description:string; unlocked:boolean; progress:number; goal:number; earned:number; percent:number }[]; titles:{ id:string; name:string; unlocked:boolean }[]; equipped:string|null }` (요청한 정확한 형태).
- `export class AchievementView`
  - `constructor(root: HTMLElement, callbacks: { catalog:()=>Promise<AchievementCatalog>; equip:(titleId:string|null)=>Promise<unknown>; signedIn:()=>boolean })` — 추가한 `AchievementViewCallbacks` 타입은 같은 형태입니다.
  - `async open(): Promise<void>` — 카탈로그 로드 후 카드·칭호 렌더. `clear(): void` — ticket 증가, 데이터/알림/대기 상태 및 root 자식 초기화.
  - `open`/내부 `equip` 응답은 ticket과 `signedIn` 스냅샷을 검사해 계정 전환 뒤늦은 응답을 무시합니다. 오류는 고정된 안전 텍스트만 노출합니다.
  - 칭호 카드는 미해금/게스트/대기 중 버튼을 비활성화하고, 해금 칭호는 장착·장착 해제를 지원하며 현재 장착 칭호를 표시합니다.
  - 칭호 요구 목록은 pure `TITLES` + `ACHIEVEMENTS`로 이름·목표를 표시하고, 이미 해금한 항목은 강조합니다.
  - 각 도전과제 카드에 `progress/goal`, 획득률(소수 최대 2자리), `earned/participants`를 표시합니다. 분모 문구는 '일반 모드 기록 제출 회원 · 업데이트 이후부터 집계', 0명이면 '집계 시작 전'입니다. 게스트 로그인 안내도 표시합니다.
  - DOM은 `textContent`/`replaceChildren`만 사용(XSS 방지). CSS는 root에 붙은 `.achievement-view` 하위 `.achievement-*`로만 한정했고, 짧은 의미 단위 `nowrap` span, `word-break: keep-all`, `text-wrap: balance`, 320px 가로 넘침 방지를 넣었습니다. 화면 제목·홈 버튼·main·nav는 만들지 않았습니다.
  - 도전과제 목록은 전달된 배열 길이만큼 동적으로 그리며, `전체 / 진행 중 / 획득 완료` 필터로 장문 스크롤을 줄일 수 있습니다. 카운트 80/30은 모듈에 하드코딩하지 않았습니다.
- 검증: 변경 반영 후 `npx tsc --noEmit` 1회 성공. 기존 backend 테스트/빌드는 반복하지 않았고 root가 실제 브라우저 1회 확인 예정. 커밋/푸시/배포 없이 freeze 후 `t1n`에 보고.
