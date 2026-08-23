<script lang="ts">
  /**
   * 전역 에러·경고·알림 토스트 표시
   * errorReporter 큐를 구독해 자동 dismiss·수동 닫기 처리
   */
  import { errorReporter } from '$lib/utils/errorReporter.svelte'
  import { t } from '$lib/i18n/index.svelte'

  const toasts = $derived(errorReporter.items)

  const categoryKey: Record<string, string> = {
    parse: 'error.categoryParse',
    render: 'error.categoryRender',
    storage: 'error.categoryStorage',
    bridge: 'error.categoryBridge',
    tool: 'error.categoryTool',
    network: 'error.categoryNetwork',
    unknown: 'error.categoryUnknown'
  }
</script>

<div class="toast-stack" aria-live="polite" role="status">
  {#each toasts as toast (toast.id)}
    <button
      type="button"
      class="toast toast-{toast.kind}"
      onclick={() => errorReporter.dismiss(toast.id)}
      aria-label={t('common.closeNotification')}
    >
      <span class="badge">{categoryKey[toast.category] ? t(categoryKey[toast.category]) : toast.category}</span>
      <span class="message">{toast.message}</span>
      {#if toast.detail}
        <span class="detail">{toast.detail}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    max-width: min(420px, calc(100vw - 32px));
  }

  .toast {
    pointer-events: auto;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    row-gap: 4px;
    align-items: center;
    padding: 10px 14px;
    border: 1px solid transparent;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.4;
    background: #fff;
    color: #111;
    animation: slide-in 180ms ease-out;
  }

  .toast:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }

  .badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.08);
    white-space: nowrap;
  }

  .message {
    font-weight: 500;
  }

  .detail {
    grid-column: 1 / -1;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.6);
    word-break: break-word;
  }

  .toast-error {
    background: #fef2f2;
    border-color: #fca5a5;
    color: #7f1d1d;
  }
  .toast-error .badge { background: #fecaca; color: #7f1d1d; }

  .toast-warning {
    background: #fffbeb;
    border-color: #fcd34d;
    color: #78350f;
  }
  .toast-warning .badge { background: #fde68a; color: #78350f; }

  .toast-info {
    background: #eff6ff;
    border-color: #93c5fd;
    color: #1e3a8a;
  }
  .toast-info .badge { background: #bfdbfe; color: #1e3a8a; }

  @keyframes slide-in {
    from { opacity: 0; transform: translateX(20px); }
    to   { opacity: 1; transform: translateX(0); }
  }
</style>
