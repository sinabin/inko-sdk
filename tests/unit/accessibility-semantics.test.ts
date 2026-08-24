import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import PdfToolbar from '../../src/components/PdfToolbar.svelte'
import PdfThumbnail from '../../src/components/PdfThumbnail.svelte'
import PdfThumbnailList from '../../src/components/PdfThumbnailList.svelte'
import TextInputOverlay from '../../src/components/TextInputOverlay.svelte'
import ToolOptionsSheet from '../../src/components/ToolOptionsSheet.svelte'
import UserCanvasDataList from '../../src/components/UserCanvasDataList.svelte'
import ErrorToast from '../../src/components/ErrorToast.svelte'
import { errorReporter } from '../../src/lib/utils/errorReporter.svelte'
import { setLocale } from '../../src/lib/i18n/index.svelte'

const mounted: Array<Record<string, unknown>> = []

function render(component: any, props: Record<string, unknown>): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  mounted.push(mount(component, { target, props }) as Record<string, unknown>)
  flushSync()
  return target
}

async function settleFocus(): Promise<void> {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  flushSync()
}

beforeAll(() => {
  if (typeof HTMLDialogElement === 'undefined') return
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  while (mounted.length > 0) unmount(mounted.pop()!)
  errorReporter.__resetForTesting()
  document.body.innerHTML = ''
  setLocale('ko')
  vi.restoreAllMocks()
})

