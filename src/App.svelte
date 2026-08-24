<script lang="ts">
  import PdfViewer from './components/PdfViewer.svelte'
  import ErrorToast from './components/ErrorToast.svelte'
  // NextH가 직접 생성한 합성 fixture — 고객·기관 문서를 개발 자산으로 포함하지 않음
  const testPdfUrl = import.meta.env.BASE_URL + 'samples/inko-demo.pdf'

  // 개발 서버 또는 명시적 E2E production fixture의 top-level 화면에서만 테스트 PDF 자동 로드.
  // 공개/운영 build는 VITE_STANDALONE_DEMO를 주입하지 않아 기본적으로 빈 viewer를 유지한다.
  // iframe에서는 localhost여도 호스트 SDK가 전달한 PDF만 로드해야 초기 로드 경쟁이 생기지 않는다.
  const isStandaloneFixture =
    (import.meta.env.DEV || import.meta.env.VITE_STANDALONE_DEMO === 'true') &&
    typeof window !== 'undefined' &&
    window.self === window.top &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  const initialPdfUrl = isStandaloneFixture ? testPdfUrl : ''
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
