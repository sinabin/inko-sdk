import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import PdfScrollViewer from '../../src/components/PdfScrollViewer.svelte'

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