describe('접근성 시맨틱 기준선', () => {
  it('툴바의 그룹·버튼 이름·선택 상태·패널 연결을 노출한다', () => {
    const el = render(PdfToolbar, {
      currentTool: 'pen',
      currentPage: 2,
      totalPages: 5,
      scale: 1.25,
      hasUserCanvasData: true,
      isHistoryPanelVisible: true,
      showThumbnails: true
    })

    const toolbar = el.querySelector<HTMLElement>('[role="toolbar"]')!
    expect(toolbar.getAttribute('aria-label')).toBe('PDF 도구 모음')
    expect(toolbar.querySelectorAll('[role="group"]')).toHaveLength(5)

    const pen = el.querySelector<HTMLButtonElement>('[data-tool="pen"]')!
    expect(pen.getAttribute('aria-label')).toBe('펜')
    expect(pen.getAttribute('aria-pressed')).toBe('true')
    expect(pen.getAttribute('aria-haspopup')).toBe('dialog')

    const thumbnails = el.querySelector<HTMLButtonElement>('.thumbnail-toggle-btn')!
    expect(thumbnails.getAttribute('aria-expanded')).toBe('true')
    expect(thumbnails.getAttribute('aria-controls')).toBe('pdf-thumbnail-sidebar')

    const history = el.querySelector<HTMLButtonElement>('.history-btn')!
    expect(history.getAttribute('aria-expanded')).toBe('true')
    expect(history.getAttribute('aria-controls')).toBe('user-canvas-history-panel')
    expect(el.querySelector('.zoom-info')?.getAttribute('aria-live')).toBe('polite')

    for (const button of el.querySelectorAll<HTMLButtonElement>('button')) {
      expect(button.getAttribute('aria-label') || button.textContent?.trim()).toBeTruthy()
    }
  })

  it('썸네일은 키보드로 작동하는 현재 페이지 버튼이고 목록은 이름 있는 탐색 영역이다', () => {
    const onPageClick = vi.fn()
    const pdfDocument = {
      numPages: 1,
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 120, height: 160 }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() })
      }))
    }
    const thumbnail = render(PdfThumbnail, {
      pdfDocument,
      pageNumber: 2,
      isActive: true,
      onPageClick
    })

    const button = thumbnail.querySelector<HTMLButtonElement>('button.thumbnail-container')!
    expect(button).toBeInstanceOf(HTMLButtonElement)
    expect(button.getAttribute('aria-current')).toBe('page')
    expect(button.getAttribute('aria-label')).toContain('2페이지')
    button.click()
    expect(onPageClick).toHaveBeenCalledWith(2)

    const list = render(PdfThumbnailList, { pdfDocument: null, currentPage: 1 })
    const nav = list.querySelector<HTMLElement>('nav#pdf-thumbnail-sidebar')!
    expect(nav.getAttribute('aria-label')).toBe('PDF 페이지 썸네일')
    expect(nav.querySelector('[role="status"]')?.textContent).toContain('불러온 PDF가 없습니다')
  })

  it('텍스트 입력 모달은 이름·설명·초기 포커스·포커스 트랩·Escape 복귀를 제공한다', async () => {
    const trigger = document.createElement('button')
    trigger.className = 'tool-btn'
    trigger.dataset.tool = 'text'
    document.body.appendChild(trigger)
    trigger.focus()
    const onCancel = vi.fn()
    const el = render(TextInputOverlay, {
      isVisible: true,
      initialText: 'hello',
      fontSize: 16,
      onCancel
    })
    await settleFocus()

    const dialog = el.querySelector<HTMLDialogElement>('dialog')!
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!
    expect(dialog.open).toBe(true)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('text-input-dialog-title')
    expect(textarea.labels?.[0]?.textContent).toBe('추가할 텍스트')
    expect(document.activeElement).toBe(textarea)
    expect(el.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.getAttribute('aria-label')).toBe('글자 크기 16px')

    const confirm = el.querySelector<HTMLButtonElement>('.confirm-btn')!
    confirm.focus()
    confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(textarea)

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settleFocus()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('도구 옵션 모달은 그룹·상태·초기 포커스·Escape 복귀를 제공한다', async () => {
    const trigger = document.createElement('button')
    trigger.className = 'tool-btn'
    trigger.dataset.tool = 'pen'
    document.body.appendChild(trigger)
    trigger.focus()
    const onClose = vi.fn()
    const el = render(ToolOptionsSheet, {
      isVisible: true,
      toolKind: 'pen',
      brushColor: '#123456',
      brushWidth: 2,
      colorPresets: ['#000000', '#ffffff'],
      widthPresets: [1, 2, 4],
      pressureSensitivity: 50,
      onClose
    })
    await settleFocus()

    const dialog = el.querySelector<HTMLDialogElement>('dialog')!
    const close = el.querySelector<HTMLButtonElement>('.sheet-close-btn')!
    expect(dialog.open).toBe(true)
    expect(dialog.getAttribute('aria-labelledby')).toBe('tool-options-heading')
    expect(document.activeElement).toBe(close)
    expect(el.querySelectorAll('[role="group"]')).toHaveLength(2)
    expect(el.querySelector('.color-picker-trigger')?.getAttribute('aria-pressed')).toBe('true')

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settleFocus()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('작업 이력은 이름 있는 영역·유일한 roving tab stop·고유 편집 이름·포커스 복귀를 제공한다', async () => {
    const trigger = document.createElement('button')
    trigger.className = 'history-btn'
    document.body.appendChild(trigger)
    trigger.focus()
    const onClose = vi.fn()
    const el = render(UserCanvasDataList, {
      userCanvasData: [
        { canvasId: 'v2', userName: '나', userId: '', canvasData: '{}', enabled: false, registeredAt: '2026-08-24 10:00:00' },
        { canvasId: 'v1', userName: '나', userId: '', canvasData: '{}', enabled: false, registeredAt: '2026-08-23 10:00:00' }
      ],
      isVisible: true,
      currentEditCanvasId: 'v2',
      isVersionHistoryMode: true,
      onClose
    })
    await settleFocus()

    const panel = el.querySelector<HTMLElement>('#user-canvas-history-panel')!
    expect(panel.getAttribute('role')).toBe('region')
    expect(panel.getAttribute('aria-labelledby')).toBe('user-canvas-history-title')
    expect(el.querySelectorAll('[role="radio"][tabindex="0"]')).toHaveLength(1)
    const editLabels = Array.from(el.querySelectorAll<HTMLButtonElement>('.load-btn'), button => button.ariaLabel)
    expect(new Set(editLabels).size).toBe(editLabels.length)
    expect(document.activeElement).toBe(el.querySelector('.close-btn'))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settleFocus()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })

  it('토스트 메시지는 실제 live-region 내용으로 발표되고 닫기 버튼은 별도 이름을 갖는다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const el = render(ErrorToast, {})
    errorReporter.reportError('render', '페이지 렌더링 실패')
    flushSync()

    const alert = el.querySelector<HTMLElement>('[role="alert"]')!
    expect(alert.getAttribute('aria-live')).toBe('assertive')
    expect(alert.textContent).toContain('페이지 렌더링 실패')
    const close = alert.querySelector<HTMLButtonElement>('.toast-close')!
    expect(close.ariaLabel).toContain('페이지 렌더링 실패')
    close.click()
    flushSync()
    expect(el.querySelector('[role="alert"]')).toBeNull()
  })

  it('로케일 변경 시 문서 언어도 동기화한다', () => {
    setLocale('en')
    expect(document.documentElement.lang).toBe('en')
    setLocale(' ko ')
    expect(document.documentElement.lang).toBe('ko')
  })
})
