<script module lang="ts">
  import { PermissionFlag } from 'pdfjs-dist'

  /** PDF.js 권한 배열이 명시적으로 일반 복사를 허용하지 않을 때만 차단 */
  export function shouldEnforcePdfCopyPermission(permissions: readonly number[] | null): boolean {
    return Array.isArray(permissions) && !permissions.includes(PermissionFlag.COPY)
  }
</script>

<script lang="ts">
  import type { PDFDocumentProxy } from 'pdfjs-dist'
  import type { ToolMode, UserCanvasInfo } from '../types'
  import { createScrollMode, type ScrollMode } from '../lib/scroll/scrollMode.svelte'
  import { createHistoryManager, type HistoryManager } from '../lib/history'
  import { createPdfLinkService, type PdfLinkService } from '../lib/pdf/pdfLinkService'
  import type { PdfSearchMatch, PdfSearchState } from '../lib/pdf/pdfSearch.svelte'
  import { createPageDimensionStore } from '../lib/pdf/pageDimensionStore.svelte'
  import {
    createPageLayerCoordinator,
    type PageDomLayersReady
  } from '../lib/viewer/pageLayerCoordinator.svelte'
  import {
    createPdfAccessibleTextIndex,
    type PdfAccessiblePageTextState
  } from '../lib/accessibility/pdfAccessibleTextIndex'
  import type {
    PaperAnnotationKind,
    PaperCanvasAccessibilityState
  } from '../lib/accessibility/paperCanvasKeyboard'
  import { t } from '../lib/i18n/index.svelte'
  import PdfPageDomLayers from './PdfPageDomLayers.svelte'
  import PdfAccessiblePageText from './PdfAccessiblePageText.svelte'
  import { onMount, onDestroy, tick, untrack } from 'svelte'

  interface Props {
    pdfDoc: PDFDocumentProxy | null
    totalPages: number
    viewportScale: number
    currentTool: ToolMode
    brushColor: string
    brushWidth: number
    pressureSensitivity?: number
    fontSize?: number
    isReadOnly: boolean
    userCanvasData?: UserCanvasInfo[]
    /** 현재 편집 캔버스에 로드되어 검토본 중복 렌더에서 제외할 항목 */
    currentEditCanvasId?: string
    /** 버전 이력 모드에서는 과거 시점 미리보기 중 현재 편집 레이어를 숨김 */
    isVersionHistoryMode?: boolean
    searchState?: PdfSearchState | null
    onPageChange?: (page: number) => void
    onCanvasChange?: (pageNum: number, json: string) => void
    onTextInputRequest?: (existingText?: string) => void
    onReady?: (scrollContainer: HTMLElement) => void
    onSelectionChange?: (hasSelection: boolean) => void
    onUndoStateChange?: (canUndo: boolean, canRedo: boolean) => void
    getPreview?: (pageNum: number) => string | undefined
    hasPreview?: (pageNum: number) => boolean
  }

  let {
    pdfDoc,
    totalPages,
    viewportScale,
    currentTool,
    brushColor,
    brushWidth,
    pressureSensitivity = 50,
    fontSize = 16,
    isReadOnly,
    userCanvasData = [],
    currentEditCanvasId = '',
    isVersionHistoryMode = false,
    searchState = null,
    onPageChange,
    onCanvasChange,
    onTextInputRequest,
    onReady,
    onSelectionChange,
    onUndoStateChange,
    getPreview,
    hasPreview
  }: Props = $props()

  let scrollContainer: HTMLElement | null = $state(null)
  const pageContainers = new Map<number, HTMLElement>()
  let scrollMode: ScrollMode | null = $state(null)
  let linkServiceController: ReturnType<typeof createPdfLinkService> | null = null
  let pdfLinkService: PdfLinkService | null = $state(null)
  let historyManager: HistoryManager | null = null
  let currentPage = $state(1)
  let programmaticPage: number | null = null
  let programmaticPageTimer: ReturnType<typeof setTimeout> | null = null
  let canUndoState = $state(false)
  let canRedoState = $state(false)
  // 권한 조회가 끝나기 전에는 복사를 fail-closed로 유지
  let enforceTextPermissions = $state(true)
  let permissionGeneration = 0
  let accessiblePageTextStates = $state<PdfAccessiblePageTextState[]>([])
  let nativeTextAvailableByPage = $state<Record<number, boolean>>({})
  const paperCanvasElements = new Map<number, HTMLCanvasElement>()
  let canvasAccessibilityByPage = $state<Record<number, PaperCanvasAccessibilityState>>({})
  let canvasAccessibilityAnnouncement = $state('')

  const accessibleTextIndex = createPdfAccessibleTextIndex({
    concurrency: 2,
    onReset: (states) => {
      accessiblePageTextStates = states.slice()
    },
    onPageStateChange: (state) => {
      accessiblePageTextStates[state.pageNumber - 1] = state
    }
  })

  const pageDimensions = createPageDimensionStore({
    onPageError: (pageNumber, error) => {
      console.error(`Failed to get dimensions for page ${pageNumber}:`, error)
    }
  })

  const pageLayers = createPageLayerCoordinator({
    getIsReadOnly: () => isReadOnly,
    getViewportScale: () => viewportScale,
    getCurrentTool: () => currentTool,
    getBrushSettings: () => ({
      color: brushColor,
      width: brushWidth,
      pressureSensitivity,
      fontSize
    }),
    getPageDimensions: (pageNumber) => pageDimensions.get(pageNumber),
    setPageDimensions: (pageNumber, dimensions) => {
      pageDimensions.set(pageNumber, dimensions)
    },
    getScrollContainer: () => scrollContainer,
    getHistoryManager: () => historyManager,
    getReviewEntries: () => userCanvasData,
    getCurrentEditCanvasId: () => currentEditCanvasId,
    onCanvasChange: (pageNumber, pageJson) => onCanvasChange?.(pageNumber, pageJson),
    onTextInputRequest: (existingText) => onTextInputRequest?.(existingText),
    onSelectionChange: (hasSelection) => onSelectionChange?.(hasSelection),
    onCanvasAccessibilityChange: handleCanvasAccessibilityChange,
    onUndoStateChange: (canUndo, canRedo) => {
      canUndoState = canUndo
      canRedoState = canRedo
      onUndoStateChange?.(canUndo, canRedo)
    },
    onError: (pageNumber, operation, error) => {
      console.error(`[PdfScrollViewer] ${operation} failed on page ${pageNumber}:`, error)
    }
  })

  let pageBaseDimensions = $derived(pageDimensions.dimensions)
  let renderedPages = $derived(pageLayers.renderedPages)
  let pageDomLayerMetadata = $derived(pageLayers.pageDomLayerMetadata)
  let isSelectMode = $derived(currentTool === 'select')
  let isTextMode = $derived(currentTool === 'text')
  let isNativeInteraction = $derived(isReadOnly || currentTool === 'contentSelect')
  let isEditingActive = $derived(!isNativeInteraction)
  let isPreviewingHistory = $derived(
    isVersionHistoryMode && userCanvasData.some((data) =>
      data.enabled && data.canvasId !== currentEditCanvasId
    )
  )
  let pageNumbers = $derived(Array.from({ length: totalPages }, (_, index) => index + 1))

  $effect(() => {
    const document = pdfDoc
    untrack(() => {
      nativeTextAvailableByPage = {}
      void accessibleTextIndex.setDocument(document)
    })
  })

  $effect(() => {
    const scale = viewportScale
    untrack(() => {
      pageLayers.setZoom(scale)
      scrollMode?.handleScaleChange(scale)
    })
  })

  $effect(() => {
    const page = currentPage
    untrack(() => {
      historyManager?.setActivePage(page)
      pageLayers.updateUndoRedoState(page)
    })
  })

  $effect(() => {
    const tool = currentTool
    untrack(() => pageLayers.setDrawingMode(tool))
  })

  $effect(() => {
    const settings = {
      color: brushColor,
      width: brushWidth,
      pressureSensitivity,
      fontSize
    }
    untrack(() => pageLayers.setBrushSettings(settings))
  })

  $effect(() => {
    const entries = userCanvasData
    const currentId = currentEditCanvasId
    void currentId
    untrack(() => {
      void entries
      pageLayers.updateReviewOverlays()
    })
  })

  $effect(() => {
    const state = searchState
    if (state) {
      void state.currentIndex
      void state.query
      void state.status
    }
    untrack(() => pageLayers.setSearchState(state))
  })

  $effect(() => {
    const pageCount = totalPages
    const mode = scrollMode
    if (!mode) return
    untrack(() => {
      mode.updateTotalPages(pageCount)
      if (pageCount > 0) void tick().then(() => mode.triggerInitialRender())
    })
  })

  /** 가상화 범위 밖 페이지를 요청하고 실제 렌더 상태까지 대기 */
  export async function ensurePageRendered(pageNumber: number): Promise<void> {
    if (pageNumber < 1 || pageNumber > totalPages || pageLayers.renderedPages.has(pageNumber)) return
    scrollToPage(pageNumber, 'auto')
    scrollMode?.requestRender(pageNumber)
    if (!pageLayers.renderedPages.has(pageNumber)) {
      await pageLayers.waitUntilPageRendered(pageNumber)
    }
    await tick()
  }

  function pageContainerAction(node: HTMLElement, pageNumber: number) {
    pageContainers.set(pageNumber, node)
    scrollMode?.registerPage(pageNumber, node)
    return { destroy: () => {
      if (pageContainers.get(pageNumber) === node) pageContainers.delete(pageNumber)
      scrollMode?.unregisterPage(pageNumber)
    } }
  }

  /** 이름 있는 scroll region을 키보드 탐색 순서에 포함한다. */
  function focusableRegion(node: HTMLElement) {
    node.tabIndex = 0
    return { destroy: () => node.removeAttribute('tabindex') }
  }

  function pdfCanvasAction(node: HTMLCanvasElement, pageNumber: number) {
    return pageLayers.pdfCanvasAction(node, pageNumber)
  }

  function paperCanvasAction(node: HTMLCanvasElement, pageNumber: number) {
    paperCanvasElements.set(pageNumber, node)
    node.tabIndex = 0
    node.setAttribute('role', 'img')
    const handleFocus = () => {
      const state = canvasAccessibilityByPage[pageNumber]
      if (state) canvasAccessibilityAnnouncement = formatCanvasAccessibilityAnnouncement(state)
    }
    node.addEventListener('focus', handleFocus)
    const layerAction = pageLayers.paperCanvasAction(node, pageNumber)
    return { destroy: () => {
      node.removeEventListener('focus', handleFocus)
      node.removeAttribute('tabindex')
      node.removeAttribute('role')
      if (paperCanvasElements.get(pageNumber) === node) paperCanvasElements.delete(pageNumber)
      layerAction.destroy()
    } }
  }

  function overlayContainerAction(node: HTMLElement, pageNumber: number) {
    return pageLayers.overlayContainerAction(node, pageNumber)
  }

  function handleDomLayersReady(result: PageDomLayersReady): void {
    nativeTextAvailableByPage[result.pageNumber] = Boolean(result.textLayer?.textContent?.trim())
    pageLayers.handleDomLayersReady(result)
  }

  function handlePageUnrendered(pageNumber: number): void {
    pageLayers.handlePageUnrendered(pageNumber)
    delete nativeTextAvailableByPage[pageNumber]
    delete canvasAccessibilityByPage[pageNumber]
  }

  function annotationKindLabel(kind: PaperAnnotationKind | null): string {
    return t(`document.annotationKind.${kind ?? 'annotation'}`)
  }

  function formatCanvasAccessibilityAnnouncement(state: PaperCanvasAccessibilityState): string {
    if (state.selectedIndex !== null) {
      let kind = annotationKindLabel(state.selectedKind)
      if (state.selectedText) kind += ` “${state.selectedText}”`
      return t('document.canvasSelectionAnnouncement', {
        n: state.pageNumber,
        kind,
        index: state.selectedIndex,
        total: state.annotationCount,
        x: state.selectedX ?? 0,
        y: state.selectedY ?? 0
      })
    }
    return t('document.canvasCountAnnouncement', {
      n: state.pageNumber,
      count: state.annotationCount
    })
  }

  function handleCanvasAccessibilityChange(
    pageNumber: number,
    state: PaperCanvasAccessibilityState
  ): void {
    canvasAccessibilityByPage[pageNumber] = state
    const canvas = paperCanvasElements.get(pageNumber)
    if (canvas && document.activeElement === canvas) {
      canvasAccessibilityAnnouncement = formatCanvasAccessibilityAnnouncement(state)
    }
  }

  function canvasKeyboardInstructions(tool: ToolMode): string {
    switch (tool) {
      case 'select': return t('document.canvasInstructionsSelect')
      case 'text': return t('document.canvasInstructionsText')
      case 'rectangle':
      case 'circle':
      case 'line': return t('document.canvasInstructionsShape')
      case 'pen':
      case 'highlighter': return t('document.canvasInstructionsPath')
      case 'eraser': return t('document.canvasInstructionsEraser')
      default: return t('document.canvasInstructionsDefault')
    }
  }

  function handleDomLayersError(pageNumber: number, error: unknown): void {
    delete nativeTextAvailableByPage[pageNumber]
    console.error(`[PdfScrollViewer] PDF DOM layers failed on page ${pageNumber}:`, error)
  }

  export function getCanvasData(pageNumber: number): string | null {
    return pageLayers.getCanvasData(pageNumber)
  }

  export function getAllCanvasData(): Map<number, string> {
    return pageLayers.getAllCanvasData()
  }

  export function setCanvasData(pageNumber: number, json: string): void {
    pageLayers.setCanvasData(pageNumber, json)
  }

  export function clearCanvas(pageNumber: number = currentPage): void {
    pageLayers.clearCanvas(pageNumber)
  }

  export function waitUntilFirstPageReady(): Promise<void> {
    return pageLayers.waitUntilFirstPageReady()
  }

  export function loadHistoryCanvasData(pageDataRecord: Record<string, string>): void {
    pageLayers.replaceCanvasData(pageDataRecord)
  }

  export function addTextToCurrentPage(text: string, x: number, y: number): void {
    pageLayers.getManager(currentPage)?.addText(text, x, y)
  }

  export function confirmTextOnCurrentPage(text: string): void {
    pageLayers.getManager(currentPage)?.confirmText(text)
  }

  export function cancelTextOnCurrentPage(): void {
    pageLayers.getManager(currentPage)?.cancelText()
  }

  export function deleteSelected(): void {
    pageLayers.getManager(currentPage)?.deleteSelected()
  }

  export function getCurrentPage(): number {
    return currentPage
  }

  export function undo(): boolean {
    const result = pageLayers.getManager(currentPage)?.undo() ?? false
    pageLayers.updateUndoRedoState(currentPage)
    return result
  }

  export function redo(): boolean {
    const result = pageLayers.getManager(currentPage)?.redo() ?? false
    pageLayers.updateUndoRedoState(currentPage)
    return result
  }

  export function getCanUndo(): boolean {
    return canUndoState
  }

  export function getCanRedo(): boolean {
    return canRedoState
  }

  export function scrollToPage(
    pageNumber: number,
    behavior: ScrollBehavior = 'smooth'
  ): void {
    if (pageNumber < 1 || pageNumber > totalPages) return
    programmaticPage = pageNumber
    if (programmaticPageTimer) clearTimeout(programmaticPageTimer)
    programmaticPageTimer = setTimeout(() => {
      programmaticPage = null
      programmaticPageTimer = null
    }, 750)
    currentPage = pageNumber
    onPageChange?.(pageNumber)

    const pageContainer = pageContainers.get(pageNumber)
    if (!pageContainer || !scrollContainer) return
    const containerRect = scrollContainer.getBoundingClientRect()
    const pageRect = pageContainer.getBoundingClientRect()
    const scrollTop = scrollContainer.scrollTop + pageRect.top - containerRect.top - 16
    scrollContainer.scrollTo({ top: scrollTop, behavior })
  }

  /** 모든 페이지에 상시 존재하는 의미 컨테이너로 키보드 포커스를 이동 */
  export function focusPage(pageNumber: number, options: FocusOptions = {}): boolean {
    if (pageNumber < 1 || pageNumber > totalPages) return false
    const pageContainer = pageContainers.get(pageNumber)
    if (!pageContainer) return false
    pageContainer.focus({ preventScroll: true, ...options })
    return document.activeElement === pageContainer
  }

  /** 가상화 페이지와 TextLayer를 준비한 뒤 선택된 검색 표시의 정확한 위치로 이동 */
  export async function scrollToSearchMatch(
    match: PdfSearchMatch,
    behavior: ScrollBehavior = 'auto'
  ): Promise<boolean> {
    if (match.pageNumber < 1 || match.pageNumber > totalPages) return false
    const isCurrentMatch = () => {
      const current = searchState?.currentMatch
      return searchState?.status === 'ready' && !!current &&
        current.pageNumber === match.pageNumber &&
        current.offset === match.offset &&
        current.length === match.length
    }
    if (!isCurrentMatch()) return false
    await ensurePageRendered(match.pageNumber)
    if (!isCurrentMatch()) return false
    const didScrollToHighlight = await pageLayers.scrollToSearchMatch(match, behavior)
    if (!didScrollToHighlight && isCurrentMatch()) scrollToPage(match.pageNumber, behavior)
    return didScrollToHighlight
  }

  export function getScrollContainer(): HTMLElement | null {
    return scrollContainer
  }

  onMount(async () => {
    if (!scrollContainer || !pdfDoc) return
    onReady?.(scrollContainer)

    const permissionDocument = pdfDoc
    const currentPermissionGeneration = ++permissionGeneration
    void (async () => {
      try {
        if (typeof permissionDocument.getPermissions !== 'function') {
          if (currentPermissionGeneration === permissionGeneration) enforceTextPermissions = false
          return
        }
        const permissions = await permissionDocument.getPermissions()
        if (
          currentPermissionGeneration === permissionGeneration &&
          permissionDocument === pdfDoc
        ) {
          enforceTextPermissions = shouldEnforcePdfCopyPermission(permissions)
        }
      } catch (error) {
        if (currentPermissionGeneration === permissionGeneration) {
          enforceTextPermissions = true
          console.warn('[PdfScrollViewer] PDF copy permission lookup failed:', error)
        }
      }
    })()

    if (!isReadOnly) {
      historyManager = createHistoryManager({
        maxHistorySize: 20,
        debounceMs: 300,
        onHistoryChange: () => pageLayers.updateUndoRedoState(currentPage)
      })
    }

    await pageDimensions.loadDocument(pdfDoc, totalPages)
    if (pageDimensions.isDisposed || !scrollContainer || !pdfDoc) return

    scrollMode = createScrollMode({
      getPdfDoc: () => pdfDoc,
      getTotalPages: () => totalPages,
      getViewportScale: () => viewportScale,
      onPageRendered: pageLayers.handlePageRendered,
      onPageUnrendered: handlePageUnrendered,
      onCurrentPageChange: (pageNumber) => {
        if (programmaticPage !== null && pageNumber !== programmaticPage) return
        currentPage = pageNumber
        onPageChange?.(pageNumber)
      }
    })
    scrollMode.initialize(scrollContainer)

    linkServiceController = createPdfLinkService({
      getCurrentPage: () => currentPage,
      setCurrentPage: (pageNumber) => {
        currentPage = pageNumber
        onPageChange?.(pageNumber)
      },
      ensurePageVisible: ensurePageRendered,
      scrollPageIntoView: ({ pageNumber }) => {
        scrollToPage(pageNumber, 'auto')
        focusPage(pageNumber)
      },
      onNavigationError: (error) => {
        console.error('[PdfScrollViewer] PDF link navigation failed:', error)
      }
    })
    linkServiceController.setDocument(pdfDoc, window.location.href)
    pdfLinkService = linkServiceController.service

    await tick()
    pageContainers.forEach((element, pageNumber) => {
      scrollMode?.registerPage(pageNumber, element)
    })
    scrollMode.triggerInitialRender()
  })

  $effect(() => {
    if (!scrollMode) return
    document.documentElement.classList.toggle('fast-scrolling', scrollMode.isScrollingFast)
  })

  onDestroy(() => {
    permissionGeneration++
    scrollMode?.dispose()
    scrollMode = null
    linkServiceController?.dispose()
    linkServiceController = null
    pdfLinkService = null
    accessibleTextIndex.dispose()
    accessiblePageTextStates = []
    nativeTextAvailableByPage = {}
    paperCanvasElements.clear()
    canvasAccessibilityByPage = {}
    canvasAccessibilityAnnouncement = ''
    pageLayers.dispose()
    pageDimensions.dispose()
    historyManager?.dispose()
    historyManager = null
    if (programmaticPageTimer) clearTimeout(programmaticPageTimer)
    programmaticPageTimer = null
    programmaticPage = null
    document.documentElement.classList.remove('fast-scrolling')
  })
