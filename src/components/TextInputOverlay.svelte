<script lang="ts">
  import { tick } from 'svelte'
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

  let inputText = $state('')
  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let dialogEl = $state<HTMLDialogElement | null>(null)
  let returnFocusElement: HTMLElement | null = null
  // IME(한글·일본어 등) 조합 진행 중 추적 — 합성 중 Enter는 문자 선택용이지 confirm 아님
  let isComposing = false

  // 표시 상태 변경 시 텍스트 초기화 + 모달 초기 포커스
  $effect(() => {
    if (!isVisible || !dialogEl) return

    inputText = initialText
    if (typeof document !== 'undefined') {
      const active = document.activeElement
      returnFocusElement = active instanceof HTMLElement && active !== document.body ? active : null
    }
    if (!dialogEl.open) {
      if (typeof dialogEl.showModal === 'function') dialogEl.showModal()
      else dialogEl.setAttribute('open', '')
    }
    tick().then(() => {
      textareaEl?.focus()
      textareaEl?.select()
    })
  })

  function handleConfirm() {
    closeDialog()
    onConfirm?.(inputText)
    restoreFocus()
  }

  function handleCancel() {
    closeDialog()
    onCancel?.()
    restoreFocus()
  }

  function closeDialog(): void {
    if (!dialogEl?.open) return
    if (typeof dialogEl.close === 'function') dialogEl.close()
    else dialogEl.removeAttribute('open')
  }

  function restoreFocus(): void {
    const focusTarget = returnFocusElement?.isConnected
      ? returnFocusElement
      : typeof document !== 'undefined'
        ? document.querySelector<HTMLElement>('.tool-btn[data-tool="text"]')
        : null
    setTimeout(() => focusTarget?.focus(), 0)
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
      event.preventDefault()
      event.stopPropagation()
      handleCancel()
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      handleCancel()
      return
    }

    if (event.key !== 'Tab' || !dialogEl) return
    const focusable = Array.from(dialogEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])'
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

  function handleDialogCancel(event: Event): void {
    event.preventDefault()
    handleCancel()
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
  <dialog
    bind:this={dialogEl}
    class="overlay-dialog"
    aria-modal="true"
    aria-labelledby="text-input-dialog-title"
    aria-describedby="text-input-dialog-instructions"
    tabindex="-1"
    onclick={handleBackdropClick}
    onkeydown={handleDialogKeyDown}
    oncancel={handleDialogCancel}
  >
    <div class="input-container">
      <h2 id="text-input-dialog-title">{t('text.dialogTitle')}</h2>
      <p id="text-input-dialog-instructions" class="visually-hidden">{t('text.instructions')}</p>
      <label for="text-input-overlay-field" class="text-input-label">{t('text.inputLabel')}</label>
      <textarea
        id="text-input-overlay-field"
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
      <fieldset class="font-size-row">
        <legend class="font-size-label">{t('text.fontSizeGroup')}</legend>
        {#each fontSizePresets as size}
          <button
            type="button"
            class="font-size-chip"
            class:active={fontSize === size}
            onclick={() => onFontSizeChange?.(size)}
            aria-label={t('text.fontSizeOption', { size })}
            aria-pressed={fontSize === size}
          >
            {size}
          </button>
        {/each}
      </fieldset>
      <div class="button-row">
        <button type="button" class="btn cancel-btn" onclick={handleCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" class="btn confirm-btn" onclick={handleConfirm}>
          {t('common.confirm')}
        </button>
      </div>
    </div>
  </dialog>
{/if}

<style>
  .overlay-dialog {
    width: min(480px, calc(100vw - 48px));
    max-width: none;
    max-height: calc(100vh - 48px);
    margin: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    overflow: visible;
  }

  .overlay-dialog::backdrop {
    background: var(--color-surface-overlay);
  }

  .input-container {
    width: 100%;
    background: var(--color-surface);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-4);
  }

  .input-container h2 {
    margin: 0 0 var(--space-3);
    color: var(--color-text-primary);
    font-size: var(--font-size-xl);
  }

  .text-input-label {
    display: block;
    margin-bottom: var(--space-1_5);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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

  .text-input:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 2px;
    border-color: var(--color-primary);
    box-shadow: var(--shadow-focus-soft);
  }

  .font-size-row {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
    margin-top: var(--space-2);
    padding: 0;
    border: 0;
  }

  .font-size-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    margin-right: var(--space-0_5);
    padding: 0;
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
    background: var(--color-primary-strong-hover);
    border-color: var(--color-primary-strong-hover);
    color: var(--color-text-inverse);
    font-weight: var(--font-weight-semibold);
  }

  .font-size-chip:hover:not(.active) {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .font-size-chip:focus-visible,
  .btn:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 2px;
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
    background: var(--color-primary-strong-hover);
    border-color: var(--color-primary-strong-hover);
    color: var(--color-text-inverse);
  }

  .confirm-btn:hover {
    background: var(--color-primary-strong-hover);
    border-color: var(--color-primary-strong-hover);
  }
</style>
