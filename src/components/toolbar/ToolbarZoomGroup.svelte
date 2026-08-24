<script lang="ts">
  import './toolbar-shared.css'
  import type { OrientationMode } from '../../types'
  import { t } from '../../lib/i18n/index.svelte'
  import { toolbarRovingGroup } from '../../lib/accessibility/toolbarRoving'

  interface Props {
    scale: number
    orientation: OrientationMode
    zoomEnabled: boolean
    orientationEnabled: boolean
    onZoomIn?: () => void
    onZoomOut?: () => void
    onOrientationToggle?: () => void
  }

  let {
    scale,
    orientation,
    zoomEnabled,
    orientationEnabled,
    onZoomIn,
    onZoomOut,
    onOrientationToggle
  }: Props = $props()
</script>

<div
  class="toolbar-section inko-toolbar-section inko-toolbar-section--divided"
  role="group"
  aria-label={t('toolbar.zoomGroup')}
  use:toolbarRovingGroup
>
  <button
    type="button"
    class="btn inko-toolbar-button"
    onclick={onZoomOut}
    style:display={zoomEnabled ? undefined : 'none'}
    title={t('toolbar.zoomOut')}
    aria-label={t('toolbar.zoomOut')}
  >
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  </button>
  <output
    class="zoom-info"
    style:display={zoomEnabled ? undefined : 'none'}
    aria-label={t('toolbar.zoomLevel', { percent: Math.round(scale * 100) })}
    aria-live="polite"
  >{Math.round(scale * 100)}%</output>
  <button
    type="button"
    class="btn inko-toolbar-button"
    onclick={onZoomIn}
    style:display={zoomEnabled ? undefined : 'none'}
    title={t('toolbar.zoomIn')}
    aria-label={t('toolbar.zoomIn')}
  >
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  </button>
  <button
    type="button"
    class="btn inko-toolbar-button orientation-btn"
    onclick={onOrientationToggle}
    style:display={orientationEnabled ? undefined : 'none'}
    title={orientation === 'portrait' ? t('toolbar.orientationLandscape') : t('toolbar.orientationPortrait')}
    aria-label={orientation === 'portrait' ? t('toolbar.orientationLandscape') : t('toolbar.orientationPortrait')}
  >
    {#if orientation === 'portrait'}
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" fill="currentColor" fill-opacity="0.10"/>
        <path d="M16 11.5l2 -2.5l2 2.5"/>
        <path d="M18 9 a4 4 0 0 0 -4 -4"/>
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="2" width="12" height="20" rx="2" fill="currentColor" fill-opacity="0.10"/>
        <path d="M11.5 16l-2.5 2l2.5 2"/>
        <path d="M9 18 a4 4 0 0 0 4 -4"/>
      </svg>
    {/if}
  </button>
</div>

<style>
  .zoom-info {
    min-width: 48px;
    text-align: center;
    font-size: var(--font-size-md);
  }

  .orientation-btn {
    width: 48px;
    height: 48px;
    padding: 0;
    color: var(--color-text-tool);
  }

  @media (orientation: landscape) {
    .zoom-info {
      min-width: 40px;
      font-size: var(--font-size-sm);
    }

    .orientation-btn {
      width: 36px;
      height: 36px;
    }
  }
</style>
