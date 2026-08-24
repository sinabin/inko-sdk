<script lang="ts">
  import type { PDFDocumentProxy } from 'pdfjs-dist'
  import type { ToolMode, UserCanvasInfo } from '../types'
  import { createScrollMode, type ScrollMode } from '../lib/scroll/scrollMode.svelte'
  import { createPageCanvasManager, type PageCanvasManager } from '../lib/canvas/pageCanvasManager.svelte'
  import { createUserOverlay, type UserOverlay } from '../lib/canvas/userOverlay.svelte'
  import { createHistoryManager, type HistoryManager } from '../lib/history'
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
    /**
     * 현재 편집 캔버스에 로드된 작업이력 항목의 canvasId.
     * 이 항목은 userOverlay(z-index 20) 렌더링에서 제외 — 편집 캔버스와 동일 데이터를 위에 덮어
     * 사용자 입장에서 지우개 등 편집 동작이 즉시 시각 반영되지 않는 문제를 방지
     */
    currentEditCanvasId?: string
    /** 버전 이력 모드(데모 '작업 이력' 뷰어 등) — 과거 버전 미리보기 시 편집 레이어를 숨긴다.
     *  기본(다중 사용자 레이어=겹쳐 보기) 모드는 false로 두어 기존 동작 유지 */
    isVersionHistoryMode?: boolean
    onPageChange?: (page: number) => void
    onCanvasChange?: (pageNum: number, json: string) => void
    onTextInputRequest?: (existingText?: string) => void
    onReady?: (scrollContainer: HTMLElement) => void
    onSelectionChange?: (hasSelection: boolean) => void
    onUndoStateChange?: (canUndo: boolean, canRedo: boolean) => void
    // 저해상도 프리뷰 관련 props
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
    onPageChange,
    onCanvasChange,
    onTextInputRequest,
    onReady,
    onSelectionChange,
    onUndoStateChange,
    getPreview,
    hasPreview
  }: Props = $props()

  // DOM refs
  let scrollContainer: HTMLElement | null = $state(null)
  let pageContainers: Map<number, HTMLElement> = new Map()
  let pdfCanvases: Map<number, HTMLCanvasElement> = new Map()
  let paperCanvasElements: Map<number, HTMLCanvasElement> = new Map()
  let overlayContainers: Map<number, HTMLElement> = new Map()

  // 1.0x baseline 기준 페이지 논리 크기 (Paper.js project 좌표계 = 데이터 저장 좌표계)
  // 시각 크기는 baseDim × viewportScale로 계산
  let pageBaseDimensions = $state<Map<number, { width: number; height: number }>>(new Map())

  // Scroll mode instance — $state로 선언해 onMount의 늦은 할당 후 외부 $effect가 재구독되도록
  let scrollMode: ScrollMode | null = $state(null)

  // Page canvas manager instances per page
  let canvasManagers: Map<number, PageCanvasManager> = new Map()

  // User overlay instances per page
  let userOverlayInstances: Map<number, UserOverlay> = new Map()

  // History manager for undo/redo
  let historyManager: HistoryManager | null = null

  // Rendered pages tracking
  let renderedPages = $state<Set<number>>(new Set())

  let firstPageReady = false
  let resolveFirstPageReady!: (result: { ok: true } | { ok: false; error: Error }) => void
  const firstPageReadyPromise = new Promise<{ ok: true } | { ok: false; error: Error }>((resolve) => {
    resolveFirstPageReady = resolve
  })

  function markFirstPageReady(): void {
    if (firstPageReady) return
    firstPageReady = true
    resolveFirstPageReady({ ok: true })
  }

  function markFirstPageFailed(error: unknown): void {
    if (firstPageReady) return
    firstPageReady = true
    resolveFirstPageReady({
      ok: false,
      error: error instanceof Error ? error : new Error(String(error))
    })
  }

  // 페이지별 캔버스 JSON 데이터 — 항상 1.0x baseline 좌표계로 저장 (언로드된 페이지도 보존)
  // 줌 변경은 view.zoom(시각 스케일)으로만 처리하므로 좌표 변환·스케일 메타데이터 불필요
  let canvasDataStore: Map<number, string> = new Map()

  // Editing mode tracking
  let isEditingActive = $state(false)
  let isSelectMode = $derived(currentTool === 'select')
  let isTextMode = $derived(currentTool === 'text')
  // 과거 버전 미리보기 중 — 현재 편집(currentEditCanvasId) 외 항목이 켜져 있으면 true.
  // 이때 편집 레이어(현재 버전)를 숨겨, 체크한 과거 이력만 보이게 한다. (체크 해제 시 복귀)
  let isPreviewingHistory = $derived(
    isVersionHistoryMode && userCanvasData.some(d => d.enabled && d.canvasId !== currentEditCanvasId)
  )

  // 현재 페이지 derived state
  let currentPage = $state(1)

  // Undo/Redo state for reactivity
  let canUndoState = $state(false)
  let canRedoState = $state(false)

  // 편집 모드 동기화: readOnly가 아니면 모든 도구(select 포함)에서 캔버스 이벤트 수신
  // → CSS .editing-active 클래스 토글로 pointer-events: auto 적용
  $effect(() => {
    isEditingActive = !isReadOnly
  })

  // 스케일 변경 감지 — Paper.js·UserOverlay는 view.zoom/displayScale만 동기 갱신(데이터 보존),
  // PDF는 새 해상도로 비동기 재렌더. 데이터가 1.0x baseline에 저장되므로 좌표 변환 불필요
  $effect(() => {
    const scale = viewportScale
    untrack(() => {
      if (scrollMode && scale) {
        // Paper.js 캔버스: view.zoom 즉시 갱신
        canvasManagers.forEach(manager => {
          manager.setZoom(scale)
        })
        // UserOverlay: displayScale 즉시 갱신 — PDF 재렌더 비동기 갭 동안 어긋남 방지
        userOverlayInstances.forEach(overlay => {
          overlay.setDisplayScale(scale)
        })
        // PDF 비트맵 재렌더 요청 (선명도 유지)
        scrollMode.handleScaleChange(scale)
      }
    })
  })

  // 현재 페이지 변경 → 히스토리 매니저의 활성 페이지 전환 및 undo/redo 상태 동기화
  // untrack: historyManager 내부 $state 접근이 이 effect를 재트리거하지 않도록 방지
  $effect(() => {
    const page = currentPage
    untrack(() => {
      historyManager?.setActivePage(page)
      updateUndoRedoState()
    })
  })

  // 도구 변경 → 모든 페이지 캔버스 매니저에 드로잉 모드 전파
  // untrack: manager.setDrawingMode 내부의 $state/$derived 간접 의존성 차단
  $effect(() => {
    const tool = currentTool
    untrack(() => {
      canvasManagers.forEach(manager => {
        manager.setDrawingMode(tool)
      })
    })
  })

  // 브러시 설정 변경 시 업데이트 — 색·굵기·폰트크기·필압 감도 전파
  $effect(() => {
    const color = brushColor
    const width = brushWidth
    const fSize = fontSize
    const sens = pressureSensitivity
    untrack(() => {
      canvasManagers.forEach(manager => {
        manager.setBrushColor(color)
        manager.setBrushWidth(width)
        manager.setFontSize(fSize)
        manager.setBrushPressureSensitivity(sens)
      })
    })
  })

  // User canvas data 변경 시 오버레이 업데이트
  // untrack: updateUserOverlays() 내부에서 userCanvasData 개별 enabled 접근이
  // 이 effect의 fine-grained 의존성으로 등록되어 무한 재실행을 유발하는 것을 방지
  // currentEditCanvasId 변경 시에도 재렌더 — 편집 대상 전환에 따른 오버레이 제외 항목 갱신
  $effect(() => {
    const data = userCanvasData
    const currentId = currentEditCanvasId
    void currentId
    untrack(() => {
      if (data) {
        updateUserOverlays()
      }
    })
  })

  /**
   * 페이지 1.0x 논리 크기 로드 — 줌과 무관, PDF 페이지 자체 크기만 한 번 로드
   * 1단계: 처음 5페이지 즉시 로드 → UI 빠르게 표시
   * 2단계: 나머지 페이지 백그라운드 로드 (10페이지 단위로 갱신)
   */
  async function loadAllPageDimensions(): Promise<void> {
    if (!pdfDoc) return

    const newDimensions = new Map<number, { width: number; height: number }>()
    const INITIAL_PAGES = 5

    const initialCount = Math.min(INITIAL_PAGES, totalPages)
    for (let pageNum = 1; pageNum <= initialCount; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.0 })
        newDimensions.set(pageNum, {
          width: viewport.width,
          height: viewport.height
        })
      } catch (error) {
        console.error(`Failed to get dimensions for page ${pageNum}:`, error)
      }
    }

    pageBaseDimensions = new Map(newDimensions)

    if (totalPages > INITIAL_PAGES) {
      loadRemainingDimensions(newDimensions, INITIAL_PAGES + 1)
    }
  }

  /** 나머지 페이지 1.0x 논리 크기 백그라운드 로드 */
  async function loadRemainingDimensions(
    currentDimensions: Map<number, { width: number; height: number }>,
    startPage: number
  ): Promise<void> {
    if (!pdfDoc) return

    for (let pageNum = startPage; pageNum <= totalPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.0 })
        currentDimensions.set(pageNum, {
          width: viewport.width,
          height: viewport.height
        })

        if (pageNum % 10 === 0) {
          pageBaseDimensions = new Map(currentDimensions)
        }
      } catch (error) {
        console.error(`Failed to get dimensions for page ${pageNum}:`, error)
      }
    }

    pageBaseDimensions = new Map(currentDimensions)
  }

  /**
   * 페이지 렌더링 완료 핸들러 — scrollMode에서 오프스크린 캔버스(시각 크기) 수신
   * 1. 1.0x baseline 크기 보정 (canvas.width = baseW × scale)
   * 2. renderedPages Set 갱신 → Svelte 반응성으로 DOM에 캔버스 요소 생성
   * 3. tick() 후 PDF 이미지를 DOM 캔버스에 복사 (Paper.js/Overlay 초기화는 Svelte action에서 처리)
   */
  function handlePageRendered(pageNum: number, canvas: HTMLCanvasElement): void {
    // canvas.width/height = baseDim × viewportScale × renderDpr (백버퍼 픽셀, DPR 오버샘플링됨)
    // baseDim 갱신: viewportScale와 renderDpr로 나눠 1.0x 기준 추출
    const renderDpr = (canvas as any).__renderDpr || 1
    if (canvas.width > 0 && canvas.height > 0 && viewportScale > 0) {
      const baseW = canvas.width / (viewportScale * renderDpr)
      const baseH = canvas.height / (viewportScale * renderDpr)
      const existing = pageBaseDimensions.get(pageNum)
      // 미세한 부동소수점 차이는 무시하고 처음 한 번만 갱신
      if (!existing || Math.abs(existing.width - baseW) > 0.5 || Math.abs(existing.height - baseH) > 0.5) {
        const newDimensions = new Map(pageBaseDimensions)
        newDimensions.set(pageNum, { width: baseW, height: baseH })
        pageBaseDimensions = newDimensions
      }
    }

    renderedPages = new Set([...renderedPages, pageNum])

    // User overlay 캔버스 크기 갱신 (1.0x baseline + 시각 스케일)
    const dims = pageBaseDimensions.get(pageNum)
    const overlay = userOverlayInstances.get(pageNum)
    if (overlay && dims) {
      overlay.updateCanvasSize(Math.floor(dims.width), Math.floor(dims.height))
      overlay.setDisplayScale(viewportScale)
      updateUserOverlayForPage(pageNum)
    }

    // DOM 업데이트 후 PDF 비트맵 복사
    tick().then(() => {
      const pdfCanvas = pdfCanvases.get(pageNum)
      if (!pdfCanvas) throw new Error(`PDF canvas missing for page ${pageNum}`)
      pdfCanvas.width = canvas.width
      pdfCanvas.height = canvas.height
      const ctx = pdfCanvas.getContext('2d')
      if (!ctx) throw new Error(`PDF canvas context missing for page ${pageNum}`)
      ctx.drawImage(canvas, 0, 0)
      if (pageNum === 1) markFirstPageReady()
    }).catch((error) => {
      console.error(`[PdfScrollViewer] Failed to present page ${pageNum}:`, error)
      if (pageNum === 1) markFirstPageFailed(error)
    })
  }

  /** 페이지 언로드 — 1.0x JSON 보존 후 Paper.js/Overlay 인스턴스 정리 */
  function handlePageUnrendered(pageNum: number): void {
    savePageCanvasData(pageNum)

    const manager = canvasManagers.get(pageNum)
    if (manager) {
      manager.dispose()
      canvasManagers.delete(pageNum)
    }

    const overlay = userOverlayInstances.get(pageNum)
    if (overlay) {
      overlay.dispose()
      userOverlayInstances.delete(pageNum)
    }

    const newSet = new Set(renderedPages)
    newSet.delete(pageNum)
    renderedPages = newSet
  }

  /**
   * Paper.js 캔버스 초기화 — 1.0x baseline + 현재 viewportScale(view.zoom)
   * 데이터(JSON)는 항상 1.0x project 좌표계, view.zoom이 시각 스케일을 담당하므로 좌표 변환 불필요
   */
  function initializePaperCanvas(pageNum: number): void {
    if (isReadOnly) return

    const canvasEl = paperCanvasElements.get(pageNum)
    if (!canvasEl) return

    // 기존 인스턴스 정리
    const existing = canvasManagers.get(pageNum)
    if (existing) {
      existing.dispose()
    }

    // 1.0x baseline 크기 결정
    const dims = pageBaseDimensions.get(pageNum)
    const baseW = dims ? dims.width : (canvasEl.clientWidth / viewportScale || 612)
    const baseH = dims ? dims.height : (canvasEl.clientHeight / viewportScale || 792)

    const manager = createPageCanvasManager({
      historyManager: historyManager ?? undefined,
      pageNum,
      isReadOnly,
      onSelectionChange,
      getScrollContainer: () => scrollContainer,
      onCanvasChange: () => {
        // JSON은 항상 1.0x project 좌표계로 export됨 (view.zoom 무관)
        const json = manager.exportJSON()
        canvasDataStore.set(pageNum, json)
        onCanvasChange?.(pageNum, json)
        updateUndoRedoState()
      },
      onTextInputRequest: (existingText) => {
        onTextInputRequest?.(existingText)
      }
    })

    manager.init(canvasEl, baseW, baseH, viewportScale)
    manager.setDrawingMode(currentTool)
    manager.setBrushColor(brushColor)
    manager.setBrushWidth(brushWidth)
    manager.setBrushPressureSensitivity(pressureSensitivity)
    manager.setFontSize(fontSize)

    // 저장된 1.0x JSON 복원 — 좌표 변환 불필요, view.zoom이 시각 스케일 담당
    const savedData = canvasDataStore.get(pageNum)
    if (savedData) {
      if (!manager.importJSON(savedData)) {
        const error = new Error(`Failed to restore canvas data for page ${pageNum}`)
        if (pageNum === 1) markFirstPageFailed(error)
        manager.dispose()
        return
      }
    }

    canvasManagers.set(pageNum, manager)

    // 새 PaperScope에서 importJSON 후 즉시 렌더링 강제 실행
    // Paper.js requestAnimationFrame 자동 렌더가 일부 임베드 다중 스코프 환경에서
    // 안정적이지 않아 명시적 update 호출
    if (savedData) {
      manager.paperCanvas?.render()
    }
  }

  /** User overlay 초기화 — 1.0x baseline 크기 + 현재 displayScale */
  function initializeUserOverlay(pageNum: number): void {
    const container = overlayContainers.get(pageNum)
    if (!container) return

    const existing = userOverlayInstances.get(pageNum)
    if (existing) {
      existing.dispose()
    }

    const overlay = createUserOverlay()
    overlay.setContainer(container)
    overlay.setDisplayScale(viewportScale)

    const dims = pageBaseDimensions.get(pageNum)
    if (dims) {
      overlay.updateCanvasSize(Math.floor(dims.width), Math.floor(dims.height))
    }

    userOverlayInstances.set(pageNum, overlay)

    updateUserOverlayForPage(pageNum)
  }

  // 페이지별 User overlay 업데이트
  function updateUserOverlayForPage(pageNum: number): void {
    const overlay = userOverlayInstances.get(pageNum)
    if (!overlay) return

    const pageKey = String(pageNum)

    userCanvasData.forEach(data => {
      // 현재 편집 대상 항목은 오버레이 제외 — 편집 캔버스와 동일 데이터 중복 렌더 방지
      // (이중 렌더 시 편집 캔버스의 변경(예: 지우개)이 위 오버레이에 가려져 즉시 반영 안 됨)
      if (data.canvasId === currentEditCanvasId) return

      if (data.enabled) {
        // 전체 canvasData에서 해당 페이지 데이터만 추출
        const pageCanvasData = extractPageCanvasData(data.canvasData, pageKey)
        if (pageCanvasData) {
          overlay.setUserData({ ...data, canvasData: pageCanvasData })
        }
      }
    })
  }

  /** 페이지별 키 구조 canvasData에서 특정 페이지의 드로잉 아이템만 추출 */
  function extractPageCanvasData(canvasData: string, pageKey: string): string | null {
    try {
      const parsed = JSON.parse(canvasData)

      // 페이지별 키 구조: {"1": "[Layer,{children:[[Path,...],[Path,...]]}]", "2": "..."}
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[pageKey]) {
        const pageData = parsed[pageKey]
        const layerDef = typeof pageData === 'string' ? JSON.parse(pageData) : pageData

        // layerDef = ["Layer", {"applyMatrix":true, "children":[["Path",{...}], ...]}]
        // Layer 자체가 아닌 내부 children(Path 등)만 추출하여
        // activeLayer에 직접 import할 수 있게 함 (Layer-in-Layer 중첩 방지)
        const layerProps = layerDef[1] || {}
        const innerChildren = layerProps.children || []

        if (innerChildren.length === 0) return null

        return JSON.stringify({ children: innerChildren })
      }

      // 페이지 키 구조가 아닌 경우 원본 그대로 반환
      return canvasData
    } catch {
      return null
    }
  }

  // 모든 User overlay 업데이트
  function updateUserOverlays(): void {
    userOverlayInstances.forEach((overlay, pageNum) => {
      overlay.clearAll()
      updateUserOverlayForPage(pageNum)
    })
  }

  // Undo/Redo 상태 업데이트 — 외부(PdfViewer)에 콜백으로 전파해 툴바 버튼 활성/비활성 동기화
  function updateUndoRedoState(): void {
    canUndoState = historyManager?.canUndoPage(currentPage) ?? false
    canRedoState = historyManager?.canRedoPage(currentPage) ?? false
    onUndoStateChange?.(canUndoState, canRedoState)
  }

  /** 페이지 캔버스 데이터 저장 — 항상 1.0x project 좌표계 JSON */
  function savePageCanvasData(pageNum: number): void {
    const manager = canvasManagers.get(pageNum)
    if (manager) {
      const json = manager.exportJSON()
      if (json) {
        canvasDataStore.set(pageNum, json)
      }
    }
  }

  /** Svelte action — 페이지 컨테이너를 IntersectionObserver에 등록/해제 */
  function pageContainerAction(node: HTMLElement, pageNum: number) {
    pageContainers.set(pageNum, node)
    scrollMode?.registerPage(pageNum, node)

    return {
      destroy() {
        pageContainers.delete(pageNum)
        scrollMode?.unregisterPage(pageNum)
      }
    }
  }

  // Svelte action for PDF canvas
  function pdfCanvasAction(node: HTMLCanvasElement, pageNum: number) {
    pdfCanvases.set(pageNum, node)

    return {
      destroy() {
        pdfCanvases.delete(pageNum)
      }
    }
  }

  /** Svelte action — Paper.js 캔버스 DOM 삽입 시 자동으로 PaperScope 초기화 */
  function paperCanvasAction(node: HTMLCanvasElement, pageNum: number) {
    paperCanvasElements.set(pageNum, node)

    if (renderedPages.has(pageNum)) {
      initializePaperCanvas(pageNum)
    }

    return {
      destroy() {
        paperCanvasElements.delete(pageNum)
      }
    }
  }

  // Svelte action for overlay container
  function overlayContainerAction(node: HTMLElement, pageNum: number) {
    overlayContainers.set(pageNum, node)

    // 렌더링 완료된 페이지면 즉시 초기화
    if (renderedPages.has(pageNum)) {
      initializeUserOverlay(pageNum)
    }

    return {
      destroy() {
        overlayContainers.delete(pageNum)
      }
    }
  }

  // 외부 API: 특정 페이지의 캔버스 데이터 가져오기
  export function getCanvasData(pageNum: number): string | null {
    // 현재 렌더링된 페이지면 최신 데이터
    const manager = canvasManagers.get(pageNum)
    if (manager) {
      return manager.exportJSON()
    }
    // 저장된 데이터 반환
    return canvasDataStore.get(pageNum) ?? null
  }

  /**
   * 외부 API: 모든 페이지의 캔버스 데이터 수집 (1.0x baseline 좌표계)
   * 데이터가 항상 1.0x로 저장되므로 변환 없이 그대로 반환
   */
  export function getAllCanvasData(): Map<number, string> {
    const result = new Map<number, string>()

    canvasDataStore.forEach((data, pageNum) => {
      result.set(pageNum, data)
    })

    canvasManagers.forEach((manager, pageNum) => {
      const json = manager.exportJSON()
      if (json) {
        result.set(pageNum, json)
      }
    })

    return result
  }

  /** 외부 API: 특정 페이지의 캔버스 데이터 설정 (1.0x baseline JSON 가정) */
  export function setCanvasData(pageNum: number, json: string): void {
    canvasDataStore.set(pageNum, json)

    const manager = canvasManagers.get(pageNum)
    if (manager) {
      manager.importJSON(json)
    }
  }

  /** 외부 API: 지정 페이지(기본값은 현재 페이지)의 편집 캔버스만 초기화 */
  export function clearCanvas(pageNum: number = currentPage): void {
    const manager = canvasManagers.get(pageNum)
    if (manager) {
      manager.clear()
    }
    canvasDataStore.delete(pageNum)
  }

  /** 첫 페이지의 PDF 비트맵 표시와 편집 상태 복원이 끝날 때까지 대기 */
  export async function waitUntilFirstPageReady(): Promise<void> {
    const result = await firstPageReadyPromise
    if (!result.ok) throw result.error
  }

  /** 외부 API: 이력 데이터를 편집 캔버스에 로드 (1.0x baseline JSON 가정, 기존 내용 완전 대체) */
  export function loadHistoryCanvasData(pageDataRecord: Record<string, string>): void {
    canvasDataStore.clear()

    canvasManagers.forEach((manager) => {
      manager.paperCanvas?.clear()
    })

    Object.entries(pageDataRecord).forEach(([pageStr, json]) => {
      const pageNum = parseInt(pageStr)
      if (isNaN(pageNum) || !json) return
      canvasDataStore.set(pageNum, json)
    })

    // 현재 렌더링된 페이지에 1.0x 데이터 그대로 import — view.zoom이 시각 스케일 담당
    const failedPages: number[] = []
    canvasManagers.forEach((manager, pageNum) => {
      const savedData = canvasDataStore.get(pageNum)
      if (savedData) {
        if (!manager.importJSON(savedData)) failedPages.push(pageNum)
      }
    })
    if (failedPages.length > 0) {
      throw new Error(`Failed to restore canvas data for pages: ${failedPages.join(', ')}`)
    }
  }

  // 외부 API: 텍스트 추가
  export function addTextToCurrentPage(text: string, x: number, y: number): void {
    const manager = canvasManagers.get(currentPage)
    if (manager) {
      manager.addText(text, x, y)
    }
  }

  // 외부 API: 텍스트 확인 (textMode의 pendingPosition 사용)
  export function confirmTextOnCurrentPage(text: string): void {
    const manager = canvasManagers.get(currentPage)
    if (manager) {
      manager.confirmText(text)
    }
  }

  // 외부 API: 텍스트 취소
  export function cancelTextOnCurrentPage(): void {
    const manager = canvasManagers.get(currentPage)
    if (manager) {
      manager.cancelText()
    }
  }

  // 외부 API: 선택된 아이템 삭제
  export function deleteSelected(): void {
    const manager = canvasManagers.get(currentPage)
    if (manager) {
      manager.deleteSelected()
    }
  }

  // 외부 API: 현재 페이지 가져오기
  export function getCurrentPage(): number {
    return currentPage
  }

  // 외부 API: Undo
  export function undo(): boolean {
    const manager = canvasManagers.get(currentPage)
    if (manager) {
      const result = manager.undo()
      updateUndoRedoState()
      return result
    }
    return false
  }

  // 외부 API: Redo
  export function redo(): boolean {
    const manager = canvasManagers.get(currentPage)
    if (manager) {
      const result = manager.redo()
      updateUndoRedoState()
      return result
    }
    return false
  }

  // 외부 API: Undo 가능 여부
  export function getCanUndo(): boolean {
    return canUndoState
  }

  // 외부 API: Redo 가능 여부
  export function getCanRedo(): boolean {
    return canRedoState
  }

  // 외부 API: 특정 페이지로 스크롤
  export function scrollToPage(pageNum: number): void {
    if (pageNum < 1 || pageNum > totalPages) return

    const pageContainer = pageContainers.get(pageNum)
    if (pageContainer && scrollContainer) {
      // 페이지 컨테이너의 위치로 스크롤
      const containerRect = scrollContainer.getBoundingClientRect()
      const pageRect = pageContainer.getBoundingClientRect()
      const scrollTop = scrollContainer.scrollTop + pageRect.top - containerRect.top - 16 // 16px 패딩

      scrollContainer.scrollTo({
        top: scrollTop,
        behavior: 'smooth'
      })
    }
  }

  // 외부 API: 스크롤 컨테이너 요소 반환
  export function getScrollContainer(): HTMLElement | null {
    return scrollContainer
  }

  onMount(async () => {
    if (!scrollContainer || !pdfDoc) return

    // 부모 컴포넌트에 스크롤 컨테이너 DOM 요소 전달
    onReady?.(scrollContainer)

    // History manager 초기화 (읽기 전용이 아닐 때만)
    if (!isReadOnly) {
      historyManager = createHistoryManager({
        maxHistorySize: 20,
        debounceMs: 300,
        onHistoryChange: updateUndoRedoState
      })
    }

    // 페이지 치수 먼저 로드
    await loadAllPageDimensions()

    // Scroll mode 초기화
    scrollMode = createScrollMode({
      getPdfDoc: () => pdfDoc,
      getTotalPages: () => totalPages,
      getViewportScale: () => viewportScale,
      onPageRendered: handlePageRendered,
      onPageUnrendered: handlePageUnrendered,
      onCurrentPageChange: (page) => {
        currentPage = page
        onPageChange?.(page)
      }
    })

    scrollMode.initialize(scrollContainer)

    // 이미 렌더링된 페이지 컨테이너들을 등록
    await tick()
    pageContainers.forEach((element, pageNum) => {
      scrollMode?.registerPage(pageNum, element)
    })

    // 초기 뷰포트에 있는 페이지 렌더링
    scrollMode.triggerInitialRender()
  })

  /**
   * 빠른 스크롤(>1500px/s) 중 root에 .fast-scrolling 클래스 부착 →
   * CSS가 toolbar·sidebar·panel의 backdrop-filter를 일시 비활성해 60fps 보호 (design.md §3.5·§5.4).
   * scrollMode.isScrollingFast가 idle 감지 시 자동 false로 돌아오므로 클래스도 자동 해제.
   */
  $effect(() => {
    if (!scrollMode) return
    const fast = scrollMode.isScrollingFast
    document.documentElement.classList.toggle('fast-scrolling', fast)
  })

  onDestroy(() => {
    // 문서 교체·상위 뷰어 해제 중 첫 페이지가 아직 렌더되지 않았으면 대기자를 반드시 깨운다.
    // 그렇지 않으면 이전 load 요청의 completePostMessageLoad가 영구 대기하며 수명주기를 붙잡는다.
    markFirstPageFailed(new Error('PDF viewer was destroyed before the first page became ready'))

    // 모든 캔버스 데이터 저장 (1.0x baseline JSON)
    canvasManagers.forEach((manager, pageNum) => {
      const json = manager.exportJSON()
      if (json) {
        canvasDataStore.set(pageNum, json)
      }
    })

    canvasManagers.forEach(manager => manager.dispose())
    canvasManagers.clear()

    // User overlay 인스턴스 정리
    userOverlayInstances.forEach(overlay => overlay.dispose())
    userOverlayInstances.clear()

    // History manager 정리
    historyManager?.dispose()
    historyManager = null

    // Scroll mode 정리
    scrollMode?.dispose()

    // 잔존 fast-scrolling 클래스 제거 — unmount 직전 fast 상태로 끝났을 가능성
    document.documentElement.classList.remove('fast-scrolling')
  })

  // 페이지 배열 생성
  const pageNumbers = $derived(Array.from({ length: totalPages }, (_, i) => i + 1))
