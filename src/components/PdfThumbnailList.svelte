<script lang="ts">
  import { tick, untrack } from 'svelte'
  import type { PDFDocumentProxy } from 'pdfjs-dist'
  import PdfThumbnail from './PdfThumbnail.svelte'
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    pdfDocument: PDFDocumentProxy | null
    currentPage: number
    fileName?: string
    onPageChange?: (page: number) => void
  }

  let {
    pdfDocument,
    currentPage,
    fileName,
    onPageChange
  }: Props = $props()

  let renderedPages = $state<number[]>([])
  let queue = $state<number[]>([])
  let isProcessing = $state(false)
  let totalPages = $state(0)
  let activeThumbnailEl: HTMLElement | null = null

  // 활성 썸네일 요소 추적용 Svelte action
  function activeRef(node: HTMLElement, isActive: boolean) {
    if (isActive) activeThumbnailEl = node
    return {
      update(newActive: boolean) {
        if (newActive) activeThumbnailEl = node
      }
    }
  }

  let queueLength = $derived(queue.length)

  // PDF 문서가 변경되면 큐 초기화 및 썸네일 생성 시작
  $effect(() => {
    if (!pdfDocument) {
      renderedPages = []
      queue = []
      isProcessing = false
      totalPages = 0
      return
    }

    totalPages = pdfDocument.numPages
    const pageQueue: number[] = []

    // 전체 페이지를 큐에 추가
    for (let i = 1; i <= pdfDocument.numPages; i++) {
      pageQueue.push(i)
    }

    queue = pageQueue
    renderedPages = []
    isProcessing = false

    // untrack으로 processQueue 내부의 $state 읽기가 이 effect의 의존성으로 추적되지 않도록 함
    // (processQueue가 isProcessing, queue를 읽고 쓰면서 무한 루프 방지)
    untrack(() => processQueue())
  })

  // 큐에서 순차적으로 썸네일 생성
  function processQueue() {
    if (isProcessing) return
    if (queue.length === 0) return

    isProcessing = true

    const nextPage = queue[0]
    queue = queue.slice(1)

    if (nextPage) {
      renderedPages = [...renderedPages, nextPage]

      // 다음 썸네일 생성 (약간의 딜레이를 주어 UI가 부드럽게 업데이트되도록)
      setTimeout(() => {
        isProcessing = false
        processQueue()
      }, 100)
    }
  }

  // 현재 페이지 썸네일로 스크롤
  $effect(() => {
    // currentPage 변경 시 반응성 트리거
    const _page = currentPage
    tick().then(() => {
      if (activeThumbnailEl) {
        activeThumbnailEl.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        })
      }
    })
  })

  function handlePageClick(pageNumber: number) {
    onPageChange?.(pageNumber)
  }
</script>

<div class="thumbnail-sidebar">
  {#if !pdfDocument}
    <div class="no-pdf">
      <div class="no-pdf-text">{t('thumbnails.noPdf')}</div>
    </div>
  {:else}
    <div class="thumbnail-list-container">
      {#if fileName}
        <div class="file-name-display">
          {fileName}
        </div>
      {/if}
      <div class="thumbnail-list">
        {#each renderedPages as pageNum (pageNum)}
          <div use:activeRef={pageNum === currentPage}>
            <PdfThumbnail
              pdfDocument={pdfDocument}
              pageNumber={pageNum}
              isActive={pageNum === currentPage}
              onPageClick={handlePageClick}
            />
          </div>
        {/each}
        {#if queueLength > 0}
          <div class="loading-info">
            {t('thumbnails.loadingList', { n: renderedPages.length, total: totalPages })}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .thumbnail-sidebar {
    width: 180px;
    min-width: 180px;
    flex-shrink: 0;
    /* 컨테이너 자체는 완전 투명 — 썸네일 카드만 떠 있는 형태.
       blur·border·shadow 제거해 위계는 카드가 단독으로 형성 */
    background-color: transparent;
    border-right: none;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .no-pdf {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .no-pdf-text {
    font-size: var(--font-size-base);
    color: var(--color-text-secondary);
  }

  .thumbnail-list-container {
    padding: var(--space-4) var(--space-2);
  }

  .file-name-display {
    /* 버튼이 아닌 라벨이라 색 입히지 않음 — border·gloss로만 분리 표현 */
    background-color: transparent;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-4);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
    color: var(--color-text-strong);
    word-break: break-all;
    text-align: left;
    box-shadow: var(--glass-gloss-top);
  }

  .thumbnail-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }

  .loading-info {
    text-align: center;
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
    padding: var(--space-2) 0;
  }

  /* 스크롤바 스타일 */
  .thumbnail-sidebar::-webkit-scrollbar {
    width: 8px;
  }

  .thumbnail-sidebar::-webkit-scrollbar-track {
    background: var(--color-border-muted);
  }

  .thumbnail-sidebar::-webkit-scrollbar-thumb {
    background: var(--color-border-divider);
    border-radius: var(--radius-sm);
  }

  .thumbnail-sidebar::-webkit-scrollbar-thumb:hover {
    background: var(--color-text-subtle);
  }
</style>
