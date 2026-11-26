# P20 — 착지 직전 점프 지연 수정 (Claude, 2026-11-26, `apt-jump/jump-response`)

- 재현: 공중점프가 가능해도 착지 약 100ms 안의 입력은 착지까지 대기(지연 = 남은 시간, 최대 100ms). root도 67ms 지연 재현.
- 수정: `landsSoon` 예측 창 `BUFFER*0.9`(99ms) → `LAND_WAIT = STEP*2`(16.7ms). `BUFFER`·점프 높이·속도 무변경. tradeoff: 착지 17~100ms 전 입력은 공중점프를 씀.
- `SIM_VERSION` 5: **Convex와 웹을 함께(Convex 먼저) 배포.** 구버전 탭은 새로고침 전까지 순위 실행 발급이 거부됨. 주간 순위 행·cutoff 무변경(`resetCurrentWeek` 다시 실행하지 않음).

---

# P19 — 점프 입력 지연 조사 (Claude, 2026-11-26, `apt-jump/jump-response`)

- 입력→물리 경로(input/physics/audio, main의 simulate/runInput)에 회귀 없음. root 측정(1280x720, 첫 키 입력): 물리 2.9ms, 첫 draw 9.3ms. 사용자 체감 지연은 재현하지 못함.
- 작은 개선: 입력 방식이 바뀔 때 입력 이벤트 안에서 `UI.refresh()` 전체(설정 버튼·음소거 SVG·저장 경고·최고점)를 다시 쓰던 것을 기기별 안내 문구만 쓰도록 변경. 체감 지연이 이것 때문이라는 근거는 없고, 같은 방식으로 계속 입력하면 실행되지 않는 경로.
- `tests/input.test.ts`: 한 프레임 안의 짧은 tap도 pressed가 한 번 전달됨, 기기 전환 시 아이콘을 다시 만들지 않음.
- 미확인: 마우스·터치·패드·저사양의 실측, 긴 프레임.

---

# P18 — 이번 주 순위 새 출발 (Claude, 2026-11-26, `apt-jump/weekly-fresh-start`)

- 원인: P14가 모든 release의 주간 행을 합치면서, 이전의 배포별 초기화로 숨겨졌던 이번 주 옛 기록이 다시 보임.
- `ranking.resetCurrentWeek`(internal, `{week}`, 주당 1회), `leaderboardState.resetWeek/resetAt`(optional). board·내 최고·순위·settle·관리자 주간 기록에서 이전 기록 제외(행 보존), 이전에 시작한 실행 제출 거부. `activateRelease`는 필드를 보존.
- production 실행은 Codex 담당(Convex 배포 뒤 1회).

---

# P17 — 읽기 쉬운 구역 안내 (Claude, 2026-11-26, `apt-jump/readable-district-hud`)

- 캔버스 `drawDistrict` 제거. `#hud .left`의 점수 아래 `#district`(system sans-serif 13px, 560px 이상 14px, 줄바꿈 없는 세 줄)로 이동. 갱신은 `UI.update`.
- 편집 맵은 `hidden`, 메뉴·결과는 `#hud` 숨김, 일시정지 등 화면이 덮이면 CSS(`:has`)로 숨김. 게임·랭킹·물리·backend 무변경.
- `npm run build` 통과. 320/375·가로 화면 겹침은 브라우저에서 미확인.

---

# 통합 검증 (Claude, 2026-11-26)

`src/progression.ts`(fe85627) cherry-pick 뒤 실행: `tsc` app·convex 통과, `npm run build` 통과, `tests/progression`·`convex`·`maptimes` 25개 통과(지시에 따라 전체 suite·admin·그 밖의 테스트는 미실행, 브라우저 미확인). 맵 시간 표시는 소수 셋째 자리. P13~P16의 "미실행" 표기는 이 결과 전의 상태.

---

# P16 — 구역별 생성 프로필 (Claude, 2026-11-26, `apt-jump/progression-integration`)

- `src/world.ts`: 구역 프로필·압박/회복 리듬·lap 상승, 틈 상한 0.88. `physics.ts` 무변경, `enemyChance`/`difficulty` export 유지.
- `tests/progression.test.ts` 추가. **미실행**(`progression.ts` 통합 전). 통합 후 world/progression 테스트와 tsc·build 필요. 첫 구역부터 생성 결과가 달라지므로 기존 world·moves·bot 관련 테스트 기대값 확인 필요.

---

# P15 — 공개 맵 최단 시간 순위 (Claude, 2026-11-26, `apt-jump/progression-integration`)

