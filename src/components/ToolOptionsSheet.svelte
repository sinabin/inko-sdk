<script lang="ts">
  import { tick } from 'svelte'
  import { t } from '../lib/i18n/index.svelte'

  /** 시트가 다루는 도구 종류 — 헤더·색상·굵기·미리보기·추가 컨트롤 분기에 사용 */
  export type ToolSheetKind = 'pen' | 'highlighter' | 'rectangle' | 'circle' | 'line' | 'text'

  interface Props {
    isVisible: boolean
    /** 도구 종류 — 헤더·미리보기·컨트롤 분기 결정 */
    toolKind: ToolSheetKind
    /** 현재 색상 — 미리보기·swatch 활성 표시 */
    brushColor?: string
    /** 펜·형광펜·도형: brushWidth (px). 텍스트: fontSize (px). */
    brushWidth?: number
    /** 색상 프리셋 — 펜/도형/텍스트는 9색, 형광펜은 5색 */
    colorPresets?: string[]
    /** 굵기/크기 프리셋 (도구별 다름) */
    widthPresets?: number[]
    /** 펜 전용 — 필압 감도 0-100 */
    pressureSensitivity?: number
    /** 앵커 — 도구 버튼 좌표 */
    anchorLeft?: number
    anchorTop?: number
    onColorChange?: (color: string) => void
    onWidthChange?: (width: number) => void
    onPressureSensitivityChange?: (v: number) => void
    onClose?: () => void
  }

  let {
    isVisible,
    toolKind,
    brushColor = '#000000',
    brushWidth = 2,
    colorPresets = [],
    widthPresets = [],
    pressureSensitivity = 50,
    anchorLeft = 0,
    anchorTop = 56,
    onColorChange,
    onWidthChange,
    onPressureSensitivityChange,
    onClose
  }: Props = $props()

  // 도구별 메타 — 헤더·라벨·미리보기 형태·기능 표시 여부
  type PreviewShape = 'stroke' | 'rectangle' | 'circle' | 'line' | 'text'
  const TOOL_META: Record<ToolSheetKind, {
    header: string
    sizeLabel: string
    showPressure: boolean
    showCustomPicker: boolean
    /** 미리보기 stroke opacity (형광펜은 반투명) */
    previewOpacity: number
    /** 미리보기 형태 — 도구 의도와 1:1 대응 (Krug 1초 룰) */
    previewShape: PreviewShape
  }> = {
    pen:         { header: 'tool.pen',         sizeLabel: 'sheet.thickness',     showPressure: true,  showCustomPicker: true, previewOpacity: 1.0, previewShape: 'stroke' },
    highlighter: { header: 'tool.highlighter', sizeLabel: 'sheet.thickness',     showPressure: false, showCustomPicker: true, previewOpacity: 0.5, previewShape: 'stroke' },
    rectangle:   { header: 'tool.rectangle',   sizeLabel: 'sheet.lineThickness', showPressure: false, showCustomPicker: true, previewOpacity: 1.0, previewShape: 'rectangle' },
    circle:      { header: 'tool.circle',      sizeLabel: 'sheet.lineThickness', showPressure: false, showCustomPicker: true, previewOpacity: 1.0, previewShape: 'circle' },
    line:        { header: 'tool.line',        sizeLabel: 'sheet.lineThickness', showPressure: false, showCustomPicker: true, previewOpacity: 1.0, previewShape: 'line' },
    text:        { header: 'tool.text',        sizeLabel: 'sheet.size',          showPressure: false, showCustomPicker: true, previewOpacity: 1.0, previewShape: 'text' }
  }

  let meta = $derived(TOOL_META[toolKind])

  let dialogEl = $state<HTMLDialogElement | null>(null)
  let closeButtonEl = $state<HTMLButtonElement | null>(null)
  let returnFocusElement: HTMLElement | null = null

  $effect(() => {
    if (!isVisible || !dialogEl) return

    if (typeof document !== 'undefined') {
      const active = document.activeElement
      returnFocusElement = active instanceof HTMLElement && active !== document.body ? active : null
    }
    if (!dialogEl.open) {
      if (typeof dialogEl.showModal === 'function') dialogEl.showModal()
      else dialogEl.setAttribute('open', '')
    }
    tick().then(() => closeButtonEl?.focus())
  })

  function closeDialog(): void {
    if (!dialogEl?.open) return
    if (typeof dialogEl.close === 'function') dialogEl.close()
    else dialogEl.removeAttribute('open')
  }

  function handleClose(): void {
    const focusTarget = returnFocusElement?.isConnected
      ? returnFocusElement
      : typeof document !== 'undefined'
        ? document.querySelector<HTMLElement>(`.tool-btn[data-tool="${toolKind}"]`)
        : null
    closeDialog()
    onClose?.()
    setTimeout(() => focusTarget?.focus(), 0)
  }

  function handleBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) handleClose()
  }

  function handleDialogCancel(event: Event): void {
    event.preventDefault()
    handleClose()
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      handleClose()
      return
    }

    if (event.key !== 'Tab' || !dialogEl) return
    const focusable = Array.from(dialogEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => element.tabIndex >= 0 && !element.hasAttribute('hidden'))
    if (focusable.length === 0) {
      event.preventDefault()
      dialogEl.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // 미리보기 곡선 path
  const previewPath = 'M 10 28 C 30 8, 60 8, 80 22 S 110 32, 115 18'

  /** 미리보기 stroke style — 두께 너무 가늘면 최소 2 보장 */
  function getPreviewStyle(width: number): string {
    const w = Math.max(width, 2)
    return `stroke-width: ${w}; stroke-linecap: round; stroke-linejoin: round;`
  }

  // 커스텀 색상 picker — native input[type=color] 트리거
  let colorInputEl = $state<HTMLInputElement | null>(null)
  function openCustomColorPicker() {
    colorInputEl?.click()
  }
  function handleCustomColorInput(e: Event) {
    onColorChange?.((e.target as HTMLInputElement).value)
  }

  /** 현재 색상이 표준 프리셋 중 하나가 아니면 custom picker가 활성 표시 */
  let isCustomColorActive = $derived(
    !colorPresets.some(c => c.toLowerCase() === brushColor.toLowerCase())
  )

  /** 색상 grid 컬럼 수 — 9색(+picker)는 5열 2행, 5색은 5열 1행 */
  let colorGridCols = $derived(meta.showCustomPicker ? 5 : 5)

  // === 시트 위치 클램프 — viewport 밖으로 튀어나가지 않도록 ===
  const SHEET_WIDTH = 320
  const SHEET_MARGIN = 8
  let viewportWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024)
  let viewportHeight = $state(typeof window !== 'undefined' ? window.innerHeight : 768)

  function syncViewport() {
    if (typeof window !== 'undefined') {
      viewportWidth = window.innerWidth
      viewportHeight = window.innerHeight
    }
  }

  /** anchorLeft가 viewport 밖으로 가면 좌측으로 당겨 시트가 화면 안에 표시되도록 */
  let clampedLeft = $derived(
    Math.max(
      SHEET_MARGIN,
      Math.min(anchorLeft, viewportWidth - SHEET_WIDTH - SHEET_MARGIN)
    )
  )

  /** anchorTop이 viewport 하단을 넘으면 위로 — 일반적으로는 펜 버튼 아래라 문제 없음 */
  let clampedTop = $derived(
    Math.max(SHEET_MARGIN, Math.min(anchorTop, viewportHeight - SHEET_MARGIN - 200))
  )
