import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'
import { tick } from 'svelte'
import type { ToolMode, UserCanvasInfo } from '../../types'
import { extractPageCanvasData, type CanvasDataRecord } from '../canvas/canvasDataCodec'
import { createDocumentCanvasStore } from '../canvas/documentCanvasStore'
import {
  createPageCanvasManager,
  type PageCanvasManager,
  type PageCanvasManagerOptions
} from '../canvas/pageCanvasManager.svelte'
import { createPageCanvasRegistry } from '../canvas/pageCanvasRegistry'
import { createUserOverlay, type UserOverlay } from '../canvas/userOverlay.svelte'
import { createUserOverlayRegistry } from '../canvas/userOverlayRegistry'
import type { HistoryManager } from '../history'
import type { PaperCanvasAccessibilityState } from '../accessibility/paperCanvasKeyboard'
import type { PageDimensions } from '../pdf/pageDimensionStore.svelte'
import type { PdfSearchMatch, PdfSearchState } from '../pdf/pdfSearch.svelte'
import type { PdfRenderedCanvas } from '../scroll/scrollMode.svelte'

/** 렌더된 페이지의 PDF.js DOM 레이어 입력 */
export interface PageDomLayerMetadata {
  pdfPage: PDFPageProxy
  viewport: PageViewport
  annotationCanvasMap: Map<string, HTMLCanvasElement>
}

/** PdfPageDomLayers의 완료 이벤트 중 coordinator가 사용하는 최소 계약 */
export interface PageDomLayersReady {
  pageNumber: number
  textLayer: HTMLDivElement | null
}

export interface PageLayerBrushSettings {
  color: string
  width: number
  pressureSensitivity: number
  fontSize: number
}

export interface PageLayerCoordinatorOptions {
  getIsReadOnly: () => boolean
  getViewportScale: () => number
  getCurrentTool: () => ToolMode
  getBrushSettings: () => PageLayerBrushSettings
  getPageDimensions: (pageNumber: number) => PageDimensions | null
  setPageDimensions: (pageNumber: number, dimensions: PageDimensions) => void
  getScrollContainer: () => HTMLElement | null
  getHistoryManager: () => HistoryManager | null
  getReviewEntries: () => readonly UserCanvasInfo[]
  getCurrentEditCanvasId: () => string
  onCanvasChange?: (pageNumber: number, pageJson: string) => void
  onTextInputRequest?: (existingText?: string) => void
  onSelectionChange?: (hasSelection: boolean) => void
  onCanvasAccessibilityChange?: (pageNumber: number, state: PaperCanvasAccessibilityState) => void
  onUndoStateChange?: (canUndo: boolean, canRedo: boolean) => void
  onError?: (pageNumber: number, operation: string, error: unknown) => void
  createCanvasManager?: (options: PageCanvasManagerOptions) => PageCanvasManager
  createOverlay?: () => UserOverlay
  afterDomUpdate?: () => Promise<void>
}

interface SearchTextNode {
  node: Text
  start: number
  end: number
}

/** PDF.js TextLayer에 추가한 검색 표시를 원래 텍스트 DOM으로 복원 */
export function clearPageSearchHighlights(layer: HTMLDivElement): void {
  layer.querySelectorAll<HTMLElement>('[data-inko-search-highlight]').forEach((highlight) => {
    const parent = highlight.parentNode
    highlight.replaceWith(document.createTextNode(highlight.textContent ?? ''))
    parent?.normalize()
  })
}

/** TextLayer 텍스트 노드의 문서 내 UTF-16 위치 수집 */
function collectSearchTextNodes(layer: HTMLDivElement): { text: string; nodes: SearchTextNode[] } {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  const nodes: SearchTextNode[] = []
  let text = ''
  let node = walker.nextNode() as Text | null
  while (node) {
    const start = text.length
    text += node.data
    nodes.push({ node, start, end: start + node.data.length })
    node = walker.nextNode() as Text | null
  }
  return { text, nodes }
}

