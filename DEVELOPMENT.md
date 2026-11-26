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

## 온라인 (Convex)

- 계정: Convex Auth v2(2.1.0)의 아이디+비밀번호 방식. 세션과 아이디 저장은 Convex Auth 그대로이고, 비밀번호 해시(argon2id)·로그인 시도 제한(아이디당 분당 1회, 최대 5회 누적)은 `convex/components/authPassword`가 처리합니다. 이 컴포넌트는 Convex Auth의 password 컴포넌트를 복사해(Apache-2.0, 출처·라이선스 표기 유지) **흔한 비밀번호 목록 검사만 뺀 것**이며, 같은 이름(`authPassword`)·테이블(`passwords`)·인덱스·함수로 마운트되므로 기존 비밀번호 행을 그대로 읽습니다. 이메일·Google을 쓰지 않으므로 **비밀번호를 잊으면 되찾을 방법이 없습니다**.
- 가입 `users.signUp` → `auth.signUpWithUsernamePassword`: 아이디(영문으로 시작 4~20자, 대소문자 구분 없음) + 비밀번호(**8~100자, 앞뒤 공백만 불가, 그 밖의 조건 없음**) + 닉네임을 한 트랜잭션으로 만듭니다. Convex Auth의 가입은 최소 10자로 고정되어 있어, 같은 단계를 최소 8자로 다시 쓴 것입니다(`bindMethod`, Convex Auth 타입에서 internal로 표시된 API). Convex Auth를 올릴 때는 `bindMethod`와 password 컴포넌트 변경을 확인하세요.
- `auth.signUpWithUsernamePassword`를 직접 호출해 만든 계정은 닉네임이 없어 순위·맵 게시가 막히고, 규칙에 맞지 않는 아이디는 닉네임도 정할 수 없습니다. 계정 생성 전체에 속도 제한이 있습니다.
- 주간 순위: 무한 모드만, 닉네임으로 표시. 서버 시각 기준 KST 월요일 00:00에 새 주로 바뀝니다. **production 배포마다 순위가 초기화됩니다**(사용자 요구): 페이지가 연결되면 `ranking.syncRelease`가 production `version.json`을 읽어 새 release를 활성화하고, 페이지는 이 확인이 끝난 뒤(성공·실패 모두) 실행을 발급받습니다. 확인이 실패해도 실행은 현재 순위판에 등록됩니다.
- 화면: `주간 순위`(`#ranking`)는 순위 목록·내 기록·초기화 시각만, 계정(`#account`)은 가입·로그인·닉네임·로그아웃·관리자 버튼만 담는 서로 다른 화면입니다. 타이틀은 로그인 전후 같은 8칸이며 `회원가입`/`로그인`이 `내 계정`/`로그아웃`으로 바뀝니다. 순위에 오르지 않는 판은 시작할 때 이유를 보여 줍니다.
- 줄바꿈: 안내문은 짧은 블록과 필드별 도움말로 나누고, `.screen`은 `word-break: keep-all` + `text-wrap: balance`를 씁니다.

### 관리자 (`convex/admin.ts`, `src/online/admin.ts`)

- 관리자는 Convex Auth username 컴포넌트에서 아이디 `kvkvkv`를 가진 계정 하나입니다. 모든 admin 호출이 서버 세션의 userId와 그 소유 userId를 비교하며, 화면이 보내는 값(닉네임·플래그·id)은 믿지 않습니다. `amI`는 버튼 표시용일 뿐입니다.
- 기능: 통계, 회원 검색(아이디 정확히 또는 닉네임 앞부분)·페이지 목록·상세, 비밀번호 재설정(8~100자, 대상 세션 회수, 관리자 본인은 현재 세션 유지), 정지/해제(정지 시 세션 회수, 로그인과 온라인 쓰기 거부, 본인 정지 불가), 전 기기 로그아웃, 작업 기록(`adminLog`). 삭제 기능은 없습니다.
- `users.lastActiveAt`/`plays`, `dailyStats`는 이 기능 배포 뒤부터 쌓입니다. 회원 수는 전체입니다.
- 정지 계정이 이미 게시한 맵·순위 기록은 그대로 보입니다(삭제 기능 없음).
- 비밀번호 재설정·정지·로그아웃은 대상과 작업을 보여 주는 확인 칸의 `실행`으로만 수행합니다. 회원을 바꾸면 대기 중인 확인과 입력은 지워집니다.
- 로그아웃·세션 회수·계정 변경이 감지되면 관리자 화면의 내용과 대기 중 응답을 모두 버리고 계정 화면으로 옮깁니다.
- 비밀번호·해시·토큰·세션 id는 응답과 로그에 넣지 않습니다.
- 점수 검증: 서버가 시드와 1회용 실행을 발급하고, 제출된 입력을 다시 실행해 아이템·미션까지 포함한 점수를 계산합니다. 사람이 낼 수 없는 입력 빈도, 실제보다 빠른 완료, 2시간 지난 실행은 거부합니다. 사람처럼 입력하는 자동 플레이까지 막지는 못합니다.
- 시뮬레이션 결과가 바뀌는 수정에는 `src/replay.ts`의 `SIM_VERSION`(현재 3)을 올리고 Convex와 웹을 함께 배포하세요.

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
