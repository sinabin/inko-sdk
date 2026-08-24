/** 스크롤 모드 오케스트레이션 — 렌더 큐 관리(최대 3개 동시), 빠른 스크롤 감지(1500px/s)로 렌더링 중지 */

import type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from 'pdfjs-dist'
import { createVisibilityManager, type VisibleRange, type VisibilityManager } from './visibilityManager.svelte'
import { createPageStateManager, type PageStateManager } from './pageStateManager.svelte'
import { createRenderCache, type RenderCache } from './renderCache.svelte'

export interface ScrollModeOptions {
  getPdfDoc: () => PDFDocumentProxy | null
  getTotalPages: () => number
  getViewportScale: () => number
  onPageRendered: (pageNum: number, canvas: HTMLCanvasElement) => void // 렌더링 완료 시 오프스크린 캔버스 전달
  onPageUnrendered: (pageNum: number) => void // 가시 범위 이탈 시 페이지 언로드
  onCurrentPageChange?: (pageNum: number) => void
  maxConcurrentRenders?: number  // 기본값: 3
  fastScrollThreshold?: number   // px/ms, 기본값: 1.5 (1500px/s)
}

export interface PageRenderInfo {
  pageNum: number
  width: number
  height: number
}

export interface ScrollMode {
  initialize: (scrollContainer: HTMLElement) => void
  dispose: () => void

  registerPage: (pageNum: number, element: HTMLElement) => void
  unregisterPage: (pageNum: number) => void
  getPageDimensions: (pageNum: number) => Promise<{ width: number; height: number } | null>

  forceRenderPage: (pageNum: number) => Promise<void>
  requestRender: (pageNum: number) => void
  cancelRender: (pageNum: number) => void
  triggerInitialRender: () => void

  handleScaleChange: (newScale: number) => void
  updateTotalPages: (totalPages: number) => void

  readonly visibilityManager: VisibilityManager | null
  readonly pageStateManager: PageStateManager
  readonly renderCache: RenderCache
  readonly isScrollingFast: boolean
  readonly currentPage: number
}

// 빠른 스크롤 감지 상수
const DEFAULT_FAST_SCROLL_THRESHOLD = 1.5  // px/ms = 1500px/s
const SCROLL_IDLE_DELAY = 150  // ms

// 고해상도 렌더 상수
export const MAX_RENDER_DPR = 2.5    // 기기 DPR 상한 (메모리·성능 보호)
export const MAX_CANVAS_DIM = 4096   // 백버퍼 한 변 최대 픽셀 (모바일 캔버스 크기 한계 대비)
/** pdfjs-dist 5.4.624 public AnnotationMode.ENABLE_FORMS 값. orchestration unit은 core DOM runtime을 import하지 않는다. */
export const PDFJS_ANNOTATION_MODE_ENABLE_FORMS = 2

/**
 * 페이지를 그릴 오버샘플링 배수(DPR) 계산.
 * 기기 devicePixelRatio를 따르되 상한·캔버스 크기 한계로 clamp.
 * @param cssW CSS 픽셀 기준 페이지 가로 (= viewport.width at viewportScale)
 * @param cssH CSS 픽셀 기준 페이지 세로
 */
export function computeRenderDpr(
  cssW: number,
  cssH: number,
  deviceDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
): number {
  const normalizedDpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1
  const want = Math.min(normalizedDpr, MAX_RENDER_DPR)

  if (!Number.isFinite(cssW) || !Number.isFinite(cssH) || cssW <= 0 || cssH <= 0) {
    return want
  }

  // CSS 크기 자체가 4096px을 넘는 경우에는 1배 미만까지 낮춰야
  // 실제 백버퍼의 모든 변을 정책 상한 안에 두는 것이 가능하다.
  const dimensionLimit = Math.min(MAX_CANVAS_DIM / cssW, MAX_CANVAS_DIM / cssH)
  return Math.min(want, dimensionLimit)
}

/**
 * 표시 비트맵과 같은 PDF.js render 호출에서 만든 DOM-layer 메타데이터.
 * 캐시된 canvas에도 함께 보존해 TextLayer/AnnotationLayer가 동일한 페이지,
 * logical viewport, annotationCanvasMap을 사용하도록 한다.
 */
