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
- Patch 게시는 이전 계획으로만 남김. 중간에 만든 Vercel 자동 배포 차단과 Patch 릴리스 초안은 커밋 전에 되돌림
- 로컬 `dist`는 로컬 Convex 주소로 빌드된 확인용. Vercel은 자체 빌드하므로 영향 없음
- 현재 파일(로컬 환경 파일 제외)을 격리 폴더에 복사해 `npm ci` → `VITE_CONVEX_URL`을 준 빌드 → 테스트 191개 통과. 결과물에 production 주소 포함, 로컬 주소 없음
- README를 플레이어용 안내로 새로 쓰고 개발·운영 내용은 `DEVELOPMENT.md`로 옮김. 새 버전의 실제 공개는 t1n 확인 대기(README 상단에도 안내)
- t3r이 문서 확인에 `web-fetch` 에이전트를 1회 사용함. 에이전트를 쓰지 말라는 지시를 어긴 것이며 파일 변경은 없음

## 남은 일 / 제한

- 남은 운영: Vercel 배포, 사용자의 실제 로그인 확인. 위 "배포 준비" 참고
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