- 새 파일 `convex/maptimes.ts`, `src/mapreplay.ts`, `tests/maptimes.test.ts`. 스키마에 `mapRuns`, `mapTimes` 추가(기존 변경 없음).
- `replay.ts`: 입력 해석을 `readReplay`로 분리(검증 규칙 동일). `maps.update`: 내용이 바뀌면 새 본문(이전 본문 유지), `maps.list`에 `best`.
- 화면: 공유 맵 카드의 `기록` → `#maptimes`, 완주 결과에 시간·등록 결과.
- **미실행**: `src/progression.ts` 통합 전이라 tsc·build·테스트·브라우저 모두 미확인. 통합 후 tsc(app, convex)·build·convex/maptimes 테스트 필요. `convex.test.ts`의 맵 목록·삭제 기대값은 새 동작에 맞춰 수정.

---

# P14 — 주간 순위 유지 (Claude, 2026-11-26, `apt-jump/progression-integration`)

새 사용자 규칙: 패치·난이도 변경에도 순위 유지, KST 월요일 00:00에만 새 주. 배포별 초기화 규칙(P11)은 폐기.

- `ranking.ts`: claim/settle의 release 거부 제거. board·개인 최고는 week(+user) 기준, 회원별 최고점 dedup, 동점 공동 순위. settle은 그 주 회원의 최고 행만 갱신. `SIM_VERSION`은 start·재실행 일치 확인에만 사용.
- `schema.ts`: `by_week_score`, `by_week_user_score` 추가(기존 인덱스·행 유지). Convex를 먼저 배포.
- `admin.ts`: 이번 주 기록 = 고유 회원 수(최대 2,000행 조회).
- `main.ts`: 초기화 문구 제거, 주간 기록 유지 안내.
- 테스트(`convex.test.ts`) 새 규칙으로 수정·추가. **미실행**: `src/progression.ts`가 없으면 import되지 않음 → 통합 후 tsc·build·convex 테스트 필요.
- 남음: `src/online/island.tsx`의 release 주석은 예전 설명(수정 범위 밖).

---

# P13 — 구역 배경·구역 도전 (Claude, 2026-11-26)

브랜치 `apt-jump/progression-integration` (main `20f67f1`에서 분기, 커밋 없음). `src/progression.ts`·`world.ts`는 OpenCode 담당이며 이 브랜치에 아직 없음.

- `game.ts`: `district`/`districtGoal` getter, 구역 진입 시 집계 기준 초기화, 목표 보상 1회, 이벤트 `district`/`districtGoal`. 편집 맵 무변경.
- `render.ts`: 구역별 하늘·실루엣(주택가 지붕/공사장 크레인/네온 간판/강변 다리·강/초고층)·외벽·옥상 장식, 1.5초 전환, 캐시 상한, low 품질, 한 줄 구역 HUD(`#hud` 표시 여부를 읽음).
- `replay.ts`: `SIM_VERSION` 4.
- **검증 안 함**: `progression.ts`가 없어 tsc·build·테스트·브라우저 실행 모두 미실행(지시). 통합 후 확인 필요: 타입, game/replay 관련 테스트, 모바일 HUD 위치, 구역 전환 화면.
- 가정: 팔레트 색은 `#rrggbb`, `sky`는 1개 이상. 보상 값은 `progression.ts`의 `goal.reward`를 그대로 사용.

---

# P12 — 관리자 페이지·계정/순위 화면 분리·줄바꿈 (Claude, 2026-11-26)

브랜치 `apt-jump/admin-layout` (main `61aa935`에서 분기, 커밋 없음). gameplay 파일은 건드리지 않음(OpenCode의 별도 worktree 담당). Patch 검색에서 관리자 UI에 쓸 블록은 없었음.

## 변경
- 화면 분리: `#ranking`은 순위 목록·내 기록·초기화 시각, 새 `#account`는 가입·로그인·닉네임·로그아웃·관리자 버튼. welcome의 가입/로그인도 `#account`.
- 타이틀: 로그인 전후 8칸 동일(`회원가입`→`내 계정`, `로그인`→`로그아웃`). 이전의 버튼 숨김·start 전체폭 규칙 제거.
- 고아 줄: 가입 안내 긴 문장을 필드별 도움말로 분리, `text-wrap: balance`+`keep-all`.
- 관리자(`convex/admin.ts`, `src/online/admin.ts`, `#admin`): 아이디 `kvkvkv` 소유 userId와 세션 비교를 모든 호출에서 수행. 통계, 회원 검색·페이지·상세, 비번 재설정(별도 확인 칸의 `실행`, 세션 회수; 회원 전환 시 확인·입력 초기화, 늦은 상세 응답 무시), 정지/해제(로그인·온라인 쓰기 차단), 전 기기 로그아웃, 작업 기록. 삭제 기능 없음.
- 스키마 추가(기존 필드·인덱스 삭제 없음): `users.suspended/lastActiveAt/plays`, 인덱스 `by_lastActive`, 테이블 `dailyStats`, `adminLog`. `onSignIn` 콜백 추가(정지 계정 로그인 거부).
- `AGENTS.md`(Claude 메인·OpenCode 서브, worktree별 단일 작성자, 테스트 최소화), `DEVELOPMENT.md` 갱신.

