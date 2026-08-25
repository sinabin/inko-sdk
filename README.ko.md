# Inko

[![CI](https://github.com/sinabin/inko-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/sinabin/inko-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/inko-pdf-sdk.svg)](https://www.npmjs.com/package/inko-pdf-sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) · [개발자 문서](https://nexth.co.kr/inko/docs/overview) · [라이브 데모](https://nexth.co.kr/pdfv/)

Inko는 무료 오픈소스 self-hosted PDF 주석 SDK입니다. 호스트 앱이 PDF를
불러오고, 편집 가능한 주석 상태를 반환·복원하며, 여러 검토 상태를 레이어로
겹쳐 보고, 호스트가 선택한 상태에서 편집을 이어갈 수 있게 합니다.

Inko는 [NextH](https://nexth.co.kr/)가 공개합니다. 구현과 기술적 한계를
개발자가 직접 검증할 수 있는 프로젝트를 제공하는 것이 목적입니다.

## 제공 범위

- PDF.js 기반 PDF 렌더링
- 가상화된 전체 페이지를 대상으로 하는 PDF 원문 텍스트 선택·복사와 Unicode 리터럴 검색
- PDF.js 네이티브 주석, 안전한 내부/외부 링크, AcroForm 표시·입력
- 현재 AcroForm 값이 반영된 `ArrayBuffer`를 반환하는 `exportPdf()`
- AcroForm과 지원되는 Inko 그림 유형을 페이지에 굽고 누락·실패를 항목별로
  보고하는 `exportFlattenedPdf()`
- 펜·형광펜·지우개·텍스트·도형·선택·줌·썸네일 도구
- PDF에 내장된 목차를 읽어 보여주는 책갈피 패널 (목차가 있는 문서에서만 노출)
- `canvasData`를 통한 편집 상태 반환과 복원
- `loadUserCanvasOverlay()`를 통한 검토 상태 레이어 표시
- 항목 하나에 `isCurrent: true`를 지정하는 단일 선택 버전 이력
- `Inko.mount()` 기반 브라우저·iframe SDK
- 테마·도구·한국어/영어 UI 설정

뷰어는 PDF.js 공개 `TextLayerBuilder`·`AnnotationLayerBuilder`와 문서 단위
`annotationStorage`를 사용하고, 고해상도 캔버스와 DOM 레이어를 같은 logical
viewport에 맞추며 화면 밖 페이지를 가상화합니다. 상용 PDF 연동에서 요구되는
렌더링·텍스트·양식 상태·수명주기 문제를 검증 가능한 OSS 코드로 구현했습니다.

Inko는 서버 저장소, 인증·권한, 버전 번호, append-only 저장 정책, 백업,
보존, 감사 로그, Git의 diff·merge·branch 기능, 협업 백엔드를 제공하지
않습니다. 이 기능은 호스트 앱이 구현하고 운영합니다.

## PDF.js 내장 주석 편집기 대신 Inko를 쓰는 이유

Inko는 PDF.js **위에** 만들어졌고 공개 `TextLayerBuilder`·`AnnotationLayerBuilder`를
사용합니다. PDF.js에는 자체 `AnnotationEditorLayer`(잉크·형광펜·자유 텍스트·스탬프)도
들어 있습니다. 그것으로 요구사항이 충족된다면 그대로 쓰십시오. 이미 번들에 포함돼
있고, Inko는 이를 대체하려는 프로젝트가 아닙니다.

두 방식은 서로 다른 **저장 문제**를 풉니다.

| | PDF.js `AnnotationEditorLayer` | Inko |
| --- | --- | --- |
| 편집 결과가 저장되는 곳 | PDF 내부 — 네이티브 주석 | 앱이 저장하는 별도 `canvasData` 문자열 |
| 원본 PDF 바이트 | `saveDocument()` 시 재작성 | 변경하지 않음 |
| 동시에 존재 가능한 상태 수 | 1개 — 문서 자신의 주석 집합 | 다수 — 레이어로 겹쳐 개별 토글 |
| 두 검토자의 마크업 비교 | 파일 두 개를 각각 열기 | 한 화면에서 `loadUserCanvasOverlay()` |
| 선택한 과거 상태에서 이어서 편집 | 모델 없음 | `isCurrent` 선택 후 편집 계속 |
| Acrobat·Chrome 뷰어 호환 | 즉시 호환 | `exportFlattenedPdf()` 이후에만 |

핵심 차이는 이것입니다. **PDF.js 편집기는 PDF를 정본(system of record)으로
삼고, Inko는 여러분의 DB를 정본으로 두고 PDF를 변경하지 않는 입력으로
남깁니다.** 검토자 5명이 같은 계약서에 마크업하면 PDF.js는 PDF 5개를 만들고,
Inko는 PDF 1개와 `canvasData` 5행을 만듭니다. 후자는 겹쳐 보고, 시각적으로
비교하고, 원하는 상태에서 편집을 이어갈 수 있습니다.

Inko는 둘 중 하나를 강요하지 않습니다. PDF.js 네이티브 주석과 AcroForm 필드도
함께 렌더링하며, `exportPdf()`는 현재 양식 값이 반영된 `saveDocument()` 바이트를
반환합니다.

**PDF.js 편집기가 맞는 경우** — 주석이 파일과 함께 이동해야 하고, 문서당 주석
집합 하나로 충분하며, Acrobat 호환이 최우선일 때.

**Inko가 맞는 경우** — 검토 상태가 권한·버전 관리와 함께 자체 저장소에 있어야
하고, 여러 검토자의 마크업을 동시에 봐야 하며, 애플리케이션이 선택한 상태에서
편집을 이어가야 할 때.

### Inko가 적합하지 않은 경우

도입 전에 다음 한계를 확인하십시오.

- **전자서명·인증서·마스킹(redaction)은 구현돼 있지 않습니다.** 요구사항이라면
  상용 SDK를 쓰십시오.
- **Inko 그림은 `exportFlattenedPdf()` 호출 전까지 PDF 표준 주석이 아닙니다.**
  이 함수는 그림을 페이지 콘텐츠에 굽고, 되돌릴 수 없습니다.
- **백엔드가 없습니다.** 저장·인증·권한·버전 번호·보존·감사 로그는 직접
  구현해야 합니다.
- **지원 계약이 없습니다.** SLA·LTS·응답 시간 보증이 없으며, 이슈와 PR은
  best-effort로 처리됩니다.

## 설치

```bash
npm install inko-pdf-sdk
```

Inko는 self-hosted 방식입니다. 패키지의 `viewer/` 디렉터리를 웹 서버에서
제공하고, 앱이 접근할 수 있는 URL에 `sdk/inko-sdk.js`를 배치합니다.
same-origin 배포가 가장 단순한 시작점입니다.

```bash
cp -R node_modules/inko-pdf-sdk/viewer public/inko-viewer
cp node_modules/inko-pdf-sdk/sdk/inko-sdk.js public/inko-sdk.js
```

```html
<div id="inko" style="height: 80vh"></div>
<script src="/inko-sdk.js"></script>
<script>
  let savedState = ''

  const viewer = Inko.mount('#inko', {
    src: '/inko-viewer/index.html',
    pdfUrl: '/documents/example.pdf',
    fileName: 'example.pdf',
    initialCanvasData: savedState || undefined,

    onChange(canvasData) {
      // debounce 후 호스트 앱이 선택한 저장소에 보관합니다.
      savedState = canvasData
    },

    onError(error) {
      console.error(error)
    },
  })

  // 별도 바이너리 경로: 네이티브 AcroForm 값을 PDF 바이트에 기록합니다.
  const pdfBytes = await viewer.exportPdf()

  // 전달본: AcroForm + 현재 Inko 그림 전체. canvasData 자체는 포함하지 않습니다.
  const { pdfBytes: deliveryPdf, report } = await viewer.exportFlattenedPdf()
  if (report.hasFailures) throw new Error('일부 주석을 PDF에 반영하지 못했습니다')
</script>
```

`canvasData`·`exportPdf()`·`exportFlattenedPdf()`는 의도적으로 분리된 계약입니다. `canvasData`는
Inko의 Paper.js 그림·검토 상태를 편집 가능한 형태로 보존하고,
`exportPdf()`는 PDF.js `saveDocument()`가 만든 네이티브 AcroForm 포함 PDF
바이트를 반환하며 Inko 그림은 합성하지 않습니다. `exportFlattenedPdf()`는 그
AcroForm 저장본을 기준으로 모든 페이지의 펜·형광펜·텍스트·사각형·원·선을 PDF
콘텐츠에 굽습니다. 결과는 다른 PDF 뷰어에서도 보이지만 다시 편집할 `canvasData`를
포함하지 않으므로 이어서 편집하려면 호스트가 `canvasData`도 계속 저장해야 합니다.
`report.hasFailures`를 반드시 확인하세요. 콘텐츠 재작성은 기존 CMS/PAdES
암호학적 서명을 보존하지 못합니다. Helvetica로 표현 가능한 PointText는 PDF
텍스트로 유지됩니다. 한글 등 그 밖의 Unicode PointText는 OFL Pretendard로
고해상도 투명 이미지에 그려지고 `TEXT_RASTERIZED` 경고로 보고되므로, 이
fallback 텍스트는 선택 가능한 PDF 텍스트가 아닌 시각 콘텐츠입니다.
Pretendard는 실제 fallback이 필요할 때만 지연 로드됩니다.

cross-origin iframe으로 배포하려면 빌드 시 `VITE_ALLOWED_ORIGINS`를
설정하고 호스트 환경에 필요한 CSP·CORS HTTP 헤더를 적용해야 합니다.
API와 배포 상세는 [통합 가이드](docs/integration-guide.md)를 참고하세요.

## 책임 경계

설치·호스팅·연동·origin/CSP 정책·인증·권한·저장·백업·환경 검증·보안
업데이트·업그레이드·롤백·포크 유지보수는 이용자 책임입니다.

NextH는 Inko에 대해 개별 기술지원, SLA, LTS, 응답·수정 기한, 특정
브라우저·iframe 호스트·PDF군·인프라·향후 버전의 호환성을 보증하지 않습니다.
공개 issue와 PR은 best-effort로 검토하며 지원 채널이 아닙니다.

## 소스 빌드

Node.js 22.12 이상과 npm이 필요합니다.

```bash
npm ci
npm test
npm run check
npm run build
```

production 빌드는 `dist/`에 생성됩니다. 빌드 과정의 OSS 경계 검사는 권리
미확인 샘플 PDF, 개발 mock, source map, 검토된 PDF.js·폰트 자산의 변경을
차단합니다.

저장소 루트는 소스 작업공간이 npm에 잘못 게시되지 않도록 의도적으로
`private`으로 표시합니다. `npm run build:pkg`가 `release/`에 공개 allowlist
패키지를 만들며, 검증을 통과한 해당 tarball만 게시합니다.

브라우저 통합 테스트에는 Playwright Chromium이 필요합니다.

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

## 릴리스 검증

GitHub Release에는 npm tarball, CycloneDX SBOM, `SHA256SUMS`가 포함됩니다.
설치 전에 내려받은 파일을 검증하세요.

```bash
sha256sum --check SHA256SUMS
npm audit signatures
```

릴리스 workflow는 같은 tarball에 대해 SLSA build provenance와 CycloneDX SBOM
attestation을 각각 생성합니다. 서명과 저장소 identity는 다음과 같이 검증합니다.

```bash
gh attestation verify inko-pdf-sdk-1.2.0.tgz --repo sinabin/inko-sdk
```

## 문서

- [통합 가이드](docs/integration-guide.md)
- [아키텍처](docs/architecture.md)
- [데이터 흐름](docs/data-flow.md)
- [자산 출처대장](docs/oss/asset-provenance.md)
- [제3자 고지](public/THIRD_PARTY_NOTICES.md)

## 보안 제보

의심되는 취약점을 공개 issue에 게시하지 마세요. 이 저장소의 GitHub 비공개
취약점 제보 기능을 사용하세요. 자세한 내용은
[보안 정책](SECURITY.md)을 참고하세요.

## 라이선스

Inko는 [Apache License 2.0](LICENSE)으로 배포됩니다. 제3자 컴포넌트와
자산에는 각각의 라이선스가 유지됩니다. 자세한 내용은
[THIRD_PARTY_NOTICES.md](public/THIRD_PARTY_NOTICES.md)를 참고하세요.
