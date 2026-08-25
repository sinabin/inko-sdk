<script lang="ts">
  import './toolbar-shared.css'
  import type { ToolMode } from '../../types'
  import { t } from '../../lib/i18n/index.svelte'
  import { toolbarRovingGroup } from '../../lib/accessibility/toolbarRoving'

  type ToolOptionKind = 'pen' | 'highlighter' | 'rectangle' | 'circle' | 'line' | 'text'

  interface Props {
    currentTool: ToolMode
    isReadOnly?: boolean
    hasSelection: boolean
    enabledTools: string[] | null
    onToolChange?: (tool: ToolMode) => void
    onOpenPenOptions?: (anchorLeft: number, anchorTop: number) => void
    onOpenToolOptions?: (kind: ToolOptionKind, anchorLeft: number, anchorTop: number) => void
    onDeleteSelected?: () => void
  }

  let {
    currentTool,
    isReadOnly = false,
    hasSelection,
    enabledTools,
    onToolChange,
    onOpenPenOptions,
    onOpenToolOptions,
    onDeleteSelected
  }: Props = $props()

  const tools: { id: ToolMode; labelKey: string }[] = [
    { id: 'select', labelKey: 'tool.select' },
    { id: 'contentSelect', labelKey: 'tool.contentSelect' },
    { id: 'pen', labelKey: 'tool.pen' },
    { id: 'highlighter', labelKey: 'tool.highlighter' },
    { id: 'eraser', labelKey: 'tool.eraser' },
    { id: 'text', labelKey: 'tool.text' },
    { id: 'rectangle', labelKey: 'tool.rectangle' },
    { id: 'circle', labelKey: 'tool.circle' },
    { id: 'line', labelKey: 'tool.line' }
  ]
  const SHAPE_IDS: ToolMode[] = ['rectangle', 'circle', 'line']
  const visibleTools = $derived(
    tools.filter(tool => {
      if (isReadOnly && tool.id !== 'contentSelect') return false
      return !enabledTools
        || enabledTools.includes(tool.id)
        || (SHAPE_IDS.includes(tool.id) && enabledTools.includes('shape'))
    })
  )

  function isToolActive(tool: ToolMode): boolean {
    return currentTool === tool || (isReadOnly && tool === 'contentSelect')
  }

  /** 도구 → 옵션 시트 종류 매핑 */
  function getSheetKind(tool: ToolMode): ToolOptionKind | null {
    if (tool === 'pen') return 'pen'
    if (tool === 'highlighter') return 'highlighter'
    if (tool === 'rectangle') return 'rectangle'
    if (tool === 'circle') return 'circle'
    if (tool === 'line') return 'line'
    if (tool === 'text') return 'text'
    return null
  }

  /** 도구 활성화 후 옵션 시트가 필요한 경우 버튼 좌표를 전달 */
  function handleToolClick(tool: ToolMode, button: HTMLButtonElement) {
    onToolChange?.(tool)
    const kind = getSheetKind(tool)
    if (!kind) return

    const rect = button.getBoundingClientRect()
    if (onOpenToolOptions) {
      onOpenToolOptions(kind, rect.left, rect.bottom + 4)
    } else if (kind === 'pen') {
      onOpenPenOptions?.(rect.left, rect.bottom + 4)
    }
  }
</script>

<div
  class="toolbar-section inko-toolbar-section inko-toolbar-section--divided tools"
  role="group"
  aria-label={t('toolbar.toolsGroup')}
  use:toolbarRovingGroup
>
  {#each visibleTools as tool}
    <button
      type="button"
      class="btn inko-toolbar-button tool-btn"
      class:active={isToolActive(tool.id)}
      class:has-options={getSheetKind(tool.id) !== null}
      onclick={(event) => handleToolClick(tool.id, event.currentTarget as HTMLButtonElement)}
      title={t(tool.labelKey)}
      aria-label={t(tool.labelKey)}
      aria-pressed={isToolActive(tool.id)}
      aria-haspopup={getSheetKind(tool.id) !== null ? 'dialog' : undefined}
      data-tool={tool.id}
    >
      {#if tool.id === 'select'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" fill="currentColor" fill-opacity="0.18"/>
        </svg>
      {:else if tool.id === 'contentSelect'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 5h10M10 5v14M6.5 19h7"/>
          <path d="M15 12l5 2.2-2.1 1.1 1.2 2.8-2.1.9-1.2-2.8-2.2.8z" fill="currentColor" fill-opacity="0.18"/>
        </svg>
      {:else if tool.id === 'pen'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" fill="currentColor" fill-opacity="0.14"/>
          <path d="M15 5l4 4"/>
        </svg>
      {:else if tool.id === 'highlighter'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 4l5 5-9 9H6v-5z" fill="currentColor" fill-opacity="0.28"/>
          <path d="M15 4l5 5-9 9H6v-5z"/>
          <line x1="14" y1="5" x2="19" y2="10"/>
          <line x1="4" y1="21" x2="14" y2="21" stroke-width="3" stroke-opacity="0.45"/>
        </svg>
      {:else if tool.id === 'eraser'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 20H7L3 16a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l7 7a1 1 0 0 1 0 1.4L16 18" fill="currentColor" fill-opacity="0.14"/>
          <path d="M14 6L18 10"/>
        </svg>
      {:else if tool.id === 'text'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 7 4 4 20 4 20 7"/>
          <line x1="12" y1="4" x2="12" y2="20"/>
          <line x1="8" y1="20" x2="16" y2="20"/>
        </svg>
      {:else if tool.id === 'rectangle'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="currentColor" fill-opacity="0.10"/>
        </svg>
      {:else if tool.id === 'circle'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8.5" fill="currentColor" fill-opacity="0.10"/>
        </svg>
      {:else if tool.id === 'line'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="18" x2="18" y2="6"/>
          <circle cx="6" cy="18" r="1.8" fill="currentColor" stroke="none"/>
          <circle cx="18" cy="6" r="1.8" fill="currentColor" stroke="none"/>
        </svg>
      {/if}
    </button>
  {/each}

  {#if currentTool === 'select' && hasSelection}
    <button
      type="button"
      class="btn inko-toolbar-button delete-btn"
      onclick={onDeleteSelected}
      title={t('toolbar.deleteSelection')}
      aria-label={t('toolbar.deleteSelection')}
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

<style>
  .tool-btn {
    width: 48px;
    height: 48px;
    padding: 0;
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

  .tool-btn.active:hover:not(:disabled),
  .tool-btn.active:active:not(:disabled) {
    background: var(--color-tool-active);
    border-color: var(--color-tool-active);
    color: var(--color-text-inverse);
  }

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

  .delete-btn {
    width: 48px;
    height: 48px;
    padding: 0;
    background: var(--color-action-destructive);
    border-color: var(--color-action-destructive);
    color: var(--color-text-inverse);
  }

  .delete-btn:hover:not(:disabled) {
    background: var(--color-action-destructive-hover);
    border-color: var(--color-action-destructive-hover);
  }

  @media (orientation: landscape) {
    .tool-btn,
    .delete-btn {
      width: 36px;
      height: 36px;
    }
  }
</style>