## 리뷰 반영 (Codex)
- 로그아웃·세션 회수·계정 변경·관리자 아님이 감지되면 관리자 화면 내용과 대기 응답을 버리고 계정 화면으로 이동(`guardAdmin`, `AdminScreen.clear`). 늦은 `amI` 응답은 ticket으로 무시. build와 online-ui·entry-updates 10개 통과, 전용 테스트는 없음.
- Codex 레이아웃 점검(320/375/390/768/1280): 가로 넘침·pageerror 0, 고아 줄은 320px 크레딧 1건 → 짧은 줄로 분리(build 통과). 이 수정의 브라우저 확인은 Codex 담당.
- 외부 탭 로그아웃, 관리자 클릭 흐름은 실브라우저 미확인.

## 검증
- `tsc`(app, convex), `npm run build` 통과.
- 대상 테스트만 실행: admin·online-ui·entry-updates·auth 46개 통과, 이후 변경 뒤 online-ui 6개·admin 재실행 통과. 전체 suite는 실행하지 않음(지시).

## 배포 전 확인
- Convex 먼저, 그다음 Vercel.
- 배포 뒤 `kvkvkv` 로그인 → 내 계정에 관리자 버튼, 일반 계정엔 없음.
- 활동·플레이 통계는 배포 이후만 집계(화면에 표시). 통계 계수는 2,000에서 `+` 표시.
- 정지 계정의 기존 맵·순위 기록은 계속 보임.

---

# P11 — 순위 저장·계정 동선·크레딧·비밀번호 (Claude, 2026-11-26)

브랜치 `apt-jump/fix-ranking-auth` (main `b1dc2b8`에서 분기, 커밋 없음). `feature/flight-combat`은 그대로 둠.

## 사용자 승인 (t1n 전달)
- 커밋·병합·Vercel 배포 승인. 브랜치 이름은 `apt-jump/*`로 정리. Vercel+Convex가 사용자가 명시한 배포처(Patch 기본 호스팅보다 우선).
- 실행 담당: Claude는 구현·테스트·보고까지. 커밋·병합·푸시·Convex·Vercel 배포는 Codex가 검증한 뒤 수행.

## 원인: 새 기록이 저장되지 않음
- **직접 원인(production, Codex 확인)**: Vercel은 `b1dc2b8`으로 배포됐지만 Convex production은 이전 코드. 그래서 `ranking.syncRelease`가 서버에 없음. 새 페이지의 `online.start()`는 이 호출이 실패하면 거절했고, 거절된 판은 순위 없이 진행됨. 이유는 결과 화면에만 표시됨.
- **코드상 기여 요인**:
  1. 시작 대기 3초 안에 syncRelease(서버의 manifest 요청 최대 6초)와 start가 모두 끝나야 했음. 늦으면 조용히 순위 없는 판이 됨.
  2. 계정 확인 중이거나 닉네임이 없으면 이유 없이 순위 없는 판이 됨.
- `auth.test.ts` 실패: 테스트 데이터 `scores`에 `release`가 빠져 있었음.

