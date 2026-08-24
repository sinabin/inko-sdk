<script lang="ts">
  import PdfViewer from './components/PdfViewer.svelte'
  import ErrorToast from './components/ErrorToast.svelte'
  // NextH가 직접 생성한 합성 fixture — 고객·기관 문서를 개발 자산으로 포함하지 않음
  const testPdfUrl = import.meta.env.BASE_URL + 'samples/inko-demo.pdf'

  // 개발 서버의 top-level standalone 화면에서만 테스트 PDF 자동 로드.
  // iframe에서는 localhost여도 호스트 SDK가 전달한 PDF만 로드해야 초기 로드 경쟁이 생기지 않는다.
  const isStandaloneDev =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.self === window.top &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  const initialPdfUrl = isStandaloneDev ? testPdfUrl : ''
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
