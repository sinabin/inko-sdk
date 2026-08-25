<script lang="ts">
  import './toolbar-shared.css'
  import { t } from '../../lib/i18n/index.svelte'
  import { toolbarRovingGroup } from '../../lib/accessibility/toolbarRoving'

  interface Props {
    showSearch: boolean
    isSearchOpen: boolean
    showHistory: boolean
    isHistoryPanelVisible: boolean
    showSave: boolean
    onToggleSearch?: () => void
    onToggleHistory?: () => void
    onSave?: () => void
  }

  let {
    showSearch,
    isSearchOpen,
    showHistory,
    isHistoryPanelVisible,
    showSave,
    onToggleSearch,
    onToggleHistory,
    onSave
  }: Props = $props()
</script>

<div
  class="toolbar-section inko-toolbar-section inko-toolbar-section--divided actions"
  role="group"
  aria-label={t('toolbar.actionsGroup')}
  use:toolbarRovingGroup
>
  {#if showSearch}
    <button
      type="button"
      data-testid="pdf-search-open"
      class="btn inko-toolbar-button search-btn"
      class:active={isSearchOpen}
      onclick={onToggleSearch}
      title={t('search.open')}
      aria-label={t('search.region')}
      aria-expanded={isSearchOpen}
      aria-controls="inko-pdf-search"
      aria-keyshortcuts="Control+F Meta+F"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="10.5" cy="10.5" r="6.5"/>
        <line x1="15.2" y1="15.2" x2="21" y2="21"/>
      </svg>
    </button>
  {/if}

  {#if showHistory}
    <button
      type="button"
      class="btn inko-toolbar-button history-btn"
      class:active={isHistoryPanelVisible}
      onclick={onToggleHistory}
      title={t('toolbar.history')}
      aria-label={t('toolbar.history')}
      aria-expanded={isHistoryPanelVisible}
      aria-controls="user-canvas-history-panel"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.12"/>
        <circle cx="12" cy="12" r="9"/>
        <polyline points="12 7 12 12 15.5 14"/>
      </svg>
    </button>
  {/if}

  {#if showSave}
    <button type="button" class="btn inko-toolbar-button save-btn" onclick={onSave} title={t('toolbar.save')} aria-label={t('toolbar.save')}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" fill="currentColor" fill-opacity="0.18"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 14 8"/>
      </svg>
      <span class="save-label">{t('toolbar.save')}</span>
    </button>
  {/if}
</div>

<style>
  .actions {
    margin-left: auto;
  }

  .search-btn {
    width: 48px;
    height: 48px;
    padding: 0;
    color: var(--color-text-tool);
  }

  .search-btn.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
    box-shadow: var(--shadow-tool-active);
  }

  .search-btn.active:hover:not(:disabled),
  .search-btn.active:active:not(:disabled) {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
  }

  .history-btn {
    background: var(--color-surface);
    border-color: var(--color-history);
    color: var(--color-history);
    width: 48px;
    height: 48px;
    padding: 0;
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

  .save-btn {
    background: var(--color-action-save);
    border-color: var(--color-action-save);
    color: var(--color-text-primary);
    display: inline-flex;
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

  .save-label {
    line-height: 1;
  }

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
    outline: 3px solid var(--color-primary);
    outline-offset: 2px;
    box-shadow: var(--shadow-save-action-hover), 0 0 0 3px rgba(82, 196, 26, 0.35);
  }

  @media (orientation: landscape) {
    .search-btn,
    .history-btn {
      width: 36px;
      height: 36px;
    }

    .save-btn {
      padding: var(--space-1) var(--space-3);
      gap: var(--space-1);
    }
  }
</style>