## 수정
- `src/online/island.tsx`: 페이지는 연결할 때 release를 한 번 맞추고, `start`는 그 확인이 끝난 뒤(성공·실패 모두) 실행을 발급받음. 이 순서라서 페이지가 방금 연 판을 스스로 무효화하지 않음. 실패해도 거절하지 않고 현재 순위판에 등록함. 실패 뒤 재시도는 1분에 한 번.
- `convex/ranking.ts`: manifest 요청 제한 6초 → 4초(`MANIFEST_WAIT`). `src/main.ts`: 시작 대기 3초 → 6초(`START_WAIT`).
- 제출 성공 시 `onlineUi.refreshBoard()`를 한 번 호출: 제출이 끝나기 전에 주간 순위를 열었어도 새 기록으로 갱신됨(`src/main.ts` `submitRun`, Codex 리뷰 반영, build만 재확인).
- 순위에 오르지 않는 판은 시작할 때 이유를 표시(약 150m 동안 안내 줄), 결과 화면에도 표시.
- 배포마다 순위 초기화는 그대로 유지(사용자 요구).
- 동선: 타이틀에서 로그인 상태의 `내 순위` 버튼을 제거(`주간 순위`와 중복). 로그아웃 상태는 `회원가입`·`로그인`, 로그인 상태는 `내 계정` 하나(닉네임·로그아웃 칸으로 이동). `주간 순위`는 순위 목록. 로그인 상태에서 버튼이 7개가 되므로 `달리기 시작`이 한 줄 전체를 차지하고 나머지는 2열을 유지. 닉네임은 첫 화면에 넣지 않음(320/375px 한 줄 유지).
- 크레딧(`index.html`, `CREDITS.md`): `게임 제작·저작권 © 2026 Kevin`을 추가. 글꼴 Galmuri11 © Lee Minseo(OFL 1.1)와 라이브러리는 "각 원저작자 소유" 항목으로 분리. OFL 원문은 변경 없음.
- 비밀번호: 최소 8자, 최대 100자(기존 유지), 앞뒤 공백만 불가, 그 밖의 조건 없음(흔한 비밀번호 목록 검사 제거).
  - Convex Auth 2.1.0은 가입 최소 10자가 고정이고, password 컴포넌트의 `_internal_dangerous_setPassword`가 흔한 비밀번호를 항상 거부함(해시를 가져오는 API 없음).
  - 그래서 `convex/components/authPassword`에 공식 컴포넌트를 복사함(Apache-2.0, 출처 헤더, `LICENSES/convex-dev_auth-Apache-2.0.txt`). 변경은 `validation.ts`의 목록 검사 제거 하나(`Changed:` 표시). 같은 마운트 이름·테이블·인덱스·함수·argon2id/scrypt·시도 제한을 유지하고, codegen한 component API는 공식과 동일.
  - 가입 `auth.signUpWithUsernamePassword`는 Convex Auth의 `bindMethod`(타입상 internal)로 같은 단계를 최소 8자로 다시 씀. 로그인은 Convex Auth 그대로. `users.createUser`는 새 메서드 이름 `usernamePasswordSignUp`도 받음.
  - 의존성은 `password-hash-wasm@0.0.0`을 명시. lockfile은 한 줄만 추가하고 optional `@emnapi` 항목은 보존(npm이 지우려던 것을 되돌림).
- 문서: `DEVELOPMENT.md` 온라인 절(계정·8자·배포마다 초기화·화면 동선·**Convex 먼저 배포**), 새 `AGENTS.md`(이 저장소 전용 역할·브랜치·배포 규칙).

## 검증 (실제 결과)
- `npm test`: 14 files, **207/207 통과**. 추가한 테스트:
  - syncRelease → start → finish → 다른 플레이어의 주간 순위에 즉시 표시, 더 좋은 기록으로 갱신.
  - `12345678`/`abcdefgh`/`password`/`rooftopx`/100자/한글 비밀번호로 가입하고, 같은 비밀번호로 로그인되며, 틀린 비밀번호는 거부됨.
  - 7자는 `8자 이상`으로 거부.
  - 로컬 password 컴포넌트를 convex-test에서 실제로 실행(시도 제한 테스트 포함).
- `npx tsc --noEmit -p convex` 통과. `npm run build`(앱 tsc + vite) 통과.
- 이번 변경 뒤 전체 재실행은 하지 않음: 타입 캐스트 2곳을 고친 뒤에는 auth 테스트 30개만 다시 실행해 통과(사용자 지시로 테스트 최소화).
- Codex 확인: 로컬에서 `abcdefgh` 가입 성공. production Convex dry-run 통과(인덱스 삭제 없음, 순위 인덱스 3개 추가).
- 참고: `npx convex codegen`이 로컬 익명 배포(t59)로 분석용 업로드를 함. production은 건드리지 않음.

## 남은 production 확인
1. Convex production 배포 뒤 `function-spec`에 `ranking:syncRelease`/`activateRelease`와 `auth:signUpWithUsernamePassword`(새 구현)가 있는지. 그 뒤 Vercel 배포(같은 커밋).
2. **기존 계정 로그인 호환**: 마운트를 공식 → 로컬 정의로 바꾼 뒤 기존 사용자 로그인이 되는지. 이 데이터 보존은 dry-run 결과(인덱스 삭제 없음)로만 추정하고 실제로는 확인하지 못함.
3. 배포 뒤 첫 방문에서 `leaderboardState`가 생기고, 실제 가입(8자)→한 판→주간 순위 표시→더 좋은 기록 갱신.
4. 320/375px 타이틀 버튼(로그아웃 8개, 로그인 7개) 한 줄 유지, 결과 화면 정렬 회귀 없음.
5. 리뷰 메모(범위 밖, 미수정):
   - settle에서 release가 바뀌면 run이 `claimed`로 남음(배포 시 거절은 요구사항).
   - clock offset 요청 한 번 실패 시 주간 경계에서 조회 차이 가능성.
   - `bindMethod`는 Convex Auth의 internal API라 업그레이드(`^2.1.0`) 때 확인 필요.

---

