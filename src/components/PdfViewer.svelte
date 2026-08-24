<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte'
  import type { ToolMode, OrientationMode, UserCanvasInfo, PdfOutlineNode } from '../types'
  import { createPdfLoader } from '../lib/pdf/pdfLoader.svelte'
  import { createPageNavigation } from '../lib/pdf/pageNavigation.svelte'
  import { extractOutline } from '../lib/pdf/pdfOutline'
  import { createZoomControl, ZOOM_MIN_SCALE, ZOOM_MAX_SCALE } from '../lib/interaction/zoomControl.svelte'
  import { captureZoomAnchor, applyZoomAnchor } from '../lib/interaction/zoomAnchor'
  import { createBrushSettings } from '../lib/tools/brushSettings.svelte'
  import { createCanvasState } from '../lib/canvas/canvasState.svelte'
  import { createPinchZoom } from '../lib/interaction/pinchZoom.svelte'
  import { createTouchActionManager, getTouchActionForTool } from '../lib/utils/touchActionManager'
  import { createLowResPreview } from '../lib/scroll/lowResPreview.svelte'
  import { initPointerTracking } from '../lib/utils/inputDetection'
  import { loadHistory, appendHistory, toUserCanvasInfoList } from '../lib/storage/canvasHistoryStore'
  import {
    isInIframe,
    initPostMessageBridge,
    sendPdfLoaded,
    sendCanvasDataChanged,
    sendSaveCanvasResponse,
    sendCloseRequest,
    sendSetOrientation
  } from '../lib/bridge/postMessageBridge'
  import type { PostMessageBridgeCallbacks } from '../lib/bridge/postMessageBridge'
  import { reportError, reportInfo, reportWarning } from '../lib/utils/errorReporter.svelte'
  import { applyTheme } from '../lib/config/applyTheme'
  import { setLocale, setMessages, t } from '../lib/i18n/index.svelte'
  import PdfToolbar from './PdfToolbar.svelte'
  import PdfScrollViewer from './PdfScrollViewer.svelte'
  import PdfThumbnailList from './PdfThumbnailList.svelte'
  import TextInputOverlay from './TextInputOverlay.svelte'
  import UserCanvasDataList from './UserCanvasDataList.svelte'
  import PdfOutlinePanel from './PdfOutlinePanel.svelte'
  import ToolHint from './ToolHint.svelte'
  import ToolOptionsSheet from './ToolOptionsSheet.svelte'
  import type { ToolSheetKind } from './ToolOptionsSheet.svelte'

  // Props
  interface Props {
    initialPdfUrl?: string
    isReadOnly?: boolean
  }

  let { initialPdfUrl = '', isReadOnly = false }: Props = $props()

  // State modules
  const pdfLoader = createPdfLoader()
  const pageNav = createPageNavigation({
    onPageChange: handlePageChange
  })
  const zoomControl = createZoomControl({
    onZoomChange: handleZoomChange
  })
  const brushSettings = createBrushSettings()
  const canvasState = createCanvasState({
    getScope: () => null  // Not used in scroll mode
  })

  // 저해상도 프리뷰 시스템
  const lowResPreview = createLowResPreview()

  // Gesture modules
  /** 연속 제스처(핀치·휠) 스케일을 5% 스텝으로 스냅 — 임의 스케일 난립으로 인한 렌더 캐시 오염 방지 */
  function snapScale(scale: number): number {
    return Math.round(scale * 20) / 20
  }

  // 핀치 시작 시점의 페이지 앵커 — 종료 시 스케일 반영 후 스크롤 보정에 사용
  // (프리뷰 transform이 걸린 상태에서는 getBoundingClientRect가 왜곡되므로 시작 시점에 캡처)
  let pinchAnchor: ReturnType<typeof captureZoomAnchor> = null

  const pinchZoom = createPinchZoom({
    minScale: ZOOM_MIN_SCALE,
    maxScale: ZOOM_MAX_SCALE,
    getScrollContainer: () => scrollViewerElement,
    getContentElement: () => scrollContentElement,
    onZoomStart: (focalPoint) => {
      pinchAnchor = scrollViewerElement
        ? captureZoomAnchor(scrollViewerElement, focalPoint.clientX, focalPoint.clientY)
        : null
    },
    onZoomChange: (scale) => {
      // CSS transform preview is handled internally
    },
    onZoomEnd: async (finalScale, finalFocalPoint) => {
      hasUserZoomed = true // 핀치도 수동 줌 — 리사이즈 시 fit-width 재적용 안 함
      const container = scrollViewerElement
      const oldScale = zoomControl.scale
      const anchor = pinchAnchor
      pinchAnchor = null

      zoomControl.setScale(snapScale(finalScale))
      if (!container || !anchor) return

      await tick() // 새 스케일의 페이지 크기 반영 대기
      // 시작 시 손가락 아래 있던 지점이 마지막 손가락 위치로 오도록 보정 — 팬(이동) 성분 포함
      applyZoomAnchor(
        container,
        { ...anchor, clientX: finalFocalPoint.clientX, clientY: finalFocalPoint.clientY },
        zoomControl.scale / oldScale
      )
    }
  })

  // Touch action manager
  const touchActionManager = createTouchActionManager()

  // UI State
  let currentTool = $state<ToolMode>('select')
  let currentOrientation = $state<OrientationMode>('portrait')
  let showThumbnails = $state(true)
  let isTextInputVisible = $state(false)
  let textInputInitialText = $state('')
  let isHistoryPanelVisible = $state(false)

  // 책갈피(PDF 내장 목차) — 문서에서 파생되는 읽기 전용 정보이므로 저장·왕복 대상이 아님
  let outline = $state<PdfOutlineNode[]>([])
  let isOutlineLoading = $state(false)
  let isOutlinePanelVisible = $state(false)
  let hasOutline = $derived(outline.length > 0)

  // User canvas data
  let userCanvasData = $state<UserCanvasInfo[]>([])
  let hasUserCanvasData = $derived(userCanvasData.length > 0)
  // 현재 편집 캔버스에 로드된 작업이력 항목의 canvasId — userOverlay 중복 렌더 방지용
  let currentEditCanvasId = $state<string>('')
  // 버전 이력 모드 — standalone localStorage 이력 또는 공개 SDK 목록의 isCurrent 신호로 활성화.
  // isCurrent가 없는 공개 목록은 기존 다중 검토 레이어로 유지한다.
  let isVersionHistoryMode = $state(false)

  // 호스트 커스터마이징 (SDK applyConfig) — 미지정 시 기본값 유지
  let brandLogoUrl = $state<string>('')
  let enabledTools = $state<ToolMode[] | null>(null)   // null = 전체 노출
  let toolFeatures = $state<Record<string, boolean>>({})

  const TOOL_MODES: readonly ToolMode[] = [
    'select', 'pen', 'highlighter', 'eraser', 'text', 'rectangle', 'circle', 'line'
  ]

  /** 공개 SDK의 enabled 목록을 실제 ToolMode만 남기고 정규화 */
  function normalizeEnabledTools(value: unknown): ToolMode[] | null {
    if (!Array.isArray(value)) return null
    const normalized: ToolMode[] = []
    value.forEach((candidate) => {
      if (candidate === 'shape') {
        ;(['rectangle', 'circle', 'line'] as ToolMode[]).forEach((shape) => {
          if (!normalized.includes(shape)) normalized.push(shape)
        })
      } else if (TOOL_MODES.includes(candidate as ToolMode) && !normalized.includes(candidate as ToolMode)) {
        normalized.push(candidate as ToolMode)
      }
    })
    return normalized
  }

  /** SDK applyConfig 수신 — 테마·다국어·도구 구성 적용 */
  function applyViewerConfig(config: any): void {
    if (!config || typeof config !== 'object') return
    applyTheme(config.theme)
    if (config.theme && typeof config.theme.logoUrl === 'string') brandLogoUrl = config.theme.logoUrl
    setLocale(config.locale)
    setMessages(config.messages)
    const tcfg = config.tools
    if (tcfg && typeof tcfg === 'object') {
      const nextEnabled = normalizeEnabledTools(tcfg.enabled)
      if (nextEnabled) {
        enabledTools = nextEnabled
      }
      if (tcfg.features && typeof tcfg.features === 'object') {
        toolFeatures = tcfg.features as Record<string, boolean>
        if (tcfg.features.thumbnails === false) showThumbnails = false
        if (tcfg.features.bookmarks === false) isOutlinePanelVisible = false
      }
      const requestedDefault = typeof tcfg.defaultTool === 'string' && TOOL_MODES.includes(tcfg.defaultTool as ToolMode)
        ? tcfg.defaultTool as ToolMode
        : null
      const activeEnabled = nextEnabled ?? enabledTools
      if (requestedDefault && (!activeEnabled || activeEnabled.includes(requestedDefault))) {
        currentTool = requestedDefault
      } else if (nextEnabled && !nextEnabled.includes(currentTool) && nextEnabled.length > 0) {
        currentTool = nextEnabled[0]!
      }
      if (typeof tcfg.defaultColor === 'string') brushSettings.setColor(tcfg.defaultColor)
      if (typeof tcfg.defaultWidth === 'number') brushSettings.setWidth(tcfg.defaultWidth)
    }
  }

  // Selection state
  let hasSelection = $state(false)

  // Undo/Redo 상태 — PdfScrollViewer에서 콜백으로 동기화, PdfToolbar 버튼 활성에 사용
  let canUndo = $state(false)
  let canRedo = $state(false)

  function handleUndo() {
    scrollViewerComponent?.undo()
  }

  function handleRedo() {
    scrollViewerComponent?.redo()
  }

  /**
   * 키보드 단축키 — Ctrl+Z(Cmd+Z): undo, Ctrl+Y 또는 Ctrl+Shift+Z(Cmd+Shift+Z): redo
   * Ctrl +/−: 줌, Ctrl+0: fit-width 복귀 (줌은 readOnly에서도 동작, 브라우저 페이지 줌 대체)
   * 텍스트 입력 중에는 가로채지 않음 (textarea의 기본 undo/redo 우선)
   */
  function handleGlobalKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    )) {
      return
    }
    const cmd = e.ctrlKey || e.metaKey
    if (!cmd) return

    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      zoomAnchoredTo(zoomControl.scale + zoomControl.step)
      return
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      zoomAnchoredTo(zoomControl.scale - zoomControl.step)
      return
    }
    if (e.key === '0') {
      e.preventDefault()
      hasUserZoomed = false // fit 모드 복귀 — 이후 리사이즈에도 fit 유지
      applyFitWidth()
      return
    }

    if (isReadOnly) return

    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault()
      if (e.shiftKey) {
        if (canRedo) handleRedo()
      } else {
        if (canUndo) handleUndo()
      }
    } else if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault()
      if (canRedo) handleRedo()
    }
  }

  // 도구 옵션 시트 — 한 시점에 한 시트만 열림
  let openSheetKind = $state<ToolSheetKind | null>(null)
  let sheetAnchorLeft = $state(0)
  let sheetAnchorTop = $state(56)

  /** 도구 클릭 시 호출 — 같은 종류 시트면 닫고, 다른 종류면 열기 */
  function handleToggleToolOptions(kind: ToolSheetKind, left: number, top: number) {
    if (openSheetKind === kind) {
      openSheetKind = null
    } else {
      sheetAnchorLeft = left
      sheetAnchorTop = top
      openSheetKind = kind
    }
  }

  function handlePressureSensitivityChange(v: number) {
    brushSettings.setPressureSensitivity(v)
  }

  function handleSheetClose() {
    openSheetKind = null
  }

  /** 시트의 brushWidth — 텍스트 도구일 때는 fontSize, 그 외는 brushSettings.width */
  let sheetBrushWidth = $derived(
    openSheetKind === 'text' ? brushSettings.fontSize : brushSettings.width
  )

  /** 시트 너비 변경 핸들러 — 텍스트는 fontSize 변경, 그 외는 width 변경 */
  function handleSheetWidthChange(v: number) {
    if (openSheetKind === 'text') {
      brushSettings.setFontSize(v)
    } else {
      brushSettings.setWidth(v)
    }
  }

  /** 색상 프리셋 — 모든 도구 9색 통일 (사용자가 원하는 색은 custom picker로) */
  let sheetColorPresets = $derived<string[]>(brushSettings.colorPresets)

  /** 도구별 굵기/크기 프리셋 — 형광펜은 굵게, 텍스트는 폰트 크기, 그 외는 일반 */
  const PEN_WIDTHS = [1, 2, 4, 6, 8, 12]
  const HIGHLIGHTER_WIDTHS = [12, 16, 20, 24, 32]
  const FONT_SIZES = [12, 16, 20, 24, 32, 48]
  let sheetWidthPresets = $derived<number[]>(
    openSheetKind === 'highlighter' ? HIGHLIGHTER_WIDTHS :
    openSheetKind === 'text' ? FONT_SIZES :
    PEN_WIDTHS
  )

  // Tool hint state
  let toolHintMessage = $state('')
  let isToolHintVisible = $state(false)
  let toolHintTimer: ReturnType<typeof setTimeout> | null = null

  // DOM refs
  let scrollViewerElement: HTMLElement | null = $state(null)
  let scrollContentElement: HTMLElement | null = $state(null)
  let scrollViewerComponent: PdfScrollViewer | null = $state(null)

  // 핀치 줌 제스처 연결 — scrollViewerElement 최초 할당 시 실행
  // untrack: pinchZoom.attach() 내부에서 $state(targetElement) 쓰기가
  // 이 effect를 재트리거하여 무한 루프를 유발하는 것을 방지
  // (panGesture는 네이티브 스크롤과 충돌하여 제거됨, MEMORY.md 참조)
  $effect(() => {
    const element = scrollViewerElement
    if (element) {
      untrack(() => {
        pinchZoom.attach(element)
      })
    }
  })

  /**
   * Ctrl+휠 줌 — 커서 위치 앵커. preventDefault로 브라우저 페이지 줌 유출 차단 (passive: false 필수)
   * 트랙패드 핀치(ctrlKey 합성 wheel)도 이 경로로 수렴. 일반 휠은 네이티브 스크롤 유지
   * 트랙패드의 미세 delta는 스냅 스텝(5%)보다 작아 목표 스케일을 누적한 뒤 스냅해 적용
   */
  let wheelTargetScale: number | null = null
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null

  function handleWheelZoom(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    // deltaMode LINE(휠 단위 브라우저) 보정 후 지수 스케일 — 입력 속도와 무관하게 균일한 감도
    const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY
    const factor = Math.exp(-delta * 0.002)

    const base = wheelTargetScale ?? zoomControl.scale
    wheelTargetScale = Math.max(zoomControl.minScale, Math.min(zoomControl.maxScale, base * factor))
    zoomAnchoredTo(snapScale(wheelTargetScale), e.clientX, e.clientY)

    // 입력 멈춤 후 누적 목표 초기화 — 다음 제스처는 실제 스케일에서 시작
    if (wheelIdleTimer) clearTimeout(wheelIdleTimer)
    wheelIdleTimer = setTimeout(() => {
      wheelIdleTimer = null
      wheelTargetScale = null
    }, 300)
  }

  // 더블탭(터치)·더블클릭(마우스) 줌 — select 도구·읽기 전용에서만 (드로잉 도구와 충돌 방지)
  let tapCandidate = false
  let tapStartX = 0
  let tapStartY = 0
  let lastTapTime = 0
  let lastTapX = 0
  let lastTapY = 0

  function canDoubleTapZoom(): boolean {
    return isReadOnly || currentTool === 'select'
  }

  /** 더블탭 줌 토글 — fit 근처면 탭 지점 2배 확대, 이미 확대 상태면 fit-width 복귀 */
  function toggleDoubleTapZoom(clientX: number, clientY: number) {
    if (zoomControl.scale > fitWidthScale * 1.25) {
      zoomAnchoredTo(fitWidthScale, clientX, clientY).then(() => {
        hasUserZoomed = false // fit 복귀 — 이후 리사이즈에도 fit 유지
      })
    } else {
      zoomAnchoredTo(fitWidthScale * 2, clientX, clientY)
    }
  }

  /** 탭 후보 추적 시작 — 단일 터치만, 드로잉 도구에서는 비활성 */
  function handleTouchStartForTap(e: TouchEvent) {
    if (e.touches.length !== 1 || !canDoubleTapZoom()) {
      tapCandidate = false
      return
    }
    tapCandidate = true
    tapStartX = e.touches[0]!.clientX
    tapStartY = e.touches[0]!.clientY
  }

  /** 이동량 10px 초과 시 드래그(스크롤)로 판정하고 탭 후보 해제 */
  function handleTouchMoveForTap(e: TouchEvent) {
    if (!tapCandidate) return
    const t = e.touches[0]
    if (!t || e.touches.length !== 1 ||
        Math.abs(t.clientX - tapStartX) > 10 || Math.abs(t.clientY - tapStartY) > 10) {
      tapCandidate = false
    }
  }

  /** 300ms·30px 이내 연속 탭이면 더블탭 줌 실행 */
  function handleTouchEndForTap(e: TouchEvent) {
    if (!tapCandidate || e.touches.length > 0) {
      tapCandidate = false
      return
    }
    tapCandidate = false
    const t = e.changedTouches[0]
    if (!t) return

    const now = Date.now()
    const isDouble = now - lastTapTime < 300 &&
      Math.abs(t.clientX - lastTapX) < 30 &&
      Math.abs(t.clientY - lastTapY) < 30
    if (isDouble) {
      lastTapTime = 0
      toggleDoubleTapZoom(t.clientX, t.clientY)
    } else {
      lastTapTime = now
      lastTapX = t.clientX
      lastTapY = t.clientY
    }
  }

  function handleDblClickZoom(e: MouseEvent) {
    if (!canDoubleTapZoom()) return
    toggleDoubleTapZoom(e.clientX, e.clientY)
  }

  // 휠·더블탭 줌 리스너 — scrollViewerElement 변경 시 재부착, effect cleanup으로 해제
  $effect(() => {
    const element = scrollViewerElement
    if (!element) return

    element.addEventListener('wheel', handleWheelZoom, { passive: false })
    element.addEventListener('touchstart', handleTouchStartForTap, { passive: true })
    element.addEventListener('touchmove', handleTouchMoveForTap, { passive: true })
    element.addEventListener('touchend', handleTouchEndForTap, { passive: true })
    element.addEventListener('dblclick', handleDblClickZoom)

    return () => {
      element.removeEventListener('wheel', handleWheelZoom)
      element.removeEventListener('touchstart', handleTouchStartForTap)
      element.removeEventListener('touchmove', handleTouchMoveForTap)
      element.removeEventListener('touchend', handleTouchEndForTap)
      element.removeEventListener('dblclick', handleDblClickZoom)
    }
  })

  // 도구/readOnly 변경 → touch-action CSS 모드 전환
  // 드로잉 도구: touch-action: none (Paper.js가 터치 처리)
  // 선택 도구: touch-action: pan-y pan-x (네이티브 스크롤 허용)
  // untrack: touchActionManager 내부 상태 변경이 이 effect를 재트리거하지 않도록 방지
  $effect(() => {
    const element = scrollViewerElement
    const tool = currentTool
    const readOnly = isReadOnly

    if (element) {
      const touchMode = getTouchActionForTool(tool, readOnly)
      untrack(() => {
        touchActionManager.setMode(touchMode)
        touchActionManager.setElement(element)
      })
    }
  })

  // 줌 컨트롤 → 핀치 줌 스케일 동기화
  // 핀치 중에는 동기화 건너뜀 (핀치 줌이 스케일의 소유권을 가짐)
  $effect(() => {
    if (pinchZoom.currentScale !== zoomControl.scale && !pinchZoom.isPinching) {
      pinchZoom.setScale(zoomControl.scale)
    }
  })

  // Handle page change from scroll viewer
  function handlePageChange(newPage: number) {
    pageNav.setCurrentPage(newPage)
    // 페이지 전환 시 이전 페이지 선택 상태는 의미 없음 → 삭제 버튼 잔존 방지
    if (hasSelection) {
      hasSelection = false
    }
  }

  // Handle zoom change
  function handleZoomChange(newScale: number) {
    // Scale change handled reactively
  }

  /**
   * 앵커 유지 줌 — 앵커 지점(미지정 시 뷰포트 중앙)이 화면상 같은 위치에 남도록 스크롤 보정
   * 툴바 버튼·휠·키보드·더블탭 등 핀치 외 모든 줌 경로의 공통 진입점
   * 직렬화 큐: 연속 호출(휠 연타) 시 앵커 캡처와 적용이 교차되지 않도록 보장
   */
  let zoomQueue: Promise<void> = Promise.resolve()
  function zoomAnchoredTo(targetScale: number, clientX?: number, clientY?: number): Promise<void> {
    zoomQueue = zoomQueue.then(() => performAnchoredZoom(targetScale, clientX, clientY))
    return zoomQueue
  }

  async function performAnchoredZoom(targetScale: number, clientX?: number, clientY?: number) {
    hasUserZoomed = true // 수동 줌 이후에는 리사이즈 시 fit-width 재적용 안 함
    const container = scrollViewerElement
    const oldScale = zoomControl.scale
    const newScale = Math.max(zoomControl.minScale, Math.min(zoomControl.maxScale, targetScale))
    if (!container || newScale === oldScale) {
      zoomControl.setScale(targetScale)
      return
    }

    const anchor = captureZoomAnchor(container, clientX, clientY)
    zoomControl.setScale(newScale)
    if (!anchor) return

    await tick() // 새 스케일의 페이지 크기 반영 대기
    applyZoomAnchor(container, anchor, newScale / oldScale)
  }

  // Fit-width 상태 — 수동 줌 전까지 컨테이너 크기 변화(회전·리사이즈)에 fit 유지
  let hasUserZoomed = false
  let fitWidthScale = 1 // 더블탭 줌 토글의 복귀 기준
  let fitResizeObserver: ResizeObserver | null = null
  let fitResizeTimer: ReturnType<typeof setTimeout> | null = null

  /** fit-width 적용 — 1페이지 기준 너비를 스크롤 컨테이너 가용 너비에 맞춤 */
  async function applyFitWidth(): Promise<void> {
    const container = scrollViewerElement
    const doc = pdfLoader.document
    if (!container || !doc) return

    try {
      const page = await doc.getPage(1)
      const baseWidth = page.getViewport({ scale: 1 }).width
      if (baseWidth <= 0) return

      // scroll-content 좌우 padding 제외한 가용 너비 (측정 실패 시 32px 가정)
      let padding = 32
      if (scrollContentElement) {
        const cs = getComputedStyle(scrollContentElement)
        padding = (parseFloat(cs.paddingLeft) || 16) + (parseFloat(cs.paddingRight) || 16)
      }
      const available = container.clientWidth - padding
      if (available <= 0) return

      fitWidthScale = Math.max(zoomControl.minScale, Math.min(zoomControl.maxScale, available / baseWidth))
      zoomControl.setScale(fitWidthScale)
    } catch (error) {
      console.warn('[PdfViewer] fit-width 계산 실패:', error)
    }
  }

  /** 컨테이너 리사이즈(회전 포함) 감시 — 수동 줌 전에는 fit-width 재적용 */
  function observeFitResize(element: HTMLElement): void {
    fitResizeObserver?.disconnect()
    fitResizeObserver = new ResizeObserver(() => {
      if (fitResizeTimer) clearTimeout(fitResizeTimer)
      // 디바운스 — 연속 리사이즈 중 재렌더 연발 방지
      fitResizeTimer = setTimeout(() => {
        fitResizeTimer = null
        if (!hasUserZoomed) applyFitWidth()
      }, 150)
    })
    fitResizeObserver.observe(element)
  }

  // Tool hint helpers
  function showToolHint(message: string) {
    if (toolHintTimer) clearTimeout(toolHintTimer)
    toolHintMessage = message
    isToolHintVisible = true
    toolHintTimer = setTimeout(() => {
      isToolHintVisible = false
      toolHintTimer = null
    }, 3000)
  }

  function hideToolHint() {
    if (toolHintTimer) {
      clearTimeout(toolHintTimer)
      toolHintTimer = null
    }
    isToolHintVisible = false
  }

  // Handle tool change
  function handleToolChange(tool: ToolMode) {
    // 선택 모드를 벗어나면 선택 상태 초기화
    if (currentTool === 'select' && tool !== 'select') {
      hasSelection = false
    }

    // 도구 전환 시 다른 종류 시트는 닫기 (같은 시트 종류면 그대로 유지 — handleToolClick에서 토글 처리)
    // 단, 시트 종류가 같은 경우(예: rectangle ↔ circle ↔ line은 모두 'shape')는 그대로 유지

    currentTool = tool
    // touch-action 모드는 $effect에서 자동 업데이트됨

    // 형광펜 선택 시 기본 색상/폭 자동 설정
    if (tool === 'highlighter') {
      brushSettings.setColor('#FFFF00')
      brushSettings.setWidth(20)
    }

    // 텍스트 도구 선택 시 힌트 표시, 다른 도구 선택 시 숨김
    if (tool === 'text') {
      showToolHint(t('viewer.tapToPlaceText'))
    } else {
      hideToolHint()
    }
  }

  // Handle delete selected item
  function handleDeleteSelected() {
    scrollViewerComponent?.deleteSelected()
    hasSelection = false
  }

  // Handle canvas change from scroll viewer
  function handleCanvasChange(pageNum: number, json: string) {
    canvasState.setPageData(pageNum, json)

    // iframe SDK의 onChange 계약 — 변경된 한 페이지만이 아니라 저장과 동일한 전체
    // canvasData 스냅샷을 전달해 호스트 자동저장이 곧바로 복원 가능한 값을 받도록 보장.
    if (bridgeMode === 'postMessage' && scrollViewerComponent) {
      const dataObj: Record<number, string> = {}
      scrollViewerComponent.getAllCanvasData().forEach((pageJson, page) => {
        dataObj[page] = pageJson
      })
      sendCanvasDataChanged(JSON.stringify(dataObj))
    }
  }

  // Handle text input request
  function handleTextInputRequest(existingText?: string) {
    hideToolHint()
    textInputInitialText = existingText || ''
    isTextInputVisible = true
  }

  // Handle text input confirm
  function handleTextConfirm(text: string) {
    isTextInputVisible = false
    scrollViewerComponent?.confirmTextOnCurrentPage(text)
  }

  // Handle text input cancel
  function handleTextCancel() {
    isTextInputVisible = false
    scrollViewerComponent?.cancelTextOnCurrentPage()
  }

  /** 저장: Map<페이지번호, JSON> → Record 변환 후 브릿지 모드별 전달 */
  function handleSave() {
    if (!scrollViewerComponent || isReadOnly) return

    let canvasDataStr: string
    let dataObj: Record<number, string>
    try {
      const allData = scrollViewerComponent.getAllCanvasData()
      // Map → Record 변환 (JSON 직렬화를 위한 plain object)
      dataObj = {}
      allData.forEach((json, pageNum) => {
        dataObj[pageNum] = json
      })
      canvasDataStr = JSON.stringify(dataObj)
    } catch (e) {
      const message = t('viewer.saveDataError')
      reportError('parse', message, e)
      if (bridgeMode === 'postMessage') {
        sendSaveCanvasResponse('', false, message)
      }
      return
    }

    // standalone(localhost) 모드: localStorage에 append-only로 새 버전 저장
    if (useLocalStorageHistory) {
      try {
        const entry = appendHistory(pdfLoader.fileName, canvasDataStr)
        refreshLocalCanvasHistory()
        // 방금 저장한 버전이 새 편집 베이스라인 — userOverlay 제외 대상 갱신
        currentEditCanvasId = entry.canvasId
        // 방금 저장한 버전을 "이어서 편집" 활성 상태로 표시 — PDF 최초 로드 동작과 동일.
        // canvasState는 이미 저장한 데이터 그대로이므로 reload 없이 visibility 플래그만 갱신
        handleHistoryToggleVisibility(entry.canvasId, true)
        reportInfo(t('viewer.savedVersion', { version: entry.version }))
      } catch (e) {
        reportError('storage', t('viewer.saveFailed'), e)
      }
      return
    }

    if (bridgeMode === 'postMessage') {
      // iframe 모드: postMessage로 부모에게 Canvas 데이터 전달
      const ok = sendSaveCanvasResponse(canvasDataStr, true)
      if (ok) reportInfo(t('viewer.saveRequested'))
    } else {
      reportWarning('bridge', '저장은 iframe 호스트 SDK 또는 개발용 로컬 이력에서만 사용할 수 있습니다')
    }
  }

  // Handle close
  function handleClose() {
    if (bridgeMode === 'postMessage') {
      sendCloseRequest()
    }
  }

  // Handle orientation toggle
  function handleOrientationToggle() {
    const newOrientation: OrientationMode = currentOrientation === 'portrait' ? 'landscape' : 'portrait'
    console.log('[PdfViewer] handleOrientationToggle:', currentOrientation, '→', newOrientation, '(bridgeMode:', bridgeMode, ')')
    currentOrientation = newOrientation
    // 회전 시 도구 옵션 시트는 anchor 좌표가 무효화되므로 자동 닫음
    if (openSheetKind) {
      openSheetKind = null
    }

    if (bridgeMode === 'postMessage') {
      console.log('[PdfViewer] Sending setOrientation via postMessage:', newOrientation)
      sendSetOrientation(newOrientation)
    }
  }

  // 목차 추출 세대 토큰 — 연속 로드 시 이전 문서의 추출 결과가 뒤늦게 덮어쓰는 것을 차단
  let outlineToken = 0

  /**
   * 브라우저가 한가해질 때까지 양보 — 목차 추출은 부가 기능이므로
   * 첫 페이지 렌더(호스트가 pdfLoaded를 기다리는 임계 경로)보다 뒤로 물러난다.
   */
  function whenIdle(timeoutMs = 2000): Promise<void> {
    return new Promise((resolve) => {
      const ric = (window as any).requestIdleCallback
      if (typeof ric === 'function') ric(() => resolve(), { timeout: timeoutMs })
      else setTimeout(resolve, 0)
    })
  }

  /** PDF 로드 후 내장 목차 추출 — 실패·부재는 빈 목록으로 수렴(로드 자체를 실패시키지 않음) */
  async function refreshOutline(): Promise<void> {
    const token = ++outlineToken
    outline = []
    isOutlinePanelVisible = false

    const doc = pdfLoader.document
    if (!doc) {
      isOutlineLoading = false
      return
    }

    isOutlineLoading = true
    try {
      // 첫 페이지 렌더가 pdf.js 워커를 먼저 쓰도록 양보한 뒤 추출한다
      await whenIdle()
      if (token !== outlineToken) return
      const extracted = await extractOutline(doc)
      if (token !== outlineToken) return
      outline = extracted
    } catch (e) {
      if (token !== outlineToken) return
      // 목차는 부가 기능 — 실패해도 뷰어 사용을 막지 않는다
      console.warn('[PdfViewer] Failed to extract PDF outline:', e)
      outline = []
    } finally {
      if (token === outlineToken) isOutlineLoading = false
    }
  }

  /** 책갈피 패널 토글 — 이력 패널과 같은 우측 자리를 쓰므로 상호 배타 */
  function handleToggleOutline() {
    if (toolFeatures.bookmarks === false) return
    isOutlinePanelVisible = !isOutlinePanelVisible
    if (isOutlinePanelVisible) isHistoryPanelVisible = false
  }

  /** 목차 항목 클릭 — 해당 페이지로 이동. 패널은 연속 탐색을 위해 열어 둠 */
  function handleOutlineNavigate(page: number) {
    pageNav.goToPage(page)
    scrollViewerComponent?.scrollToPage(page)
  }

  // Handle thumbnail sidebar toggle
  function handleToggleThumbnails() {
    if (toolFeatures.thumbnails === false) return
    showThumbnails = !showThumbnails
  }

  /** 공개 clear 계약: 현재 페이지의 편집 레이어만 초기화 */
  function clearCurrentCanvas(): void {
    if (isReadOnly || !scrollViewerComponent) return
    const pageNum = scrollViewerComponent.getCurrentPage()
    canvasState.setPageData(pageNum, '')
    scrollViewerComponent.clearCanvas(pageNum)
  }

  // Handle thumbnail page change
  function handleThumbnailPageChange(page: number) {
    pageNav.goToPage(page)
    scrollViewerComponent?.scrollToPage(page)
  }

  // Handle history panel toggle
  function handleToggleHistory() {
    isHistoryPanelVisible = !isHistoryPanelVisible
    // 두 패널은 우측 같은 자리를 공유 — 겹쳐 뜨지 않도록 상호 배타
    if (isHistoryPanelVisible) isOutlinePanelVisible = false
  }

  // 버전 이력은 한 시점만 미리보기, 협업 레이어는 각 검토자를 독립 토글.
  function handleHistoryToggleVisibility(canvasId: string, visible: boolean) {
    if (isVersionHistoryMode) {
      // 라디오 선택처럼 항상 정확히 한 시점만 유지한다. 선택된 항목의 재클릭은 해제하지 않는다.
      if (!visible) return
      userCanvasData = userCanvasData.map(data => ({
        ...data,
        enabled: data.canvasId === canvasId
      }))
      return
    }

    userCanvasData = userCanvasData.map(data => {
      if (data.canvasId === canvasId) {
        return { ...data, enabled: visible }
      }
      return data
    })
  }

  // Handle history panel close
  function handleHistoryClose() {
    isHistoryPanelVisible = false
  }

  /** 작업이력을 편집 캔버스에 로드하여 이어서 편집 */
  function handleLoadHistory(canvasId: string): void {
    if (isReadOnly) return

    const historyItem = userCanvasData.find(
      d => d.canvasId === canvasId
    )
    if (!historyItem) return

    try {
      // canvasData 파싱: {"1": "[Layer,{...}]", "2": "[Layer,{...}]"}
      const parsed = typeof historyItem.canvasData === 'string'
        ? JSON.parse(historyItem.canvasData)
        : historyItem.canvasData

      if (!parsed || typeof parsed !== 'object') return

      // canvasState 동기화 (기존 초기 로드 패턴과 동일)
      canvasState.clearAll()
      Object.entries(parsed).forEach(([pageStr, json]) => {
        const pageNum = parseInt(pageStr)
        if (!isNaN(pageNum) && typeof json === 'string') {
          canvasState.setPageData(pageNum, json)
        }
      })

      // PdfScrollViewer에 이력 데이터 로드
      scrollViewerComponent?.loadHistoryCanvasData(parsed as Record<string, string>)

      // 편집 캔버스에 로드된 항목으로 마킹 — userOverlay가 이 항목을 제외해야 편집 동작이 즉시 반영됨
      currentEditCanvasId = canvasId

      // 이어서 편집 = 이 항목을 활성 상태로 표시 (단일 선택, 다른 항목 자동 해제)
      handleHistoryToggleVisibility(canvasId, true)

      // 이력 패널 닫기
      isHistoryPanelVisible = false
    } catch (e) {
      console.error('[PdfViewer] Failed to load history:', e)
    }
  }

  // Load PDF from URL
  async function loadPdfFromUrl(url: string, fileName?: string): Promise<boolean> {
    // 기존 프리뷰 정리
    lowResPreview.clearPreviews()

    const success = await pdfLoader.loadFromUrl(url, fileName)
    if (success && pdfLoader.document) {
      pageNav.setTotalPages(pdfLoader.totalPages)
      // 백그라운드에서 저해상도 프리뷰 생성
      lowResPreview.generateAllPreviews(pdfLoader.document)
      // 내장 목차 추출 — 렌더를 막지 않도록 await 하지 않음
      void refreshOutline()
      // standalone 모드: localStorage 저장이력을 작업이력 패널에 반영
      refreshLocalCanvasHistory()
    }
    return success && !!pdfLoader.document
  }

  // Load PDF from Base64
  async function loadPdfFromBase64(base64: string, fileName?: string): Promise<boolean> {
    // 기존 프리뷰 정리
    lowResPreview.clearPreviews()

    const success = await pdfLoader.loadFromBase64(base64, fileName)
    if (success && pdfLoader.document) {
      pageNav.setTotalPages(pdfLoader.totalPages)
      // 백그라운드에서 저해상도 프리뷰 생성
      lowResPreview.generateAllPreviews(pdfLoader.document)
      // 내장 목차 추출 — 렌더를 막지 않도록 await 하지 않음
      void refreshOutline()
      // standalone 모드: localStorage 저장이력을 작업이력 패널에 반영
      refreshLocalCanvasHistory()
    }
    return success && !!pdfLoader.document
  }

  /** SDK canvasData를 페이지별 Paper.js JSON 레코드로 엄격히 검증 */
  function parseCanvasDataRecord(canvasData: string): Record<string, string> {
    const parsed = JSON.parse(canvasData)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('canvasData must be a page-keyed object')
    }

    const normalized: Record<string, string> = {}
    Object.entries(parsed).forEach(([pageKey, pageJson]) => {
      const pageNum = Number(pageKey)
      if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pdfLoader.totalPages) {
        throw new TypeError(`invalid canvas page: ${pageKey}`)
      }
      if (typeof pageJson !== 'string') {
        throw new TypeError(`canvas page ${pageKey} must be a JSON string`)
      }
      JSON.parse(pageJson)
      normalized[String(pageNum)] = pageJson
    })
    return normalized
  }

  /** PDF 로드 후 복원 데이터를 먼저 주입하고 첫 페이지 실제 렌더까지 기다린 뒤 완료 통지 */
  async function completePostMessageLoad(success: boolean, canvasData?: string): Promise<void> {
    if (!success) return

    try {
      const restoredData = canvasData ? parseCanvasDataRecord(canvasData) : {}
      await tick()
      if (!scrollViewerComponent) throw new Error('PDF viewer did not mount')

      canvasState.clearAll()
      Object.entries(restoredData).forEach(([pageKey, pageJson]) => {
        canvasState.setPageData(Number(pageKey), pageJson)
      })
      scrollViewerComponent.loadHistoryCanvasData(restoredData)
      await scrollViewerComponent.waitUntilFirstPageReady()
      sendPdfLoaded()
    } catch (error) {
      reportError('render', 'PDF 편집 상태를 복원할 수 없습니다', error)
    }
  }

  /** 공개 overlay 스키마만 수용하며 빈 ID·중복 ID는 제외 */
  function normalizeUserCanvasData(data: unknown[]): UserCanvasInfo[] {
    const seen = new Set<string>()
    const result: UserCanvasInfo[] = []

    data.forEach((item) => {
      if (!item || typeof item !== 'object') return
      const candidate = item as Record<string, unknown>
      const canvasId = typeof candidate.canvasId === 'string' ? candidate.canvasId.trim() : ''
      if (!canvasId || seen.has(canvasId) || typeof candidate.canvasData !== 'string') return
      try {
        JSON.parse(candidate.canvasData)
      } catch {
        return
      }

      seen.add(canvasId)
      result.push({
        canvasId,
        userName: typeof candidate.userName === 'string' && candidate.userName.trim()
          ? candidate.userName
          : 'Unknown',
        userId: typeof candidate.userId === 'string' ? candidate.userId : '',
        canvasData: candidate.canvasData,
        enabled: candidate.enabled === true,
        color: typeof candidate.color === 'string' ? candidate.color : '',
        registeredAt: typeof candidate.registeredAt === 'string' && candidate.registeredAt.trim()
          ? candidate.registeredAt
          : typeof candidate.regDt === 'string' && candidate.regDt.trim()
            ? candidate.regDt
            : undefined,
        isCurrent: candidate.isCurrent === true
      })
    })

    return result
  }

  // Setup postMessage bridge (iframe 모드)
  function initPostMessageBridgeMode() {
    const callbacks: PostMessageBridgeCallbacks = {
      onLoadPdfBase64: async (base64, fileName, canvasData, readOnly) => {
        isReadOnly = readOnly ?? false
        const success = await loadPdfFromBase64(base64, fileName)
        await completePostMessageLoad(success, canvasData)
      },

      onLoadPdfFromUrl: async (url, fileName, canvasData, readOnly) => {
        isReadOnly = readOnly ?? true
        const success = await loadPdfFromUrl(url, fileName)
        await completePostMessageLoad(success, canvasData)
      },

      onLoadUserCanvasData: (data) => {
        console.log('[PdfViewer] Loaded user canvas data via postMessage:', data.length, 'items')
        const normalized = normalizeUserCanvasData(data)
        const current = normalized.find(item => item.isCurrent)

        if (current) {
          // isCurrent는 공개 버전 이력 모드의 명시적 옵트인이다.
          // 호스트가 보낸 enabled 값과 무관하게 현재 항목 하나만 선택한다.
          currentEditCanvasId = current.canvasId
          isVersionHistoryMode = true
          userCanvasData = normalized.map(item => ({
            ...item,
            enabled: item.canvasId === current.canvasId
          }))
        } else {
          // isCurrent가 없으면 기존 협업/검토 레이어의 독립 다중 선택 계약을 유지한다.
          userCanvasData = normalized
          currentEditCanvasId = ''
          isVersionHistoryMode = false
        }
      },

      onSaveCanvas: () => {
        handleSave()
      },

      onClearCanvas: () => {
        clearCurrentCanvas()
      },

      onApplyConfig: (config) => {
        applyViewerConfig(config)
      }
    }

    cleanupPostMessage = initPostMessageBridge(callbacks)
  }

  // Pointer tracking cleanup
  let cleanupPointerTracking: (() => void) | null = null

  // postMessage bridge cleanup (iframe 모드 전용)
  let cleanupPostMessage: (() => void) | null = null

  // landscape orientation listener cleanup
  let cleanupLandscapeListener: (() => void) | null = null

  // 공개 런타임은 iframe/postMessage, 직접 실행은 standalone 개발 모드
  let bridgeMode: 'standalone' | 'postMessage' = 'standalone'

  // standalone(브라우저 직접 실행) 모드 감지 — localStorage 기반 저장이력 사용
  // iframe 환경이 아닐 때 활성화
  // production 빌드에서는 무조건 false (사내 dev 서버를 localhost로 띄운 경우 등 차단)
  const useLocalStorageHistory =
    import.meta.env.MODE === 'development' &&
    typeof window !== 'undefined' &&
    window.self === window.top &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  /** localStorage 이력을 UserCanvasInfo 배열로 변환하여 작업이력 패널에 반영 */
  function refreshLocalCanvasHistory() {
    if (!useLocalStorageHistory) return
    const entries = loadHistory(pdfLoader.fileName)
    userCanvasData = toUserCanvasInfoList(entries)
    // localStorage 이력은 단일 사용자 append-only 버전 이력 — 정확히 한 시점만 선택한다.
    isVersionHistoryMode = userCanvasData.length > 0
  }

  onMount(async () => {
    // 전역 포인터 타입 추적 초기화 (S Pen vs 손가락 구분)
    cleanupPointerTracking = initPointerTracking()

    // iframe 안이면 공개 postMessage SDK, 직접 실행이면 standalone 개발 흐름
    if (isInIframe()) {
      bridgeMode = 'postMessage'
      initPostMessageBridgeMode()
      console.log('[PdfViewer] Bridge mode: postMessage (iframe)')
    } else {
      bridgeMode = 'standalone'
      console.log('[PdfViewer] Bridge mode: standalone')
    }

    // 가로모드 진입 시 썸네일 자동 접기 (세로 공간 극대화)
    const landscapeQuery = window.matchMedia('(orientation: landscape)')
    function onOrientationMediaChange(e: MediaQueryListEvent) {
      if (e.matches && showThumbnails) {
        showThumbnails = false
      }
    }
    landscapeQuery.addEventListener('change', onOrientationMediaChange)
    // 초기 가로모드 상태 확인: 이미 가로모드이면 썸네일 숨김
    if (landscapeQuery.matches && showThumbnails) {
      showThumbnails = false
    }
    cleanupLandscapeListener = () => landscapeQuery.removeEventListener('change', onOrientationMediaChange)

    // 초기 PDF 로드는 아래 $effect에서 처리 (initialPdfUrl이 비동기로 설정될 수 있음)
  })

  // initialPdfUrl 변화 감지 → 자동 로드
  // 빈 문자열에서 유효 URL로 전환되거나 URL이 바뀔 때만 로드 (브릿지 호출은 별도 경로)
  let lastLoadedInitialUrl = ''
  $effect(() => {
    const url = initialPdfUrl
    if (url && url !== lastLoadedInitialUrl) {
      untrack(() => {
        lastLoadedInitialUrl = url
        loadPdfFromUrl(url)
      })
    }
  })

  // PDF 로드 + 작업이력 존재 시 가장 최신 버전을 자동으로 "이어서 편집" 상태로 진입.
  // doc 인스턴스 단위로 1회만 — 같은 PDF에서 userCanvasData가 부분 업데이트되어도 재트리거 방지
  let autoLoadedDoc: unknown = null
  $effect(() => {
    const doc = pdfLoader.document
    const data = userCanvasData
    if (!doc) {
      untrack(() => {
        autoLoadedDoc = null
        currentEditCanvasId = ''
      })
      return
    }
    // 공개 SDK의 편집 상태 복원은 호스트가 initialCanvasData/loadPdf*로 통제한다.
    // 목록 첫 항목을 자동으로 편집 캔버스에 올리는 동작은 standalone localStorage에만 적용한다.
    if (!useLocalStorageHistory || !isVersionHistoryMode) return
    if (isReadOnly || data.length === 0) return
    if (autoLoadedDoc === doc) return
    untrack(async () => {
      autoLoadedDoc = doc
      // 다음 마이크로태스크에서 PdfScrollViewer가 마운트되며 bind:this 연결됨
      await tick()
      if (!scrollViewerComponent) return
      handleLoadHistory(data[0].canvasId)
    })
  })

  onDestroy(() => {
    cleanupPointerTracking?.()
    cleanupPostMessage?.()
    cleanupLandscapeListener?.()
    if (toolHintTimer) clearTimeout(toolHintTimer)
    pdfLoader.unload()
    pinchZoom.detach()
    touchActionManager.dispose()
    lowResPreview.clearPreviews()
    fitResizeObserver?.disconnect()
    fitResizeObserver = null
    if (fitResizeTimer) clearTimeout(fitResizeTimer)
    if (wheelIdleTimer) clearTimeout(wheelIdleTimer)
  })

  /** PdfScrollViewer의 onReady 콜백 — 스크롤 컨테이너 DOM 수신 후 핀치 줌 대상·fit-width 설정 */
  function handleScrollViewerRef(element: HTMLElement | null) {
    scrollViewerElement = element
    if (element) {
      scrollContentElement = element.querySelector('.scroll-content') as HTMLElement
      // 문서 (재)마운트 시 fit-width로 시작
      hasUserZoomed = false
      applyFitWidth()
      observeFitResize(element)
    } else {
      fitResizeObserver?.disconnect()
      fitResizeObserver = null
    }
  }
