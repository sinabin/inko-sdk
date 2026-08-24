# Inko 성능 회귀 기준

Inko의 성능 목표는 “특정 PC에서 빠르게 보였다”가 아니라, 고정된 120페이지 PDF와 같은 측정 순서를 사용해 회귀를 검출하는 것이다. 이 기준은 배포 환경 전체의 절대 성능을 보증하지 않으며, 정해진 환경의 빌드 간 변화를 찾는 회귀 게이트다.

## 고정 fixture

`scripts/perf/generate-fixture.mjs`는 현재 시각, 난수, 외부 폰트·이미지 없이 612×792pt Letter 크기 120페이지 PDF를 생성한다. 모든 페이지는 같은 수의 Helvetica 텍스트, 선, 사각형을 포함한다. 이 크기는 뷰어의 초기 placeholder와 같아 120개 DOM 페이지의 레이아웃이 백그라운드 치수 조회 중 이동하지 않는다.

- fixture: `inko-perf-v1`
- 페이지 수: `120`
- 바이트 수: `453771`
- SHA-256: `920473dc9560669607b913ba6cac91ab351d861fb80044d0ee313518b195acee`
- 정본: `tests/perf/fixture-manifest.json`

생성기가 달라진 바이트를 만들거나 120페이지로 다시 파싱되지 않으면 검증은 실패한다.

```powershell
node scripts/perf/generate-fixture.mjs --verify --output "$env:TEMP\inko-perf-v1-120p.pdf"
npx vitest run tests/unit/performanceFixture.test.ts
```

## 결정적 단위 계약

아래 계약은 실행 PC 속도와 관계없이 pass/fail이 같아야 한다.

| 영역 | 계약 |
|---|---|
| 렌더 캐시 | 페이지·스케일 조합 최대 100개, 논리 RGBA 최대 300MiB, 단일 초과 항목 거부, `get`으로 접근한 항목은 최신 LRU로 승격 |
| 고해상도 렌더 큐 | 동시 `render()` 최대 3개, 1500px/s 초과에서 대기 큐 정지, 150ms idle 후 재개, 대기·진행 작업 취소 |
| DPR | 기기 DPR 최대 2.5, 실제 PDF backing canvas의 가로·세로 각각 최대 4096px. CSS 크기 자체가 4096px을 넘으면 DPR 1 미만 허용 |
| 저해상도 프리뷰 | 동시 생성 최대 5개, `clearPreviews()`로 캐시 URL 전부 revoke, 정리 후 완료된 이전 세대 Blob URL은 즉시 revoke하고 재진입 차단 |

```powershell
npx vitest run tests/unit/renderCache.performance.test.ts tests/unit/scrollMode.performance.test.ts tests/unit/lowResPreview.performance.test.ts
```

300MiB는 `renderCache`가 계산하는 `canvas.width × canvas.height × 4`의 논리 비트맵 합계다. DOM에 복사된 PDF 캔버스, Paper.js 편집 캔버스, 오버레이, pdf.js worker/폰트/구조 메모리, JPEG Blob은 포함하지 않는다. 따라서 “탭 전체가 300MiB 이하”라고 해석하면 안 된다.

또한 Phase 1에서 고해상도 스크롤 렌더 큐 3개와 저해상도 프리뷰 배치 5개는 서로 독립적이다. 뷰어 전체 pdf.js 렌더를 합산 3개로 제한한다는 의미가 아니다. 통합 스케줄러는 별도 구조 변경이 필요하다.

## Chromium 120p 회귀 게이트

`playwright.perf.config.ts`는 production 빌드를 독립 로컬 서버에 올리고, SDK iframe으로 고정 fixture를 연다. `npm run test:perf`로 실행하며 공개 CI와 태그 릴리스 workflow의 필수 회귀 게이트로 연결되어 있다.

현재 브라우저 계측은 동일 120p fixture의 비계측 priming load로 호스트 page-count 반응 상태를 먼저 확립하고, 두 번째 공개 `loadPdfUrl`부터 시간·메모리를 측정한다. 따라서 이 결과는 **120p 문서 교체 경로**의 회귀 보증이며, 새 iframe의 cold first-load 지연 보증이 아니다. cold-load는 `PdfScrollViewer` mount 시점의 `totalPages` 동기화 후 별도 게이트로 추가해야 한다.

```powershell
npm run test:perf
```

수동으로 하네스를 열 때는 다음 명령을 쓴다.

```powershell
node scripts/perf/serve-performance-build.mjs --build --port 5201
# http://127.0.0.1:5201/perf/host.html
```

브라우저 게이트는 `tests/perf/budgets.json`을 읽고 다음을 같이 기록한다.

| 측정치 | 회귀 예산 |
|---|---:|
| 계측 `loadPdfUrl` → 첫 페이지 실제 렌더/`pdfLoaded` | ≤ 12,000ms |
| 계측 `loadPdfUrl` → 120개 JPEG 프리뷰 생성 | ≤ 45,000ms |
| 3.5초 fast-scroll rAF frame time p95 / p99 | ≤ 50ms / 100ms |
| fast-scroll FPS | 기록(파생 측정), 별도 절대 gate 없음 |
| fast-scroll Long Task 최대 / 개수 | ≤ 500ms / 20개 |
| 중앙 샘플의 PDF canvas/preview 미표시 비율 | ≤ 5% |
| 첫 페이지 복귀 후 120페이지 점프 렌더 | ≤ 5,000ms |
| 안정화 후 DOM PDF canvas | ≤ 7개 |
| 실제 PDF canvas 한 변 | ≤ 4096px |
| 살아 있는 프리뷰 Blob URL | ≤ 120개 |
| 2회 왕복 + GC 후 CDP JS heap 증가 | ≤ 64MiB |

성공·실패 상세와 FPS, frame p95/p99, Long Task, JS heap, DOM canvas, Blob URL 개수는 콘솔의 `[Inko performance]` JSON과 `test-results/performance/playwright-report.json`의 `inko-performance-120p.json` attachment에 남는다.

## 환경별 보증과 회귀 판정

| 환경 | 판정 방식 | 보증 범위 |
|---|---|---|
| 단위 테스트 | 항상 하드 게이트 | LRU, 상한, 취소, DPR, Blob URL 수명 논리 |
| 표준 CI Chromium | 동일 OS image·Chromium 버전·viewport 1280×900·DPR 1·worker 1·병렬 부하 없음을 고정했을 때만 예산을 회귀 게이트로 사용 | 그 러너의 상대적 빌드 간 회귀 |
| 개발자 PC | 진단용. 하드웨어·전원 모드·백그라운드 부하를 결과와 함께 기록 | 현재 PC의 로컬 상태 |
| Android/iOS 실기기 | 기기 군별 별도 예산·반복 측정 필요 | 측정한 기기/웹뷰 버전만 |

브라우저 타이밍은 노이즈가 있으므로 현재 공개 CI는 비계측 priming load 뒤 단일 계측을 넉넉한 상한으로 판정한다. 더 촘촘한 성능 비교가 필요하면 같은 러너에서 3회 반복한 중간값을 별도 추세 지표로 사용해야 하며, 현재 게이트를 특정 이용자 환경의 절대 성능 보증으로 해석하면 안 된다.