</script>

<div
  class="scroll-viewer"
  class:editing-active={isEditingActive}
  class:select-mode={isSelectMode}
  class:text-mode={isTextMode}
  class:previewing-history={isPreviewingHistory}
  bind:this={scrollContainer}
>
  <div class="scroll-content">
    {#each pageNumbers as pageNum (pageNum)}
      {@const baseDims = pageBaseDimensions.get(pageNum)}
      {@const isRendered = renderedPages.has(pageNum)}
      {@const visualW = baseDims ? Math.floor(baseDims.width * viewportScale) : Math.floor(612 * viewportScale)}
      {@const visualH = baseDims ? Math.floor(baseDims.height * viewportScale) : Math.floor(792 * viewportScale)}

      <div
        class="scroll-page-container"
        data-page={pageNum}
        style:width={`${visualW}px`}
        style:height={`${visualH}px`}
        use:pageContainerAction={pageNum}
      >
        {#if isRendered}
          <!-- PDF Canvas (base layer) -->
          <canvas
            class="scroll-page-canvas-pdf"
            use:pdfCanvasAction={pageNum}
          ></canvas>

          <!-- User Overlay Container -->
          <div
            class="scroll-page-overlay-container"
            use:overlayContainerAction={pageNum}
          ></div>

          <!-- Paper.js Canvas (editing layer) -->
          {#if !isReadOnly}
            <canvas
              class="scroll-page-canvas-paper"
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
    color: var(--color-text-muted);
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
    background: rgba(0, 0, 0, 0.5);
    color: var(--color-text-inverse);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    z-index: 1;
  }
</style>
