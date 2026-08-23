<script lang="ts">
  import PdfViewer from './components/PdfViewer.svelte'
  import ErrorToast from './components/ErrorToast.svelte'
  // NextH가 직접 생성한 합성 fixture — 고객·기관 문서를 개발 자산으로 포함하지 않음
  const testPdfUrl = import.meta.env.BASE_URL + 'samples/inko-demo.pdf'

  // dev 서버(localhost)에서만 테스트 PDF 자동 로드
  // 배포 환경의 PDF 로드는 iframe 호스트가 postMessage SDK로 전달
  // 호스트명 기반 런타임 체크 — 환경변수(NODE_ENV) 설정과 무관하게 동작
  const isDevServer =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  const initialPdfUrl = isDevServer ? testPdfUrl : ''
</script>

<PdfViewer initialPdfUrl={initialPdfUrl} />
<ErrorToast />

<style>
  :global(html, body, #app) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  :global(*) {
    box-sizing: border-box;
  }
</style>
