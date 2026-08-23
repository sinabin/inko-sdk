<script lang="ts">
  import type { ToolMode, OrientationMode } from '../types'
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    currentTool: ToolMode
    currentPage: number
    totalPages: number
    scale: number
    brushColor: string
    brushWidth: number
    isReadOnly?: boolean
    hasUserCanvasData?: boolean
    isHistoryPanelVisible?: boolean
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
    onColorChange?: (color: string) => void
    onWidthChange?: (width: number) => void
    onSave?: () => void
    onToggleHistory?: () => void
    onToggleThumbnails?: () => void
    onOrientationToggle?: () => void
    fontSize?: number
    onFontSizeChange?: (size: number) => void
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
    brushColor = '#000000',
    brushWidth = 2,
    isReadOnly = false,
    hasUserCanvasData = false,
    isHistoryPanelVisible = false,
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
    onColorChange,
    onWidthChange,
    onSave,
    onToggleHistory,
    onToggleThumbnails,
    onOrientationToggle,
    fontSize = 16,
    onFontSizeChange,
    hasSelection = false,
    onDeleteSelected,
    enabledTools = null,
    features = {},
    logoUrl = ''
  }: Props = $props()

  const tools: { id: ToolMode; labelKey: string }[] = [
    { id: 'select', labelKey: 'tool.select' },
    { id: 'pen', labelKey: 'tool.pen' },
    { id: 'highlighter', labelKey: 'tool.highlighter' },
    { id: 'eraser', labelKey: 'tool.eraser' },
    { id: 'text', labelKey: 'tool.text' },
    { id: 'rectangle', labelKey: 'tool.rectangle' },
    { id: 'circle', labelKey: 'tool.circle' },
    { id: 'line', labelKey: 'tool.line' }
  ]

  const SHAPE_IDS: ToolMode[] = ['rectangle', 'circle', 'line']
  // 노출 도구 필터 — enabledTools 미지정 시 전체. 'shape'는 도형 3종 일괄 노출
  const visibleTools = $derived(
    !enabledTools
      ? tools
      : tools.filter(tl => enabledTools.includes(tl.id) || (SHAPE_IDS.includes(tl.id) && enabledTools.includes('shape')))
  )
  // 기능 토글 — false면 숨김, 그 외(미지정 포함)는 노출
  const featureOn = (key: string): boolean => features[key] !== false

  const colorPresets = [
    '#000000', '#FF0000', '#00FF00', '#0000FF',
    '#FFFF00', '#FF00FF', '#00FFFF', '#FFFFFF'
  ]

  const highlighterColorPresets = [
    '#FFFF00', '#00FF00', '#FF69B4', '#87CEEB', '#FFA500'
  ]

  const widthPresets = [1, 2, 4, 6, 8, 12]
  const highlighterWidthPresets = [12, 16, 20, 24, 32]
  const fontSizePresets = [12, 16, 20, 24, 32, 48]

  /** 도구 → 시트 종류 매핑 (도형은 종류별로 분리해 헤더·미리보기 구분) */
  function getSheetKind(tool: ToolMode): 'pen' | 'highlighter' | 'rectangle' | 'circle' | 'line' | 'text' | null {
    if (tool === 'pen') return 'pen'
    if (tool === 'highlighter') return 'highlighter'
    if (tool === 'rectangle') return 'rectangle'
    if (tool === 'circle') return 'circle'
    if (tool === 'line') return 'line'
    if (tool === 'text') return 'text'
    return null
  }

  /**
   * 도구 버튼 클릭 — 활성화 + 옵션 시트 토글(있는 경우).
   * select·eraser는 시트 없음 — 활성화만.
   */
  function handleToolClick(tool: ToolMode, btnEl?: HTMLButtonElement) {
    onToolChange?.(tool)
    const kind = getSheetKind(tool)
    if (kind && btnEl) {
      const rect = btnEl.getBoundingClientRect()
      // 새 통합 콜백 우선, 없으면 펜 한정 레거시 콜백
      if (onOpenToolOptions) {
        onOpenToolOptions(kind, rect.left, rect.bottom + 4)
      } else if (kind === 'pen') {
        onOpenPenOptions?.(rect.left, rect.bottom + 4)
      }
    }
  }

  function handlePrevPage() {
    if (currentPage > 1) {
      onPageChange?.(currentPage - 1)
    }
  }

  function handleNextPage() {
    if (currentPage < totalPages) {
      onPageChange?.(currentPage + 1)
    }
  }

  function handlePageInput(event: Event) {
    const input = event.target as HTMLInputElement
    const page = parseInt(input.value)
    if (page >= 1 && page <= totalPages) {
      onPageChange?.(page)
    } else {
      // 빈 값·NaN·범위 밖이면 현재 페이지로 reset — 표시 박스가 stale 상태로 남는 것 방지
      input.value = String(currentPage)
    }
  }

  /** blur 시에도 보강 — onchange가 같은 값이면 발화 안 하므로 빈 입력 후 blur 케이스 처리 */
  function handlePageBlur(event: FocusEvent) {
    const input = event.target as HTMLInputElement
    const page = parseInt(input.value)
    if (!(page >= 1 && page <= totalPages)) {
      input.value = String(currentPage)
    }
  }