/** 현재 검색 상태를 한 페이지 TextLayer에 반영 */
export function applyPageSearchHighlights(
  layer: HTMLDivElement,
  pageNumber: number,
  state: PdfSearchState | null
): void {
  clearPageSearchHighlights(layer)

  const normalizedQuery = state?.query.normalize('NFC') ?? ''
  if (!state || state.status !== 'ready' || normalizedQuery.length === 0) return

  const { text, nodes } = collectSearchTextNodes(layer)
  const haystack = state.caseSensitive ? text.normalize('NFC') : text.normalize('NFC').toLowerCase()
  const needle = state.caseSensitive ? normalizedQuery : normalizedQuery.toLowerCase()
  if (!needle) return

  const selectedPageOrdinal = state.currentIndex < 0
    ? -1
    : state.matches
        .slice(0, state.currentIndex + 1)
        .filter((match) => match.pageNumber === pageNumber).length - 1

  const ranges: Array<{ start: number; end: number; selected: boolean }> = []
  let from = 0
  let ordinal = 0
  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from)
    if (start < 0) break
    ranges.push({ start, end: start + needle.length, selected: ordinal === selectedPageOrdinal })
    ordinal++
    from = start + needle.length
  }

  for (let rangeIndex = ranges.length - 1; rangeIndex >= 0; rangeIndex--) {
    const range = ranges[rangeIndex]!
    for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
      const entry = nodes[nodeIndex]!
      const start = Math.max(range.start, entry.start)
      const end = Math.min(range.end, entry.end)
      if (start >= end) continue

      const localStart = start - entry.start
      const localEnd = end - entry.start
      if (localEnd < entry.node.length) entry.node.splitText(localEnd)
      const selectedText = localStart > 0 ? entry.node.splitText(localStart) : entry.node
      const highlight = document.createElement('span')
      highlight.className = range.selected ? 'highlight selected' : 'highlight'
      highlight.dataset.inkoSearchHighlight = ''
      selectedText.parentNode?.insertBefore(highlight, selectedText)
      highlight.append(selectedText)
    }
  }
}