export interface PdfRenderedCanvas extends HTMLCanvasElement {
  __renderDpr?: number
  __pdfPage?: PDFPageProxy
  __logicalViewport?: PageViewport
  __annotationCanvasMap?: Map<string, HTMLCanvasElement>
}

export function createScrollMode(options: ScrollModeOptions): ScrollMode {
  const {
    getPdfDoc,
    getTotalPages,
    getViewportScale,
    onPageRendered,
    onPageUnrendered,
    onCurrentPageChange,
    maxConcurrentRenders = 3,
    fastScrollThreshold = DEFAULT_FAST_SCROLL_THRESHOLD
  } = options

  const pageStateManager = createPageStateManager()
  const renderCache = createRenderCache({ maxMemoryMB: 300, maxPages: 100 })

  let visibilityManager: VisibilityManager | null = $state(null)
  let isScrollingFast = $state(false)
  let currentPage = $state(1)

  let scrollContainer: HTMLElement | null = null
  let lastScrollTop = 0
  let lastScrollTime = 0
  let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null
  let renderQueue: number[] = []
  const activeRenderTokens = new Set<symbol>()
  // 진행 중 pdf.js 렌더 태스크 — 스케일 변경·가시 범위 이탈 시 취소용
  const activeRenderTasks = new Map<number, RenderTask>()
  const scaleChangeRetryPages = new Set<number>()
  let isDisposed = false
  let lifecycleGeneration = 0

  function isCurrentLifecycle(generation: number): boolean {
    return !isDisposed && generation === lifecycleGeneration
  }

  /** 스크롤 속도 측정 및 빠른 스크롤 감지, idle 타이머로 스크롤 멈춤 후 렌더 큐 재개 */
  function handleScroll(): void {
    if (!scrollContainer) return

    const currentScrollTop = scrollContainer.scrollTop
    const currentTime = Date.now()

    // 스크롤 속도 계산
    const timeDelta = currentTime - lastScrollTime
    if (timeDelta > 0 && lastScrollTime > 0) {
      const scrollDelta = Math.abs(currentScrollTop - lastScrollTop)
      const velocity = scrollDelta / timeDelta  // px/ms

      isScrollingFast = velocity > fastScrollThreshold
    }

    lastScrollTop = currentScrollTop
    lastScrollTime = currentTime

    // 스크롤 멈춤 감지
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
    scrollIdleTimer = setTimeout(() => {
      isScrollingFast = false
      processRenderQueue()
    }, SCROLL_IDLE_DELAY)
  }

  /** 가시성 변경 시 범위 밖 작업을 폐기하고 버퍼 범위(뷰포트 +/- 2페이지)를 렌더 */
  function handleVisibilityChange(visibleRange: VisibleRange): void {
    if (!visibilityManager) return

    const bufferedRange = visibilityManager.getBufferedRange()
    const newCurrentPage = visibilityManager.getCenterPage()

    // 현재 페이지 갱신
    if (newCurrentPage !== currentPage) {
      currentPage = newCurrentPage
      onCurrentPageChange?.(currentPage)
    }

    // 빠른 스크롤 동안 processRenderQueue가 멈춰도 지나간 페이지의 queued 작업을
    // idle 뒤 일괄 렌더하지 않도록 현재 버퍼 밖 항목을 즉시 취소한다.
    const queuedPages = [...renderQueue]
    queuedPages.forEach(pageNum => {
      if (pageNum < bufferedRange.start || pageNum > bufferedRange.end) {
        cancelRender(pageNum)
      }
    })

    // 버퍼 범위 밖 페이지 언로드
    const renderedPages = pageStateManager.getRenderedPages()
    renderedPages.forEach(pageNum => {
      if (pageNum < bufferedRange.start || pageNum > bufferedRange.end) {
        unrenderPage(pageNum)
      }
    })

    // 버퍼 범위 밖으로 나간 진행 중 렌더 취소 — CPU 낭비 방지
    activeRenderTasks.forEach((task, pageNum) => {
      if (pageNum < bufferedRange.start || pageNum > bufferedRange.end) {
        task.cancel()
      }
    })

    // 버퍼 범위 내 페이지 렌더링 요청
    for (let pageNum = bufferedRange.start; pageNum <= bufferedRange.end; pageNum++) {
      if (!pageStateManager.isRendered(pageNum) && !pageStateManager.isRendering(pageNum)) {
        requestRender(pageNum)
      }
    }
  }

  /** 렌더링 요청 — 뷰포트 내 페이지는 큐 앞(unshift), 버퍼 영역 페이지는 큐 뒤(push)에 삽입 */
  function requestRender(pageNum: number): void {
    if (isDisposed) return

    const currentState = pageStateManager.getState(pageNum)
    console.log(`[ScrollMode] requestRender page ${pageNum}, current state: ${currentState}`)

    if (currentState === 'idle') {
      const transitioned = pageStateManager.transition(pageNum, 'queued')
      console.log(`[ScrollMode] Transition to queued: ${transitioned}`)

      if (!renderQueue.includes(pageNum)) {
        if (visibilityManager?.isInViewport(pageNum)) {
          renderQueue.unshift(pageNum)  // 뷰포트 내: 높은 우선순위
        } else {
          renderQueue.push(pageNum)  // 버퍼 영역: 낮은 우선순위
        }
        console.log(`[ScrollMode] Added to queue, queue length: ${renderQueue.length}`)
      }

      processRenderQueue()
    }
  }

  /** 렌더링 취소 — 큐에서 제거 후 상태를 idle로 복원 */
  function cancelRender(pageNum: number): void {
    if (isDisposed) return

    const index = renderQueue.indexOf(pageNum)
    if (index > -1) {
      renderQueue.splice(index, 1)
    }

    if (pageStateManager.isQueued(pageNum)) {
      pageStateManager.transition(pageNum, 'idle')
    }
  }

  /** 렌더 큐 순차 처리, 빠른 스크롤 중이면 중단, 동시 렌더 수 제한(기본 3개) */
  function processRenderQueue(): void {
    console.log(`[ScrollMode] processRenderQueue - queue: ${renderQueue.length}, active: ${activeRenderTokens.size}, fast: ${isScrollingFast}`)
    if (isDisposed || isScrollingFast) return // 빠른 스크롤 중 렌더링 중지

    while (renderQueue.length > 0 && activeRenderTokens.size < maxConcurrentRenders) {
      const pageNum = renderQueue.shift()
      if (pageNum !== undefined) {
        console.log(`[ScrollMode] Processing page ${pageNum} from queue`)
        renderPage(pageNum)
      }
    }
  }

  /** 페이지 렌더링 — 캐시 히트 시 즉시 반환, 미스 시 오프스크린 캔버스에 렌더링 (FSM: queued -> rendering -> rendered) */
  async function renderPage(pageNum: number): Promise<void> {
    const generation = lifecycleGeneration
    if (!isCurrentLifecycle(generation)) return

    console.log(`[ScrollMode] renderPage ${pageNum} starting`)
    const pdfDoc = getPdfDoc()
    if (!pdfDoc) {
      console.error(`[ScrollMode] No PDF document available!`)
      return
    }

    const scale = getViewportScale()

    // 캐시 확인
    const cachedCanvas = renderCache.get(pageNum, scale)
    if (cachedCanvas) {
      console.log(`[ScrollMode] Cache HIT for page ${pageNum} at scale ${scale}`)
      pageStateManager.transition(pageNum, 'rendered', scale)
      onPageRendered(pageNum, cachedCanvas)
      return
    }

    // 상태 전이
    if (!pageStateManager.transition(pageNum, 'rendering')) {
      return
    }

    const renderToken = Symbol(`page-${pageNum}`)
    activeRenderTokens.add(renderToken)
    let currentTask: RenderTask | null = null

    try {
      const page = await pdfDoc.getPage(pageNum)
      if (!isCurrentLifecycle(generation)) return

      // 고해상도 렌더: 표시 크기는 viewportScale(CSS 픽셀) 그대로 두고
      // 백버퍼만 기기 DPR만큼 오버샘플링 → 레티나·모바일에서 원본급 선명도.
      // 사용한 DPR은 캔버스에 실어 보내 소비자(1.0x 기준 치수 보정)가 역산하도록 함.
      const viewport = page.getViewport({ scale })
      const dpr = computeRenderDpr(viewport.width, viewport.height)

      const canvas = document.createElement('canvas') as PdfRenderedCanvas
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.__renderDpr = dpr
      canvas.__pdfPage = page
      canvas.__logicalViewport = viewport
      const annotationCanvasMap = new Map<string, HTMLCanvasElement>()
      canvas.__annotationCanvasMap = annotationCanvasMap

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Cannot get canvas context')

      currentTask = page.render({
        canvasContext: ctx,
        viewport,
        canvas,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        annotationMode: PDFJS_ANNOTATION_MODE_ENABLE_FORMS,
        annotationCanvasMap
      })
      activeRenderTasks.set(pageNum, currentTask)
      await currentTask.promise
      if (activeRenderTasks.get(pageNum) === currentTask) activeRenderTasks.delete(pageNum)
      if (!isCurrentLifecycle(generation)) return

      // 렌더 중 스케일이 바뀐 경우 결과 폐기 — 구 스케일 비트맵의 상태·캐시 오염 방지
      if (getViewportScale() !== scale) {
        scaleChangeRetryPages.delete(pageNum)
        pageStateManager.resetPage(pageNum)
        // 초기 fit-width는 IntersectionObserver가 가시 범위를 확정하기 전에
        // scale을 바꾸므로, 관측결과에 의존하면 첫 페이지가 영구히 idle이 될 수 있다.
        // 이미 시작된 작업은 최신 scale로 한 번 재queue한다.
        requestRender(pageNum)
        return
      }

      // 캐시에 저장
      renderCache.set(pageNum, scale, canvas)

      // 상태 갱신
      scaleChangeRetryPages.delete(pageNum)
      pageStateManager.transition(pageNum, 'rendered', scale)
      console.log(`[ScrollMode] Page ${pageNum} rendered successfully, calling onPageRendered`)
      onPageRendered(pageNum, canvas)

    } catch (error) {
      if (currentTask && activeRenderTasks.get(pageNum) === currentTask) {
        activeRenderTasks.delete(pageNum)
      }
      if (!isCurrentLifecycle(generation)) return

      if ((error as Error)?.name === 'RenderingCancelledException') {
        // 스케일 변경·범위 이탈로 취소됨 — idle 복원 후 가시 영역이면 재요청
        const retryForLatestScale = scaleChangeRetryPages.delete(pageNum)
        pageStateManager.resetPage(pageNum)
        if (!isDisposed && (retryForLatestScale || visibilityManager?.isNearViewport(pageNum))) {
          requestRender(pageNum)
        }
      } else {
        scaleChangeRetryPages.delete(pageNum)
        console.error(`[ScrollMode] Failed to render page ${pageNum}:`, error)
        pageStateManager.transitionToError(pageNum, error as Error)
      }
    } finally {
      activeRenderTokens.delete(renderToken)
      if (isCurrentLifecycle(generation)) processRenderQueue()
    }
  }

  /** 페이지 언로드 — 상태 초기화 후 콜백 호출 */
  function unrenderPage(pageNum: number): void {
    if (pageStateManager.isRendered(pageNum)) {
      pageStateManager.resetPage(pageNum)
      onPageUnrendered(pageNum)
    }
  }

  /** 강제 렌더링 — 큐에서 제거 후 즉시 렌더링 실행 */
  async function forceRenderPage(pageNum: number): Promise<void> {
    if (isDisposed) return

    const index = renderQueue.indexOf(pageNum)
    if (index > -1) {
      renderQueue.splice(index, 1)
    }

    pageStateManager.resetPage(pageNum)
    pageStateManager.transition(pageNum, 'queued')
    await renderPage(pageNum)
  }

  /** 페이지 치수 반환 — PDF 페이지의 뷰포트 크기 조회 */
  async function getPageDimensions(pageNum: number): Promise<{ width: number; height: number } | null> {
    const pdfDoc = getPdfDoc()
    if (!pdfDoc) return null

    try {
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: getViewportScale() })
      return {
        width: viewport.width,
        height: viewport.height
      }
    } catch {
      return null
    }
  }

  /** 스케일 변경 시 렌더된 페이지 중 스케일 불일치 페이지만 리셋 후 가시 범위 내 재렌더링 요청 */
  function handleScaleChange(newScale: number): void {
    // 진행 중인 구 스케일 렌더 즉시 취소 — 취소 예외 핸들러가 재요청 처리
    activeRenderTasks.forEach((task, pageNum) => {
      scaleChangeRetryPages.add(pageNum)
      task.cancel()
    })

    const renderedPages = pageStateManager.getRenderedPages()

    renderedPages.forEach(pageNum => {
      const renderedScale = pageStateManager.getRenderedScale(pageNum)
      if (renderedScale !== newScale) {
        pageStateManager.resetPage(pageNum)
        if (visibilityManager?.isNearViewport(pageNum)) {
          requestRender(pageNum)
        }
      }
    })
  }

  /** 비동기 문서 로드로 총 페이지 수가 뒤늦게 확정되는 경우 visibility 경계를 갱신한다. */
  function updateTotalPages(totalPages: number): void {
    visibilityManager?.updateTotalPages(Math.max(0, Math.floor(totalPages)))
  }

  /** 초기화 — 스크롤 컨테이너에 VisibilityManager 생성 및 스크롤 이벤트 등록 */
  function initialize(container: HTMLElement): void {
    isDisposed = false
    scrollContainer = container

    visibilityManager = createVisibilityManager({
      scrollContainer: container,
      totalPages: getTotalPages(),
      bufferPages: 2,
      onVisibilityChange: handleVisibilityChange
    })

    container.addEventListener('scroll', handleScroll, { passive: true })
  }

  /** 페이지 요소를 IntersectionObserver에 등록 */
  function registerPage(pageNum: number, element: HTMLElement): void {
    visibilityManager?.observe(pageNum, element)
  }

  /** 페이지 요소를 IntersectionObserver에서 해제 */
  function unregisterPage(pageNum: number): void {
    visibilityManager?.unobserve(pageNum)
  }

  /** 초기 렌더링 트리거 — 페이지 등록 후 첫 3페이지 렌더링 요청 */
  function triggerInitialRender(): void {
    const total = getTotalPages()
    if (total === 0) return

    // PdfScrollViewer는 document state가 먼저 보이고 page navigation state가 다음
    // 마이크로태스크에 채워질 수 있다. 초기화 때 0을 받은 가시성 범위를 실제
    // 페이지 수로 동기화하지 않으면 fit-width 취소 후 첫 페이지가 재요청되지 않는다.
    visibilityManager?.updateTotalPages(total)

    const initialPages = Math.min(3, total)
    console.log('[ScrollMode] Triggering initial render for first', initialPages, 'pages')

    for (let pageNum = 1; pageNum <= initialPages; pageNum++) {
      if (!pageStateManager.isRendered(pageNum) && !pageStateManager.isRendering(pageNum) && !pageStateManager.isQueued(pageNum)) {
        requestRender(pageNum)
      }
    }
  }

  /** 리소스 정리 — 진행 중 렌더, 타이머, 이벤트 리스너, 매니저, 캐시 해제 */
  function dispose(): void {
    if (isDisposed) return

    isDisposed = true
    lifecycleGeneration++
    scaleChangeRetryPages.clear()
    activeRenderTasks.forEach(task => task.cancel())
    activeRenderTasks.clear()
    activeRenderTokens.clear()

    if (scrollIdleTimer) {
      clearTimeout(scrollIdleTimer)
      scrollIdleTimer = null
    }

    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }

    visibilityManager?.dispose()
    pageStateManager.resetAll()
    renderCache.clear()
    renderQueue = []

    scrollContainer = null
    visibilityManager = null
  }

  return {
    initialize,
    dispose,
    registerPage,
    unregisterPage,
    getPageDimensions,
    forceRenderPage,
    requestRender,
    cancelRender,
    triggerInitialRender,
    handleScaleChange,
    updateTotalPages,

    get visibilityManager() { return visibilityManager },
    get pageStateManager() { return pageStateManager },
    get renderCache() { return renderCache },
    get isScrollingFast() { return isScrollingFast },
    get currentPage() { return currentPage }
  }
}
