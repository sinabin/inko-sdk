<script lang="ts">
  import './toolbar-shared.css'
  import { t } from '../../lib/i18n/index.svelte'
  import { toolbarRovingGroup } from '../../lib/accessibility/toolbarRoving'

  interface Props {
    canUndo: boolean
    canRedo: boolean
    onUndo?: () => void
    onRedo?: () => void
  }

  let { canUndo, canRedo, onUndo, onRedo }: Props = $props()
</script>

<div
  class="toolbar-section inko-toolbar-section inko-toolbar-section--divided history-section"
  role="group"
  aria-label={t('toolbar.editHistoryGroup')}
  use:toolbarRovingGroup
>
  <button
    type="button"
    class="btn inko-toolbar-button history-action-btn"
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
    type="button"
    class="btn inko-toolbar-button history-action-btn"
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
