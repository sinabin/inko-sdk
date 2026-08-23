<script lang="ts">
  import {onMount, onDestroy, untrack} from 'svelte'
  import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    pdfDocument: PDFDocumentProxy
    pageNumber: number
    isActive: boolean
    onPageClick?: (pageNumber: number) => void
  }

  let {
    pdfDocument,
    pageNumber,
    isActive,
    onPageClick
  }: Props = $props()

  let canvasEl: HTMLCanvasElement | undefined = $state()
  let isLoading = $state(true)
  let error = $state(false)
  let errorDetail = $state('')

  let isMounted = true
  let renderTask: RenderTask | null = null
  const MAX_RETRIES = 2
  const RETRY_DELAY = 500

  async function renderThumbnail(retryCount = 0) {
    if (!canvasEl || !isMounted) return

    // 기존 렌더링 취소 (경합 방지)
    if (renderTask) {
      renderTask.cancel()
      renderTask = null
    }

    try {
      isLoading = true
      error = false
      errorDetail = ''

      const page = await pdfDocument.getPage(pageNumber)
      if (!isMounted || !canvasEl) return

      const scale = 0.25 // 썸네일 스케일 (25%)
      const viewport = page.getViewport({ scale })

      const context = canvasEl.getContext('2d')
      if (!context) {
        throw new Error(t('thumbnail.contextError'))
      }

      // 캔버스 크기 설정 (정수로 반올림, scrollMode와 일관)
      canvasEl.width = Math.floor(viewport.width)
      canvasEl.height = Math.floor(viewport.height)

      // 렌더링 시작 (canvas 명시적 전달 — pdf.js v5+)
      renderTask = page.render({
        canvasContext: context,
        viewport,
        canvas: canvasEl
      } as any)

      await renderTask.promise

      if (isMounted) {
        isLoading = false
      }
    } catch (err: any) {
      if (err?.name === 'RenderingCancelledException') {
        return
      }

      // pdf.js 동시 렌더링 충돌 — 메인 뷰어/프리뷰와 페이지 렌더가 겹칠 때 발생, 조용히 재시도
      const isConcurrentRender = err?.message?.includes('multiple render()')
      if (!isConcurrentRender) {
        console.error(`[Thumbnail] Page ${pageNumber} render failed (attempt ${retryCount + 1}):`, err)
      }

      // 재시도 (최대 MAX_RETRIES회, RETRY_DELAY ms 간격)
      if (retryCount < MAX_RETRIES && isMounted) {
        setTimeout(() => {
          if (isMounted) renderThumbnail(retryCount + 1)
        }, isConcurrentRender ? RETRY_DELAY * 2 : RETRY_DELAY)
      } else if (isMounted) {
        error = true
        errorDetail = err?.message || String(err)
        isLoading = false
      }
    }
  }

  // PDF 문서 및 캔버스 준비 시 렌더링
  // untrack: renderThumbnail 내부의 reactive 읽기/쓰기가 이 effect의 의존성으로 추적되지 않도록 방지
  $effect(() => {
    if (pdfDocument && canvasEl) {
      untrack(() => renderThumbnail())
    }
  })

  onDestroy(() => {
    isMounted = false
    if (renderTask) {
      renderTask.cancel()
    }
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="thumbnail-container"
  class:active={isActive}
  onclick={() => onPageClick?.(pageNumber)}
>
  <div class="thumbnail-content">
    {#if isLoading}
      <div class="thumbnail-loading">
        <div class="loading-text">{t('thumbnail.loading')}</div>
      </div>
    {/if}
    {#if error}
      <div class="thumbnail-error">
        <div class="error-text">{errorDetail || t('thumbnail.error')}</div>
      </div>
    {/if}
    <canvas
      bind:this={canvasEl}
      style="opacity: {isLoading || error ? 0 : 1}"
      class="thumbnail-canvas"
    ></canvas>
  </div>
  <div class="thumbnail-label">{t('thumbnail.pageLabel', { n: pageNumber })}</div>
</div>

<style>
  .thumbnail-container {
    position: relative;
    cursor: pointer;
    padding: var(--space-1_5);
    border-radius: var(--radius-sm);
    width: 156px;
    border: 2px solid transparent;
    background-color: var(--gray-100);
    transition: all var(--motion-base) var(--ease-out);
  }

  .thumbnail-container:hover:not(.active) {
    border-color: var(--color-border-muted);
  }

  .thumbnail-container.active {
    border-color: var(--color-primary-strong);
    background-color: var(--blue-100);
  }

  .thumbnail-content {
    position: relative;
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .thumbnail-loading,
  .thumbnail-error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
  }

  .thumbnail-loading {
    background-color: var(--color-surface-thumbnail);
  }

  .thumbnail-error {
    background-color: var(--color-error-bg);
  }

  .loading-text {
    font-size: var(--font-size-xs);
    color: var(--color-text-subtle);
  }

  .error-text {
    font-size: var(--font-size-xs);
    color: var(--color-error);
    padding: var(--space-1);
    word-break: break-all;
    text-align: center;
  }

  .thumbnail-canvas {
    max-width: 100%;
    height: auto;
    transition: opacity var(--motion-base) var(--ease-out);
  }

  .thumbnail-label {
    text-align: center;
    font-size: var(--font-size-xs);
    margin-top: var(--space-1);
    font-weight: var(--font-weight-medium);
    color: var(--color-text-label);
  }
</style>
