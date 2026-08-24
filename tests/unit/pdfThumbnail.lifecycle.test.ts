import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import PdfThumbnailHarness from './fixtures/PdfThumbnailHarness.svelte'

interface ThumbnailHarnessInstance {
  setPdfDocument(nextDocument: PDFDocumentProxy): void
}

function createPdfDocument(renderTaskFactory: () => RenderTask): PDFDocumentProxy {
  return {
    getPage: vi.fn(async () => ({
      getViewport: () => ({ width: 120, height: 160 }),
      render: renderTaskFactory
    }))
  } as unknown as PDFDocumentProxy
}

function failedConcurrentRender(): RenderTask {
  return {
    promise: Promise.reject(new Error('Cannot use the same canvas during multiple render() operations')),
    cancel: vi.fn()
  } as unknown as RenderTask
}

function successfulRender(): RenderTask {
  return {
    promise: Promise.resolve(),
    cancel: vi.fn()
  } as unknown as RenderTask
}

async function flushMicrotasks(rounds = 12): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
}

let instance: ThumbnailHarnessInstance | null = null

afterEach(() => {
  if (instance) unmount(instance as unknown as Record<string, unknown>)
  instance = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PdfThumbnail 렌더 수명주기', () => {
  it('문서 교체는 이전 문서의 예약된 retry를 취소해 새 문서를 다시 렌더하지 않는다', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const firstDocument = createPdfDocument(failedConcurrentRender)
    const nextDocument = createPdfDocument(successfulRender)
    const target = document.createElement('div')
    document.body.appendChild(target)

    instance = mount(PdfThumbnailHarness, {
      target,
      props: { initialDocument: firstDocument }
    }) as ThumbnailHarnessInstance
    flushSync()
    await flushMicrotasks()
    expect(vi.getTimerCount()).toBe(1)

    instance.setPdfDocument(nextDocument)
    flushSync()
    await flushMicrotasks()
    expect(nextDocument.getPage).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()
    expect(nextDocument.getPage).toHaveBeenCalledTimes(1)
  })

  it('destroy는 예약된 retry timer를 즉시 제거한다', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const pdfDocument = createPdfDocument(failedConcurrentRender)
    const target = document.createElement('div')
    document.body.appendChild(target)

    instance = mount(PdfThumbnailHarness, {
      target,
      props: { initialDocument: pdfDocument }
    }) as ThumbnailHarnessInstance
    flushSync()
    await flushMicrotasks()
    expect(vi.getTimerCount()).toBe(1)

    unmount(instance as unknown as Record<string, unknown>)
    instance = null
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pdfDocument.getPage).toHaveBeenCalledTimes(1)
  })
})