# P10 — Codex 직접 구현 (2026-11-25)

사용자가 Claude 한도 소진 후 Codex 직접 코드 수정을 명시적으로 승인. 기존 보고는 아래에 보존.

- 첫 방문: 회원가입/로그인/게스트 선택. 로그인 세션이 있거나 방문 선택을 기억하면 안내 생략, 타이틀 계정 진입은 항상 유지.
- 점프: 실제 홀드 시간에 맞춰 HUD와 주자 위 게이지 표시, 최대 홀드에 금색. 실제 압력 센서를 요구하지 않아 키보드·터치·패드가 동일하게 동작.
- 감속 아이템 제거. 구맵의 slow 물체만 버리고 코스는 유지. 아이템6종을 4~6옥상마다 생성, 첫 옥상 보장 제거. 40시드×1km 기존20.175개/km → 최종4.7개/km(약77% 감소).
- 도로: 시뮬레이션 시간+도로 ID로 움직이는 자동차, 접촉 즉시 게임오버, 안전모로 막지 못함. 물리·Bot·서버 재실행·렌더가 같은 위치 계산을 사용.
- 난이도: 기본140+180 가속에 250m마다22씩 8단계 추가, 1km약385·2km약483px/s. 후반 틈 비율 최대0.88, 방해꾼 빈도와 장애물 간격 강화. 사용자 맵의 별도 속도는 유지. SIM_VERSION3으로 순위 분리.
- 도감: 2열×3행, 너비320/390/1280에서 각각140×205/175×205/376×190으로 6장 모두 동일.
- 업데이트: JS와 version.json에 빌드 ID, visible30초+focus 체크. 네트워크 실패는 무시, 새 버전5초 안내 후 reload, 세션/URL 가드로 반복 방지. 맵 편집은 로컬 저장 후 이동하고 저장 실패 시 파일 다운로드 후 업데이트. 진행 중인 판은 끝나며 순위 제출 안 함. 비밀번호 저장 안 함.
- 기존 Convex 기본 beforeunload는 시각 동기화 요청만 남아도 강제 갱신을 막을 수 있어 비활성화. 대신 직접 쓰기 진행/편집 변경에 정상 이탈 경고를 제공하고, 갱신 중에는 경고 없이 이동. 브라우저 자동 갱신/구맵 보관 PASS.
- 한계: 감지 코드 없는 기존 구버전 탭을 서버에서 소급 강제 새로고침할 수 없음. 해당 탭은 최초1회 수동 새로고침 필요, 그 뒤 배포부터 자동 적용.

주간 순위 보완: 운영 기존 version2 기록3건 확인(삭제 없음). board에 난이도 조회 인자를 추가하고 이전 기록 존재 시 안내 메타데이터 반환. UI에서 이전 기록 자동 표시·난이도 선택, 목록을 가입 폼 위로 이동, 타이틀/첫 방문에 순위 버튼. 새 규칙 기록은 별도 집계해 공정성 유지.

최종 검증: 테스트14파일199개 PASS(13.90s), 타입/온라인 빌드 PASS. 브라우저 첫 방문 가입 폼, 게스트 재방문, 게이지67% 변화, 도감 동일 크기, 강제 갱신1회/루프 없음/맵 보관/오류0 확인. 최종 난이도 자동 플레이12/12 PASS(52.159s), 오프라인 빌드 pch check 전 항목PASS/메인스레드74ms. 온라인 빌드로 Patch check 시 외부 Convex 차단은 확인했으며, 사용자가 지시한 Vercel 배포용 네트워크 연결은 정상 의도임. 주간 순위 보완을 포함해 production Convex 배포 완료. 최종 온라인 빌드 브라우저에서 기존 기록3행/이전 난이도 선택/가입 폼보다 위에 목록 표시/오류0 확인. 운영 웹9953093 main 배포 READY(dpl_F16zMDUXWWc6TvtkZKf1cQkZbuGX). 공개 주소 HTTP200, /·version.json no-store, manifest99530933ba64-mwvrurgz 확인. 실제 모바일 브라우저 첫 방문·기존 순위3행·도감6장175×205·점프 게이지53%·오류0 확인. 최초 한 번 수동 갱신이 필요한 구탭 한계는 위 설명대로 유지.

---

# CLAUDE_REPORT — 아파트 점프 P9

작성: t3r (Claude Code), 2026-11-25. 이 보고의 구현 단계에서는 커밋·배포·게시·업로드 없음(이후는 "배포 준비"). 이전 보고(P6~P8)는 아래에 그대로 둠.

## 한 일

