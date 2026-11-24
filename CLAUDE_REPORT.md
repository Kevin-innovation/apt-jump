# CLAUDE_REPORT — 아파트 점프 MVP

작성: t1p (Claude Code). 커밋/푸시/배포는 하지 않음. 브랜치 `feature/flight-combat`, 전 파일 미커밋.

## 실행

README.md 참고. Vercel은 `vercel.json`(Vite, `npm ci` → `npm run build` → `dist`). 서버·DB·환경 변수 없음.

## 검증 (최종 소스 기준)

| 항목 | 결과 |
| --- | --- |
| `npm test` | 5파일 37개 통과 |
| `npm run build` (tsc 포함) | 통과, JS 42KB + 글꼴 167KB |
| `pch check dist` | 전 항목 pass, 콘솔 오류 0, 외부 요청 0, 60fps (이 PC) |

브라우저 점검(Chrome headless, dev 서버). 이후 바뀐 것은 타이틀 배경 CSS, 크레딧 화면 문구, 레시피/테스트, 크레딧·고지 파일, 문서뿐:

- `/?patch-test=1`: 12개 전부 `pass`, 약 20초
- Space 시작, P 정지 중 거리 고정, 카운트다운 재개, blur 정지, 설정 이동/복귀, 추락 결과, 새로고침 후 최고점 유지, localStorage 차단 시 안내: 정상
- 노을·야경·세로·가로 화면 육안 확인

핵심 테스트: 200시드의 모든 간격이 가속 없는 최대 점프 거리의 82% 이하, 장애물 앞뒤 여유 거리, 봇 25시드 120초 생존, 연속 동전 콤보·시간 초과·충돌 초기화, 위험/먼 옥상 보너스 중복 방지, 손상된 저장 복구.

## 리뷰 반영

- 동전도 콤보 +1. 빨리 쌓이므로 배율은 3콤보에서 5콤보마다로 조정
- 먼 옥상: 간격이 최대 점프 거리의 50% 이상이면 40점, 옥상마다 1회. 빨랫줄을 밟고 건너면 빨랫줄 보너스만 지급
- 위험 경로 이유: 착지 팝업("위험한 길: 물탱크" 등)과 타이틀 안내

## Patch

guide 확인, toolbox 검색(rooftop, city, apartment, coin, jump, korean, cat, chiptune 등). 2D 옥상에 맞는 것은 없어(대부분 3D, Kenney 범용 픽셀 팩, 칩튠 음원) 요청대로 자체 제작. 로그인·업로드 없음. `patch-recipe.draft.json`은 초안: credits 형식은 공개 스키마를 보고 작성했고 Patch 검증은 받지 않음.

## 제한 / 남은 일

- 소리를 들어본 사람이 없고, 실제 게임패드로 확인하지 않음
- 조작감·난이도는 봇으로만 확인. 봇 생존은 사람에게 적당한 난이도라는 뜻이 아님
- 실제 휴대폰에서 확인하지 않음(에뮬레이션만)
- patch-test는 자동 플레이라 키보드·터치 입력은 검증하지 않음
- 프로젝트 자체 제작물의 라이선스 미정(사용자 결정). 레시피 credits에는 임시로 `NOASSERTION` 표기
- Patch 게시 권장: 배포 여부와 별개로 사용자 지시 시 Windows의 Patch Desktop 테스트가 필요
