# Inko 성능 회귀 기준

Inko의 성능 목표는 특정 PC에서 한 번 빠르게 보였다는 인상이 아니라, 권리 안전한 고정 120페이지 PDF와 고정된 측정 절차로 성능 회귀를 검출하는 것이다. 이 게이트는 표준 CI Chromium에서 정해진 작업을 통과했다는 근거이며, 모든 기기·브라우저·호스트 앱에서 동일한 절대 성능을 보증하지 않는다.

## 결정적 mixed fixture

`scripts/perf/generate-fixture.mjs`는 현재 시각, 난수, 외부 폰트·외부 파일 없이 `pdf-lib`만으로 `inko-perf-v2`를 만든다. 프로그램으로 생성한 RGB PNG 3종과 텍스트·벡터·투명도를 넣고, 다음 페이지 크기와 회전을 순환한다.

| 항목 | 고정값 |
|---|---|
| 페이지 수 | 120 |
| 바이트 수 | 830850 |
| SHA-256 | `5d0652f7a08ad31b47063c037cc852b4785bba72ac67bf36265cbd7bc2eb1836` |
| 페이지 크기(pt) | `595.28×841.89`, `612×792`, `720×720`, `792×612` |
| 회전 | `0°`, `90°`, `180°`, `270°` |
| 합성 이미지 | 결정적 PNG 3종 |
| 정본 | `tests/perf/fixture-manifest.json` |

생성 결과가 정본의 페이지 수·바이트 수·SHA-256·크기 집합·회전 집합과 하나라도 다르면 검증은 실패한다. 픽스처에는 고객 데이터나 제3자 문서·이미지·폰트가 들어가지 않는다.

```powershell
node scripts/perf/generate-fixture.mjs --verify --output "$env:TEMP\inko-perf-v2-120p.pdf"
npx vitest run tests/unit/performanceFixture.test.ts
```

이 픽스처는 서로 다른 크기·회전·합성 이미지를 포함하지만, 암호화 PDF, 손상 PDF, 초대형 스캔, 특수 폰트, 복잡한 양식 등 모든 실문서 유형을 대표하지는 않는다.

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

300MiB는 `renderCache`가 계산하는 `canvas.width × canvas.height × 4`의 논리 비트맵 합계다. DOM에 복사된 PDF 캔버스, Paper.js 편집 캔버스, 오버레이, pdf.js worker·폰트·문서 구조 메모리, JPEG Blob은 포함하지 않는다. 따라서 이를 탭 전체 메모리 상한으로 해석하면 안 된다.

또한 고해상도 스크롤 렌더 큐 3개와 저해상도 프리뷰 배치 5개는 서로 독립적이다. 뷰어 전체 pdf.js 렌더 작업을 합산해 3개로 제한한다는 의미가 아니다.

## Chromium 120페이지 회귀 게이트

`npm run test:perf`는 production Vite 산출물을 전용 캐시 디렉터리에 빌드하고, SDK iframe에서 mixed fixture를 연다. 전용 디렉터리를 사용하므로 일반 `dist`를 동시에 빌드하는 작업과 성능 서버가 서로 덮어쓰지 않는다.

```powershell
npm run test:perf
```

수동 진단은 다음과 같이 실행한다.

```powershell
node scripts/perf/serve-performance-build.mjs --build --port 5201
# http://127.0.0.1:5201/perf/host.html
```

### 냉간과 웜 교체를 분리하는 순서

1. 호스트 타이머를 SDK 번들 요청 전에 시작해 SDK 로드 시간을 잰다.
2. 새 iframe과 pdf.js worker를 포함한 냉간 로드에서 SDK 준비, viewer 준비, 첫 PDF canvas 페인트, 120개 프리뷰 완료를 각각 잰다.
3. 프리뷰가 정확히 120개 생성·120개 생존한 상태가 연속 animation frame에서 안정됐는지 확인한다.
4. 냉간 계측값과 CDP JS heap을 보존한 뒤 프리뷰 계측 세대만 초기화한다. 살아 있는 URL의 전역 목록은 지우지 않는다.
5. 같은 iframe에서 `loadPdfUrl`을 다시 호출해 웜 문서 교체의 첫 페이지 페인트와 120개 프리뷰 재생성을 잰다. 냉간 URL 120개가 실제 revoke되고 웜 URL 120개만 남아야 한다.
6. 세 차례 fast-scroll pass마다 Long Task 기록을 초기화하고 중간값과 최악값을 모두 판정한다.

프라이밍은 120개 프리뷰 완료 뒤 끝나며, 계측 reset은 그 이후에만 수행된다. 따라서 냉간 프리뷰 생성이 웜 교체 수치에 섞이지 않는다.

### 고정 예산

정본은 `tests/perf/budgets.json`이다.