- **계정**: Google 제거. Convex Auth 2.1 공식 username-password(argon2id·세션·시도 제한은 컴포넌트). `users.signUp`이 아이디 검사 + 닉네임을 한 트랜잭션으로 처리. 로컬 함수 재배포로 `authPassword`·`authUsername`·`rateLimiter` 컴포넌트 설치 확인
- **우회 방지**: 원본 `signUpWithUsernamePassword`는 공식 API로는 내부 함수로 바꿀 수 없어 공개 상태로 둠. 대신 닉네임 없는 계정은 `requirePlayer`가 순위·맵 쓰기를 막고, `setNickname`이 아이디 규칙을 다시 확인. 대소문자만 다른 아이디는 컴포넌트 정규화로 불가
- **순위**: `scores.version` + 인덱스 `by_board_*`. 다른 `SIM_VERSION`의 점수는 보이지도, 새 기록을 막지도 않음. 예전 `nickname`/`version` 없는 행도 스키마에 맞음
- **난이도**: 130→305 px/s(이전 118→240), 절반 지점 2400px(이전 6000). 250m 속도 167→239. 방해꾼 220m→80m, 도로 앞당김, 장애물 밀도 상향. 사용자 맵의 속도 곡선은 그대로
- **게임화**: 아이템 7종, 미션 18, 메달 4, HUD 칩·미션 줄·아이템 도감, 효과음·음악 템포, 편집기에서 아이템 배치. Patch toolbox(`pch search`/`pch assets search`)를 먼저 찾았고, 팔레트가 맞는 자산이 없어 코드로 그림. 새 외부 자산·크레딧 변경 없음
- **느림 안전성**: 속도가 아니라 시간을 바꿔 점프 거리가 동일. 12시드 전 구간을 보통/느림/빠름/점프 중 효과 종료 조건으로 도약 검사, 미도달 0
- **고친 버그**: 빠른 속도에서 상승 중 램프를 뚫고 벽에 박힘, 모서리 6px 이내 상승 중 충돌
- `package-lock.json`: 이어받은 변경이 7aa9721에서 넣은 `@emnapi/core`·`runtime` 항목을 지워 되돌림

## 검증

| 항목 | 결과 |
| --- | --- |
| `npm test` | 12파일 191개 통과 (t1n 독립 실행, 문구 수정 전). 아래 "마지막 변경" 참고 |
| `npm run build` | 통과, 게임 JS 99KB(37KB gzip) + 온라인 310KB(94KB gzip). 업스트림 `use client` 경고만 (t1n) |
| `tests/auth.test.ts` | 공식 컴포넌트·argon2·세션을 실제로 실행(모의 없음): 가입/로그인/로그아웃, 중복 아이디, 비밀번호 규칙, 추측 제한, 대량 가입 제한, 우회 가입 |
| 로컬 Convex HTTP | 가입·로그인·틀린 비밀번호·`ranking.start` 확인 |
| 봇 | 25시드 × 240초 전부 생존(사람 체감 난이도의 근거는 아님) |

t1n이 실제 브라우저에서 확인(로컬 t3v 백엔드):

- 390×844 에뮬레이션: 가입, 닉네임 표시, 새로고침 뒤 세션 유지, 로그아웃, 틀린 비밀번호 한국어 오류, 대문자 아이디 로그인. pageerror·가로 넘침·Google 문구 없음
- 무입력 랭크 런(아이템 1, 동전 6, 30m, 150점)을 서버 재실행이 승인, 순위판에 닉네임과 150점
- 로그인 상태에서 연습 맵 복사→저장→게시(닉네임·구간 12개)→게시 취소. 도감 7장·HUD 모바일 확인
- `/?patch-test=1`(t41): 12/12 pass, 52.943초, 실패 0, pageerror 0 (점수 2배 아이템, 실외기+방해꾼 밟기, 도로, 일시정지/재시작 포함)
- `pch check dist --seconds 70`(t40): exit 0, 전 항목 pass, 외부 요청 0, 최장 메인 스레드 18ms, 47초 동안 약 60fps. 화면 `shots/resume-patch/2-playing.png` 확인. 문구 한 줄 수정 전 빌드 기준

`convex.test.ts`(순위·맵 규칙)는 여전히 `getAuthUserId`를 대체해 빠르게 돌리고, 실제 세션 경로는 `auth.test.ts`와 위 브라우저 확인이 담당.

## 마지막 변경

t1n 테스트·빌드 뒤 앱 코드 변경은 `POWER_TEXT.double` 문구 한 줄(미션 제외 명시)뿐. 그 뒤 t3r이 `tsc`(앱·convex)와 테스트 12파일 191개를 다시 통과시킴.

최종 빌드 확인(t1n 실행):

