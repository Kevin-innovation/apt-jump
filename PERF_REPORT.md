# 저사양 PC 성능 개선 (apt-jump/low-spec)

## 변경 파일
- `src/ui.ts`
- `src/render.ts`
- 그 외 소스/설정/물리/게임/랭킹/서버 파일은 수정하지 않았습니다.

## 적용한 개선 (근거: 매프레임 hotpath)

1. **HUD DOM 쓰기 최소화 (`src/ui.ts`)**
   - `update()`가 프레임마다 `getElementById`를 20회 이상 호출하던 것을, element reference를 `Map`에 1회 캐시해 재사용 (`el()`).
   - 값이 같아도 매프레임 `style.transform`, `aria-valuenow`, `district`의 `borderColor`를 다시 쓰던 것을 캐시 비교 후에만 기록 (`style()`, `attr()`).
   - `mission` / `combo` / `district` / `count`의 `hidden`은 실제 `element.hidden`과 비교해 바뀔 때만 setter 호출. 외부에서 바꾼 상태를 덮어쓰지 않도록 별도 캐시를 두지 않음.
   - `best` 행도 실제 값 비교 후에만 기록.
   - 텍스트는 기존 `text()` 캐시를 유지하므로 구역 안내(`district-name`, `district-left`, `district-goal`) 및 미션/콤보 DOM은 그대로 표시됩니다.

2. **하늘/천체를 스카이 캐시에 통합 (`src/render.ts`)**
   - 해/달/달의 얼굴을 매프레임 `fillRect` 행 단위로 다시 그리던 것을, 이미 40단계로 캐시되는 `skyOf()` 캔버스에 한 번만 그리도록 이동 (`drawOrbs()`).
   - `drawSky()`는 캐시된 스카이 이미지를 `drawImage`하고 구름만 기존처럼 매프레임 그립니다. 장식 제거가 아니라 drawing 횟수의 이동이며, 구역 전환 시 페이드도 이전와 동일하게 양쪽 스카이에 적용됩니다.

3. **프레임 단위 배열 할당 제거 / 파티클·팝업 상한 (`src/render.ts`)**
   - 보이는 옥상 목록 `seen`을 필드로 재사용 (`length = 0`)해 프레임마다 새 배열을 만들지 않습니다.
   - `particles` / `popups`를 `filter()`로 매프레임 새 배열을 만들던 것을 제자리 압축(in-place compaction)으로 변경했습니다.
   - 이벤트 폭증 대비 상한은 고품질 220(기존과 동일), 저품질 80으로 설정했습니다. 오래된 파티클부터 버리는 기존 정책을 유지합니다. 팝업은 수명(0.9초)만 기존대로 적용해 게임 피드백을 줄이지 않습니다.

## 불변 사항
- 물리 STEP, 입력, replay, world, game, 점수/미션 계산, 랭킹·서버·계정 기능, 주간 리더보드 정책은 건드리지 않았습니다.
- 프레임 건너뛰기/임의 30fps 제한/전체 품질 강제 하락/새 의존성·에셋/추가 에이전트는 없습니다.
- `window.patch.quality` 처리와 `qualitychange` 리스너는 변경하지 않았고, 명시된 품질 값을 그대로 존중합니다(저품질 파티클 상한은 이미 존재하던 저품질 분기와 같은 기준).
- 장애물, 코인, 적, 파워업 가시성 코드는 수정하지 않았습니다.

## 검증
- `npm run build` 1회 성공 (`tsc --noEmit && vite build`, 133 modules, warning은 기존 Convex `"use client"` 번들 경고뿐). 전체 테스트 suite는 run하지 않았습니다.
- **실측은 제가 하지 않았습니다.** Codex가 제공한 기준값(CPU 4배 감속 headless Chromium, 5구역 × 100프레임, 워밍 20프레임 제외): high UI 0.138ms / draw 1.191ms, low UI 0.109ms / draw 0.665ms. 같은 scratch 벤치로 전후 비교할 예정이라고 전달받았습니다. 위 변경은 코드 경로 근거에 기반하며, 성능 수치 개선을 주장하지 않습니다.

## 상태
- 커밋/푸시/배포 없이 변경만 freeze했습니다. Codex가 통합·측정·최종 배포를 담당합니다.
