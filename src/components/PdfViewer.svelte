<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from 'svelte'
  import type { ToolMode, OrientationMode, PdfOutlineNode } from '../types'
  import { createPdfLoader } from '../lib/pdf/pdfLoader.svelte'
  import {
    createPdfSearch,
    type PdfSearch,
    type PdfSearchMatch,
    type PdfSearchState
  } from '../lib/pdf/pdfSearch.svelte'
  import { createPageNavigation } from '../lib/pdf/pageNavigation.svelte'
  import { extractOutline } from '../lib/pdf/pdfOutline'
  import { createBrushSettings } from '../lib/tools/brushSettings.svelte'
  import { serializeCanvasDataMap } from '../lib/canvas/canvasDataCodec'
  import { planViewerConfigUpdate } from '../lib/config/viewerConfigPolicy'
  import { createLowResPreview } from '../lib/scroll/lowResPreview.svelte'
  import { initPointerTracking } from '../lib/utils/inputDetection'
  import { createViewerInteractionController } from '../lib/viewer/viewerInteractionController.svelte'
  import { createViewerReviewController } from '../lib/viewer/viewerReviewController.svelte'
  import { createViewerBridgeController } from '../lib/viewer/viewerBridgeController'
  import type { PdfScrollViewerPort } from '../lib/viewer/viewerPorts'
  import { reportError, reportInfo, reportWarning } from '../lib/utils/errorReporter.svelte'
  import { applyTheme } from '../lib/config/applyTheme'
  import { setLocale, setMessages, t } from '../lib/i18n/index.svelte'
  import PdfToolbar from './PdfToolbar.svelte'
  import PdfScrollViewer from './PdfScrollViewer.svelte'
  import PdfSearchBar from './PdfSearchBar.svelte'
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
  const brushSettings = createBrushSettings()
  const lowResPreview = createLowResPreview()

  // UI State
  let currentTool = $state<ToolMode>('select')
  let currentOrientation = $state<OrientationMode>('portrait')
  let showThumbnails = $state(true)
  let isTextInputVisible = $state(false)
  let textInputInitialText = $state('')

  const EMPTY_SEARCH_STATE: PdfSearchState = Object.freeze({
    status: 'idle',
    query: '',
    caseSensitive: false,
    matches: Object.freeze([]),
    currentIndex: -1,
    currentMatch: null,
    totalMatches: 0,
    wrapped: false,
    indexedPages: 0,
    failedPages: Object.freeze([])
  })
  let pdfSearch: PdfSearch | null = null
  let searchState = $state<PdfSearchState>(EMPTY_SEARCH_STATE)
  let searchQuery = $state('')
  let isSearchOpen = $state(false)
  /** 검색이 자동 전환한 contentSelect를 닫을 때만 복원할 도구 */
  let preSearchTool = $state<ToolMode | null>(null)

  // 책갈피(PDF 내장 목차) — 문서에서 파생되는 읽기 전용 정보이므로 저장·왕복 대상이 아님
  let outline = $state<PdfOutlineNode[]>([])
  let isOutlineLoading = $state(false)
  let isOutlinePanelVisible = $state(false)
  let hasOutline = $derived(outline.length > 0)

  let scrollViewerComponent = $state<PdfScrollViewerPort | null>(null)
  const useLocalStorageHistory =
    import.meta.env.MODE === 'development' &&
    typeof window !== 'undefined' &&
    window.self === window.top &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  const review = createViewerReviewController({
    getScrollViewer: () => scrollViewerComponent,
    getTotalPages: () => pdfLoader.totalPages,
    getFileName: () => pdfLoader.fileName,
    getReadOnly: () => isReadOnly,
    useLocalStorageHistory,
    onLoadError: (error) => console.error('[PdfViewer] Failed to load history:', error)
  })

  // 호스트 커스터마이징 (SDK applyConfig) — 미지정 시 기본값 유지
  let brandLogoUrl = $state<string>('')
  let enabledTools = $state<ToolMode[] | null>(null)   // null = 전체 노출
  let toolFeatures = $state<Record<string, boolean>>({})

  /** SDK applyConfig를 테스트된 순수 정책으로 계획한 뒤 UI 효과만 실행 */
  function applyViewerConfig(config: unknown): void {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return
    const raw = config as Record<string, any>
    applyTheme(raw.theme)
    setLocale(raw.locale)
    setMessages(raw.messages)

    const result = planViewerConfigUpdate({
      currentTool,
      enabledTools,
      features: toolFeatures,
      logoUrl: brandLogoUrl,
      brushColor: brushSettings.color,
      brushWidth: brushSettings.width
    }, config, { hasPdfDocument: !!pdfLoader.document })

    currentTool = result.state.currentTool
    enabledTools = result.state.enabledTools
    toolFeatures = result.state.features
    brandLogoUrl = result.state.logoUrl
    brushSettings.setColor(result.state.brushColor)
    brushSettings.setWidth(result.state.brushWidth)
    if (result.effects.hideThumbnails) showThumbnails = false
    if (result.effects.outlineAction === 'reset') resetOutline()
    if (result.effects.outlineAction === 'refresh') void refreshOutline()
    if (toolFeatures.search === false && isSearchOpen) closePdfSearch()
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

  const interaction = createViewerInteractionController({
    getPdfDocument: () => pdfLoader.document,
    getCurrentTool: () => currentTool,
    getReadOnly: () => isReadOnly,
    getCanUndo: () => canUndo,
    getCanRedo: () => canRedo,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onOpenSearch: openPdfSearch,
    getSearchEnabled: () => toolFeatures.search !== false,
    onFitError: (error) => console.warn('[PdfViewer] fit-width 계산 실패:', error)
  })

  function handleGlobalKeyDown(event: KeyboardEvent): void {
    interaction.handleGlobalKeyDown(event)
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

  // Handle page change from scroll viewer
  function handlePageChange(newPage: number) {
    pageNav.setCurrentPage(newPage)
    // 페이지 전환 시 이전 페이지 선택 상태는 의미 없음 → 삭제 버튼 잔존 방지
    if (hasSelection) {
      hasSelection = false
    }
  }

  function resetPdfSearch(): void {
    restorePreSearchTool()
    pdfSearch?.dispose()
    pdfSearch = null
    searchState = EMPTY_SEARCH_STATE
    searchQuery = ''
    isSearchOpen = false
  }

  async function navigateToSearchMatch(match: PdfSearchMatch): Promise<void> {
    const viewer = scrollViewerComponent
    if (!viewer) return
    pageNav.goToPage(match.pageNumber)
    // searchState prop과 자식 coordinator의 highlight 상태가 먼저 같은 결과를 가리키도록 보장
    await tick()
    await viewer.scrollToSearchMatch(match, 'auto')
  }

  function initializePdfSearch(): void {
    pdfSearch?.dispose()
    const document = pdfLoader.document
    if (!document) {
      pdfSearch = null
      searchState = EMPTY_SEARCH_STATE
      return
    }

    pdfSearch = createPdfSearch({
      pdfDocument: document,
      onStateChange: (state) => {
        searchState = state
      },
      onNavigate: (match) => {
        void navigateToSearchMatch(match)
      }
    })
    searchState = pdfSearch.state
  }

  function openPdfSearch(): void {
    if (!pdfLoader.document || toolFeatures.search === false) return
    if (isSearchOpen) return
    // 포커스 트랩을 가진 도구 옵션 시트와 검색 입력이 동시에 열리지 않도록 정리
    openSheetKind = null
    isSearchOpen = true
    // 검색 결과 선택·복사가 Paper.js 입력에 가려지지 않도록 명시적 PDF 내용 선택으로 전환한다.
    if (
      !isReadOnly &&
      currentTool !== 'contentSelect' &&
      isToolEnabled('contentSelect')
    ) {
      preSearchTool = currentTool
      handleToolChange('contentSelect')
    } else {
      preSearchTool = null
    }
  }

  function closePdfSearch(): void {
    isSearchOpen = false
    searchQuery = ''
    if (pdfSearch) void pdfSearch.search('')
    else searchState = EMPTY_SEARCH_STATE
    restorePreSearchTool()
  }

  function isToolEnabled(tool: ToolMode): boolean {
    return enabledTools === null || enabledTools.includes(tool)
  }

  /** 사용자가 검색 중 다른 도구를 고르지 않았고 기존 도구도 여전히 허용될 때만 복원 */
  function restorePreSearchTool(): void {
    const restoreTool = preSearchTool
    preSearchTool = null
    if (
      restoreTool &&
      !isReadOnly &&
      currentTool === 'contentSelect' &&
      isToolEnabled(restoreTool)
    ) {
      handleToolChange(restoreTool)
    }
  }

  function handleSearchQueryChange(query: string): void {
    searchQuery = query
    void pdfSearch?.search(query)
  }

  function handleSearchNext(): void {
    pdfSearch?.next()
  }

  function handleSearchPrevious(): void {
    pdfSearch?.previous()
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
  function handleCanvasChange(_pageNum: number, _json: string) {
    // iframe SDK의 onChange 계약 — 변경된 한 페이지만이 아니라 저장과 동일한 전체
    // canvasData 스냅샷을 전달해 호스트 자동저장이 곧바로 복원 가능한 값을 받도록 보장.
    if (bridge.isPostMessage && scrollViewerComponent) {
      bridge.notifyCanvasChanged(
        serializeCanvasDataMap(scrollViewerComponent.getAllCanvasData(), pdfLoader.totalPages)
      )
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
    try {
      canvasDataStr = serializeCanvasDataMap(
        scrollViewerComponent.getAllCanvasData(),
        pdfLoader.totalPages
      )
    } catch (e) {
      const message = t('viewer.saveDataError')
      reportError('parse', message, e)
      bridge.respondSave('', false, message)
      return
    }

    // standalone(localhost) 모드: localStorage에 append-only로 새 버전 저장
    if (useLocalStorageHistory) {
      try {
        const entry = review.recordLocalSave(canvasDataStr)
        reportInfo(t('viewer.savedVersion', { version: (entry as any)?.version ?? review.entries.length }))
      } catch (e) {
        reportError('storage', t('viewer.saveFailed'), e)
      }
      return
    }

    if (bridge.isPostMessage) {
      // iframe 모드: postMessage로 부모에게 Canvas 데이터 전달
      const ok = bridge.respondSave(canvasDataStr, true)
      if (ok) reportInfo(t('viewer.saveRequested'))
    } else {
      reportWarning('bridge', '저장은 iframe 호스트 SDK 또는 개발용 로컬 이력에서만 사용할 수 있습니다')
    }
  }

  // Handle close
  function handleClose() {
    bridge.requestClose()
  }

  // Handle orientation toggle
  function handleOrientationToggle() {
    const newOrientation: OrientationMode = currentOrientation === 'portrait' ? 'landscape' : 'portrait'
    currentOrientation = newOrientation
    // 회전 시 도구 옵션 시트는 anchor 좌표가 무효화되므로 자동 닫음
    if (openSheetKind) {
      openSheetKind = null
    }

    bridge.requestOrientation(newOrientation)
  }

  // 목차 추출 세대 토큰 — 연속 로드 시 이전 문서의 추출 결과가 뒤늦게 덮어쓰는 것을 차단
  let outlineToken = 0

  /** 진행 중 추출 무효화와 패널·결과 초기화를 한 동작으로 유지 */
  function resetOutline(): void {
    outlineToken++
    outline = []
    isOutlineLoading = false
    isOutlinePanelVisible = false
  }

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
      // 새 keyed PdfScrollViewer가 연결되고 첫 페이지를 실제 표시할 때까지 대기.
      // postMessage 완료 흐름은 같은 Promise 뒤 곧바로 pdfLoaded를 보내며,
      // 아래 idle 양보가 목차 worker RPC를 그 신호보다 확실히 뒤로 미룬다.
      await tick()
      const viewer = scrollViewerComponent
      if (!viewer) return
      await viewer.waitUntilFirstPageReady()
      if (token !== outlineToken || pdfLoader.document !== doc) return
      await whenIdle()
      if (token !== outlineToken || pdfLoader.document !== doc) return
      const extracted = await extractOutline(doc, {
        shouldContinue: () => (
          token === outlineToken &&
          pdfLoader.document === doc &&
          toolFeatures.bookmarks !== false
        )
      })
      if (token !== outlineToken || pdfLoader.document !== doc) return
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
    if (isOutlinePanelVisible) review.closePanel()
  }

  /** 목차 항목 클릭 — 해당 페이지로 이동. 패널은 연속 탐색을 위해 열어 둠 */
  function handleOutlineNavigate(page: number) {
    pageNav.goToPage(page)
    scrollViewerComponent?.scrollToPage(page, 'auto')
    scrollViewerComponent?.focusPage(page)
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
    scrollViewerComponent.clearCanvas(pageNum)
  }

  // Handle thumbnail page change
  function handleThumbnailPageChange(page: number) {
    pageNav.goToPage(page)
    scrollViewerComponent?.scrollToPage(page)
    scrollViewerComponent?.focusPage(page)
  }

  // Handle history panel toggle
  function handleToggleHistory() {
    const visible = review.togglePanel()
    // 두 패널은 우측 같은 자리를 공유 — 겹쳐 뜨지 않도록 상호 배타
    if (visible) isOutlinePanelVisible = false
  }

  function handleHistoryToggleVisibility(canvasId: string, visible: boolean) {
    review.toggleVisibility(canvasId, visible)
  }

  function handleHistoryClose() {
    review.closePanel()
  }

  function handleLoadHistory(canvasId: string): void {
    review.continueEditing(canvasId)
  }

  function prepareDocumentLoad(): void {
    lowResPreview.clearPreviews()
    resetOutline()
    resetPdfSearch()
    review.resetDocumentTracking()
  }

  function finishDocumentLoad(): void {
    const document = pdfLoader.document
    if (!document) return
    pageNav.setTotalPages(pdfLoader.totalPages)
    initializePdfSearch()
    lowResPreview.generateAllPreviews(document)
    if (toolFeatures.bookmarks !== false) void refreshOutline()
    review.refreshLocalHistory()
  }

  const bridge = createViewerBridgeController({
    pdfLoader,
    getScrollViewer: () => scrollViewerComponent,
    setReadOnly: (value) => { isReadOnly = value },
    onBeforeDocumentLoad: prepareDocumentLoad,
    onDocumentLoaded: finishDocumentLoad,
    onReviewData: review.setPublicEntries,
    onSave: handleSave,
    onClear: clearCurrentCanvas,
    onApplyConfig: applyViewerConfig,
    onLoadError: (message, error) => reportError('render', message, error),
    afterDomUpdate: tick
  })

  // Pointer tracking cleanup
  let cleanupPointerTracking: (() => void) | null = null
  let cleanupLandscapeListener: (() => void) | null = null

  onMount(async () => {
    cleanupPointerTracking = initPointerTracking()
    bridge.initialize()

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

  })

  // initialPdfUrl 변화 감지 → 자동 로드
  // 빈 문자열에서 유효 URL로 전환되거나 URL이 바뀔 때만 로드 (브릿지 호출은 별도 경로)
  let lastLoadedInitialUrl = ''
  $effect(() => {
    const url = initialPdfUrl
    if (url && url !== lastLoadedInitialUrl) {
      untrack(() => {
        lastLoadedInitialUrl = url
        void bridge.loadPdfFromUrl(url)
      })
    }
  })

  $effect(() => {
    const doc = pdfLoader.document
    void review.entries
    void review.isVersionHistoryMode
    untrack(async () => {
      await tick()
      review.continueLatestLocalHistory(doc)
    })
  })

  $effect(() => {
    void currentTool
    void isReadOnly
    untrack(() => interaction.syncInteractionMode())
  })

  onDestroy(() => {
    resetOutline()
    resetPdfSearch()
    cleanupPointerTracking?.()
    cleanupLandscapeListener?.()
    if (toolHintTimer) clearTimeout(toolHintTimer)
    bridge.dispose()
    review.dispose()
    interaction.dispose()
    void pdfLoader.unload()
    lowResPreview.clearPreviews()
  })

  function handleScrollViewerRef(element: HTMLElement | null) {
    interaction.setScrollElement(element)
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<div class="pdf-viewer-container">
  <!-- Toolbar -->
  <PdfToolbar
    currentTool={currentTool}
    currentPage={pageNav.currentPage}
    totalPages={pageNav.totalPages}
    hasPdfDocument={pdfLoader.document !== null}
    scale={interaction.scale}
    isReadOnly={isReadOnly}
    enabledTools={enabledTools}
    features={toolFeatures}
    logoUrl={brandLogoUrl}
    hasUserCanvasData={review.hasEntries}
    isHistoryPanelVisible={review.panelVisible}
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
      scrollViewerComponent?.focusPage(page)
    }}
    onZoomIn={() => interaction.zoomAnchoredTo(interaction.scale + interaction.step)}
    onZoomOut={() => interaction.zoomAnchoredTo(interaction.scale - interaction.step)}
    onSave={handleSave}
    onToggleHistory={handleToggleHistory}
    isSearchOpen={isSearchOpen}
    onToggleSearch={() => isSearchOpen ? closePdfSearch() : openPdfSearch()}
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
      {#if toolFeatures.search !== false}
        <div id="inko-pdf-search" class="pdf-search-popover">
          <PdfSearchBar
            open={isSearchOpen}
            query={searchQuery}
            state={searchState}
            onQueryChange={handleSearchQueryChange}
            onPrevious={handleSearchPrevious}
            onNext={handleSearchNext}
            onClose={closePdfSearch}
          />
        </div>
      {/if}
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
          viewportScale={interaction.scale}
          currentTool={currentTool}
          brushColor={brushSettings.color}
          brushWidth={brushSettings.width}
          pressureSensitivity={brushSettings.pressureSensitivity}
          fontSize={brushSettings.fontSize}
          isReadOnly={isReadOnly}
          userCanvasData={review.entries}
          currentEditCanvasId={review.currentEditCanvasId}
          isVersionHistoryMode={review.isVersionHistoryMode}
          searchState={searchState}
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
    userCanvasData={review.entries}
    isVisible={review.panelVisible}
    isReadOnly={isReadOnly}
    currentEditCanvasId={review.currentEditCanvasId}
    isVersionHistoryMode={review.isVersionHistoryMode}
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

  .pdf-search-popover {
    position: absolute;
    top: var(--space-2);
    right: var(--space-3);
    z-index: 980;
    max-width: calc(100% - var(--space-6));
  }

  @media (max-width: 560px) {
    .pdf-search-popover {
      left: var(--space-1);
      right: var(--space-1);
      max-width: none;
    }
  }

  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .viewer-content {
      margin-top: -16px;
      padding-top: 16px;
      box-sizing: border-box;
    }

    .pdf-search-popover {
      top: calc(var(--space-4) + var(--space-2));
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