</script>

<div
  class="scroll-viewer"
  class:editing-active={isEditingActive}
  class:select-mode={isSelectMode}
  class:text-mode={isTextMode}
  class:native-interaction={isNativeInteraction}
  class:previewing-history={isPreviewingHistory}
  bind:this={scrollContainer}
  role="region"
  aria-label={t('document.viewerRegion')}
  use:focusableRegion
>
  <div class="current-page-announcement" role="status" aria-live="polite" aria-atomic="true">
    {t('document.currentPageAnnouncement', { n: currentPage, total: totalPages })}
  </div>
  <div class="canvas-accessibility-announcement" role="status" aria-live="polite" aria-atomic="true">
    {canvasAccessibilityAnnouncement}
  </div>
  <div class="scroll-content">
    {#each pageNumbers as pageNum (pageNum)}
      {@const baseDims = pageBaseDimensions.get(pageNum)}
      {@const isRendered = renderedPages.has(pageNum)}
      {@const domMetadata = pageDomLayerMetadata.get(pageNum)}
      {@const accessibleTextState = accessiblePageTextStates[pageNum - 1] ?? {
        pageNumber: pageNum,
        status: 'pending' as const,
        text: ''
      }}
      {@const nativeTextAvailable = nativeTextAvailableByPage[pageNum] === true}
      {@const canvasAccessibility = canvasAccessibilityByPage[pageNum]}
      {@const visualW = baseDims ? Math.floor(baseDims.width * viewportScale) : Math.floor(612 * viewportScale)}
      {@const visualH = baseDims ? Math.floor(baseDims.height * viewportScale) : Math.floor(792 * viewportScale)}

      <div
        class="scroll-page-container"
        data-page={pageNum}
        role="region"
        aria-label={t('document.pageRegion', { n: pageNum })}
        aria-current={pageNum === currentPage ? 'page' : undefined}
        aria-busy={!nativeTextAvailable && ['pending', 'loading'].includes(accessibleTextState.status)}
        tabindex="-1"
        style:width={`${visualW}px`}
        style:height={`${visualH}px`}
        use:pageContainerAction={pageNum}
      >
        <PdfAccessiblePageText
          pageNumber={pageNum}
          state={accessibleTextState}
          {nativeTextAvailable}
        />

        {#if isRendered}
          <!-- PDF Canvas (base layer) -->
          <canvas
            class="scroll-page-canvas-pdf"
            use:pdfCanvasAction={pageNum}
          ></canvas>

          {#if pdfLinkService && domMetadata}
            <PdfPageDomLayers
              pdfDocument={pdfDoc!}
              pdfPage={domMetadata.pdfPage}
              viewport={domMetadata.viewport}
              linkService={pdfLinkService}
              readOnly={isReadOnly}
              enableTextPermissions={enforceTextPermissions}
              annotationCanvasMap={domMetadata.annotationCanvasMap}
              onReady={handleDomLayersReady}
              onError={(error) => handleDomLayersError(pageNum, error)}
            />
          {/if}

          <!-- User Overlay Container -->
          <div
            class="scroll-page-overlay-container"
            use:overlayContainerAction={pageNum}
          ></div>

          <!-- Paper.js Canvas (editing layer) -->
          {#if !isReadOnly}
            <p class="paper-canvas-instructions" id={`paper-canvas-instructions-${pageNum}`}>
              {canvasKeyboardInstructions(currentTool)}
            </p>
            <canvas
              class="scroll-page-canvas-paper"
              aria-label={t('document.editableCanvas', { n: pageNum })}
              aria-describedby={`paper-canvas-instructions-${pageNum}`}
              data-annotation-count={canvasAccessibility?.annotationCount ?? 0}
              data-selected-annotation={canvasAccessibility?.selectedIndex ?? undefined}
              use:paperCanvasAction={pageNum}
            ></canvas>
          {/if}
        {:else if hasPreview?.(pageNum)}
          <!-- 저해상도 프리뷰 (렌더링 전 표시) -->
          <img
            src={getPreview?.(pageNum)}
            class="page-preview"
            style:width={`${visualW}px`}
            style:height={`${visualH}px`}
            alt=""
          />
          <div class="preview-indicator">로딩 중...</div>
        {:else}
          <!-- 프리뷰도 없는 경우 (기존 placeholder) -->
          <div class="page-placeholder">
            <span class="page-number">{pageNum}</span>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .scroll-viewer {
    width: 100%;
    height: 100%;
    overflow: auto;
    background-color: var(--color-surface-page-bg);
    transform: translateZ(0);
    will-change: scroll-position;
  }

  .scroll-viewer:focus-visible,
  .scroll-page-container:focus-visible,
  .scroll-page-canvas-paper:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: -3px;
  }

  .current-page-announcement,
  .canvas-accessibility-announcement,
  .paper-canvas-instructions {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  /* 비편집 모드 (readOnly): 네이티브 스크롤만 */
  .scroll-viewer:not(.editing-active) {
    touch-action: pan-y pan-x !important;
    -webkit-overflow-scrolling: touch !important;
  }

  /* 선택 모드: 캔버스 이벤트 받으면서 스크롤도 허용 */
  .scroll-viewer.editing-active.select-mode {
    touch-action: pan-y pan-x !important;
    -webkit-overflow-scrolling: touch !important;
  }

  /* 드로잉 모드 (pen, eraser, shapes, text): Paper.js가 터치 처리 */
  .scroll-viewer.editing-active:not(.select-mode) {
    touch-action: none !important;
  }

  .scroll-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    min-height: 100%;
  }

  .scroll-page-container {
    position: relative;
    background-color: var(--color-surface);
    box-shadow: var(--shadow-page);
    contain: layout style paint;
    flex-shrink: 0;
    margin: 0 auto;
  }

  .scroll-page-canvas-pdf {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: var(--z-pdf);
  }

  /* PDF.js DOM 레이어는 readOnly 또는 명시적 내용 선택 모드에서만 상호작용한다. */
  .scroll-viewer:not(.native-interaction) :global(.inko-text-layer) {
    pointer-events: none !important;
    user-select: none;
  }

  .scroll-viewer.native-interaction :global(.inko-text-layer) {
    pointer-events: auto;
    user-select: text;
    cursor: text;
  }

  .scroll-page-overlay-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: var(--z-overlay);
    pointer-events: none;
  }

  /* 과거 버전 미리보기 중에는 편집 레이어(현재 버전)를 숨겨, 체크한 이력만 보이게 한다 */
  .scroll-viewer.previewing-history .scroll-page-canvas-paper {
    display: none;
  }

  .scroll-page-canvas-paper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: var(--z-paper);
  }

  /* 비편집 모드 (readOnly): 캔버스가 이벤트를 통과시켜 스크롤 허용 */
  .scroll-viewer:not(.editing-active) .scroll-page-canvas-paper {
    pointer-events: none !important;
  }

  /* 편집 모드 (select, pen, eraser, shapes, text): 캔버스가 이벤트를 캡처 */
  .scroll-viewer.editing-active .scroll-page-canvas-paper {
    pointer-events: auto !important;
  }

  /* 텍스트 모드: I-beam 커서 */
  .scroll-viewer.editing-active.text-mode .scroll-page-canvas-paper {
    cursor: text !important;
  }

  .page-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--gray-150);
  }

  .page-number {
    font-size: var(--font-size-2xl);
    color: var(--color-text-secondary);
  }

  /* 저해상도 프리뷰 이미지 */
  .page-preview {
    position: absolute;
    top: 0;
    left: 0;
    object-fit: contain;
    image-rendering: auto;
    z-index: 0;
  }

  /* 로딩 중 인디케이터 */
  .preview-indicator {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    background: rgba(0, 0, 0, 0.72);
    color: var(--color-text-inverse);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    z-index: 1;
  }
</style>