- 빌드(t42): exit 0. 게임 `index-B0G64-Kb.js` 99.04KB(37.50KB gzip), 온라인 94.39KB gzip
- `pch check --seconds 12 --out shots/resume-final-patch`(t43): exit 0, 전 항목 pass, 외부 요청 0, 콘솔 오류·pageerror 0, 메인 스레드 22ms, 8.3초 동안 60.1fps
- 12/12 patch-test는 문구 수정 전에 실행했으며 다시 돌리지 않음

## 배포 준비

- 사용자가 커밋·푸시·main 병합과 **Vercel 배포**를 승인(t1n 전달), 로그인은 사용자가 직접 확인. 실행은 t1n, t3r은 설정과 문서만
- 구성: Vercel 프런트엔드 + Convex production `honorable-guanaco-452`. Convex 배포 성공(t45, t1n 보고): auth·password·username·rateLimiter 설치. 게스트 조회(board·me)와 게스트 쓰기 거부 확인(t1n). production 계정은 만들지 않았고 가입·로그인은 사용자 확인 몫
- Vercel 프로젝트에 `VITE_CONVEX_URL=https://honorable-guanaco-452.convex.cloud`(Production)를 Production·Preview에 설정함(t1n 보고). 연결된 프로젝트의 production 브랜치는 main
- 커밋 `4c61113`을 feature에 푸시, 기준 커밋 `37fc610`에서 main을 만들어 fast-forward 병합·푸시, GitHub 기본 브랜치를 main으로 변경(t1n)
- Vercel production 공개 완료(t47 exit 0, t1n 확인): `apt-jump-oj6zm8zq5-dlab-daegu.vercel.app`, 주소 <https://apt-jump-wine.vercel.app>. 브라우저에서 HTTP 200, 제목, 아이템 7종·미션 문구, 아이템 도감, 가입 폼(아이디·비밀번호·닉네임) 표시, pageerror 0. 실제 가입은 하지 않음
- production 메타데이터(t1n 확인): `dpl_3w6NHQXXqw37J6ECgYe6ZZSAmaY4` READY, main, sha `4c6111327b2d2cd320eb32b8e7caab26286ef014`. 공개 번들 `index-CAtEdDHj.js`에 production Convex 주소가 있고 `127.0.0.1:3210`은 없음(t3r의 격리 빌드와 같은 파일 이름)
- 브랜치 이름 `feature/flight-combat`은 상위 작업 공간에서 물려받은 이름일 뿐이며, 저장소·패키지·게임은 모두 `apt-jump`(아파트 점프). 이름은 바꾸지 않음
- Patch 게시는 이전 계획으로만 남김. 중간에 만든 Vercel 자동 배포 차단과 Patch 릴리스 초안은 커밋 전에 되돌림
- 로컬 `dist`는 로컬 Convex 주소로 빌드된 확인용. Vercel은 자체 빌드하므로 영향 없음
- 현재 파일(로컬 환경 파일 제외)을 격리 폴더에 복사해 `npm ci` → `VITE_CONVEX_URL`을 준 빌드 → 테스트 191개 통과. 결과물에 production 주소 포함, 로컬 주소 없음
- README를 플레이어용 안내로 새로 쓰고 개발·운영 내용은 `DEVELOPMENT.md`로 옮김. 공개 확인 뒤 README 상단의 임시 안내를 지움
- t3r이 문서 확인에 `web-fetch` 에이전트를 1회 사용함. 에이전트를 쓰지 말라는 지시를 어긴 것이며 파일 변경은 없음

## 남은 일 / 제한

- 남은 운영: 사용자의 실제 production 가입·로그인 확인. 위 "배포 준비" 참고
- 설치된 pch에 게임 설정 명령이 없음(t1n 확인: `pch game settings --help`가 기본 도움말로 넘어감). `connects_to`는 Patch MCP 또는 API로 등록
- 비밀번호 찾기 없음(이메일을 받지 않으므로). 로그인 시도 제한은 계정별이라 남이 일부러 잠글 수 있음(1분에 1회씩 회복)
- 가입 제한은 전역(분당 20, 최대 40)이라 대량 공격 시 정상 가입도 늦어짐
- 실기기·소리·패드·사람 난이도, Safari/Firefox 재실행 일치는 미확인
- 이 로컬 DB에 시험 계정이 남아 있음(t1n의 시험 계정들, t3r의 smoke 1개)
- 실행 중: t3v `apt-convex-local`(t3r 시작, 127.0.0.1:3210), t3s `apt-resume-web`(t1n 시작, 127.0.0.1:7622)

---

# CLAUDE_REPORT — 아파트 점프 v2 (P6~P8)

작성: t1p (Claude Code). 본문은 커밋 전 작성 기준이며 이후 결과는 맨 끝 "후속 기록" 참고. MVP(P0~P5) 보고는 커밋 044f237의 이 파일 참고.

## 검증

