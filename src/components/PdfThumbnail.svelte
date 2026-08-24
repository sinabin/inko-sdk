<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    pdfDocument: PDFDocumentProxy
    pageNumber: number
    isActive: boolean
    tabIndex?: number
    onPageClick?: (pageNumber: number) => void
    onKeydown?: (event: KeyboardEvent) => void
  }

  let {
    pdfDocument,
    pageNumber,
    isActive,
    tabIndex = 0,
    onPageClick,
    onKeydown
  }: Props = $props()

  let canvasEl: HTMLCanvasElement | undefined = $state()
  let isLoading = $state(true)
  let error = $state(false)
  let errorDetail = $state('')
  let accessibilityLabel = $derived(
    error
      ? t('thumbnail.pageErrorLabel', { n: pageNumber })
      : isLoading
        ? t('thumbnail.pageLoadingLabel', { n: pageNumber })
        : isActive
          ? t('thumbnail.currentPageLabel', { n: pageNumber })
          : t('thumbnail.pageLabel', { n: pageNumber })
  )

  let isMounted = true
  let renderTask: RenderTask | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let renderGeneration = 0
  const MAX_RETRIES = 2
  const RETRY_DELAY = 500

  function clearRetryTimer(): void {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function cancelActiveRender(): void {
    const task = renderTask
    renderTask = null
    task?.cancel()
  }

  function isCurrentRender(
    generation: number,
    document: PDFDocumentProxy,
    targetPage: number,
    canvas: HTMLCanvasElement
  ): boolean {
    return isMounted &&
      generation === renderGeneration &&
      pdfDocument === document &&
      pageNumber === targetPage &&
      canvasEl === canvas
  }

  function startRender(document: PDFDocumentProxy, targetPage: number, canvas: HTMLCanvasElement): void {
    const generation = ++renderGeneration
    clearRetryTimer()
    cancelActiveRender()
    void renderThumbnail(document, targetPage, canvas, generation)
  }

  async function renderThumbnail(
    document: PDFDocumentProxy,
    targetPage: number,
    canvas: HTMLCanvasElement,
    generation: number,
    retryCount = 0
  ): Promise<void> {
    if (!isCurrentRender(generation, document, targetPage, canvas)) return

    let currentTask: RenderTask | null = null

    try {
      isLoading = true
      error = false
      errorDetail = ''

      const page = await document.getPage(targetPage)
      if (!isCurrentRender(generation, document, targetPage, canvas)) return

      const scale = 0.25 // 썸네일 스케일 (25%)
      const viewport = page.getViewport({ scale })

      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error(t('thumbnail.contextError'))
      }

      // 캔버스 크기 설정 (정수로 반올림, scrollMode와 일관)
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)

      // 렌더링 시작 (canvas 명시적 전달 — pdf.js v5+)
      currentTask = page.render({
        canvasContext: context,
        viewport,
        canvas
      } as any)
      renderTask = currentTask

      await currentTask.promise
      if (renderTask === currentTask) renderTask = null

      if (isCurrentRender(generation, document, targetPage, canvas)) {
        isLoading = false
      }
    } catch (err: any) {
      if (renderTask === currentTask) renderTask = null
      if (!isCurrentRender(generation, document, targetPage, canvas)) return

      if (err?.name === 'RenderingCancelledException') {
        return
      }

      // pdf.js 동시 렌더링 충돌 — 메인 뷰어/프리뷰와 페이지 렌더가 겹칠 때 발생, 조용히 재시도
      const isConcurrentRender = err?.message?.includes('multiple render()')
      if (!isConcurrentRender) {
        console.error(`[Thumbnail] Page ${targetPage} render failed (attempt ${retryCount + 1}):`, err)
      }

      // 재시도 (최대 MAX_RETRIES회, RETRY_DELAY ms 간격)
      if (retryCount < MAX_RETRIES) {
        clearRetryTimer()
        retryTimer = setTimeout(() => {
          retryTimer = null
          if (isCurrentRender(generation, document, targetPage, canvas)) {
            void renderThumbnail(document, targetPage, canvas, generation, retryCount + 1)
          }
        }, isConcurrentRender ? RETRY_DELAY * 2 : RETRY_DELAY)
      } else {
        error = true
        errorDetail = err?.message || String(err)
        isLoading = false
      }
    }
  }

  // PDF 문서 및 캔버스 준비 시 렌더링
  // untrack: renderThumbnail 내부의 reactive 읽기/쓰기가 이 effect의 의존성으로 추적되지 않도록 방지
  $effect(() => {
    const document = pdfDocument
    const targetPage = pageNumber
    const canvas = canvasEl
    if (!document || !canvas) return

    untrack(() => startRender(document, targetPage, canvas))

    return () => {
      renderGeneration++
      clearRetryTimer()
      cancelActiveRender()
    }
  })

  onDestroy(() => {
    isMounted = false
    renderGeneration++
    clearRetryTimer()
    cancelActiveRender()
  })
</script>

<button
  type="button"
  class="thumbnail-container"
  class:active={isActive}
  onclick={() => onPageClick?.(pageNumber)}
  onkeydown={onKeydown}
  aria-label={accessibilityLabel}
  aria-current={isActive ? 'page' : undefined}
  aria-busy={isLoading}
  data-page-number={pageNumber}
  tabindex={tabIndex}
>
  <span class="thumbnail-content" aria-hidden="true">
    {#if isLoading}
      <span class="thumbnail-loading">
        <span class="loading-text">{t('thumbnail.loading')}</span>
      </span>
    {/if}
    {#if error}
      <span class="thumbnail-error">
        <span class="error-text">{errorDetail || t('thumbnail.error')}</span>
      </span>
    {/if}
    <canvas
      bind:this={canvasEl}
      style="opacity: {isLoading || error ? 0 : 1}"
      class="thumbnail-canvas"
      aria-hidden="true"
    ></canvas>
  </span>
  <span class="thumbnail-label" aria-hidden="true">{t('thumbnail.pageLabel', { n: pageNumber })}</span>
</button>

<style>
  .thumbnail-container {
    position: relative;
    display: block;
    cursor: pointer;
    padding: var(--space-1_5);
    border-radius: var(--radius-sm);
    width: 156px;
    border: 2px solid transparent;
    background-color: var(--gray-100);
    color: inherit;
    font: inherit;
    text-align: initial;
    appearance: none;
    transition: all var(--motion-base) var(--ease-out);
  }

  .thumbnail-container:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 2px;
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
    color: var(--color-text-primary);
    font-weight: var(--font-weight-semibold);
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
    display: block;
    text-align: center;
    font-size: var(--font-size-xs);
    margin-top: var(--space-1);
    font-weight: var(--font-weight-medium);
    color: var(--color-text-label);
  }
</style>