/** 페이지별 PDF/Paper/검토본 DOM과 편집 상태 수명주기 조정 */
export function createPageLayerCoordinator(options: PageLayerCoordinatorOptions) {
  const managerFactory = options.createCanvasManager ?? createPageCanvasManager
  const overlayFactory = options.createOverlay ?? createUserOverlay
  const afterDomUpdate = options.afterDomUpdate ?? tick
  const canvasStore = createDocumentCanvasStore({
    onLiveError: (pageNumber, operation, error) => options.onError?.(pageNumber, operation, error)
  })
  const canvasRegistry = createPageCanvasRegistry<PageCanvasManager>({
    store: canvasStore,
    onLifecycleError: (pageNumber, operation, error) => options.onError?.(pageNumber, operation, error)
  })
  const overlayRegistry = createUserOverlayRegistry<UserOverlay>({
    onDisposeError: (pageNumber, error) => options.onError?.(pageNumber, 'overlay-dispose', error)
  })

  const pdfCanvases = new Map<number, HTMLCanvasElement>()
  const paperCanvasElements = new Map<number, HTMLCanvasElement>()
  const overlayContainers = new Map<number, HTMLElement>()
  const textLayerElements = new Map<number, HTMLDivElement>()
  const pageRenderWaiters = new Map<number, Set<() => void>>()
  const textLayerWaiters = new Map<number, Set<(layer: HTMLDivElement | null) => void>>()
  const pagePresentationGenerations = new Map<number, number>()
  let renderedPages = $state<Set<number>>(new Set())
  let pageDomLayerMetadata = $state<Map<number, PageDomLayerMetadata>>(new Map())
  let searchState: PdfSearchState | null = null
  let authoritativeMutationDepth = 0
  let disposed = false

  let firstPageSettled = false
  let resolveFirstPageReady!: (result: { ok: true } | { ok: false; error: Error }) => void
  const firstPageReadyPromise = new Promise<{ ok: true } | { ok: false; error: Error }>((resolve) => {
    resolveFirstPageReady = resolve
  })

  function report(pageNumber: number, operation: string, error: unknown): void {
    try {
      options.onError?.(pageNumber, operation, error)
    } catch {
      // 관측 실패가 페이지 정리 경로를 중단하지 않도록 격리
    }
  }

  function markFirstPageReady(): void {
    if (firstPageSettled) return
    firstPageSettled = true
    resolveFirstPageReady({ ok: true })
  }

  function markFirstPageFailed(error: unknown): void {
    if (firstPageSettled) return
    firstPageSettled = true
    resolveFirstPageReady({
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    })
  }

  function advancePageGeneration(pageNumber: number): number {
    const generation = (pagePresentationGenerations.get(pageNumber) ?? 0) + 1
    pagePresentationGenerations.set(pageNumber, generation)
    return generation
  }

  function isCurrentPresentation(pageNumber: number, generation: number): boolean {
    return !disposed && renderedPages.has(pageNumber) &&
      pagePresentationGenerations.get(pageNumber) === generation
  }

  function notifyCanvasChange(pageNumber: number, manager: PageCanvasManager): void {
    if (!canvasStore.commitLiveSnapshot(pageNumber, manager) || authoritativeMutationDepth > 0) return
    const pageJson = canvasStore.getCommittedSnapshot(pageNumber)
    if (pageJson !== null) options.onCanvasChange?.(pageNumber, pageJson)
    updateUndoRedoState(pageNumber)
  }

  function configureManager(manager: PageCanvasManager): void {
    const brush = options.getBrushSettings()
    manager.setDrawingMode(options.getCurrentTool())
    manager.setBrushColor(brush.color)
    manager.setBrushWidth(brush.width)
    manager.setBrushPressureSensitivity(brush.pressureSensitivity)
    manager.setFontSize(brush.fontSize)
  }

  function initializePaperCanvas(pageNumber: number): PageCanvasManager | null {
    if (options.getIsReadOnly() || disposed) return null
    const canvasElement = paperCanvasElements.get(pageNumber)
    if (!canvasElement) return null

    canvasRegistry.unregister(pageNumber)
    const dimensions = options.getPageDimensions(pageNumber)
    const scale = options.getViewportScale()
    const baseWidth = dimensions?.width ?? (canvasElement.clientWidth / scale || 612)
    const baseHeight = dimensions?.height ?? (canvasElement.clientHeight / scale || 792)
    let manager!: PageCanvasManager
    manager = managerFactory({
      historyManager: options.getHistoryManager() ?? undefined,
      pageNum: pageNumber,
      isReadOnly: options.getIsReadOnly(),
      onSelectionChange: options.onSelectionChange,
      onAccessibilityChange: (state) => options.onCanvasAccessibilityChange?.(pageNumber, state),
      getScrollContainer: options.getScrollContainer,
      onCanvasChange: () => notifyCanvasChange(pageNumber, manager),
      onTextInputRequest: options.onTextInputRequest
    })

    manager.init(canvasElement, baseWidth, baseHeight, scale)
    configureManager(manager)
    const hadSavedData = canvasStore.get(pageNumber) !== null
    try {
      canvasRegistry.register(pageNumber, manager)
    } catch (error) {
      report(pageNumber, 'canvas-restore', error)
      if (pageNumber === 1) markFirstPageFailed(error)
      return null
    }

    if (hadSavedData) manager.paperCanvas?.render()
    return manager
  }

  function updateReviewOverlayForPage(pageNumber: number): void {
    const overlay = overlayRegistry.get(pageNumber)
    if (!overlay) return
    const pageKey = String(pageNumber)
    const currentEditCanvasId = options.getCurrentEditCanvasId()

    options.getReviewEntries().forEach((entry) => {
      if (!entry.enabled || entry.canvasId === currentEditCanvasId) return
      const pageCanvasData = extractPageCanvasData(entry.canvasData, pageKey)
      if (pageCanvasData) overlay.setUserData({ ...entry, canvasData: pageCanvasData })
    })
  }

  function initializeUserOverlay(pageNumber: number): UserOverlay | null {
    if (disposed) return null
    const container = overlayContainers.get(pageNumber)
    if (!container) return null

    overlayRegistry.unregister(pageNumber)
    const overlay = overlayFactory()
    overlay.setContainer(container)
    overlay.setDisplayScale(options.getViewportScale())
    const dimensions = options.getPageDimensions(pageNumber)
    if (dimensions) {
      overlay.updateCanvasSize(Math.floor(dimensions.width), Math.floor(dimensions.height))
    }
    overlayRegistry.register(pageNumber, overlay)
    updateReviewOverlayForPage(pageNumber)
    return overlay
  }

  /** 오프스크린 PDF 렌더 결과를 페이지 DOM과 편집 레이어에 연결 */
  function handlePageRendered(pageNumber: number, canvas: HTMLCanvasElement): void {
    if (disposed) return
    const generation = advancePageGeneration(pageNumber)
    const renderedCanvas = canvas as PdfRenderedCanvas
    const scale = options.getViewportScale()
    const renderDpr = renderedCanvas.__renderDpr || 1
    if (canvas.width > 0 && canvas.height > 0 && scale > 0) {
      options.setPageDimensions(pageNumber, {
        width: canvas.width / (scale * renderDpr),
        height: canvas.height / (scale * renderDpr)
      })
    }

    renderedPages = new Set([...renderedPages, pageNumber])
    if (renderedCanvas.__pdfPage && renderedCanvas.__logicalViewport) {
      pageDomLayerMetadata = new Map(pageDomLayerMetadata)
      pageDomLayerMetadata.set(pageNumber, {
        pdfPage: renderedCanvas.__pdfPage,
        viewport: renderedCanvas.__logicalViewport,
        annotationCanvasMap: renderedCanvas.__annotationCanvasMap ?? new Map()
      })
    }

    pageRenderWaiters.get(pageNumber)?.forEach((resolve) => resolve())
    pageRenderWaiters.delete(pageNumber)

    const dimensions = options.getPageDimensions(pageNumber)
    const overlay = overlayRegistry.get(pageNumber)
    if (overlay && dimensions) {
      overlay.updateCanvasSize(Math.floor(dimensions.width), Math.floor(dimensions.height))
      overlay.setDisplayScale(scale)
      overlay.clearAll()
      updateReviewOverlayForPage(pageNumber)
    }

    void afterDomUpdate().then(() => {
      if (!isCurrentPresentation(pageNumber, generation)) return
      const pdfCanvas = pdfCanvases.get(pageNumber)
      if (!pdfCanvas) throw new Error(`PDF canvas missing for page ${pageNumber}`)
      pdfCanvas.width = canvas.width
      pdfCanvas.height = canvas.height
      const context = pdfCanvas.getContext('2d')
      if (!context) throw new Error(`PDF canvas context missing for page ${pageNumber}`)
      context.drawImage(canvas, 0, 0)
      if (pageNumber === 1) markFirstPageReady()
    }).catch((error) => {
      report(pageNumber, 'page-present', error)
      if (pageNumber === 1) markFirstPageFailed(error)
    })
  }

  /** 페이지 이탈 시 최신 스냅샷을 먼저 보존하고 Paper/overlay 자원 해제 */
  function handlePageUnrendered(pageNumber: number): void {
    if (disposed) return
    advancePageGeneration(pageNumber)
    canvasRegistry.unregister(pageNumber)
    overlayRegistry.unregister(pageNumber)
    const nextRenderedPages = new Set(renderedPages)
    nextRenderedPages.delete(pageNumber)
    renderedPages = nextRenderedPages
    textLayerElements.delete(pageNumber)
    textLayerWaiters.get(pageNumber)?.forEach((resolve) => resolve(null))
    textLayerWaiters.delete(pageNumber)
    pageDomLayerMetadata = new Map(pageDomLayerMetadata)
    pageDomLayerMetadata.delete(pageNumber)
  }

  function handleDomLayersReady(result: PageDomLayersReady): void {
    if (disposed) return
    if (result.textLayer) textLayerElements.set(result.pageNumber, result.textLayer)
    else textLayerElements.delete(result.pageNumber)
    const layer = textLayerElements.get(result.pageNumber)
    if (layer) applyPageSearchHighlights(layer, result.pageNumber, searchState)
    textLayerWaiters.get(result.pageNumber)?.forEach((resolve) => resolve(layer ?? null))
    textLayerWaiters.delete(result.pageNumber)
  }

  function setSearchState(state: PdfSearchState | null): void {
    if (disposed) return
    searchState = state
    textLayerElements.forEach((layer, pageNumber) => {
      applyPageSearchHighlights(layer, pageNumber, state)
    })
  }

  function isCurrentSearchMatch(match: PdfSearchMatch): boolean {
    const current = searchState?.currentMatch
    return searchState?.status === 'ready' && !!current &&
      current.pageNumber === match.pageNumber &&
      current.offset === match.offset &&
      current.length === match.length
  }

  function waitUntilTextLayerReady(pageNumber: number): Promise<HTMLDivElement | null> {
    if (disposed) return Promise.resolve(null)
    const existing = textLayerElements.get(pageNumber)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve) => {
      const waiters = textLayerWaiters.get(pageNumber) ?? new Set()
      waiters.add(resolve)
      textLayerWaiters.set(pageNumber, waiters)
    })
  }

  /** 가상화 렌더 완료 뒤 현재 선택된 검색 표시를 스크롤 영역의 상단 1/3에 배치 */
  async function scrollToSearchMatch(
    match: PdfSearchMatch,
    behavior: ScrollBehavior = 'auto'
  ): Promise<boolean> {
    if (disposed || !isCurrentSearchMatch(match)) return false
    const layer = await waitUntilTextLayerReady(match.pageNumber)
    if (!layer || disposed || !isCurrentSearchMatch(match)) return false

    if (!layer.querySelector('.highlight.selected')) {
      applyPageSearchHighlights(layer, match.pageNumber, searchState)
    }
    await afterDomUpdate()
    if (disposed || !isCurrentSearchMatch(match)) return false

    const highlight = layer.querySelector<HTMLElement>('.highlight.selected')
    const container = options.getScrollContainer()
    if (!highlight || !container) return false

    const containerRect = container.getBoundingClientRect()
    const highlightRect = highlight.getBoundingClientRect()
    const preferredOffset = Math.max(16, (container.clientHeight - highlightRect.height) / 3)
    const top = Math.max(
      0,
      container.scrollTop + highlightRect.top - containerRect.top - preferredOffset
    )
    container.scrollTo({ top, behavior })
    return true
  }

  function setZoom(scale: number): void {
    if (disposed) return
    canvasRegistry.getAll().forEach((manager) => manager.setZoom(scale))
    overlayRegistry.getAll().forEach((overlay) => overlay.setDisplayScale(scale))
  }

  function setDrawingMode(tool: ToolMode): void {
    if (disposed) return
    canvasRegistry.getAll().forEach((manager) => manager.setDrawingMode(tool))
  }

  function setBrushSettings(settings: PageLayerBrushSettings): void {
    if (disposed) return
    canvasRegistry.getAll().forEach((manager) => {
      manager.setBrushColor(settings.color)
      manager.setBrushWidth(settings.width)
      manager.setBrushPressureSensitivity(settings.pressureSensitivity)
      manager.setFontSize(settings.fontSize)
    })
  }

  function updateReviewOverlays(): void {
    if (disposed) return
    overlayRegistry.getAll().forEach((overlay, pageNumber) => {
      overlay.clearAll()
      updateReviewOverlayForPage(pageNumber)
    })
  }

  function waitUntilPageRendered(pageNumber: number): Promise<void> {
    if (disposed || renderedPages.has(pageNumber)) return Promise.resolve()
    return new Promise((resolve) => {
      const waiters = pageRenderWaiters.get(pageNumber) ?? new Set<() => void>()
      waiters.add(resolve)
      pageRenderWaiters.set(pageNumber, waiters)
    })
  }

  async function waitUntilFirstPageReady(): Promise<void> {
    const result = await firstPageReadyPromise
    if (!result.ok) throw result.error
  }

  function replaceCanvasData(record: CanvasDataRecord): void {
    authoritativeMutationDepth++
    try {
      canvasStore.replace(record)
    } finally {
      authoritativeMutationDepth--
    }
  }

  function updateUndoRedoState(pageNumber: number): void {
    const manager = canvasRegistry.get(pageNumber)
    options.onUndoStateChange?.(manager?.canUndo ?? false, manager?.canRedo ?? false)
  }

  function getManager(pageNumber: number): PageCanvasManager | null {
    return canvasRegistry.get(pageNumber)
  }

  function pdfCanvasAction(node: HTMLCanvasElement, pageNumber: number) {
    pdfCanvases.set(pageNumber, node)
    return { destroy: () => {
      if (pdfCanvases.get(pageNumber) === node) pdfCanvases.delete(pageNumber)
    } }
  }

  function paperCanvasAction(node: HTMLCanvasElement, pageNumber: number) {
    paperCanvasElements.set(pageNumber, node)
    const manager = renderedPages.has(pageNumber) ? initializePaperCanvas(pageNumber) : null
    return { destroy: () => {
      if (paperCanvasElements.get(pageNumber) === node) paperCanvasElements.delete(pageNumber)
      if (manager) canvasRegistry.unregister(pageNumber, manager)
    } }
  }

  function overlayContainerAction(node: HTMLElement, pageNumber: number) {
    overlayContainers.set(pageNumber, node)
    const overlay = renderedPages.has(pageNumber) ? initializeUserOverlay(pageNumber) : null
    return { destroy: () => {
      if (overlayContainers.get(pageNumber) === node) overlayContainers.delete(pageNumber)
      if (overlay) overlayRegistry.unregister(pageNumber, overlay)
    } }
  }

  /** coordinator가 소유한 자원을 snapshot-before-dispose 순서로 해제 */
  function dispose(): void {
    if (disposed) return
    disposed = true
    pagePresentationGenerations.forEach((_generation, pageNumber) => advancePageGeneration(pageNumber))
    markFirstPageFailed(new Error('PDF viewer was destroyed before the first page became ready'))
    pageRenderWaiters.forEach((waiters) => waiters.forEach((resolve) => resolve()))
    pageRenderWaiters.clear()
    textLayerWaiters.forEach((waiters) => waiters.forEach((resolve) => resolve(null)))
    textLayerWaiters.clear()
    canvasRegistry.dispose()
    overlayRegistry.dispose()
    canvasStore.dispose()
    textLayerElements.forEach(clearPageSearchHighlights)
    textLayerElements.clear()
    pdfCanvases.clear()
    paperCanvasElements.clear()
    overlayContainers.clear()
    renderedPages = new Set()
    pageDomLayerMetadata = new Map()
  }

  return {
    get renderedPages() { return renderedPages },
    get pageDomLayerMetadata() { return pageDomLayerMetadata },
    get isDisposed() { return disposed },
    handlePageRendered,
    handlePageUnrendered,
    handleDomLayersReady,
    setSearchState,
    scrollToSearchMatch,
    setZoom,
    setDrawingMode,
    setBrushSettings,
    updateReviewOverlays,
    waitUntilPageRendered,
    waitUntilFirstPageReady,
    getCanvasData: canvasStore.get,
    getAllCanvasData: canvasStore.getAll,
    setCanvasData: canvasStore.set,
    clearCanvas: canvasStore.clear,
    replaceCanvasData,
    getManager,
    updateUndoRedoState,
    pdfCanvasAction,
    paperCanvasAction,
    overlayContainerAction,
    dispose
  }
}

export type PageLayerCoordinator = ReturnType<typeof createPageLayerCoordinator>
