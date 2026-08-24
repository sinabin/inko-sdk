import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { PermissionFlag, type PDFDocumentProxy } from 'pdfjs-dist'
import PdfScrollViewer, {
  shouldEnforcePdfCopyPermission
} from '../../src/components/PdfScrollViewer.svelte'

let instance: Record<string, any> | null = null

afterEach(() => {
  if (instance) {
    unmount(instance)
    instance = null
  }
  document.body.innerHTML = ''
})

describe('PdfScrollViewer 첫 페이지 준비 수명주기', () => {
  it('첫 페이지 렌더 전 destroy되면 미결 waitUntilFirstPageReady를 실패로 settle한다', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const pdfDoc = {
      getPage: vi.fn(() => new Promise(() => {}))
    } as unknown as PDFDocumentProxy

    instance = mount(PdfScrollViewer, {
      target,
      props: {
        pdfDoc,
        totalPages: 1,
        viewportScale: 1,
        currentTool: 'select',
        brushColor: '#000000',
        brushWidth: 2,
        isReadOnly: true
      }
    }) as Record<string, any>
    flushSync()

    const firstPageReady = instance.waitUntilFirstPageReady()
    unmount(instance)
    instance = null

    await expect(firstPageReady).rejects.toThrow(
      'PDF viewer was destroyed before the first page became ready'
    )
  })
})

describe('PdfScrollViewer PDF 복사 권한', () => {
  it('권한 사전이 없으면 복사를 유지하고 COPY가 빠진 명시 권한만 차단한다', () => {
    expect(shouldEnforcePdfCopyPermission(null)).toBe(false)
    expect(shouldEnforcePdfCopyPermission([PermissionFlag.COPY])).toBe(false)
    expect(shouldEnforcePdfCopyPermission([])).toBe(true)
    expect(shouldEnforcePdfCopyPermission([PermissionFlag.PRINT])).toBe(true)
  })
})

describe('PdfScrollViewer 접근성 페이지 수명주기', () => {
  it('가상화 렌더 전에도 이름 있는 문서/페이지 영역과 포커스 API·현재 페이지 알림을 제공한다', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const pdfDoc = {
      numPages: 2,
      getPage: vi.fn(() => new Promise(() => {}))
    } as unknown as PDFDocumentProxy

    instance = mount(PdfScrollViewer, {
      target,
      props: {
        pdfDoc,
        totalPages: 2,
        viewportScale: 1,
        currentTool: 'contentSelect',
        brushColor: '#000000',
        brushWidth: 2,
        isReadOnly: true
      }
    }) as Record<string, any>
    flushSync()

    const viewerRegion = target.querySelector<HTMLElement>('.scroll-viewer')!
    expect(viewerRegion.getAttribute('role')).toBe('region')
    expect(viewerRegion.getAttribute('aria-label')).toBe('PDF 문서 보기 영역')
    expect(viewerRegion.tabIndex).toBe(0)
    expect(instance.getScrollContainer()).toBe(viewerRegion)
    expect(instance.getCurrentPage()).toBe(1)
    expect(instance.getCanUndo()).toBe(false)
    expect(instance.getCanRedo()).toBe(false)
    expect(target.querySelector('[role="status"]')?.textContent).toContain('현재 PDF 1/2페이지')

    const pages = target.querySelectorAll<HTMLElement>('.scroll-page-container')
    expect(pages).toHaveLength(2)
    expect(Array.from(pages, page => page.getAttribute('role'))).toEqual(['region', 'region'])
    expect(Array.from(pages, page => page.getAttribute('aria-label'))).toEqual([
      'PDF 1페이지',
      'PDF 2페이지'
    ])
    expect(pages[0].getAttribute('aria-current')).toBe('page')
    expect(pages[1].getAttribute('aria-current')).toBeNull()
    expect(Array.from(pages, page => page.tabIndex)).toEqual([-1, -1])
    expect(target.querySelectorAll('[data-accessible-page-text]')).toHaveLength(2)

    Object.defineProperty(viewerRegion, 'scrollTo', { value: vi.fn(), configurable: true })
    instance.scrollToPage(2, 'auto')
    flushSync()
    expect(target.querySelector('[role="status"]')?.textContent).toContain('현재 PDF 2/2페이지')
    expect(pages[0].getAttribute('aria-current')).toBeNull()
    expect(pages[1].getAttribute('aria-current')).toBe('page')

    expect(instance.focusPage(2)).toBe(true)
    expect(document.activeElement).toBe(pages[1])
    expect(instance.focusPage(0)).toBe(false)
  })
})
