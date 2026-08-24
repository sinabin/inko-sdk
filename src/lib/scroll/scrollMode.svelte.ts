/** 스크롤 모드 오케스트레이션 — 렌더 큐 관리(최대 3개 동시), 빠른 스크롤 감지(1500px/s)로 렌더링 중지 */

import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
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
const MAX_RENDER_DPR = 2.5    // 기기 DPR 상한 (메모리·성능 보호)
const MAX_CANVAS_DIM = 4096   // 백버퍼 한 변 최대 픽셀 (모바일 캔버스 크기 한계 대비)

/**
 * 페이지를 그릴 오버샘플링 배수(DPR) 계산.
 * 기기 devicePixelRatio를 따르되 상한·캔버스 크기 한계로 clamp.
 * @param cssW CSS 픽셀 기준 페이지 가로 (= viewport.width at viewportScale)
 * @param cssH CSS 픽셀 기준 페이지 세로
 */
function computeRenderDpr(cssW: number, cssH: number): number {
  const want = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR)
  const longest = Math.max(cssW, cssH)
  if (longest <= 0) return want
  if (longest * want <= MAX_CANVAS_DIM) return want
  return Math.max(1, MAX_CANVAS_DIM / longest)  // 한계 초과 시 1배 밑으로는 내리지 않음
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
  let activeRenders = 0
  // 진행 중 pdf.js 렌더 태스크 — 스케일 변경·가시 범위 이탈 시 취소용
  const activeRenderTasks = new Map<number, RenderTask>()

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

  /** 가시성 변경 시 버퍼 범위(뷰포트 +/- 2페이지) 내 미렌더 페이지 요청, 범위 밖 페이지 언로드 */
  function handleVisibilityChange(visibleRange: VisibleRange): void {
    if (!visibilityManager) return

    const bufferedRange = visibilityManager.getBufferedRange()
    const newCurrentPage = visibilityManager.getCenterPage()

    // 현재 페이지 갱신
    if (newCurrentPage !== currentPage) {
      currentPage = newCurrentPage
      onCurrentPageChange?.(currentPage)
    }

    // 버퍼 범위 내 페이지 렌더링 요청
    for (let pageNum = bufferedRange.start; pageNum <= bufferedRange.end; pageNum++) {
      if (!pageStateManager.isRendered(pageNum) && !pageStateManager.isRendering(pageNum)) {
        requestRender(pageNum)
      }
    }

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
  }

  /** 렌더링 요청 — 뷰포트 내 페이지는 큐 앞(unshift), 버퍼 영역 페이지는 큐 뒤(push)에 삽입 */
  function requestRender(pageNum: number): void {
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
    console.log(`[ScrollMode] processRenderQueue - queue: ${renderQueue.length}, active: ${activeRenders}, fast: ${isScrollingFast}`)
    if (isScrollingFast) return // 빠른 스크롤 중 렌더링 중지

    while (renderQueue.length > 0 && activeRenders < maxConcurrentRenders) {
      const pageNum = renderQueue.shift()
      if (pageNum !== undefined) {
        console.log(`[ScrollMode] Processing page ${pageNum} from queue`)
        renderPage(pageNum)
      }
    }
  }

  /** 페이지 렌더링 — 캐시 히트 시 즉시 반환, 미스 시 오프스크린 캔버스에 렌더링 (FSM: queued -> rendering -> rendered) */
  async function renderPage(pageNum: number): Promise<void> {
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

    activeRenders++

    try {
      const page = await pdfDoc.getPage(pageNum)

      // 고해상도 렌더: 표시 크기는 viewportScale(CSS 픽셀) 그대로 두고
      // 백버퍼만 기기 DPR만큼 오버샘플링 → 레티나·모바일에서 원본급 선명도.
      // 사용한 DPR은 캔버스에 실어 보내 소비자(1.0x 기준 치수 보정)가 역산하도록 함.
      const baseViewport = page.getViewport({ scale })
      const dpr = computeRenderDpr(baseViewport.width, baseViewport.height)
      const viewport = page.getViewport({ scale: scale * dpr })

      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      ;(canvas as any).__renderDpr = dpr

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Cannot get canvas context')

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        canvas
      })
      activeRenderTasks.set(pageNum, renderTask)
      await renderTask.promise
      activeRenderTasks.delete(pageNum)

      // 렌더 중 스케일이 바뀐 경우 결과 폐기 — 구 스케일 비트맵의 상태·캐시 오염 방지
      if (getViewportScale() !== scale) {
        pageStateManager.resetPage(pageNum)
        if (visibilityManager?.isNearViewport(pageNum)) {
          requestRender(pageNum)
        }
        return
      }

      // 캐시에 저장
      renderCache.set(pageNum, scale, canvas)

      // 상태 갱신
      pageStateManager.transition(pageNum, 'rendered', scale)
      console.log(`[ScrollMode] Page ${pageNum} rendered successfully, calling onPageRendered`)
      onPageRendered(pageNum, canvas)

    } catch (error) {
      activeRenderTasks.delete(pageNum)
      if ((error as Error)?.name === 'RenderingCancelledException') {
        // 스케일 변경·범위 이탈로 취소됨 — idle 복원 후 가시 영역이면 재요청
        pageStateManager.resetPage(pageNum)
        if (visibilityManager?.isNearViewport(pageNum)) {
          requestRender(pageNum)
        }
      } else {
        console.error(`[ScrollMode] Failed to render page ${pageNum}:`, error)
        pageStateManager.transitionToError(pageNum, error as Error)
      }
    } finally {
      activeRenders--
      processRenderQueue()
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
    activeRenderTasks.forEach(task => task.cancel())

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

  /** 초기화 — 스크롤 컨테이너에 VisibilityManager 생성 및 스크롤 이벤트 등록 */
  function initialize(container: HTMLElement): void {
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
    activeRenderTasks.forEach(task => task.cancel())
    activeRenderTasks.clear()

    if (scrollIdleTimer) {
      clearTimeout(scrollIdleTimer)
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

    get visibilityManager() { return visibilityManager },
    get pageStateManager() { return pageStateManager },
    get renderCache() { return renderCache },
    get isScrollingFast() { return isScrollingFast },
    get currentPage() { return currentPage }
  }
}
