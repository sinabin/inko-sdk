<script lang="ts">
  import { fly, fade } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    isVisible: boolean
    /** 현재 펜 색상 — 미리보기·swatch 활성 표시에 사용 */
    brushColor?: string
    /** 현재 펜 굵기 (1.0x 기준 px) */
    brushWidth?: number
    /** 색상 프리셋 */
    colorPresets?: string[]
    /** 굵기 프리셋 (px) */
    widthPresets?: number[]
    /** 필압 감도 0-100 */
    pressureSensitivity?: number
    /** 앵커 위치 — 펜 버튼 좌측 px (PdfToolbar에서 측정해 전달) */
    anchorLeft?: number
    /** 앵커 위치 — 툴바 하단 y (px) */
    anchorTop?: number
    onColorChange?: (color: string) => void
    onWidthChange?: (width: number) => void
    onPressureSensitivityChange?: (v: number) => void
    onClose?: () => void
  }

  let {
    isVisible,
    brushColor = '#000000',
    brushWidth = 2,
    colorPresets = ['#000000', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899'],
    widthPresets = [1, 2, 4, 6, 8, 12],
    pressureSensitivity = 50,
    anchorLeft = 0,
    anchorTop = 56,
    onColorChange,
    onWidthChange,
    onPressureSensitivityChange,
    onClose
  }: Props = $props()

  // 커스텀 색상 picker — native input[type=color]을 hidden 처리하고 디자인된 버튼으로 트리거
  let colorInputEl: HTMLInputElement
  function openCustomColorPicker() {
    colorInputEl?.click()
  }
  function handleCustomColorInput(e: Event) {
    const value = (e.target as HTMLInputElement).value
    onColorChange?.(value)
  }
  /** 현재 색상이 표준 프리셋 중 하나인지 — 아니면 custom picker 셀에 활성 표시 */
  let isCustomColorActive = $derived(!colorPresets.some(c => c.toLowerCase() === brushColor.toLowerCase()))

  function handleBackdrop() {
    onClose?.()
  }

  // ESC 키로 닫기
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose?.()
  }

  // 미리보기 SVG path — 가운데 곡선
  const previewPath = 'M 10 28 C 30 8, 60 8, 80 22 S 110 32, 115 18'

  /** 메인 미리보기 — 실제 brushWidth 반영 (너무 가늘면 최소 2px) */
  function getPreviewStyle(width: number): string {
    const w = Math.max(width, 2)
    return `stroke-width: ${w}; stroke-linecap: round; stroke-linejoin: round;`
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if isVisible}
  <!-- 투명 backdrop — 외부 클릭으로 닫기 -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="pen-sheet-backdrop" onclick={handleBackdrop} transition:fade={{ duration: 120 }}></div>

  <!-- 시트 본체 — 펜 버튼 아래 떠있는 popover -->
  <div
    class="pen-sheet"
    style="left: {anchorLeft}px; top: {anchorTop}px"
    role="dialog"
    aria-label={t('sheet.dialogLabel', { header: t('tool.pen') })}
    transition:fly={{ y: -8, duration: 200, easing: cubicOut, opacity: 0 }}
  >
    <header class="pen-sheet-header">
      <h3>{t('tool.pen')}</h3>
    </header>

    <!-- 메인 미리보기 — 현재 색상 + 굵기 즉시 반영 (Krug 1초 룰) -->
    <div class="pen-preview">
      <svg viewBox="0 0 120 40" width="220" height="60" fill="none">
        <path d={previewPath} stroke={brushColor} style={getPreviewStyle(brushWidth)}/>
      </svg>
    </div>

    <!-- 색상 — 9개 표준 swatch + 1 custom picker (5×2 grid) -->
    <section class="pen-section">
      <h4 class="pen-section-label">{t('sheet.color')}</h4>
      <div class="color-grid">
        {#each colorPresets as color (color)}
          <button
            class="color-swatch-sheet"
            class:active={brushColor.toLowerCase() === color.toLowerCase()}
            style="background-color: {color}; border-color: {color};"
            onclick={() => onColorChange?.(color)}
            aria-label={t('sheet.colorSwatch', { color })}
            aria-pressed={brushColor.toLowerCase() === color.toLowerCase()}
          ></button>
        {/each}
        <!-- 커스텀 색상 picker — native input[type=color] 트리거 -->
        <button
          class="color-swatch-sheet color-picker-trigger"
          class:active={isCustomColorActive}
          onclick={openCustomColorPicker}
          aria-label={t('sheet.customColorPick')}
          title={t('sheet.customColor')}
          style="background-color: {isCustomColorActive ? brushColor : 'transparent'}"
        >
          {#if !isCustomColorActive}
            <span class="color-picker-rainbow"></span>
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
      </div>
    </section>

    <!-- 굵기 — 실제 stroke 미리보기 (사용자가 그릴 선 형태 그대로) -->
    <section class="pen-section">
      <h4 class="pen-section-label">{t('sheet.thickness')}</h4>
      <div class="width-grid">
        {#each widthPresets as w (w)}
          <button
            class="width-btn-sheet"
            class:active={brushWidth === w}
            onclick={() => onWidthChange?.(w)}
            aria-label={t('sheet.widthSwatch', { label: t('sheet.thickness'), n: w })}
            aria-pressed={brushWidth === w}
          >
            <svg viewBox="0 0 32 18" width="32" height="18" fill="none" stroke="currentColor" stroke-linecap="round" class="width-stroke">
              <line x1="4" y1="9" x2="28" y2="9" stroke-width={w}/>
            </svg>
          </button>
        {/each}
      </div>
    </section>

    <!-- 필압 감도 (S Pen 등 압력 지원 입력에 영향) -->
    <section class="pen-section">
      <div class="slider-row">
        <div class="slider-head">
          <label for="pressure-sens-slider" class="slider-label">{t('sheet.pressure')}</label>
          <span class="slider-value">{pressureSensitivity}%</span>
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
        />
      </div>
    </section>
  </div>
{/if}

<style>
  .pen-sheet-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 999;
  }

  .pen-sheet {
    position: fixed;
    z-index: 1000;
    width: 320px;
    /* fallback — backdrop-filter 미지원·reduced-transparency 시 솔리드 */
    background: var(--color-surface);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-4);
    max-width: calc(100vw - var(--space-4));
  }

  /* Liquid Glass — 컨텐츠 위에 떠 있다는 위계를 재료성으로 표현 (Ive)
     scope: 시트 본체에만, blur는 자기 영역에만 적용 → 60fps 영향 미미 */
  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .pen-sheet {
      background: var(--glass-bg-strong);
      border-color: var(--glass-border);
      backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
      box-shadow: var(--shadow-glass), var(--glass-gloss);
    }
  }

  .pen-sheet-header {
    margin-bottom: var(--space-2);
  }

  .pen-sheet-header h3 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
    text-align: center;
  }

  /* 미리보기 영역 — 색상·굵기 즉시 반영. glass 위에서 stroke 가독성 위해 내부는 살짝 단단한 톤 */
  .pen-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 64px;
    background: var(--color-surface-muted);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-3);
  }

  /* === 섹션 (색상·굵기·필압) — 일관된 헤더와 spacing === */
  .pen-section {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-light);
  }

  .pen-section-label {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-secondary);
  }

  /* === 색상 swatch grid (5열 × 2행 = 10셀, 마지막은 custom picker) === */
  .color-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-2);
  }

  .color-swatch-sheet {
    width: 100%;
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

  /* 커스텀 색상 trigger — 비활성 시 무지개 conic-gradient, 활성 시 선택된 색 채움 */
  .color-picker-trigger {
    border-color: var(--color-border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .color-picker-rainbow {
    width: 70%;
    height: 70%;
    border-radius: var(--radius-full);
    background: conic-gradient(
      from 0deg,
      #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444
    );
  }

  /* native input[type=color] — 시각적으로 숨기되 click()으로 트리거 가능하게 유지 */
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

  /* === 굵기 막대 grid (가로 균등) === */
  .width-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
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
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .width-stroke {
    display: block;
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
    color: var(--color-primary);
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
      var(--color-primary) 0%,
      var(--color-primary) var(--progress),
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
    border: 2px solid var(--color-primary);
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
    border: 2px solid var(--color-primary);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: transform var(--motion-fast) var(--ease-spring);
  }

  .slider::-moz-range-thumb:hover {
    transform: scale(1.18);
  }

  .slider:focus-visible {
    outline: none;
  }

  .slider:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px rgba(24, 144, 255, 0.25), var(--shadow-sm);
  }

  /* landscape 컴팩트 — 가로 모드에서 시트 좁게 */
  @media (orientation: landscape) {
    .pen-sheet {
      width: 280px;
      padding: var(--space-3);
    }
    .pen-preview {
      height: 50px;
    }
  }
</style>
