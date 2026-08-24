<script lang="ts">
  import type { PdfAccessiblePageTextState } from '../lib/accessibility/pdfAccessibleTextIndex'
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    pageNumber: number
    state: PdfAccessiblePageTextState
    /** 렌더된 PDF.js textLayer에 실제 읽을 텍스트가 있을 때 중복 노출 방지 */
    nativeTextAvailable?: boolean
  }

  let {
    pageNumber,
    state,
    nativeTextAvailable = false
  }: Props = $props()
</script>

<div
  class="accessible-page-text"
  role="document"
  aria-label={t('document.pageText', { n: pageNumber })}
  aria-hidden={nativeTextAvailable}
  data-accessible-page-text={pageNumber}
  data-status={state.status}
>
  {#if state.status === 'ready'}
    <p>{state.text}</p>
  {:else if state.status === 'image-only'}
    <p>{t('document.accessibleTextImageOnly', { n: pageNumber })}</p>
  {:else if state.status === 'error'}
    <p>{t('document.accessibleTextError', { n: pageNumber })}</p>
  {:else}
    <p>{t('document.accessibleTextLoading', { n: pageNumber })}</p>
  {/if}
</div>

<style>
  /* 화면 레이아웃에는 관여하지 않되 스크린리더의 문서 읽기 순서에는 남긴다. */
  .accessible-page-text {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
    white-space: pre-wrap;
    border: 0;
  }

  .accessible-page-text p {
    margin: 0;
  }
</style>
