# 아파트 점프 (apt-jump)

**플레이: <https://apt-jump-wine.vercel.app>**

노을 진 아파트 옥상을 자동으로 달리며 뛰는 8비트 원버튼 점프 게임. Vite + TypeScript + Canvas + WebAudio로 만든 웹 게임입니다. 온라인 기능(주간 순위, 맵 공유)은 Convex를 쓰며, 연결하지 않아도 나머지는 모두 동작합니다.

## 규칙

- 짧게 누르면 낮게, 길게 누르면 높게 뜁니다.
- 착지 후 0.18초 안에 새로 누르면 **퍼펙트**: 최대 5단계까지 가속. 착지 전에 미리 누르면 점프만 됩니다.
- 동전·퍼펙트·위험 보너스마다 콤보 +1, 5콤보마다 배율 +1(최대 x5). 4초 동안 잇지 못하거나 부딪히면 초기화.
- 위험 보너스(장소마다 1회): 물탱크 위 60, 빨랫줄 이불 60, 먼 옥상 40점.
- **2단 점프**: 공중에서 한 번 더. 3초마다 충전. 높이 뜬 다이아(동전 20개분)는 2단 점프로 닿습니다.
- **밟기**: 실외기 30, 비둘기 50, 드론 60점. 위에서 밟으면 부서지고 튀어 오르며, 옆으로 부딪히면 휘청입니다. 방해꾼은 약 220m부터 나오고 점점 잦아집니다.
- **도로**: 초록 "도로" 표지와 줄무늬가 있는 옥상 뒤 발판 구간은 떨어져도 도로에 착지하고 램프로 복귀합니다. 다른 틈은 추락입니다.
- 멀리 갈수록 빨라집니다(118 → 최대 240 px/s 미만, 가속 보너스 별도).
- 실외기·물탱크 옆면에 부딪히면 휘청이며 느려지고, 건물 사이로 떨어지면 끝.

| | 점프 / 선택 | 일시정지 | 메뉴 | 음소거 |
| --- | --- | --- | --- | --- |
| 키보드·마우스 | Space, ↑, W, Z, X, 클릭 | P | ↑↓, Enter, Backspace | M |
| 터치 | 화면 누르기 | 버튼 | 누르기 | 버튼 |
| 표준 패드 | 아래 버튼 | 스타트 | 십자/왼쪽 스틱, 오른쪽 버튼(뒤로) | 설정 |

창이 포커스를 잃으면 멈추고, 재개할 때 카운트다운합니다.

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

- 로그인: Convex Auth v2 + Google. 앱의 `users` 테이블과 공개 화면(순위·맵 작성자)에는 닉네임만 둡니다. 로그인 자체에 필요한 계정 정보는 Convex Auth 컴포넌트가 따로 관리합니다.
- 주간 순위: 무한 모드만. 서버 시각 기준 KST 월요일 00:00에 새 주로 바뀌고 이전 주 기록은 남습니다.
- 점수 검증: 서버가 시드와 1회용 실행을 발급하고, 제출된 입력을 다시 실행해 점수를 계산합니다. 사람이 낼 수 없는 입력 빈도, 실제보다 빠른 완료, 2시간 지난 실행은 거부합니다. 사람처럼 입력하는 자동 플레이까지 막지는 못합니다.
- 시뮬레이션 결과가 바뀌는 수정에는 `src/replay.ts`의 `SIM_VERSION`을 올리고 Convex와 웹을 함께 배포하세요.

```sh
# 로컬 (계정 불필요)
CONVEX_AGENT_MODE=anonymous npx convex dev
npx convex env set AUTH_GOOGLE_CLIENT_ID <값>        # 없으면 자리표시 값이라도 필요
npx convex env set AUTH_GOOGLE_CLIENT_SECRET <값>
npx convex env set SITE_ORIGINS http://127.0.0.1:7622
```

### 운영

| 항목 | 값 | 상태 |
| --- | --- | --- |
| Convex 팀 / 프로젝트 | `kevin-park-e828f` / `apt-jump` | 완료 |
| 기본 production (프로젝트와 함께 자동 생성) | `honorable-guanaco-452` | 완료 |
| `SITE_ORIGINS` | `https://apt-jump-wine.vercel.app` | 설정됨 |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | 비밀 | **없음, 사용자 설정 대기** |
| Convex 함수 배포 | | **대기** (Google 값이 없으면 실패) |
| Vercel `VITE_CONVEX_URL` | `https://honorable-guanaco-452.convex.cloud` | **대기** (함수 배포 뒤) |

Google 콘솔의 승인된 리디렉션 URI: `https://honorable-guanaco-452.convex.site/oauth/google/callback`

`.env.local`은 로컬 배포용이므로 운영 명령에는 대상을 항상 적습니다. 배포에 쓰는 `.env.convex-prod.local`은 Git·Vercel에서 제외되며 내용은 다음 한 줄뿐입니다(비밀 값 없음): `CONVEX_DEPLOYMENT=prod:honorable-guanaco-452`

```sh
# 1. 값은 명령줄에 쓰지 말고 물을 때 입력 (셸 기록에 남지 않도록)
npx convex env set AUTH_GOOGLE_CLIENT_ID --deployment honorable-guanaco-452
npx convex env set AUTH_GOOGLE_CLIENT_SECRET --deployment honorable-guanaco-452
npx convex env list --names-only --deployment honorable-guanaco-452
# 2. 함수 배포
npx convex deploy --env-file .env.convex-prod.local --codegen disable
# 3. Vercel에 VITE_CONVEX_URL(위 표)을 넣고 다시 배포한 뒤 실제 로그인 확인
```

비밀 값은 Convex 환경 변수에만 두고 `VITE_`로 시작하는 변수나 파일에 넣지 않습니다.

## 구조

`physics` 물리, `world` 도시 생성, `game` 점수, `bot` 자동 플레이, `maps` 맵 스키마, `replay` 기록 재실행, `week`·`nickname` 공용 규칙(이상 DOM 없음, 일부는 서버와 공유) · `render`/`art`/`sprites` 그림 · `audio` · `input` · `ui` · `storage`/`mapstore` 저장 · `editor`/`mapscreen` 맵 화면 · `online/` 온라인 화면과 React 연결부 · `patchtest` · `main` · `convex/` 서버.

출처와 라이선스: [CREDITS.md](CREDITS.md)
