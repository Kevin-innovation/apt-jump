# 개발 안내

플레이 방법은 [README.md](README.md). Vite + TypeScript + Canvas + WebAudio로 만들고, 온라인 기능(계정, 주간 순위, 맵 공유)은 Convex를 씁니다. 온라인 주소 없이 빌드해도 나머지는 모두 동작합니다.

배포: 프런트엔드는 Vercel(<https://apt-jump-wine.vercel.app>), 백엔드는 Convex production. Patch 공개는 이전 계획이며 지금은 진행하지 않습니다.

## 실행

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 7622 --strictPort
npm test
npm run build      # 타입체크 + dist/
pch check dist     # Patch 헤드리스 검사 (로그인 불필요)
```

`/?patch-test=1`은 게임을 실제로 자동 플레이하며 콘솔에 `pass <check>`를 출력합니다. 이 모드는 사람 입력을 무시하고 기록을 저장하지 않습니다. 검사 목록은 `patch-recipe.draft.json`(초안)에 있습니다.

## 유저 맵

타이틀 → 유저 맵에서 만들고, 저장하고, 테스트하고, JSON 파일로 주고받습니다. 단위는 8px이며 스키마와 제한은 `src/maps.ts`의 `LIMITS`에 있습니다. 맵 점수는 무한 모드 기록·주간 순위와 섞이지 않습니다.

## 구역 (무한 모드)

- 계약: `src/progression.ts`의 `districtAt(distance)`가 400m마다 구역(주택가·공사장·네온 상가·강변·초고층)과 목표·팔레트(`#rrggbb`)를 정합니다.
- `Game.district` / `Game.districtGoal`: 구역에 들어설 때의 집계를 기준으로 목표를 세고, 달성하면 보상을 한 번만 더합니다. 기존 미션·아이템은 그대로이며 편집 맵에는 구역이 없습니다.
- `Renderer`: 구역별 하늘·실루엣·건물 외벽·옥상 장식. 배경은 현재 구역과 사라지는 구역 2개만, 건물 그림은 80개까지만 보관합니다. `low` 품질은 배경 층과 장식을 줄이고 전환 페이드를 생략합니다.
- 구역 안내(`#district`)는 DOM HUD의 점수 아래에 system sans-serif 13~14px 세 줄(구역·다음 거리·목표)로 표시합니다. 편집 맵, 일시정지·결과·메뉴에서는 숨깁니다.
- `world.ts`의 `PROFILES`: 주택가 넓은 옥상, 공사장 도로·비계 비중, 네온 방해꾼, 강변 먼 틈·낮은 고저차·빨랫줄, 초고층 고저차·물탱크. 구역 후반(50~85%)은 압박, 마지막 15%는 회복(새 도로 없음), 2회차부터 소폭 상승(상한). 틈은 점프 도달거리의 0.88 이하(최소 틈 26px·도로 위 70px은 유지), 착지·도움닫기 구간과 아이템 희귀도는 그대로.
- 구역 보너스와 생성 변화 때문에 `SIM_VERSION` 4, 착지 직전 입력 처리 변경으로 5.
- 점프 입력: 공중점프가 가능하면 바로 뜁니다. 착지가 `LAND_WAIT`(2스텝, 약 17ms) 안일 때만 착지 점프로 미룹니다. 공중점프가 없을 때의 입력 버퍼(`BUFFER` 110ms)는 그대로입니다.

## 공개 맵 시간 순위 (`convex/maptimes.ts`, `src/mapreplay.ts`)

- 로그인 뒤 `온라인 게시`한 맵만 공개됩니다(자동 공개 없음). 게스트도 플레이할 수 있고, 기록 등록은 로그인 회원만(정지 계정 거부)입니다. 내 맵 보관함·편집기 테스트는 서버 순위와 무관합니다.
- 서버가 실행을 발급할 때 맵 내용(`bodyId`)을 고정해 그 JSON을 돌려주고, 제출된 입력을 다시 실행해 **골에 도착한 것만** 인정합니다. 시간은 `steps × STEP`(일시정지 제외)이며 클라이언트 시간은 받지 않습니다. 발급 뒤 실제 경과보다 긴 기록, 2시간 지난 실행, 재제출은 거부합니다.
- 맵별 전체 기간, 회원별 최단 하나. 맵 내용이 바뀌면 새 `bodyId`로 순위가 분리되고 이전 본문·기록 행은 남습니다(본문이 계속 쌓임).

- 공유 절차(3.4.0~, `convex/maps.ts`): `shareStart`가 내용을 `mapShares`에만 보관하고, `shareFinish`는 재생해 골에 도착했는지 검증하고 `maps`/`mapBodies`에 한 트랜잭션으로 게시만 합니다(갱신은 그때까지 이전 내용 유지). 이 확인용 판은 `mapTimes`와 `maps.plays`를 바꾸지 않으며(3.6.0~), 둘은 공개 맵을 완주한 판(`maptimes.finish`)에서만 바뀝니다. 내용이 바뀐 갱신은 새 `bodyId`를 만들고, 이전 내용의 기록은 남아 「이전 버전」 기록(`maptimes.versions`)에서 볼 수 있습니다. 예전 방식으로 저장된 제작자의 확인용 행(내용 생성 1초 이내)은 지우지 않고 순위에서만 숨깁니다. 예전 `publish`/`update`는 새로고침 안내로 거부합니다. `rename`은 제목만 바꾸며 내용(`bodyId`)과 기록은 그대로입니다. Convex를 웹보다 먼저(또는 함께) 배포하세요.

## 온라인 (Convex)

- 계정: Convex Auth v2(2.1.0)의 아이디+비밀번호 방식. 세션과 아이디 저장은 Convex Auth 그대로이고, 비밀번호 해시(argon2id)·로그인 시도 제한(아이디당 분당 1회, 최대 5회 누적)은 `convex/components/authPassword`가 처리합니다. 이 컴포넌트는 Convex Auth의 password 컴포넌트를 복사해(Apache-2.0, 출처·라이선스 표기 유지) **흔한 비밀번호 목록 검사만 뺀 것**이며, 같은 이름(`authPassword`)·테이블(`passwords`)·인덱스·함수로 마운트되므로 기존 비밀번호 행을 그대로 읽습니다. 이메일·Google을 쓰지 않으므로 **비밀번호를 잊으면 되찾을 방법이 없습니다**.
- 가입 `users.signUp` → `auth.signUpWithUsernamePassword`: 아이디(영문으로 시작 4~20자, 대소문자 구분 없음) + 비밀번호(**8~100자, 앞뒤 공백만 불가, 그 밖의 조건 없음**) + 닉네임을 한 트랜잭션으로 만듭니다. Convex Auth의 가입은 최소 10자로 고정되어 있어, 같은 단계를 최소 8자로 다시 쓴 것입니다(`bindMethod`, Convex Auth 타입에서 internal로 표시된 API). Convex Auth를 올릴 때는 `bindMethod`와 password 컴포넌트 변경을 확인하세요.
- `auth.signUpWithUsernamePassword`를 직접 호출해 만든 계정은 닉네임이 없어 순위·맵 게시가 막히고, 규칙에 맞지 않는 아이디는 닉네임도 정할 수 없습니다. 계정 생성 전체에 속도 제한이 있습니다.
- 주간 순위: 무한 모드만, 닉네임으로 표시. **서버 시각 기준 KST 월요일 00:00에만 새로 시작합니다**(사용자 요구). 패치·배포·난이도 변경에도 주간 기록은 유지됩니다. 순위판과 개인 최고점은 `week`(+`userId`)만으로 모든 `version`/`release`의 행을 합쳐, 회원별 최고점 하나를 보여 줍니다(동점은 같은 순위). 기존 행은 삭제하지 않습니다. `SIM_VERSION`은 재실행 일치용으로 새 판 발급·제출에만 쓰고 순위 필터가 아닙니다. `release`와 `ranking.syncRelease`는 업데이트 안내·구버전 페이지 호환용이며 순위와 무관합니다.
- 이번 주 새 출발(운영자 전용, 사용자 요청 때만): `npx convex run ranking:resetCurrentWeek '{"week":"<이번 주 월요일 KST, YYYY-MM-DD>"}' --prod`. internal mutation이라 화면에서 호출할 수 없고 배포는 실행하지 않습니다. 그 주의 `resetAt` 이전 기록은 순위판·내 최고·순위 계산·관리자 집계에서 빠지지만 행은 남습니다. 그 전에 시작한 실행은 제출이 거부됩니다. 같은 주에 다시 실행해도 변화가 없습니다.
- 화면: `주간 순위`(`#ranking`)는 순위 목록·내 기록·초기화 시각만, 계정(`#account`)은 가입·로그인·닉네임·로그아웃·관리자 버튼만 담는 서로 다른 화면입니다. 타이틀은 로그인 전후 같은 8칸이며 `회원가입`/`로그인`이 `내 계정`/`로그아웃`으로 바뀝니다. 순위에 오르지 않는 판은 시작할 때 이유를 보여 줍니다.
- 줄바꿈: 안내문은 짧은 블록과 필드별 도움말로 나누고, `.screen`은 `word-break: keep-all` + `text-wrap: balance`를 씁니다.

### 관리자 (`convex/admin.ts`, `src/online/admin.ts`)

- 관리자는 Convex Auth username 컴포넌트에서 아이디 `kvkvkv`를 가진 계정 하나입니다. 모든 admin 호출이 서버 세션의 userId와 그 소유 userId를 비교하며, 화면이 보내는 값(닉네임·플래그·id)은 믿지 않습니다. `amI`는 버튼 표시용일 뿐입니다.
- 화면(3.2.1~): 가로 한 화면 대시보드(일반 글꼴). 핵심 숫자 13개, `admin.trends`의 최근 14일(하루 플레이·플레이어·가입) 차트, 회원 표(최근 접속=세션 갱신·활동 중 늦은 쪽, 최근 로그인=최신 세션 생성, 최근 플레이=최신 순위 판 시작, 7일 판=`dailyProgress` 합, 주간 최고, 코인), 열 제목 정렬과 화면에 맞춘 페이지, 최근 순위 판 30개와 관리 기록, 오른쪽에서 열리는 회원 상세. 폭 1000px·높이 560px 미만에서는 세로로 쌓여 스크롤됩니다.
- 기능: 통계, 회원 검색(아이디 정확히 또는 닉네임 앞부분)·페이지 목록·상세, 코인 조정(±1,000,000, 0 아래로 안 내려감)·코스튬 회수(환불 선택), 비밀번호 재설정(8~100자, 대상 세션 회수, 관리자 본인은 현재 세션 유지), 정지/해제(정지 시 세션 회수, 로그인과 온라인 쓰기 거부, 본인 정지 불가), 전 기기 로그아웃, 작업 기록(`adminLog`). 삭제 기능은 없습니다.
- `users.lastActiveAt`/`plays`, `dailyStats`는 이 기능 배포 뒤부터 쌓입니다. 회원 수는 전체입니다.
- 정지 계정이 이미 게시한 맵·순위 기록은 그대로 보입니다(삭제 기능 없음).
- 비밀번호 재설정·정지·로그아웃은 대상과 작업을 보여 주는 확인 칸의 `실행`으로만 수행합니다. 회원을 바꾸면 대기 중인 확인과 입력은 지워집니다.
- 로그아웃·세션 회수·계정 변경이 감지되면 관리자 화면의 내용과 대기 중 응답을 모두 버리고 계정 화면으로 옮깁니다.
- 비밀번호·해시·토큰·세션 id는 응답과 로그에 넣지 않습니다.
- 점수 검증: 서버가 시드와 1회용 실행을 발급하고, 제출된 입력을 다시 실행해 아이템·미션까지 포함한 점수를 계산합니다. 사람이 낼 수 없는 입력 빈도, 실제보다 빠른 완료, 2시간 지난 실행은 거부합니다. 사람처럼 입력하는 자동 플레이까지 막지는 못합니다.
- 시뮬레이션 결과가 바뀌는 수정에는 `src/replay.ts`의 `SIM_VERSION`(현재 13)을 올리고 Convex와 웹을 함께 배포하세요.

```sh
# 로컬 (계정·환경 변수 불필요). .env.local의 VITE_CONVEX_URL=http://127.0.0.1:3210
CONVEX_AGENT_MODE=anonymous npx convex dev
```

### 운영

| 항목 | 값 | 상태 |
| --- | --- | --- |
| Convex 팀 / 프로젝트 | `kevin-park-e828f` / `apt-jump` | 완료 |
| Convex production | `honorable-guanaco-452` | 함수 배포 완료, 게스트 조회와 게스트 쓰기 거부 확인(t1n 보고) |
| Vercel 환경 변수 `VITE_CONVEX_URL` (Production·Preview) | `https://honorable-guanaco-452.convex.cloud` | 설정됨(t1n 보고) |
| Vercel 배포 | <https://apt-jump-wine.vercel.app> | 공개 완료: `4c61113`, 2026-11-25 (t1n 확인) |
| production 가입·로그인 | | 사용자 확인 대기 |
| `SITE_ORIGINS` (Convex) | Google 로그인 때의 값 | 이제 쓰지 않음(지워도 됨) |

```sh
# Convex 함수 (.env.convex-prod.local 내용: CONVEX_DEPLOYMENT=prod:honorable-guanaco-452)
npx convex deploy --env-file .env.convex-prod.local --codegen disable
```

`VITE_CONVEX_URL`은 빌드할 때 들어갑니다. 값을 넣거나 바꾼 뒤에는 다시 배포해야 하고, 없으면 온라인 기능 없이 동작합니다. `SIM_VERSION`이 바뀌면 Convex와 웹을 함께 배포합니다. **배포 순서: Convex 함수를 먼저(또는 함께) 배포한 뒤 Vercel을 배포합니다.** 웹만 배포되면 새 페이지가 서버에 없는 함수를 불러 기록이 저장되지 않습니다(2026-11-26 실제 원인).

## 구조

`physics` 물리, `world` 도시 생성, `game` 점수, `items` 아이템, `missions` 미션·메달, `bot` 자동 플레이, `maps` 맵 스키마, `replay` 기록 재실행, `week`·`nickname`·`username` 공용 규칙(이상 DOM 없음, 일부는 서버와 공유) · `render`/`art`/`sprites` 그림 · `audio` · `input` · `ui` · `storage`/`mapstore` 저장 · `editor`/`mapscreen` 맵 화면 · `online/` 온라인 화면과 React 연결부 · `patchtest` · `main` · `convex/` 서버.

출처와 라이선스: [CREDITS.md](CREDITS.md)

## 첫 방문과 배포 갱신

- 첫 방문 계정 안내는 로컬 플래그로 재표시를 막고, 로그인 세션이 있으면 생략합니다. 저장 거부 시 메모리에서 동작합니다.
- 빌드별 ID를 JS와 `version.json`에 함께 넣습니다. 화면이 보일 때 30초 간격과 focus/visibilitychange에서 검사하고, 새 ID면 5초 안내 후 새로고침합니다. 네트워크 실패·잘못된 응답은 무시하고, 세션/URL 가드로 반복 새로고침을 막습니다.
- `/`, `/index.html`, `/version.json`은 Vercel `Cache-Control: no-store`로 배포합니다. 해시 자산은 별도 캐시를 유지합니다.
- 이 감지 코드가 없던 구버전 탭은 원격으로 최초 새로고침할 수 없습니다. 해당 사용자에게 최초 1회 새로고침이 필요하며, 이후 배포부터 자동 적용됩니다.
- 자동차 위치는 주자의 시뮬레이션 시간과 도로 ID에서 계산합니다. Bot·브라우저·서버 재실행이 같은 경로를 사용하며 자동차 충돌은 안전모와 무관하게 즉시 종료합니다.
- 구맵의 `slow` 물체는 로드할 때 제거합니다. 아이템 풀·편집기·물리에는 감속 기능이 없습니다.

## 슬라이드·지름길·도로 (SIM_VERSION 6)

- 입력: PC는 `ArrowDown`만, 터치는 `↓` 버튼, 패드는 십자 아래·왼쪽 버튼·스틱 아래. 새로 누른 한 번만 전달합니다. 같은 스텝의 점프가 우선합니다. 0.65초, 쉬는 시간 0.35초, 낮은 몸 7px.
- 리플레이: A~H(점프 누름 1 · 누르고 있음 2 · 슬라이드 4). 서버와 화면이 같은 해석(`inputOf`)을 씁니다.
- 장애물: `bar`(위에서 내려온 틀, 슬라이드로만 통과), `box`(슬라이드나 밟기로 파괴). `Game.slides`는 성공한 회피·파괴를 id당 한 번 셉니다.
- 틈새 드론(`Enemy.over`): 도로·빨랫줄이 없는 짧은 간격에만. 공중에서 옆으로 부딪히면 콤보만 끊기고 속도는 유지합니다.
- 밟기: 이전/현재 발 위치로 판정하고 윗면을 좌우 4px 넓게 봅니다.
- 도로: 도착 후 0.9초(`ROAD_GRACE`) 동안 닿은 차는 떨어질 때까지 통과합니다. 그 뒤에는 헬멧이 있어도 치명적입니다. 도로 위 공중에서 `↓`는 급강하입니다.
- 실내 보너스 건물(`Roof.route`): 지붕은 안전한 길(거리 단축은 없음). 약 2.5초 전 화면 위 안내와 표지가 나오고, 유리 위에서 슬라이드해야만 실내로 들어가고, 상자·덕트를 지나 경사로로 같은 지붕에 돌아옵니다. 통로 안은 무한 모드와 맵이 같은 `world.passage()`로 만듭니다(맵의 구간 설정 `route`).
- 도전과제 통계는 `ranking.finish`가 서버에서 재생해 구하고, `settle`이 실행당 한 번만 반영합니다. 맵 기록은 세지 않습니다.

## 3.x 게임 흐름과 운영 (SIM_VERSION 13)

- 공유 맵 횟수(`maps`): `plays`는 확인된 완주(`maptimes.settle`), 인기순·BEST 기준. `attempts`(3.7.0)는 화면의 「누적 플레이」(시작 횟수, 중간에 그만둔 판 포함)로 회원은 `maptimes.start`가 발급할 때, 게스트·닉네임 없는 계정은 `maptimes.countStart`(로그인 없음, 맵당 분당 30회·최대 60회 누적 제한)가 더합니다. 게스트 완주는 `plays`에 없습니다. `shareStart`/`shareFinish`는 둘 다 바꾸지 않습니다. 값이 없는 옛 맵은 `max(attempts, plays)`(`startsOf`)로 읽어 완주율이 100%를 넘지 않습니다.

- 무한 모드 가시(3.7.0, SIM_VERSION 13, `world.ts` `maybeSpikes`): `SPIKE_START`(약 200m)부터 일반 옥상에 확률적으로 한 곳. 옥상 시작 뒤 `SPIKE_CLEAR`(0.9초) 이후, 다음 점프 도움닫기 전, 장애물·방해꾼·물웅덩이와 0.9초 이상 떨어진 곳에만 놓습니다. 구역 후반 휴식·정전 랩·균열 옥상 제외. 시드에서 결정되므로 서버 재생과 같습니다.
- 편집기 테스트 시작 위치(`maps.ts` `testCourse`): 만든 코스를 통째로 평행 이동해 고른 지점이 출발선이 되게 합니다(속도는 맵의 시작 속도부터). 맵 형식·공유·순위에는 영향이 없습니다.

- 기어(`src/progression.ts`): 2km 랩과 별개로 거리 `GEAR_AT` [0, 300, 700, 1.2k, 1.8k, 2.5k, 3.3k, 4.2k, 5.2k, 6.3k]m마다 올라갑니다. 기어마다 속도 +4%(최대 +36%, `DEFAULT_PACE.lapGear`), 모든 점수와 거리 점수에 `gearMultiplier` ×1 → ×5(9기어). 만든 맵에는 기어가 없습니다(`Pace.lapGear` 없음).
- 시작 속도: `DEFAULT_PACE` base 200 · gain 120(최고 속도는 이전과 같은 320+단계). 자동차 간격은 기어만큼 넓어지고(`Road.spacing`), 도로마다 속도·출발·간격이 다릅니다(최소 간격 0.82, `traffic.ts`).
- 골든 러시: 3기어부터 각 기어 직전 150m, 마지막 기어 뒤로는 1.2km마다. 점수 ×3, 피버 게이지는 차지 않음, 기어 경계에서 끝나고 `goldenEnd`로 정산합니다. 맵은 구간 설정 `golden`.
- 피버: 10콤보부터 게이지가 찹니다. 첫 기어(300m)에 피버 확정. 피버 중 다시 채우면 ×2 → ×3 → ×4(`FEVER_MULTS`), 콤보가 끊기면 ×2로.
- 연속 밟기: 착지 없이 연달아 밟으면 ×2 … ×5(`MAX_STOMP_CHAIN`).
- 추격 깃발: 로컬 `bestDistance`와 이번 주 1위 거리에 깃발(`Renderer.marks`), HUD에 남은 거리, 지나가면 안내. 결과 줄에 다음 순위·1위까지 점수 차.
- 일시정지: 직접 하는 일시정지는 한 판에 1번. 창을 벗어나거나 업데이트로 멈추는 것은 세지 않습니다(서버의 일시정지 한도는 그대로).
- 업데이트: 판 도중 새 버전을 찾으면 HUD에만 표시하고, 판이 끝난 뒤 7초 있다가 안내합니다. `SIM_VERSION`이 바뀐 배포라면 이전 규칙으로 시작한 판은 "게임 규칙이 업데이트되어…"로 순위에서 빠집니다. 규칙이 바뀌는 배포는 모아서, 사람이 적은 시간에 하세요.

### 코인 · 출석 · 미션 · 주간 보상

- 코인은 서버만 지급합니다: 판의 동전(`ranking.settle`), 도전과제 해금(등급별), 출석(`daily.checkIn`, 1~7일 100~700), 오늘의 미션(`dailyMissions`, 하루 3개 · 200/350/600), 주간 보상. 가입 시 300.
- 주간 보상(`convex/rewards.ts`, `convex/crons.ts`): 매주 월요일 00:05 KST에 끝난 주를 정산합니다. 1~3위 5,000/3,000/2,000(동점은 같은 순위·같은 보상), 그 주 검증된 판 10판 이상이면 300. 주당 한 번만 지급되고(`weeklyRewards.by_week`), 회원은 다음 타이틀 화면에서 한 번 안내를 봅니다.
- 정산이 빠졌다면(크론 실패 등) 끝난 주를 지정해 수동 지급합니다. 진행 중인 주는 거부됩니다.

```sh
npx convex run rewards:payLastWeek '{"week":"2026-11-23"}' --env-file .env.convex-prod.local
```

- 점수 도전과제: 100만·200만·300만·500만은 나중에 더한 단계라 등급을 고정했습니다(`EXTRA`). 기존 사다리의 등급과 이미 지급한 보상은 바뀌지 않습니다.

### 방문 통계

- Vercel Web Analytics(`@vercel/analytics`의 `inject()`, `src/main.ts`). 쿠키 없음, 테스트 실행 제외. 사용자 지정 이벤트 `run_start`(map/ranked/guest), `costume_buy`, `check_in`은 요금제에 따라 대시보드에 보이지 않을 수 있습니다.

### 배포 순서 (요약)

1. `npm test`, `npx tsc --noEmit -p .`, `npx tsc --noEmit -p convex`, `npm run build`
2. `src/version.ts`에 버전·패치노트, `package.json` 버전
3. Convex: `npx convex deploy --env-file .env.convex-prod.local --codegen disable -y`
4. `apt-jump/*` 브랜치에 커밋 → main에 fast-forward → push (Vercel 자동 배포)
