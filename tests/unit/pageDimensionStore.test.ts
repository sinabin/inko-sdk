import { describe, expect, it, vi } from 'vitest'
import { createPageDimensionStore } from '../../src/lib/pdf/pageDimensionStore.svelte'
import type {
  PdfDimensionDocumentPort,
  PdfDimensionPagePort
} from '../../src/lib/viewer/viewerPorts'

function pdfPage(width: number, height: number): PdfDimensionPagePort {
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale
    }))
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('pageDimensionStore — 문서 generation', () => {
  it('1.0x 페이지 치수를 수집하고 현재 문서의 페이지 오류만 보고', async () => {
    const onPageError = vi.fn()
    const store = createPageDimensionStore({ initialPageCount: 2, onPageError })
    const document: PdfDimensionDocumentPort = {
      getPage: vi.fn(async (pageNumber: number) => {
        if (pageNumber === 2) throw new Error('damaged page')
        return pdfPage(600 + pageNumber, 800 + pageNumber)
      })
    }

    await store.loadDocument(document, 3)
    await store.waitForIdle()

    expect(store.getAll()).toEqual(new Map([
      [1, { width: 601, height: 801 }],
      [3, { width: 603, height: 803 }]
    ]))
    expect(onPageError).toHaveBeenCalledTimes(1)
    expect(onPageError).toHaveBeenCalledWith(2, expect.any(Error))
    expect(store.isLoading).toBe(false)
  })

  it('이전 문서의 늦은 getPage 완료가 새 문서 치수를 덮지 못함', async () => {
    const oldPage = deferred<PdfDimensionPagePort>()
    const oldDocument: PdfDimensionDocumentPort = {
      getPage: vi.fn(() => oldPage.promise)
    }
    const newDocument: PdfDimensionDocumentPort = {
      getPage: vi.fn(async () => pdfPage(700, 900))
    }
    const store = createPageDimensionStore()

    const oldLoad = store.loadDocument(oldDocument, 1)
    const newLoad = store.loadDocument(newDocument, 1)
    await newLoad
    oldPage.resolve(pdfPage(100, 200))
    await oldLoad

    expect(store.get(1)).toEqual({ width: 700, height: 900 })
    expect(store.size).toBe(1)
  })

  it('초기 페이지를 먼저 게시하고 나머지는 background에서 이어서 로드', async () => {
    const thirdPage = deferred<PdfDimensionPagePort>()
    const document: PdfDimensionDocumentPort = {
      getPage: vi.fn(async (pageNumber: number) => {
        if (pageNumber === 3) return thirdPage.promise
        return pdfPage(600 + pageNumber, 800 + pageNumber)
      })
    }
    const store = createPageDimensionStore({ initialPageCount: 2, publishBatchSize: 2 })

    await store.loadDocument(document, 4)

    expect(store.getAll()).toEqual(new Map([
      [1, { width: 601, height: 801 }],
      [2, { width: 602, height: 802 }]
    ]))
    expect(store.isLoading).toBe(true)

    thirdPage.resolve(pdfPage(603, 803))
    await store.waitForIdle()
    expect(store.size).toBe(4)
    expect(store.isLoading).toBe(false)
  })

  it('이전 문서의 stale 실패는 현재 문서 오류 채널에도 유입되지 않음', async () => {
    const oldPage = deferred<PdfDimensionPagePort>()
    const onPageError = vi.fn()
    const store = createPageDimensionStore({ onPageError })
    const oldLoad = store.loadDocument({ getPage: () => oldPage.promise }, 1)
    await store.loadDocument({ getPage: async () => pdfPage(612, 792) }, 1)

    oldPage.reject(new Error('stale failure'))
    await oldLoad

    expect(onPageError).not.toHaveBeenCalled()
    expect(store.get(1)).toEqual({ width: 612, height: 792 })
  })

  it('null 문서 교체는 이전 치수를 즉시 비우고 generation을 전진', async () => {
    const store = createPageDimensionStore()
    await store.loadDocument({ getPage: async () => pdfPage(612, 792) }, 1)
    const generation = store.generation

    await store.loadDocument(null, 0)

    expect(store.generation).toBe(generation + 1)
    expect(store.getAll().size).toBe(0)
    expect(store.isLoading).toBe(false)
  })
})

describe('pageDimensionStore — dispose와 인스턴스 격리', () => {
  it('dispose 후 늦은 completion을 무효화하고 반복 dispose와 use-after-dispose를 안전하게 처리', async () => {
    const pendingPage = deferred<PdfDimensionPagePort>()
    const store = createPageDimensionStore()
    const load = store.loadDocument({ getPage: () => pendingPage.promise }, 1)
    const generation = store.generation

    store.dispose()
    store.dispose()
    await store.waitForIdle()
    pendingPage.resolve(pdfPage(612, 792))
    await load

    expect(store.isDisposed).toBe(true)
    expect(store.generation).toBe(generation + 1)
    expect(store.isLoading).toBe(false)
    expect(store.getAll().size).toBe(0)
    await expect(store.loadDocument(null, 0)).rejects.toThrow(
      'PageDimensionStore has been disposed'
    )
  })

  it('한 factory의 generation·dispose가 다른 인스턴스에 영향 없음', async () => {
    const first = createPageDimensionStore()
    const second = createPageDimensionStore()
    await second.loadDocument({ getPage: async () => pdfPage(500, 700) }, 1)

    first.dispose()

    expect(first.isDisposed).toBe(true)
    expect(second.isDisposed).toBe(false)
    expect(second.get(1)).toEqual({ width: 500, height: 700 })
    second.dispose()
  })
})
