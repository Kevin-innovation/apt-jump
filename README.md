# 아파트 점프 (apt-jump)

**플레이: <https://apt-jump-wine.vercel.app>**

노을 진 아파트 옥상을 자동으로 달리며 뛰는 8비트 원버튼 점프 게임. Vite + TypeScript + Canvas + WebAudio로 만든 정적 웹 게임이며 서버와 DB가 없습니다.

## 규칙

- 짧게 누르면 낮게, 길게 누르면 높게 뜁니다.
- 착지 후 0.18초 안에 새로 누르면 **퍼펙트**: 최대 5단계까지 가속. 착지 전에 미리 누르면 점프만 됩니다.
- 동전·퍼펙트·위험 보너스마다 콤보 +1, 5콤보마다 배율 +1(최대 x5). 4초 동안 잇지 못하거나 부딪히면 초기화.
- 위험 보너스(장소마다 1회): 물탱크 위 60, 빨랫줄 이불 60, 먼 옥상 40점.
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

## 구조

`physics` 물리, `world` 도시 생성, `game` 점수, `bot` 테스트 자동 플레이(이상 DOM 없음) · `render`/`sprites` 픽셀 그림 · `audio` 칩튠 · `input` · `ui` · `storage` · `patchtest` · `main`.

출처와 라이선스: [CREDITS.md](CREDITS.md)
