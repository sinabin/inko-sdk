<script lang="ts">
  import './toolbar-shared.css'
  import { t } from '../../lib/i18n/index.svelte'
  import { toolbarRovingGroup } from '../../lib/accessibility/toolbarRoving'

  interface Props {
    currentPage: number
    totalPages: number
    showThumbnails: boolean
    isOutlinePanelVisible: boolean
    hasOutline: boolean
    thumbnailsEnabled: boolean
    bookmarksEnabled: boolean
    pageNavEnabled: boolean
    onPageChange?: (page: number) => void
    onToggleThumbnails?: () => void
    onToggleOutline?: () => void
  }

  let {
    currentPage,
    totalPages,
    showThumbnails,
    isOutlinePanelVisible,
    hasOutline,
    thumbnailsEnabled,
    bookmarksEnabled,
    pageNavEnabled,
    onPageChange,
    onToggleThumbnails,
    onToggleOutline
  }: Props = $props()

  function handlePrevPage() {
    if (currentPage > 1) onPageChange?.(currentPage - 1)
  }

  function handleNextPage() {
    if (currentPage < totalPages) onPageChange?.(currentPage + 1)
  }

  function handlePageInput(event: Event) {
    const input = event.target as HTMLInputElement
    const page = parseInt(input.value)
    if (page >= 1 && page <= totalPages) {
      onPageChange?.(page)
    } else {
      input.value = String(currentPage)
    }
  }

  /** blur 시에도 빈 값·범위 밖 입력을 현재 페이지로 복원 */
  function handlePageBlur(event: FocusEvent) {
    const input = event.target as HTMLInputElement
    const page = parseInt(input.value)
    if (!(page >= 1 && page <= totalPages)) input.value = String(currentPage)
  }
</script>

<div
  class="toolbar-section inko-toolbar-section"
  role="group"
  aria-label={t('toolbar.navigationGroup')}
  use:toolbarRovingGroup
>
  <button
    type="button"
    class="btn inko-toolbar-button thumbnail-toggle-btn"
    onclick={onToggleThumbnails}
    style:display={thumbnailsEnabled ? undefined : 'none'}
    title={showThumbnails ? t('toolbar.thumbnailsHide') : t('toolbar.thumbnailsShow')}
    aria-label={showThumbnails ? t('toolbar.thumbnailsHide') : t('toolbar.thumbnailsShow')}
    aria-expanded={showThumbnails}
    aria-controls="pdf-thumbnail-sidebar"
  >
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {#if showThumbnails}
        <rect x="3" y="4" width="6" height="16" rx="1.5" fill="currentColor" fill-opacity="0.18" stroke-width="2"/>
        <line x1="12" y1="7" x2="20" y2="7"/>
        <line x1="12" y1="12" x2="20" y2="12"/>
        <line x1="12" y1="17" x2="16.5" y2="17"/>
      {:else}
        <rect x="3" y="4" width="6" height="16" rx="1.5" stroke-dasharray="2.5 2.5"/>
        <line x1="12" y1="7" x2="20" y2="7"/>
        <line x1="12" y1="12" x2="20" y2="12"/>
        <line x1="12" y1="17" x2="16.5" y2="17"/>
      {/if}
    </svg>
  </button>

  {#if hasOutline && bookmarksEnabled}
    <button
      type="button"
      class="btn inko-toolbar-button outline-toggle-btn"
      class:active={isOutlinePanelVisible}
      onclick={onToggleOutline}
      aria-pressed={isOutlinePanelVisible}
      aria-expanded={isOutlinePanelVisible}
      aria-controls="inko-outline-panel"
      title={isOutlinePanelVisible ? t('toolbar.bookmarksHide') : t('toolbar.bookmarksShow')}
      aria-label={isOutlinePanelVisible ? t('toolbar.bookmarksHide') : t('toolbar.bookmarksShow')}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path
          d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"
          fill={isOutlinePanelVisible ? 'currentColor' : 'none'}
          fill-opacity={isOutlinePanelVisible ? '0.18' : '0'}
        />
      </svg>
    </button>
  {/if}

  <button
    type="button"
    class="btn inko-toolbar-button"
    onclick={handlePrevPage}
    disabled={currentPage <= 1}
    style:display={pageNavEnabled ? undefined : 'none'}
    title={t('toolbar.prevPage')}
    aria-label={t('toolbar.prevPage')}
  >
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  </button>
  <span class="page-info" style:display={pageNavEnabled ? undefined : 'none'}>
    <input
      type="number"
      value={currentPage}
      min="1"
      max={totalPages}
      onchange={handlePageInput}
      onblur={handlePageBlur}
      onfocus={(event) => (event.target as HTMLInputElement).select()}
      class="page-input"
      aria-label={t('toolbar.currentPage')}
    />
    <span class="page-divider" aria-hidden="true">/</span>
    <span class="page-total">{totalPages}</span>
  </span>
  <button
    type="button"
    class="btn inko-toolbar-button"
    onclick={handleNextPage}
    disabled={currentPage >= totalPages}
    style:display={pageNavEnabled ? undefined : 'none'}
    title={t('toolbar.nextPage')}
    aria-label={t('toolbar.nextPage')}
  >
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  </button>
</div>

<style>
  .outline-toggle-btn.active {
    color: var(--color-primary, #1890ff);
  }

  .outline-toggle-btn:focus-visible {
    outline: 2px solid var(--color-focus-ring, var(--color-primary));
    outline-offset: 2px;
  }

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

  .page-input:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
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

  .thumbnail-toggle-btn {
    width: 48px;
    height: 48px;
    padding: 0;
    color: var(--color-text-tool);
  }

  @media (orientation: landscape) {
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

    .thumbnail-toggle-btn {
      width: 36px;
      height: 36px;
    }
  }
</style>