</script>

<svelte:window on:keydown={handleGlobalKeyDown} />

<div class="pdf-viewer-container">
  <!-- Toolbar -->
  <PdfToolbar
    currentTool={currentTool}
    currentPage={pageNav.currentPage}
    totalPages={pageNav.totalPages}
    scale={zoomControl.scale}
    brushColor={brushSettings.color}
    brushWidth={brushSettings.width}
    isReadOnly={isReadOnly}
    enabledTools={enabledTools}
    features={toolFeatures}
    logoUrl={brandLogoUrl}
    hasUserCanvasData={hasUserCanvasData}
    isHistoryPanelVisible={isHistoryPanelVisible}
    isOutlinePanelVisible={isOutlinePanelVisible}
    hasOutline={hasOutline}
    showThumbnails={showThumbnails}
    canUndo={canUndo}
    canRedo={canRedo}
    onUndo={handleUndo}
    onRedo={handleRedo}
    onOpenToolOptions={handleToggleToolOptions}
    orientation={currentOrientation}
    onToggleThumbnails={handleToggleThumbnails}
    onToggleOutline={handleToggleOutline}
    onOrientationToggle={handleOrientationToggle}
    onToolChange={handleToolChange}
    onPageChange={(page) => {
      pageNav.goToPage(page)
      scrollViewerComponent?.scrollToPage(page)
    }}
    onZoomIn={() => zoomAnchoredTo(zoomControl.scale + zoomControl.step)}
    onZoomOut={() => zoomAnchoredTo(zoomControl.scale - zoomControl.step)}
    onColorChange={(color) => brushSettings.setColor(color)}
    onWidthChange={(width) => brushSettings.setWidth(width)}
    onSave={handleSave}
    onToggleHistory={handleToggleHistory}
    fontSize={brushSettings.fontSize}
    onFontSizeChange={(size) => brushSettings.setFontSize(size)}
    hasSelection={hasSelection}
    onDeleteSelected={handleDeleteSelected}
  />

  <!-- Main viewer area -->
  <div class="viewer-content">
    {#if pdfLoader.isLoading}
      <div class="loading">
        <div class="spinner"></div>
        <p>PDF 로딩 중...</p>
      </div>
    {:else if pdfLoader.error}
      <div class="error">
        <p>오류: {pdfLoader.error}</p>
      </div>
    {:else if pdfLoader.document}
      {#if showThumbnails && toolFeatures.thumbnails !== false}
        <PdfThumbnailList
          pdfDocument={pdfLoader.document}
          currentPage={pageNav.currentPage}
          fileName={pdfLoader.fileName}
          onPageChange={handleThumbnailPageChange}
        />
      {/if}
      <ToolHint message={toolHintMessage} isVisible={isToolHintVisible} />
      {#key pdfLoader.document}
        <PdfScrollViewer
          bind:this={scrollViewerComponent}
          pdfDoc={pdfLoader.document}
          totalPages={pageNav.totalPages}
          viewportScale={zoomControl.scale}
          currentTool={currentTool}
          brushColor={brushSettings.color}
          brushWidth={brushSettings.width}
          pressureSensitivity={brushSettings.pressureSensitivity}
          fontSize={brushSettings.fontSize}
          isReadOnly={isReadOnly}
          userCanvasData={userCanvasData}
          currentEditCanvasId={currentEditCanvasId}
          isVersionHistoryMode={isVersionHistoryMode}
          onPageChange={handlePageChange}
          onCanvasChange={handleCanvasChange}
          onTextInputRequest={handleTextInputRequest}
          onReady={handleScrollViewerRef}
          onSelectionChange={(has) => { hasSelection = has }}
          onUndoStateChange={(u, r) => { canUndo = u; canRedo = r }}
          getPreview={(pageNum) => lowResPreview.getPreview(pageNum)}
          hasPreview={(pageNum) => lowResPreview.hasPreview(pageNum)}
        />
      {/key}
    {:else}
      <div class="empty">
        <p>PDF 파일을 로드해주세요</p>
      </div>
    {/if}
  </div>

  <!-- Text input overlay -->
  <TextInputOverlay
    isVisible={isTextInputVisible}
    initialText={textInputInitialText}
    fontSize={brushSettings.fontSize}
    onConfirm={handleTextConfirm}
    onCancel={handleTextCancel}
    onFontSizeChange={(size) => brushSettings.setFontSize(size)}
  />

  <!-- 도구 옵션 시트 — 펜·형광펜·도형·텍스트 통합 (한 시점에 하나만 표시) -->
  {#if openSheetKind}
    <ToolOptionsSheet
      isVisible={openSheetKind !== null}
      toolKind={openSheetKind}
      brushColor={brushSettings.color}
      brushWidth={sheetBrushWidth}
      colorPresets={sheetColorPresets}
      widthPresets={sheetWidthPresets}
      pressureSensitivity={brushSettings.pressureSensitivity}
      anchorLeft={sheetAnchorLeft}
      anchorTop={sheetAnchorTop}
      onColorChange={(c) => brushSettings.setColor(c)}
      onWidthChange={handleSheetWidthChange}
      onPressureSensitivityChange={handlePressureSensitivityChange}
      onClose={handleSheetClose}
    />
  {/if}

  <!-- 책갈피 패널 (PDF 내장 목차) -->
  {#if toolFeatures.bookmarks !== false}
    <PdfOutlinePanel
      outline={outline}
      isVisible={isOutlinePanelVisible}
      isLoading={isOutlineLoading}
      currentPage={pageNav.currentPage}
      onNavigate={handleOutlineNavigate}
      onClose={() => { isOutlinePanelVisible = false }}
    />
  {/if}

  <!-- User canvas data list (history panel) -->
  <UserCanvasDataList
    userCanvasData={userCanvasData}
    isVisible={isHistoryPanelVisible}
    isReadOnly={isReadOnly}
    currentEditCanvasId={currentEditCanvasId}
    isVersionHistoryMode={isVersionHistoryMode}
    onToggleVisibility={handleHistoryToggleVisibility}
    onLoadHistory={handleLoadHistory}
    onClose={handleHistoryClose}
  />
</div>

<style>
  .pdf-viewer-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    /* 앱 컨테이너도 색을 입히지 않음 — 투명 toolbar/sidebar 뒤로 부모 배경이 그대로 노출 */
    background: transparent;
  }

  /* viewer-content가 toolbar 아래로 약간 흘러들어가 toolbar의 backdrop-filter가
     실제 PDF 컨텐츠를 블러해 Liquid Glass 효과를 가시화 (margin-top negative trick).
     toolbar는 z-index로 떠 있고 컨텐츠는 padding-top으로 시각적 오프셋 유지. */
  .viewer-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    position: relative;
  }

  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .viewer-content {
      margin-top: -16px;
      padding-top: 16px;
      box-sizing: border-box;
    }
  }

  .loading,
  .error,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    color: var(--color-text-secondary);
  }

  .error {
    color: var(--color-action-destructive);
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--gray-100);
    border-top: 3px solid var(--color-primary);
    border-radius: var(--radius-full);
    animation: spin 1s linear infinite;
    margin-bottom: var(--space-4);
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>
