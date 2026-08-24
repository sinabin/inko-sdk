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
</script>
```

`canvasData`와 `exportPdf()`는 의도적으로 분리된 계약입니다. `canvasData`는
Inko의 Paper.js 그림·검토 상태를 편집 가능한 형태로 보존하고,
`exportPdf()`는 PDF.js `saveDocument()`가 만든 네이티브 AcroForm 포함 PDF
바이트를 반환합니다. Inko 그림을 PDF에 flatten하거나 합성하지 않습니다.

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

GitHub build attestation은 다음과 같이 검증할 수 있습니다.

```bash
gh attestation verify inko-pdf-sdk-1.1.0.tgz --repo sinabin/inko-sdk
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
