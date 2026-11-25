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

- 계정: Convex Auth v2의 공식 아이디+비밀번호 방식. 비밀번호 해시(argon2id), 세션, 로그인 시도 제한은 Convex Auth가 처리합니다. 이메일·Google을 쓰지 않으므로 **비밀번호를 잊으면 되찾을 방법이 없습니다**.
- 가입 `users.signUp`: 아이디(영문으로 시작 4~20자, 대소문자 구분 없음) + 비밀번호(10~100자) + 닉네임을 한 트랜잭션으로 만듭니다. 공개되는 것은 닉네임뿐이고, 아이디와 같은 닉네임은 거부합니다.
- Convex Auth의 `signUpWithUsernamePassword`도 호출할 수 있지만, 그렇게 만든 계정은 닉네임이 없어 순위·맵 게시가 막히고, 규칙에 맞지 않는 아이디는 닉네임도 정할 수 없습니다. 계정 생성 전체에 속도 제한이 있습니다.
- 주간 순위: 무한 모드만, 닉네임으로 표시. 서버 시각 기준 KST 월요일 00:00에 새 주로 바뀝니다. 순위는 주 + `SIM_VERSION`별이라 규칙이 다른 버전의 점수가 섞이지 않으며, 이전 기록은 남습니다.
- 점수 검증: 서버가 시드와 1회용 실행을 발급하고, 제출된 입력을 다시 실행해 아이템·미션까지 포함한 점수를 계산합니다. 사람이 낼 수 없는 입력 빈도, 실제보다 빠른 완료, 2시간 지난 실행은 거부합니다. 사람처럼 입력하는 자동 플레이까지 막지는 못합니다.
- 시뮬레이션 결과가 바뀌는 수정에는 `src/replay.ts`의 `SIM_VERSION`(현재 2)을 올리고 Convex와 웹을 함께 배포하세요.

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
| Vercel 배포 | <https://apt-jump-wine.vercel.app> | 새 버전 공개 확인 대기 |
| production 가입·로그인 | | 사용자 확인 대기 |
| `SITE_ORIGINS` (Convex) | Google 로그인 때의 값 | 이제 쓰지 않음(지워도 됨) |

```sh
# Convex 함수 (.env.convex-prod.local 내용: CONVEX_DEPLOYMENT=prod:honorable-guanaco-452)
npx convex deploy --env-file .env.convex-prod.local --codegen disable
```

`VITE_CONVEX_URL`은 빌드할 때 들어갑니다. 값을 넣거나 바꾼 뒤에는 다시 배포해야 하고, 없으면 온라인 기능 없이 동작합니다. `SIM_VERSION`이 바뀌면 Convex와 웹을 함께 배포합니다.

## 구조

`physics` 물리, `world` 도시 생성, `game` 점수, `items` 아이템, `missions` 미션·메달, `bot` 자동 플레이, `maps` 맵 스키마, `replay` 기록 재실행, `week`·`nickname`·`username` 공용 규칙(이상 DOM 없음, 일부는 서버와 공유) · `render`/`art`/`sprites` 그림 · `audio` · `input` · `ui` · `storage`/`mapstore` 저장 · `editor`/`mapscreen` 맵 화면 · `online/` 온라인 화면과 React 연결부 · `patchtest` · `main` · `convex/` 서버.

출처와 라이선스: [CREDITS.md](CREDITS.md)