</script>

<svelte:window onresize={syncViewport} />

{#if isVisible}
  <dialog
    bind:this={dialogEl}
    class="tool-sheet"
    style="left: {clampedLeft}px; top: {clampedTop}px"
    aria-modal="true"
    aria-labelledby="tool-options-heading"
    tabindex="-1"
    onclick={handleBackdrop}
    onkeydown={handleKeyDown}
    oncancel={handleDialogCancel}
  >
    <header class="tool-sheet-header">
      <h3 id="tool-options-heading">{t('sheet.dialogLabel', { header: t(meta.header) })}</h3>
      <button
        bind:this={closeButtonEl}
        type="button"
        class="sheet-close-btn"
        onclick={handleClose}
        aria-label={t('sheet.closeLabel', { header: t(meta.header) })}
        title={t('sheet.closeLabel', { header: t(meta.header) })}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </header>

    <!-- 미리보기 — 도구 의도와 1:1 대응 (Norman 어포던스, Krug 1초 룰) -->
    <div class="tool-preview" aria-hidden="true">
      {#if meta.previewShape === 'text'}
        <svg viewBox="0 0 220 60" width="220" height="60">
          <text
            x="50%"
            y="50%"
            text-anchor="middle"
            dominant-baseline="central"
            fill={brushColor}
            font-size={Math.min(brushWidth * 0.7, 36)}
            font-weight="500"
          >{t('sheet.textPreviewSample')}</text>
        </svg>
      {:else if meta.previewShape === 'rectangle'}
        <svg viewBox="0 0 120 40" width="220" height="60" fill="none">
          <rect
            x="14"
            y="6"
            width="92"
            height="28"
            rx="2"
            stroke={brushColor}
            stroke-width={Math.max(Math.min(brushWidth, 8), 1)}
          />
        </svg>
      {:else if meta.previewShape === 'circle'}
        <svg viewBox="0 0 120 40" width="220" height="60" fill="none">
          <circle
            cx="60"
            cy="20"
            r="14"
            stroke={brushColor}
            stroke-width={Math.max(Math.min(brushWidth, 8), 1)}
          />
        </svg>
      {:else if meta.previewShape === 'line'}
        <svg viewBox="0 0 120 40" width="220" height="60" fill="none">
          <line
            x1="14"
            y1="20"
            x2="106"
            y2="20"
            stroke={brushColor}
            stroke-width={Math.max(Math.min(brushWidth, 12), 1)}
            stroke-linecap="round"
          />
        </svg>
      {:else}
        <!-- pen / highlighter — stroke 곡선 -->
        <svg viewBox="0 0 120 40" width="220" height="60" fill="none" style="opacity: {meta.previewOpacity}">
          <path d={previewPath} stroke={brushColor} style={getPreviewStyle(brushWidth)}/>
        </svg>
      {/if}
    </div>

    <!-- 색상 -->
    <section class="tool-section">
      <h4 id="tool-options-color-heading" class="tool-section-label">{t('sheet.color')}</h4>
      <div class="color-grid" style="--color-cols: {colorGridCols}" role="group" aria-labelledby="tool-options-color-heading">
        {#each colorPresets as color (color)}
          <button
            type="button"
            class="color-swatch-sheet"
            class:active={brushColor.toLowerCase() === color.toLowerCase()}
            style="background-color: {color}; border-color: {color};"
            onclick={() => onColorChange?.(color)}
            aria-label={t('sheet.colorSwatch', { color })}
            aria-pressed={brushColor.toLowerCase() === color.toLowerCase()}
          ></button>
        {/each}
        {#if meta.showCustomPicker}
          <button
            type="button"
            class="color-swatch-sheet color-picker-trigger"
            class:active={isCustomColorActive}
            onclick={openCustomColorPicker}
            aria-label={t('sheet.customColorPick')}
            aria-pressed={isCustomColorActive}
            title={t('sheet.customColor')}
          >
            <!-- 무지개는 항상 표시 — picker임을 영구 어포던스 -->
            <span class="color-picker-rainbow"></span>
            <!-- 활성 시(현재 색이 커스텀일 때) 가운데에 현재 색 dot 표시 -->
            {#if isCustomColorActive}
              <span class="color-picker-current-dot" style="background-color: {brushColor}"></span>
            {/if}
          </button>
          <input
            bind:this={colorInputEl}
            type="color"
            value={brushColor}
            oninput={handleCustomColorInput}
            class="hidden-color-input"
            tabindex="-1"
            aria-hidden="true"
          />
        {/if}
      </div>
    </section>

    <!-- 굵기/크기 -->
    <section class="tool-section">
      <h4 id="tool-options-size-heading" class="tool-section-label">{t(meta.sizeLabel)}</h4>
      <div class="width-grid" style="--width-cols: {widthPresets.length}" role="group" aria-labelledby="tool-options-size-heading">
        {#each widthPresets as w (w)}
          <button
            type="button"
            class="width-btn-sheet"
            class:active={brushWidth === w}
            onclick={() => onWidthChange?.(w)}
            aria-label={t('sheet.widthSwatch', { label: t(meta.sizeLabel), n: w })}
            aria-pressed={brushWidth === w}
          >
            {#if toolKind === 'text'}
              <!-- 텍스트는 폰트 크기 숫자 표시 -->
              <span class="size-label" style="font-size: {Math.min(w * 0.55, 20)}px">{w}</span>
            {:else}
              <!-- 그 외는 SVG line으로 stroke 두께 시각화 -->
              <svg viewBox="0 0 32 18" width="32" height="18" fill="none" stroke="currentColor" stroke-linecap="round" class="width-stroke">
                <line x1="4" y1="9" x2="28" y2="9" stroke-width={Math.min(w, 14)}/>
              </svg>
            {/if}
          </button>
        {/each}
      </div>
    </section>

    <!-- 필압 감도 — 펜 도구 전용 -->
    {#if meta.showPressure}
      <section class="tool-section">
        <div class="slider-row">
          <div class="slider-head">
            <label for="pressure-sens-slider" class="slider-label">{t('sheet.pressure')}</label>
            <output id="pressure-sens-value" class="slider-value" for="pressure-sens-slider">{pressureSensitivity}%</output>
          </div>
          <input
            id="pressure-sens-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            value={pressureSensitivity}
            oninput={(e) => onPressureSensitivityChange?.(parseInt((e.target as HTMLInputElement).value))}
            class="slider"
            style="--progress: {pressureSensitivity}%"
            aria-label={t('sheet.pressure')}
            aria-describedby="pressure-sens-value"
          />
        </div>
      </section>
    {/if}
  </dialog>
{/if}

<style>
  .tool-sheet::backdrop {
    background: transparent;
  }

  .tool-sheet {
    position: fixed;
    inset: auto;
    margin: 0;
    z-index: var(--z-sheet);
    width: 320px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-4);
    max-width: calc(100vw - var(--space-4));
  }

  .tool-sheet-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .tool-sheet-header h3 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
    text-align: center;
    flex: 1;
  }

  .sheet-close-btn {
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-2xl);
    line-height: 1;
  }

  .sheet-close-btn:hover {
    background: var(--color-surface-muted);
  }

  .tool-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 64px;
    background: var(--color-surface-muted);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-3);
  }

  .tool-section {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-light);
  }

  .tool-section-label {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-secondary);
  }

  /* === 색상 swatch grid — minmax로 swatch 폭 cap, 좌측 정렬 === */
  .color-grid {
    display: grid;
    grid-template-columns: repeat(var(--color-cols), minmax(0, 40px));
    gap: var(--space-2);
    justify-content: start;
  }

  .color-swatch-sheet {
    width: 100%;
    min-width: 0;             /* grid item min-content 무력화 */
    max-width: 40px;          /* swatch 비대화 방지 */
    aspect-ratio: 1 / 1;
    border: 2px solid;
    border-radius: var(--radius-full);
    cursor: pointer;
    padding: 0;
    transition: transform var(--motion-fast) var(--ease-spring),
                box-shadow var(--motion-fast) var(--ease-out);
  }

  .color-swatch-sheet:hover:not(.active) {
    transform: scale(1.08);
  }

  .color-swatch-sheet.active {
    transform: scale(1.18);
    box-shadow: var(--shadow-focus-ring);
  }

  /* 커스텀 색상 picker — 무지개 conic으로 picker 의미 영구 표시, 활성 시 가운데 현재 색 dot */
  .color-picker-trigger {
    border-color: var(--color-border-strong);
    background-color: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }

  .color-picker-rainbow {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-full);
    background: conic-gradient(
      from 0deg,
      #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444
    );
  }

  .color-picker-current-dot {
    position: absolute;
    width: 50%;
    height: 50%;
    border-radius: var(--radius-full);
    border: 2px solid var(--color-surface);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
  }

  .hidden-color-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: 0;
    border: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    pointer-events: none;
    opacity: 0;
  }

  /* === 굵기/크기 grid === */
  .width-grid {
    display: grid;
    grid-template-columns: repeat(var(--width-cols), minmax(0, 1fr));
    gap: var(--space-1_5);
  }

  .width-btn-sheet {
    width: 100%;
    height: 36px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--color-text-primary);
    transition: border-color var(--motion-fast) var(--ease-out),
                background-color var(--motion-fast) var(--ease-out),
                color var(--motion-fast) var(--ease-out);
  }

  .width-btn-sheet:hover:not(.active) {
    border-color: var(--color-border-divider);
  }

  .width-btn-sheet.active {
    background: var(--color-primary-bg);
    border-color: var(--color-primary-strong-hover);
    color: var(--color-primary-strong-hover);
  }

  .width-stroke {
    display: block;
  }

  .size-label {
    font-weight: var(--font-weight-semibold);
    line-height: 1;
  }

  /* === Slider === */
  .slider-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
  }

  .slider-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .slider-label {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-secondary);
  }

  .slider-value {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-primary-strong-hover);
    font-variant-numeric: tabular-nums;
    min-width: 36px;
    text-align: right;
  }

  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: var(--radius-full);
    background: linear-gradient(
      to right,
      var(--color-primary-strong-hover) 0%,
      var(--color-primary-strong-hover) var(--progress),
      var(--color-border-light) var(--progress),
      var(--color-border-light) 100%
    );
    outline: none;
    cursor: pointer;
    transition: background var(--motion-fast) var(--ease-out);
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    background: var(--color-surface);
    border: 2px solid var(--color-primary-strong-hover);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: transform var(--motion-fast) var(--ease-spring),
                box-shadow var(--motion-fast) var(--ease-out);
  }

  .slider::-webkit-slider-thumb:hover {
    transform: scale(1.18);
    box-shadow: var(--shadow-md);
  }

  .slider::-webkit-slider-thumb:active {
    transform: scale(1.08);
  }

  .slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    background: var(--color-surface);
    border: 2px solid var(--color-primary-strong-hover);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: transform var(--motion-fast) var(--ease-spring);
  }

  .slider::-moz-range-thumb:hover {
    transform: scale(1.18);
  }

  .slider:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 4px;
  }

  .slider:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px rgba(24, 144, 255, 0.25), var(--shadow-sm);
  }

  .sheet-close-btn:focus-visible,
  .color-swatch-sheet:focus-visible,
  .width-btn-sheet:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 2px;
  }

  /* landscape — 시트 좁게 */
  @media (orientation: landscape) {
    .tool-sheet {
      width: 280px;
      padding: var(--space-3);
    }
    .tool-preview {
      height: 50px;
    }
  }
</style>