</script>

<div class="toolbar">
  {#if logoUrl}
    <img class="toolbar-logo" src={logoUrl} alt="" style="height: 26px; width: auto; max-width: 140px; margin: 0 var(--space-2); flex-shrink: 0; object-fit: contain;" />
  {/if}
  <!-- Navigation Section -->
  <div class="toolbar-section">
    <button
      class="btn thumbnail-toggle-btn"
      onclick={onToggleThumbnails}
      style:display={featureOn('thumbnails') ? undefined : 'none'}
      title={showThumbnails ? t('toolbar.thumbnailsHide') : t('toolbar.thumbnailsShow')}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {#if showThumbnails}
          <!-- ON: 사이드바 채움 + 본문 라인 -->
          <rect x="3" y="4" width="6" height="16" rx="1.5" fill="currentColor" fill-opacity="0.18" stroke-width="2"/>
          <line x1="12" y1="7" x2="20" y2="7"/>
          <line x1="12" y1="12" x2="20" y2="12"/>
          <line x1="12" y1="17" x2="16.5" y2="17"/>
        {:else}
          <!-- OFF: 사이드바 점선(접힘) + 본문 라인 -->
          <rect x="3" y="4" width="6" height="16" rx="1.5" stroke-dasharray="2.5 2.5"/>
          <line x1="12" y1="7" x2="20" y2="7"/>
          <line x1="12" y1="12" x2="20" y2="12"/>
          <line x1="12" y1="17" x2="16.5" y2="17"/>
        {/if}
      </svg>
    </button>
    <button
      class="btn"
      onclick={handlePrevPage}
      disabled={currentPage <= 1}
      style:display={featureOn('pageNav') ? undefined : 'none'}
      title={t('toolbar.prevPage')}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    <span class="page-info" style:display={featureOn('pageNav') ? undefined : 'none'}>
      <input
        type="number"
        value={currentPage}
        min="1"
        max={totalPages}
        onchange={handlePageInput}
        onblur={handlePageBlur}
        onfocus={(e) => (e.target as HTMLInputElement).select()}
        class="page-input"
        aria-label={t('toolbar.currentPage')}
      />
      <span class="page-divider" aria-hidden="true">/</span>
      <span class="page-total">{totalPages}</span>
    </span>
    <button
      class="btn"
      onclick={handleNextPage}
      disabled={currentPage >= totalPages}
      style:display={featureOn('pageNav') ? undefined : 'none'}
      title={t('toolbar.nextPage')}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  </div>

  <!-- Undo/Redo Section (편집 모드에서만 노출) -->
  {#if !isReadOnly && featureOn('undoRedo')}
    <div class="toolbar-section history-section">
      <button
        class="btn history-action-btn"
        onclick={onUndo}
        disabled={!canUndo}
        title={t('toolbar.undo')}
        aria-label={t('toolbar.undo')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 14 4 9 9 4"/>
          <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
        </svg>
      </button>
      <button
        class="btn history-action-btn"
        onclick={onRedo}
        disabled={!canRedo}
        title={t('toolbar.redo')}
        aria-label={t('toolbar.redo')}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 14 20 9 15 4"/>
          <path d="M4 20v-7a4 4 0 0 1 4-4h12"/>
        </svg>
      </button>
    </div>
  {/if}

  <!-- Zoom Section -->
  <div class="toolbar-section">
    <button class="btn" onclick={onZoomOut} style:display={featureOn('zoom') ? undefined : 'none'} title={t('toolbar.zoomOut')}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
    </button>
    <span class="zoom-info" style:display={featureOn('zoom') ? undefined : 'none'}>{Math.round(scale * 100)}%</span>
    <button class="btn" onclick={onZoomIn} style:display={featureOn('zoom') ? undefined : 'none'} title={t('toolbar.zoomIn')}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
    </button>
    <button
      class="btn orientation-btn"
      onclick={onOrientationToggle}
      style:display={featureOn('orientation') ? undefined : 'none'}
      title={orientation === 'portrait' ? t('toolbar.orientationLandscape') : t('toolbar.orientationPortrait')}
    >
      {#if orientation === 'portrait'}
        <!-- 가로 보기로 전환 — 가로 화면 + 회전 화살표 -->
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" fill="currentColor" fill-opacity="0.10"/>
          <path d="M16 11.5l2 -2.5l2 2.5"/>
          <path d="M18 9 a4 4 0 0 0 -4 -4"/>
        </svg>
      {:else}
        <!-- 세로 보기로 전환 — 세로 화면 + 회전 화살표 -->
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="2" width="12" height="20" rx="2" fill="currentColor" fill-opacity="0.10"/>
          <path d="M11.5 16l-2.5 2l2.5 2"/>
          <path d="M9 18 a4 4 0 0 0 4 -4"/>
        </svg>
      {/if}
    </button>
  </div>

  <!-- Tools Section (hidden in read-only mode) -->
  {#if !isReadOnly}
    <div class="toolbar-section tools">
      {#each visibleTools as tool}
        <button
          class="btn tool-btn"
          class:active={currentTool === tool.id}
          class:has-options={getSheetKind(tool.id) !== null}
          onclick={(e) => handleToolClick(tool.id, e.currentTarget as HTMLButtonElement)}
          title={t(tool.labelKey)}
          data-tool={tool.id}
        >
          {#if tool.id === 'select'}
            <!-- 커서 화살표 — 채워진 형태로 활성/포인터 의미 강화 -->
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" fill="currentColor" fill-opacity="0.18"/>
            </svg>
          {:else if tool.id === 'pen'}
            <!-- 펜 — 기울어진 닙, 본체에 fill로 무게감 -->
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" fill="currentColor" fill-opacity="0.14"/>
              <path d="M15 5l4 4"/>
            </svg>
          {:else if tool.id === 'highlighter'}
            <!-- 형광펜 — 굵은 닙 + 반투명 자국으로 펜과 명확히 구분 -->
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <!-- 마커 본체 -->
              <path d="M15 4l5 5-9 9H6v-5z" fill="currentColor" fill-opacity="0.28"/>
              <path d="M15 4l5 5-9 9H6v-5z"/>
              <!-- 닙 분리선 (마커 끝) -->
              <line x1="14" y1="5" x2="19" y2="10"/>
              <!-- 형광 자국 (반투명 굵은 선) -->
              <line x1="4" y1="21" x2="14" y2="21" stroke-width="3" stroke-opacity="0.45"/>
            </svg>
          {:else if tool.id === 'eraser'}
            <!-- 지우개 — 본체 fill + 분할선으로 "지움" 시각화 -->
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 20H7L3 16a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l7 7a1 1 0 0 1 0 1.4L16 18" fill="currentColor" fill-opacity="0.14"/>
              <path d="M14 6L18 10"/>
            </svg>
          {:else if tool.id === 'text'}
            <!-- 텍스트 T + 커서 -->
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
              <line x1="8" y1="20" x2="16" y2="20"/>
            </svg>
          {:else if tool.id === 'rectangle'}
            <!-- 사각형 — 약한 fill로 도형이 "면"임을 시사 -->
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="currentColor" fill-opacity="0.10"/>
            </svg>
          {:else if tool.id === 'circle'}
            <!-- 원 — 약한 fill로 면 시사 -->
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="8.5" fill="currentColor" fill-opacity="0.10"/>
            </svg>
          {:else if tool.id === 'line'}
            <!-- 직선 — 시작·끝점 dot으로 "두 점을 잇는 도구" 의미 강화 -->
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="18" x2="18" y2="6"/>
              <circle cx="6" cy="18" r="1.8" fill="currentColor" stroke="none"/>
              <circle cx="18" cy="6" r="1.8" fill="currentColor" stroke="none"/>
            </svg>
          {/if}
        </button>
      {/each}

      <!-- 선택 모드 삭제 버튼 -->
      {#if currentTool === 'select' && hasSelection}
        <button
          class="btn delete-btn"
          onclick={onDeleteSelected}
          title={t('toolbar.deleteSelection')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      {/if}
    </div>

    <!-- 색상·굵기·폰트 크기 등은 모두 도구별 옵션 시트(ToolOptionsSheet)에서 설정 -->
  {/if}

  <!-- Action Section -->
  <div class="toolbar-section actions">
    <!-- History button (only show if there's user canvas data) -->
    {#if hasUserCanvasData && featureOn('history')}
      <button
        class="btn history-btn"
        class:active={isHistoryPanelVisible}
        onclick={onToggleHistory}
        title={t('toolbar.history')}
        aria-pressed={isHistoryPanelVisible}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.12"/>
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15.5 14"/>
        </svg>
      </button>
    {/if}

    {#if !isReadOnly && featureOn('save')}
      <button class="btn save-btn" onclick={onSave} title={t('toolbar.save')}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <!-- 디스크 본체 — 미세 fill로 무게 -->
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" fill="currentColor" fill-opacity="0.18"/>
          <!-- 디스크 라벨(아래쪽) -->
          <polyline points="17 21 17 13 7 13 7 21"/>
          <!-- 디스크 슬라이더(위쪽) — 균형 위해 14로 단축 -->
          <polyline points="7 3 7 8 14 8"/>
        </svg>
        <span class="save-label">{t('toolbar.save')}</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2_5) var(--space-4);
    /* 컨테이너 자체는 완전 투명 — 버튼만 떠 있는 형태.
       blur·border·shadow도 제거해 위계는 버튼·아이콘이 단독으로 형성 */
    background: transparent;
    border-bottom: none;
    flex-wrap: wrap;
    flex-shrink: 0;
    position: relative;
    z-index: 5;
  }

  .toolbar-section {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    position: relative;
  }

  /* 섹션 사이 세로 divider — 그룹 시각 분리 (Garrett Structure) */
  .toolbar-section + .toolbar-section::before {
    content: '';
    width: 1px;
    height: 28px;
    background: var(--color-border-light);
    margin-right: var(--space-1);
    flex-shrink: 0;
  }
  /* actions 앞 divider는 margin-left:auto 때문에 멀리 떨어지므로 숨김 */
  .toolbar-section.actions::before {
    display: none;
  }

  /* 툴바 버튼 — light glass 칩.
     툴바 자체가 backdrop-filter를 가지므로 버튼은 자체 blur 없이 translucent fill + 상단 inner gloss로 "유리 칩" 느낌. 활성/액션 버튼은 별도 처리. */
  .btn {
    padding: var(--space-1_5) var(--space-3);
    border: 1px solid var(--glass-border-btn);
    border-radius: var(--radius-md);
    background: var(--glass-bg-btn);
    cursor: pointer;
    font-size: var(--font-size-md);
    transition: all var(--motion-fast) var(--ease-out);
    min-height: 48px;
    min-width: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--glass-gloss-top);
  }

  .btn:hover:not(:disabled) {
    background: var(--glass-bg-btn-hover);
    border-color: rgba(255, 255, 255, 0.75);
  }

  .btn:active:not(:disabled) {
    background: var(--glass-bg-btn-active);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* 마우스 클릭 후 잔존하는 브라우저 기본 :focus outline 제거.
     키보드 사용자에게는 :focus-visible(개별 버튼별 ring)이 노출되어 a11y 유지 */
  .btn:focus {
    outline: none;
  }

  .tool-btn {
    width: 48px;
    height: 48px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tool);
  }

  .tool-btn:hover:not(:disabled):not(.active) {
    color: var(--color-text-primary);
    background: var(--gray-200);
  }

  .tool-btn.active {
    background: var(--color-tool-active);
    border-color: var(--color-tool-active);
    color: var(--color-text-inverse);
    box-shadow: var(--shadow-tool-active);
  }

  /* hover/press 시 .btn 기본 hover/active 규칙(specificity 0,3,0)이 .tool-btn.active(0,2,0)를
     덮어쓰면서 bg가 연한 azure tint로 바뀌어 흰색 아이콘이 사라지는 문제 방지 */
  .tool-btn.active:hover:not(:disabled),
  .tool-btn.active:active:not(:disabled) {
    background: var(--color-tool-active);
    border-color: var(--color-tool-active);
    color: var(--color-text-inverse);
  }

  /* 옵션 보유 표시 — 우하단 작은 caret 점 (펜 도구의 "옵션 가능" 어포던스) */
  .tool-btn.has-options {
    position: relative;
  }

  .tool-btn.has-options::after {
    content: '';
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--color-text-muted);
    transition: background-color var(--motion-fast) var(--ease-out);
  }

  .tool-btn.has-options.active::after {
    background: var(--color-text-inverse);
    opacity: 0.85;
  }

  /* 페이지 정보 — [ 2 / 18 ] chip 통합. focus 시 컨테이너 전체가 강조 (Linear/Arc 류) */
  /* 페이지 정보 chip — 툴바 glass 위에 살짝 더 밝은 light tint chip */
  .page-info {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1_5);
    padding: 2px var(--space-2_5);
    background: var(--glass-bg-btn);
    border: 1px solid var(--glass-border-btn);
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    box-shadow: var(--glass-gloss-top);
    transition: background-color var(--motion-fast) var(--ease-out),
                border-color var(--motion-fast) var(--ease-out),
                box-shadow var(--motion-fast) var(--ease-out);
  }

  .page-info:hover {
    background: var(--glass-bg-btn-hover);
    border-color: rgba(255, 255, 255, 0.75);
  }

  .page-info:focus-within {
    background: var(--glass-bg-btn-active);
    border-color: var(--color-primary);
    box-shadow: var(--shadow-focus-soft), var(--glass-gloss-top);
  }

  /* 입력 영역 — chip 안의 invisible field. spinner 제거, 자릿수 균일 */
  .page-input {
    width: 38px;
    min-height: 36px;
    padding: var(--space-1) 0;
    border: none;
    background: transparent;
    text-align: center;
    color: var(--color-text-primary);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    font-variant-numeric: tabular-nums;
    outline: none;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .page-input::-webkit-outer-spin-button,
  .page-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .page-divider {
    color: var(--color-text-muted);
    font-weight: var(--font-weight-regular);
    user-select: none;
  }

  .page-total {
    color: var(--color-text-secondary);
    font-weight: var(--font-weight-medium);
    user-select: none;
  }

  .zoom-info {
    min-width: 48px;
    text-align: center;
    font-size: var(--font-size-md);
  }

  .brush-settings {
    display: flex;
    gap: var(--space-4);
  }

  .color-picker {
    display: flex;
    gap: var(--space-1_5);
  }

  /* 컬러 swatch — 원형, 활성 시 spring scale + focus ring (Linear/Arc 톤) */
  .color-swatch {
    width: 30px;
    height: 30px;
    border: 2px solid;
    border-radius: var(--radius-full);
    cursor: pointer;
    padding: 0;
    transition: transform var(--motion-fast) var(--ease-spring),
                box-shadow var(--motion-fast) var(--ease-out);
  }

  .color-swatch:hover:not(.active) {
    transform: scale(1.08);
  }

  .color-swatch.active {
    transform: scale(1.18);
    box-shadow: var(--shadow-focus-ring);
  }

  .width-picker {
    display: flex;
    gap: var(--space-1_5);
    align-items: center;
  }

  .width-btn {
    width: 40px;
    height: 40px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .width-btn.active {
    background: var(--color-primary-bg);
    border-color: var(--color-primary);
  }

  /* 굵기 가로 막대 — 두께 차이를 시각적으로 표현 */
  .width-bar {
    width: 18px;
    background: var(--color-text-primary);
    border-radius: var(--radius-full);
    transition: height var(--motion-fast) var(--ease-out);
  }

  .width-btn.active .width-bar {
    background: var(--color-primary);
  }

  .font-size-picker {
    display: flex;
    gap: var(--space-1_5);
    align-items: center;
  }

  .picker-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    margin-right: var(--space-0_5);
  }

  .font-size-btn {
    min-width: 40px;
    height: 40px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-1);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  .font-size-btn.active {
    background: var(--color-primary-bg);
    border-color: var(--color-primary);
    color: var(--color-primary);
    font-weight: var(--font-weight-bold);
  }

  .font-size-btn:hover:not(.active) {
    background: var(--color-surface-muted);
  }

  .actions {
    margin-left: auto;
    display: flex;
    gap: var(--space-2);
  }

  /* 이력 버튼 — Liquid Glass tinted pill.
     비활성: 라이트 glass + 보라 hairline / 활성: 보라 tinted glass + 광택 + halo */
  .history-btn {
    /* fallback — backdrop-filter 미지원 환경에서도 의미 유지 */
    background: var(--color-surface);
    border-color: var(--color-history);
    color: var(--color-history);
    width: 48px;
    height: 48px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--glass-gloss);
  }

  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .history-btn {
      background: var(--glass-bg-history);
      backdrop-filter: blur(var(--glass-blur-button)) saturate(var(--glass-saturate));
      -webkit-backdrop-filter: blur(var(--glass-blur-button)) saturate(var(--glass-saturate));
    }
  }

  .history-btn:hover:not(.active) {
    background: var(--glass-bg-history-hover);
    color: var(--color-history-hover);
    border-color: var(--color-history-hover);
  }

  .history-btn.active {
    background: var(--color-history);
    border-color: var(--color-history);
    color: var(--color-text-inverse);
    box-shadow: var(--shadow-history-action), var(--glass-gloss);
  }

  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .history-btn.active {
      background: var(--glass-bg-history-active);
    }
  }

  .history-btn.active:hover {
    background: var(--color-history-hover);
    border-color: var(--color-history-hover);
  }

  .delete-btn {
    width: 48px;
    height: 48px;
    padding: 0;
    background: var(--color-action-destructive);
    border-color: var(--color-action-destructive);
    color: var(--color-text-inverse);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .delete-btn:hover:not(:disabled) {
    background: var(--color-action-destructive-hover);
    border-color: var(--color-action-destructive-hover);
  }

  /* 저장 — 1차 액션: Liquid Glass tinted pill (green tint + 상단 광택 + halo).
     색상으로 1차 의미를 잃지 않도록 tint 강도는 강하게(0.78 alpha) 유지. */
  .save-btn {
    /* fallback — 솔리드 green pill */
    background: var(--color-action-save);
    border-color: var(--color-action-save);
    color: var(--color-text-inverse);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1_5);
    padding: var(--space-1_5) var(--space-4);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-save-action), var(--glass-gloss);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.02em;
    transition: background-color var(--motion-fast) var(--ease-out),
                border-color var(--motion-fast) var(--ease-out),
                box-shadow var(--motion-base) var(--ease-out),
                transform var(--motion-fast) var(--ease-out);
  }

  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .save-btn {
      background: var(--glass-bg-save);
      border-color: rgba(255, 255, 255, 0.45);
      backdrop-filter: blur(var(--glass-blur-button)) saturate(var(--glass-saturate));
      -webkit-backdrop-filter: blur(var(--glass-blur-button)) saturate(var(--glass-saturate));
    }
  }

  .save-btn .save-label {
    line-height: 1;
  }

  /* :not(:disabled)으로 specificity 0,3,0 까지 올려 .btn:hover/.btn:active(0,3,0)을
     소스 순서로 우선시키지 않으면 glass-btn-hover(연한 azure)가 green bg를 덮어 버림 */
  .save-btn:hover:not(:disabled) {
    background: var(--glass-bg-save-hover);
    border-color: rgba(255, 255, 255, 0.6);
    box-shadow: var(--shadow-save-action-hover), var(--glass-gloss);
    transform: translateY(-1px);
  }

  .save-btn:active:not(:disabled) {
    background: var(--glass-bg-save);
    border-color: rgba(255, 255, 255, 0.45);
    transform: translateY(0) scale(0.97);
    box-shadow: var(--shadow-save-action);
    transition-duration: var(--motion-fast);
  }

  .save-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-save-action-hover), 0 0 0 3px rgba(82, 196, 26, 0.35);
  }

  /* orientation·thumbnail 토글 — .btn 글래스 톤을 그대로 상속, 색상만 tool 톤으로 */
  .orientation-btn,
  .thumbnail-toggle-btn {
    width: 48px;
    height: 48px;
    padding: 0;
    color: var(--color-text-tool);
  }

  /* Portrait mode: tighter spacing */
  @media (orientation: portrait) {
    .toolbar {
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
    }

    .toolbar-section {
      gap: var(--space-1_5);
    }
  }

  /* Landscape mode: 세로 공간 극대화를 위한 컴팩트 툴바 */
  @media (orientation: landscape) {
    .toolbar {
      gap: var(--space-2_5);
      padding: var(--space-1) var(--space-3);
    }
    .toolbar-section {
      gap: var(--space-1);
    }
    .btn {
      min-height: 36px;
      min-width: 36px;
      padding: var(--space-1) var(--space-2);
      font-size: var(--font-size-sm);
    }
    .tool-btn {
      width: 36px;
      height: 36px;
    }
    .page-info {
      padding: 2px var(--space-2);
      gap: var(--space-1);
    }
    .page-input {
      width: 30px;
      min-height: 28px;
      font-size: var(--font-size-sm);
      padding: var(--space-0_5) 0;
    }
    .zoom-info {
      min-width: 40px;
      font-size: var(--font-size-sm);
    }
    .color-swatch {
      width: 28px;
      height: 28px;
    }
    .color-picker {
      gap: var(--space-1);
    }
    .width-btn {
      width: 32px;
      height: 32px;
    }
    .width-picker {
      gap: var(--space-1);
    }
    .font-size-btn {
      min-width: 32px;
      height: 32px;
      font-size: 11px;
    }
    .font-size-picker {
      gap: var(--space-1);
    }
    .brush-settings {
      gap: var(--space-2_5);
    }
    .history-btn,
    .delete-btn,
    .orientation-btn,
    .thumbnail-toggle-btn {
      width: 36px;
      height: 36px;
    }
    .save-btn {
      padding: var(--space-1) var(--space-3);
      gap: var(--space-1);
    }
  }
</style>
