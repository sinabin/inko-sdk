import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import PdfToolbar from '../../src/components/PdfToolbar.svelte'
import { setLocale } from '../../src/lib/i18n/index.svelte'

const mounted: Array<Record<string, unknown>> = []

function render(props: Record<string, unknown>): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  mounted.push(mount(PdfToolbar, { target, props }) as Record<string, unknown>)
  flushSync()
  return target
}

function baseProps(): Record<string, unknown> {
  return {
    currentTool: 'select',
    currentPage: 2,
    totalPages: 5,
    scale: 1.25
  }
}

afterEach(() => {
  while (mounted.length > 0) unmount(mounted.pop()!)
  document.body.innerHTML = ''
  setLocale('ko')
  vi.restoreAllMocks()
})

describe('PdfToolbar 그룹 조합', () => {
  it('기존 DOM selector와 그룹별 callback 계약을 유지한다', () => {
    const callbacks = {
      onToggleThumbnails: vi.fn(),
      onToggleOutline: vi.fn(),
      onPageChange: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onZoomOut: vi.fn(),
      onZoomIn: vi.fn(),
      onOrientationToggle: vi.fn(),
      onToolChange: vi.fn(),
      onOpenToolOptions: vi.fn(),
      onDeleteSelected: vi.fn(),
      onToggleHistory: vi.fn(),
      onSave: vi.fn()
    }
    const el = render({
      ...baseProps(),
      ...callbacks,
      canUndo: true,
      canRedo: true,
      hasOutline: true,
      hasSelection: true,
      hasUserCanvasData: true,
      logoUrl: '/brand.svg'
    })

    expect(el.querySelector('.toolbar-logo')).not.toBeNull()
    expect(el.querySelectorAll('.toolbar > .toolbar-section')).toHaveLength(5)
    expect(el.querySelectorAll('.toolbar > .inko-toolbar-section')).toHaveLength(5)
    expect(el.querySelectorAll('.toolbar > .inko-toolbar-section--divided')).toHaveLength(3)
    expect(el.querySelectorAll('.toolbar .btn')).toHaveLength(
      el.querySelectorAll('.toolbar .inko-toolbar-button').length
    )
    expect(el.querySelectorAll('.history-action-btn')).toHaveLength(2)
    expect(el.querySelector('.page-info .page-input')).not.toBeNull()
    expect(el.querySelector('.toolbar-section.actions')).not.toBeNull()
    expect(Array.from(el.querySelectorAll<HTMLElement>('.tool-btn[data-tool]'), tool => tool.dataset.tool)).toEqual([
      'select', 'pen', 'highlighter', 'eraser', 'text', 'rectangle', 'circle', 'line'
    ])
    el.querySelector<HTMLButtonElement>('.thumbnail-toggle-btn')!.click()
    el.querySelector<HTMLButtonElement>('.outline-toggle-btn')!.click()
    el.querySelector<HTMLButtonElement>('[aria-label="이전 페이지"]')!.click()
    el.querySelector<HTMLButtonElement>('[aria-label="다음 페이지"]')!.click()
    el.querySelector<HTMLButtonElement>('[aria-label="실행 취소"]')!.click()
    el.querySelector<HTMLButtonElement>('[aria-label="다시 실행"]')!.click()
    el.querySelector<HTMLButtonElement>('[aria-label="축소"]')!.click()
    el.querySelector<HTMLButtonElement>('[aria-label="확대"]')!.click()
    el.querySelector<HTMLButtonElement>('.orientation-btn')!.click()
    el.querySelector<HTMLButtonElement>('[data-tool="pen"]')!.click()
    el.querySelector<HTMLButtonElement>('.delete-btn')!.click()
    el.querySelector<HTMLButtonElement>('.history-btn')!.click()
    el.querySelector<HTMLButtonElement>('.save-btn')!.click()

    expect(callbacks.onToggleThumbnails).toHaveBeenCalledOnce()
    expect(callbacks.onToggleOutline).toHaveBeenCalledOnce()
    expect(callbacks.onPageChange.mock.calls).toEqual([[1], [3]])
    expect(callbacks.onUndo).toHaveBeenCalledOnce()
    expect(callbacks.onRedo).toHaveBeenCalledOnce()
    expect(callbacks.onZoomOut).toHaveBeenCalledOnce()
    expect(callbacks.onZoomIn).toHaveBeenCalledOnce()
    expect(callbacks.onOrientationToggle).toHaveBeenCalledOnce()
    expect(callbacks.onToolChange).toHaveBeenCalledWith('pen')
    expect(callbacks.onOpenToolOptions).toHaveBeenCalledWith('pen', 0, 4)
    expect(callbacks.onDeleteSelected).toHaveBeenCalledOnce()
    expect(callbacks.onToggleHistory).toHaveBeenCalledOnce()
    expect(callbacks.onSave).toHaveBeenCalledOnce()
  })

  it('readOnly·feature 설정에서도 기존 그룹과 숨김 경계를 유지한다', () => {
    const el = render({
      ...baseProps(),
      isReadOnly: true,
      hasOutline: true,
      hasUserCanvasData: true,
      features: {
        thumbnails: false,
        bookmarks: false,
        pageNav: false,
        zoom: false,
        orientation: false,
        history: false,
        save: false
      }
    })

    expect(el.querySelectorAll('.toolbar > .toolbar-section')).toHaveLength(3)
    expect(el.querySelector('.history-section')).toBeNull()
    expect(el.querySelector('.tools')).toBeNull()
    expect(el.querySelector('.outline-toggle-btn')).toBeNull()
    expect(el.querySelector('.history-btn')).toBeNull()
    expect(el.querySelector('.save-btn')).toBeNull()
    expect(el.querySelector<HTMLElement>('.thumbnail-toggle-btn')!.style.display).toBe('none')
    expect(el.querySelector<HTMLElement>('.zoom-info')!.style.display).toBe('none')
  })
})
