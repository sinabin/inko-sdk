<script lang="ts">
  import type { ToolMode, OrientationMode } from '../types'
  import { t } from '../lib/i18n/index.svelte'
  import ToolbarNavigationGroup from './toolbar/ToolbarNavigationGroup.svelte'
  import ToolbarHistoryGroup from './toolbar/ToolbarHistoryGroup.svelte'
  import ToolbarZoomGroup from './toolbar/ToolbarZoomGroup.svelte'
  import ToolbarToolGroup from './toolbar/ToolbarToolGroup.svelte'
  import ToolbarActionGroup from './toolbar/ToolbarActionGroup.svelte'

  interface Props {
    currentTool: ToolMode
    currentPage: number
    totalPages: number
    scale: number
    isReadOnly?: boolean
    hasUserCanvasData?: boolean
    isHistoryPanelVisible?: boolean
    /** 책갈피(PDF 내장 목차) 패널 표시 여부 */
    isOutlinePanelVisible?: boolean
    /** PDF에 목차가 있을 때만 버튼 노출 — 빈 패널로 유도하지 않기 위함 */
    hasOutline?: boolean
    showThumbnails?: boolean
    orientation?: OrientationMode
    onToolChange?: (tool: ToolMode) => void
    onPageChange?: (page: number) => void
    onZoomIn?: () => void
    onZoomOut?: () => void
    canUndo?: boolean
    canRedo?: boolean
    onUndo?: () => void
    onRedo?: () => void
    /** 펜 옵션 시트 트리거 — 활성 펜 재탭 또는 롱프레스 시 호출, 앵커 좌표 전달 */
    /**
     * 도구 옵션 시트 트리거 — 옵션이 있는 도구(pen·highlighter·shape·text) 클릭 시 호출.
     * shape 도구(rectangle/circle/line)는 단일 'shape' kind로 통합됨
     */
    onOpenPenOptions?: (anchorLeft: number, anchorTop: number) => void
    onOpenToolOptions?: (kind: 'pen' | 'highlighter' | 'rectangle' | 'circle' | 'line' | 'text', anchorLeft: number, anchorTop: number) => void
    onSave?: () => void
    onToggleHistory?: () => void
    onToggleThumbnails?: () => void
    onToggleOutline?: () => void
    onOrientationToggle?: () => void
    hasSelection?: boolean
    onDeleteSelected?: () => void
    /** 노출할 도구 목록 (null = 전체). 'shape'는 사각형·원·선 일괄 */
    enabledTools?: string[] | null
    /** 툴바 기능 토글 — 미지정 키는 노출(on), false면 숨김 */
    features?: Record<string, boolean>
    /** 브랜드 로고 이미지 URL (툴바 좌측) */
    logoUrl?: string
  }

  let {
    currentTool = 'select',
    currentPage = 1,
    totalPages = 0,
    scale = 1,
    isReadOnly = false,
    hasUserCanvasData = false,
    isHistoryPanelVisible = false,
    isOutlinePanelVisible = false,
    hasOutline = false,
    showThumbnails = true,
    orientation = 'portrait',
    onToolChange,
    onPageChange,
    onZoomIn,
    onZoomOut,
    canUndo = false,
    canRedo = false,
    onUndo,
    onRedo,
    onOpenPenOptions,
    onOpenToolOptions,
    onSave,
    onToggleHistory,
    onToggleThumbnails,
    onToggleOutline,
    onOrientationToggle,
    hasSelection = false,
    onDeleteSelected,
    enabledTools = null,
    features = {},
    logoUrl = ''
  }: Props = $props()
</script>

<div class="toolbar" role="toolbar" aria-label={t('toolbar.label')}>
  {#if logoUrl}
    <img class="toolbar-logo" src={logoUrl} alt="" style="height: 26px; width: auto; max-width: 140px; margin: 0 var(--space-2); flex-shrink: 0; object-fit: contain;" />
  {/if}

  <ToolbarNavigationGroup
    {currentPage}
    {totalPages}
    {showThumbnails}
    {isOutlinePanelVisible}
    {hasOutline}
    thumbnailsEnabled={features.thumbnails !== false}
    bookmarksEnabled={features.bookmarks !== false}
    pageNavEnabled={features.pageNav !== false}
    {onPageChange}
    {onToggleThumbnails}
    {onToggleOutline}
  />

  {#if !isReadOnly && features.undoRedo !== false}
    <ToolbarHistoryGroup {canUndo} {canRedo} {onUndo} {onRedo} />
  {/if}

  <ToolbarZoomGroup
    {scale}
    {orientation}
    zoomEnabled={features.zoom !== false}
    orientationEnabled={features.orientation !== false}
    {onZoomIn}
    {onZoomOut}
    {onOrientationToggle}
  />

  {#if !isReadOnly}
    <ToolbarToolGroup
      {currentTool}
      {hasSelection}
      {enabledTools}
      {onToolChange}
      {onOpenPenOptions}
      {onOpenToolOptions}
      {onDeleteSelected}
    />
  {/if}

  <ToolbarActionGroup
    showHistory={hasUserCanvasData && features.history !== false}
    {isHistoryPanelVisible}
    showSave={!isReadOnly && features.save !== false}
    {onToggleHistory}
    {onSave}
  />
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2_5) var(--space-4);
    background: transparent;
    border-bottom: none;
    flex-wrap: wrap;
    flex-shrink: 0;
    position: relative;
    z-index: 5;
  }

  @media (orientation: portrait) {
    .toolbar {
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
    }
  }

  @media (orientation: landscape) {
    .toolbar {
      gap: var(--space-2_5);
      padding: var(--space-1) var(--space-3);
    }
  }
</style>
