# Inko 통합 가이드

Inko는 정적 뷰어와 브라우저 SDK로 구성됩니다. SDK가 iframe을 만들고
`postMessage`로 PDF와 편집 상태를 전달합니다. 저장소·인증·권한·버전 번호·
append-only 정책·백업·보존은 호스트 앱이 구현하고 운영합니다.

## 설치와 정적 호스팅

```bash
npm install inko-pdf-sdk
```

패키지의 `viewer/` 디렉터리를 웹 서버의 정적 경로에 배치하고, 같은 패키지의
`sdk/inko-sdk.js`를 페이지에서 불러옵니다. 처음에는 같은 origin에 배치하는
구성이 가장 단순합니다.

```html
<div id="inko" style="width:100%;height:80vh"></div>
<script src="/assets/inko/sdk/inko-sdk.js"></script>
<script>
  const viewer = Inko.mount('#inko', {
    src: '/assets/inko/viewer/index.html',
    pdfUrl: '/documents/sample.pdf',
    fileName: 'sample.pdf',
    onSave(canvasData, ok, message) {
      if (!ok) throw new Error(message)
      fetch('/api/pdf-state/sample', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canvasData }),
      })
    },
  })
</script>
```

패키지 자체 예제는 패키지 루트를 정적 서버로 열고 `example/index.html`에
접속하면 실행할 수 있습니다. `file://` URL로 직접 열면 브라우저 보안 정책으로
PDF 로드가 차단될 수 있습니다.

## `Inko.mount(target, options)`

| 옵션 | 타입 | 설명 |
| --- | --- | --- |
| `src` | `string` | 필수. 호스팅한 `viewer/index.html` URL |
| `pdfUrl` | `string` | 초기 PDF URL. `pdfBase64`와 하나만 사용 |
| `pdfBase64` | `string` | 초기 PDF의 Base64 본문 |
| `fileName` | `string` | 표시할 파일명 |
| `readOnly` | `boolean` | 편집 UI와 편집 캔버스를 비활성화 |
| `initialCanvasData` | `string` | 앞서 저장한 편집 상태를 그대로 복원 |
| `width`, `height` | `string` | 생성되는 iframe 크기 |
| `iframeAttributes` | `object` | iframe에 추가할 속성 |
| `theme` | `object` | 색상·로고·CSS 변수 설정 |
| `tools` | `object` | 도구와 툴바 기능 설정 |
| `locale` | `string` | `ko` 또는 `en` |
| `messages` | `object` | UI 문구의 키별 재정의 |
| `onReady` | `function` | SDK와 뷰어 연결 완료 |
| `onPdfLoaded` | `function` | PDF 로드 완료 |
| `onChange` | `function` | 편집 상태가 바뀔 때 `canvasData` 전달 |
| `onSave` | `function` | `save()` 결과 전달 |
| `onClose` | `function` | 뷰어가 닫기를 요청할 때 호출 |
| `onError` | `function` | SDK 오류 전달 |

`canvasData`는 SDK가 외부에 반환하는 불투명 문자열입니다. 내용을 직접 수정하지
말고 받은 값을 그대로 저장하고 복원하세요.

## 인스턴스 API

```javascript
viewer.loadPdfUrl(url, fileName?, canvasData?, readOnly?)
viewer.loadPdfBase64(base64, fileName?, canvasData?, readOnly?)
viewer.loadUserCanvasOverlay(entries)
viewer.save()
viewer.clear()
viewer.applyConfig(config)
viewer.getLastCanvasData()
viewer.destroy()
viewer.isReady()
viewer.iframe
```

`clear()`는 현재 페이지의 편집 상태만 지웁니다. 전체 문서를 초기화하려면 각
페이지에 대해 호스트 UI에서 명시적인 흐름을 제공하거나 새 빈 상태로 문서를
다시 여세요.

## 저장과 이어서 편집

```javascript
const saved = await fetch('/api/pdf-state/review-42').then((response) =>
  response.ok ? response.json() : null,
)

const viewer = Inko.mount('#inko', {
  src: '/assets/inko/viewer/index.html',
  pdfUrl: '/documents/report.pdf',
  initialCanvasData: saved?.canvasData,
  onChange(canvasData) {
    scheduleAutosave(canvasData)
  },
  onSave(canvasData, ok) {
    if (ok) persistState(canvasData)
  },
})
```

Inko는 상태를 반환하고 복원하지만 저장 요청의 인증·권한 확인, 동시 수정 정책,
버전 번호, 보존 기간과 장애 복구는 호스트 앱의 책임입니다.

## 검토본 레이어

저장된 다른 검토본을 읽기 전용 레이어로 겹쳐 표시할 수 있습니다.

```javascript
viewer.loadUserCanvasOverlay([
  {
    canvasId: 'review-17',
    userName: 'Reviewer A',
    canvasData: firstReview.canvasData,
    enabled: true,
  },
  {
    canvasId: 'review-18',
    userName: 'Reviewer B',
    canvasData: secondReview.canvasData,
    enabled: false,
  },
])
```

레이어 목록과 표시 여부는 UI 편의를 위한 값입니다. 사용자 신원과 열람 권한은
신뢰할 수 있는 서버에서 확인하세요.

## 배포 보안

- 운영 환경은 HTTPS를 사용합니다.
- 호스트 CSP의 `frame-src`에 뷰어 origin을 허용합니다.
- 다른 origin에 뷰어를 둘 때는 빌드 시 `VITE_ALLOWED_ORIGINS`에 호스트 origin을
  정확히 등록하고 PDF 서버의 CORS 정책도 설정합니다.
- PDF URL과 Base64 입력 크기 제한을 호스트 API에서도 적용합니다.
- `readOnly`는 UI 설정입니다. 서버 권한 검사를 대신하지 않습니다.
- 비밀값이나 접근 토큰을 URL 또는 `canvasData`에 넣지 않습니다.

## 문제 확인

| 증상 | 확인할 항목 |
| --- | --- |
| iframe이 비어 있음 | `src`가 200을 반환하는지, CSP `frame-src`가 허용하는지 |
| `onReady`가 호출되지 않음 | 호스트와 뷰어 origin, `VITE_ALLOWED_ORIGINS` 설정 |
| PDF가 401/403 | PDF URL의 쿠키·CORS·서버 권한 정책 |
| 자동 저장 호출이 너무 잦음 | `onChange`를 호스트 코드에서 debounce |
| 저장 후 복원이 안 됨 | `onSave`의 문자열을 변형 없이 `initialCanvasData`로 전달했는지 |

구조 설명은 [아키텍처](architecture.md), 메시지 흐름은
[데이터 흐름](data-flow.md)을 참고하세요.
