<script lang="ts">
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    isVisible: boolean
    initialText?: string
    fontSize?: number
    onConfirm?: (text: string) => void
    onCancel?: () => void
    onFontSizeChange?: (size: number) => void
  }

  let {
    isVisible = false,
    initialText = '',
    fontSize = 16,
    onConfirm,
    onCancel,
    onFontSizeChange
  }: Props = $props()

  const fontSizePresets = [12, 16, 20, 24, 32, 48]

  let inputText = $state(initialText)
  let textareaEl: HTMLTextAreaElement | null = null
  // IME(한글·일본어 등) 조합 진행 중 추적 — 합성 중 Enter는 문자 선택용이지 confirm 아님
  let isComposing = false

  // 표시 상태 변경 시 텍스트 초기화
  $effect(() => {
    if (isVisible) {
      inputText = initialText
      // 렌더링 후 textarea 포커스
      setTimeout(() => {
        textareaEl?.focus()
        textareaEl?.select()
      }, 0)
    }
  })

  function handleConfirm() {
    onConfirm?.(inputText)
  }

  function handleCancel() {
    onCancel?.()
  }

  function handleKeyDown(event: KeyboardEvent) {
    // IME 합성 중에는 Enter/Escape를 가로채지 않음 (한글 조합 완료 신호와 충돌)
    // KeyboardEvent.isComposing은 합성 중 true. 일부 브라우저는 keyCode 229 사용
    if (isComposing || event.isComposing || event.keyCode === 229) {
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleConfirm()
    } else if (event.key === 'Escape') {
      handleCancel()
    }
  }

  function handleCompositionStart() {
    isComposing = true
  }

  function handleCompositionEnd() {
    isComposing = false
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleCancel()
    }
  }
</script>

{#if isVisible}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="overlay-backdrop" onclick={handleBackdropClick}>
    <div class="input-container">
      <textarea
        bind:this={textareaEl}
        bind:value={inputText}
        onkeydown={handleKeyDown}
        oncompositionstart={handleCompositionStart}
        oncompositionend={handleCompositionEnd}
        placeholder={t('text.placeholder')}
        rows="3"
        class="text-input"
        style="font-size: {Math.min(fontSize, 32)}px"
      ></textarea>
      <div class="font-size-row">
        <span class="font-size-label">{t('sheet.size')}</span>
        {#each fontSizePresets as size}
          <button
            class="font-size-chip"
            class:active={fontSize === size}
            onclick={() => onFontSizeChange?.(size)}
          >
            {size}
          </button>
        {/each}
      </div>
      <div class="button-row">
        <button class="btn cancel-btn" onclick={handleCancel}>
          {t('common.cancel')}
        </button>
        <button class="btn confirm-btn" onclick={handleConfirm}>
          {t('common.confirm')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--color-surface-overlay);
    z-index: var(--z-text-modal-backdrop);
  }

  .input-container {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: calc(100vw - 48px);
    max-width: 480px;
    background: var(--color-surface);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-4);
    z-index: var(--z-text-modal);
  }

  .text-input {
    width: 100%;
    padding: var(--space-3);
    border: 2px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-lg);
    resize: vertical;
    min-height: 80px;
  }

  .text-input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: var(--shadow-focus-soft);
  }

  .font-size-row {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
    margin-top: var(--space-2);
  }

  .font-size-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    margin-right: var(--space-0_5);
  }

  .font-size-chip {
    padding: var(--space-1) var(--space-2_5);
    border: 1px solid #d9d9d9;
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    font-size: var(--font-size-sm);
    min-height: 32px;
    transition: all var(--motion-fast) var(--ease-out);
  }

  .font-size-chip.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
    font-weight: var(--font-weight-semibold);
  }

  .font-size-chip:hover:not(.active) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .button-row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .btn {
    padding: var(--space-2_5) var(--space-6);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    cursor: pointer;
    font-size: var(--font-size-lg);
    transition: all var(--motion-base) var(--ease-out);
    min-height: 48px;
    min-width: 80px;
  }

  .cancel-btn:hover {
    background: var(--color-surface-muted);
  }

  .confirm-btn {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .confirm-btn:hover {
    background: var(--color-primary-hover);
    border-color: var(--color-primary-hover);
  }
</style>