| 측정치 | 회귀 예산 |
|---|---:|
| SDK 번들 요청 → SDK 준비 | ≤ 2,000ms |
| SDK 번들 요청 → iframe viewer 준비 | ≤ 5,000ms |
| SDK 번들 요청 → 냉간 첫 페이지 실제 canvas 페인트 | ≤ 5,000ms |
| SDK 번들 요청 → 냉간 120개 프리뷰 생성 | ≤ 15,000ms |
| 웜 `loadPdfUrl` → 첫 페이지 실제 canvas 페인트 | ≤ 3,000ms |
| 웜 `loadPdfUrl` → 120개 프리뷰 재생성 | ≤ 12,000ms |
| fast-scroll pass | 3회 × 3.5초 |
| pass별 rAF frame 최소 표본 | ≥ 120개 |
| pass별 실제 시각 샘플 최소 표본 | ≥ 25개 |
| pass별 스크롤 이동 증거 | 상단 오차 ≤ 1px, 하단 도달 오차 ≤ 2px, 표본 페이지 최소값 ≤ 5·최대값 ≥ 115 |
| 3회 FPS 중간값 / 최악값 | ≥ 50 / ≥ 45 |
| frame time p95 중간값 / 최악값 | ≤ 25ms / ≤ 35ms |
| frame time p99 중간값 / 최악값 | ≤ 40ms / ≤ 60ms |
| pass별 Long Task 최대 / 개수 | ≤ 250ms / ≤ 5개 |
| 화면 중앙 시각 샘플의 blank 비율 | ≤ 2% |
| 먼 페이지 실제 canvas 페인트 | ≤ 2,500ms |
| 안정화 후 DOM PDF canvas | ≤ 7개 |
| 실제 PDF canvas 한 변 | ≤ 4096px |
| 살아 있는 프리뷰 Blob URL / 바이트 | ≤ 120개 / ≤ 8MiB |
| DOM canvas 논리 pixel bytes | ≤ 96MiB |
| 냉간 완료 CDP JS heap 증가 | ≤ 64MiB |
| 웜 교체 완료 CDP JS heap 증가 | ≤ 64MiB |
| 3회 스크롤 뒤 CDP JS heap 증가 | ≤ 96MiB |

FPS는 `requestAnimationFrame` 간격으로 직접 계산하며 단순 파생 로그로만 남기지 않는다. 세 pass의 중간값뿐 아니라 가장 낮은 FPS와 가장 높은 p95·p99도 하드 게이트다. 20FPS 수준을 정상으로 통과시키는 완화 기준은 사용하지 않는다.

### fail-closed 계측과 실제 페인트 확인

- Long Task API가 없거나 observer 설치가 실패하면 0건으로 간주하지 않고 테스트를 실패시킨다.
- CDP `Performance.getMetrics`에서 `JSHeapUsedSize`를 얻지 못하면 메모리 통과로 간주하지 않는다.
- rAF frame과 시각 샘플이 최소 개수보다 적으면 좋은 수치처럼 보여도 실패한다.
- 각 pass가 실제 상단에서 하단까지 이동하지 않거나 초기·후반 페이지 표본을 모두 남기지 못하면 실패한다.
- 첫 페이지와 먼 페이지는 canvas 요소 존재가 아니라 픽셀 alpha 표본을 읽어 실제 페인트를 확인한다.
- 저해상도 프리뷰는 `img.complete`, `naturalWidth`, `naturalHeight`로 decode된 이미지를 확인한다.
- 스크롤 중 viewport 표본에 실제로 페인트된 canvas 또는 decode된 preview가 없으면 blank로 계산한다.

### 메모리 측정 경계

브라우저 게이트는 다음 세 층을 함께 기록하고 상한을 둔다.

- CDP의 renderer JS heap 사용량
- 생성·해제 계측으로 얻은 살아 있는 JPEG preview Blob의 정확한 바이트 합계
- 현재 DOM canvas들의 `width × height × 4` 논리 pixel bytes 합계

이 세 수치를 합쳐 탭 전체 물리 메모리라고 부르지 않는다. pdf.js worker heap, GPU surface, 브라우저 native allocation, 디코딩 캐시, DOM 밖의 일시적 canvas는 포함되지 않을 수 있다. 이 영역까지 보증하려면 플랫폼별 프로세스 메모리 계측을 별도로 추가해야 한다.

## 결과와 재현 메타데이터

성공·실패 상세는 콘솔의 `[Inko performance]` JSON과 `test-results/performance/playwright-report.json`의 `inko-performance-120p.json` attachment에 남는다. 결과에는 다음 재현 정보도 포함한다.

- fixture id·SHA-256·바이트 수
- Node 버전, OS, architecture, CPU logical count
- Playwright·Chromium 버전
- user agent, navigator platform, hardware concurrency
- viewport, device pixel ratio
- GitHub Actions runner OS·image·architecture·commit SHA(제공되는 경우)
- SDK·worker·fixture resource timing

## 환경별 보증과 판정

| 환경 | 판정 방식 | 보증 범위 |
|---|---|---|
| 단위 테스트 | 항상 하드 게이트 | LRU, 상한, 취소, DPR, Blob URL 수명, fixture 결정성 |
| 표준 CI Chromium | `ubuntu-latest`, viewport 1280×900, DPR 1, worker 1, retry 0에서 고정 예산 적용 | 해당 runner image와 Chromium의 회귀 |
| 개발자 PC | 같은 하드 예산을 적용하되 환경 메타데이터와 함께 진단 | 현재 PC의 로컬 상태 |
| Android/iOS 실기기 | 기기군별 별도 예산과 반복 측정 필요 | 실제 측정한 기기·WebView 버전만 |

한 번의 브라우저 프로세스 실행 안에서 스크롤은 세 차례 반복해 중간값과 최악값을 판정한다. 이는 독립적인 CI 머신 세 번의 분포와 같지 않다. runner image나 Chromium 버전이 바뀌면 기존 결과와 직접 비교하기 전에 환경 메타데이터를 확인하고, 실제 회귀인지 인프라 변화인지 분리한다.