| 항목 | 결과 |
| --- | --- |
| `npm test` | 10파일 141개 통과 |
| `tsc` (앱, convex) | 통과 |
| 업로드 대상 파일만 복사한 `npm ci` + build | 통과, 게임 JS 33KB gzip + 온라인 94KB gzip(연결 주소가 있을 때만 내려받음), 로컬 주소 미포함 |
| `pch check` (위 빌드) | 전 항목 pass, 외부 요청 0 |
| `/?patch-test=1` | 12/12 pass, 55초, pageerror 0 |
| 재실행 검증 속도 | 20분 기록 67ms, 5.6KB (이 PC Node) |

- 생존: 봇 25시드 × 240초(최고 속도 부근) 전부 생존. 방해꾼 하나하나에 대해 깨끗이 지나는 방법이 3가지 이상임을 확인
- 도로: 30시드에서 입력 없이 떨어져도 도로 → 램프 → 옥상 복귀
- 서버: convex-test로 게스트 차단, 본인만 닉네임·맵 수정, 1회 제출, 손상·초고속·오래된 기록 거부, KST 주 전환, top50, 페이지 제한. **convex-test에서는 로그인 세션 확인(getAuthUserId)을 대체**했으므로 실제 세션 경로는 검증하지 않음
- 로컬 Convex 실서버: 함수 배포 성공, 게스트 조회, Google 로그인 주소로 이동까지 확인. t1n이 게스트 변경 호출 거부를 별도 확인
- 브라우저: 온라인 모듈을 가짜로 바꿔 실제 키 입력 런(중간 일시정지 포함)의 재실행 점수가 화면 점수와 일치, 닉네임 입력, 게시/갱신/취소/플레이, 응답 지연 시 비순위 시작 확인. 마크업 닉네임·맵 이름은 텍스트로만 표시

## 리뷰 반영

- `reach<=0` 검사, 조작 안내가 다른 도움말을 덮던 문제, 닉네임 중복 fallback, 위조 테스트의 시드 의존, 주간 전환 시 무한 재귀(회귀 테스트가 수정 전 실패·수정 후 통과), `.vercelignore`의 `.convex`
- 공유 맵은 메타데이터 목록 + 개별 get, 본문은 별도 테이블
- 시뮬레이션에서 `exp`/`sin` 제거: 브라우저 엔진이 달라도 재실행이 같도록

## 제한 / 남은 일

- **P8 운영은 미완료**: Google 값이 없어 Convex 함수 배포, Google 로그인, 로그인 상태의 서버 호출을 확인하지 못함. 현재 상태와 명령은 DEVELOPMENT "운영" 및 아래 후속 기록
- 재실행 검증은 점수 조작을 막지만, 시드를 받아 자동으로 플레이하는 봇은 막지 못함. 일시정지를 허용하므로 느린 플레이도 구분하지 못함
- Safari/Firefox에서 재실행 일치는 실측하지 않음(기본 사칙연산만 쓰도록 설계)
- 맵 편집기는 포인터 조작 중심이라 패드로는 배치할 수 없음. 패드 실기기·소리·실제 휴대폰·사람 난이도는 여전히 미확인
- 로컬 빌드는 `.env.local`의 로컬 주소 문자열을 포함하지만 운영 빌드는 https 주소가 아니면 연결하지 않음. Vercel에는 올라가지 않음
- Patch 배포본은 외부 호스트 연결이 막히므로 `VITE_CONVEX_URL` 없이 빌드(온라인 기능 없이 동작)
- 자체 제작물 라이선스 미정(사용자 결정)

## 후속 기록

- 커밋 `0040aa2`, 잠금 파일 수정 `7aa9721` 푸시. Vercel 재배포 성공(t1n 수행·보고): <https://apt-jump-wine.vercel.app>
- 잠금 파일: npm 10에서 `@emnapi/core`·`@emnapi/runtime` 누락을 재현하고 두 항목만 추가. 격리 폴더 npm 10/11 × linux/win32 설치 통과
- Convex 운영(t1n 수행·보고): 로그인, 팀 `kevin-park-e828f`의 `apt-jump` 프로젝트 생성 완료. 기본 production `honorable-guanaco-452`는 자동 생성됨. 이전 문서의 production 생성 명령은 "이미 존재" 오류가 나고 prod 선택은 지원되지 않아 삭제
- t1p 확인: `env list --names-only --deployment honorable-guanaco-452`에 `SITE_ORIGINS`만 있음. `env set`에는 `--env-file`이 없어 `--deployment`로 대상을 지정. `convex deploy --env-file`은 도움말로만 확인하고 실행하지 않음
- 대기: 사용자의 Google OAuth 값 → Convex 함수 배포 → Vercel `VITE_CONVEX_URL` → 실제 로그인 확인
- t1p가 시작한 서버는 모두 종료함
