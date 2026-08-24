import { beforeEach, describe, expect, it, vi } from 'vitest'

const pdfJsMock = vi.hoisted(() => ({
  GlobalWorkerOptions: { workerSrc: '' },
  VerbosityLevel: { ERRORS: 0 },
  getDocument: vi.fn()
}))

vi.mock('pdfjs-dist', () => pdfJsMock)

import { createPdfLoader } from '../../src/lib/pdf/pdfLoader.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createTask(promise: Promise<unknown>) {
  return {
    promise,
    destroy: vi.fn().mockResolvedValue(undefined)
  }
}

function createDocument(id: string, numPages = 1) {
  return {
    id,
    numPages,
    destroy: vi.fn().mockResolvedValue(undefined),
    getPage: vi.fn(),
    getData: vi.fn(),
    saveDocument: vi.fn()
  }
}

beforeEach(() => {
  pdfJsMock.getDocument.mockReset()
})

describe('PdfLoader 비동기 수명주기', () => {
  it('뒤늦게 끝난 이전 load가 최신 document/loading 상태를 덮지 않는다', async () => {
    const firstResult = deferred<ReturnType<typeof createDocument>>()
    const secondResult = deferred<ReturnType<typeof createDocument>>()
    const firstTask = createTask(firstResult.promise)
    const secondTask = createTask(secondResult.promise)
    const firstDocument = createDocument('first', 2)
    const secondDocument = createDocument('second', 7)
    pdfJsMock.getDocument
      .mockReturnValueOnce(firstTask)
      .mockReturnValueOnce(secondTask)

    const loader = createPdfLoader()
    const firstLoad = loader.loadFromUrl('/first.pdf')
    await vi.waitFor(() => expect(pdfJsMock.getDocument).toHaveBeenCalledTimes(1))

    const secondLoad = loader.loadFromUrl('/second.pdf')
    await vi.waitFor(() => expect(firstTask.destroy).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(pdfJsMock.getDocument).toHaveBeenCalledTimes(2))

    firstResult.resolve(firstDocument)
    await expect(firstLoad).resolves.toBe(false)
    expect(firstDocument.destroy).toHaveBeenCalledTimes(1)
    expect(loader.document).toBeNull()
    expect(loader.isLoading).toBe(true)
    expect(loader.fileName).toBe('second.pdf')

    secondResult.resolve(secondDocument)
    await expect(secondLoad).resolves.toBe(true)
    expect((loader.document as any)?.id).toBe('second')
    expect(loader.totalPages).toBe(7)
    expect(loader.isLoading).toBe(false)
    expect(loader.error).toBeNull()
  })

  it('새 load가 이미 열린 document를 폐기한 뒤 새 문서만 활성화한다', async () => {
    const firstResult = deferred<ReturnType<typeof createDocument>>()
    const secondResult = deferred<ReturnType<typeof createDocument>>()
    const firstTask = createTask(firstResult.promise)
    const secondTask = createTask(secondResult.promise)
    const firstDocument = createDocument('first', 3)
    const secondDocument = createDocument('second', 5)
    pdfJsMock.getDocument
      .mockReturnValueOnce(firstTask)
      .mockReturnValueOnce(secondTask)

    const loader = createPdfLoader()
    const firstLoad = loader.loadFromUrl('/first.pdf')
    await vi.waitFor(() => expect(pdfJsMock.getDocument).toHaveBeenCalledTimes(1))
    firstResult.resolve(firstDocument)
    await expect(firstLoad).resolves.toBe(true)

    const secondLoad = loader.loadFromUrl('/second.pdf')
    expect(loader.document).toBeNull()
    expect(loader.isLoading).toBe(true)
    await vi.waitFor(() => expect(firstDocument.destroy).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(pdfJsMock.getDocument).toHaveBeenCalledTimes(2))

    secondResult.resolve(secondDocument)
    await expect(secondLoad).resolves.toBe(true)
    expect((loader.document as any)?.id).toBe('second')
    expect(loader.totalPages).toBe(5)
  })

  it('unload가 진행 중 loadingTask를 취소하고 늦은 결과도 폐기한다', async () => {
    const result = deferred<ReturnType<typeof createDocument>>()
    const task = createTask(result.promise)
    const staleDocument = createDocument('stale', 9)
    pdfJsMock.getDocument.mockReturnValueOnce(task)

    const loader = createPdfLoader()
    const load = loader.loadFromUrl('/slow.pdf', 'slow.pdf')
    await vi.waitFor(() => expect(pdfJsMock.getDocument).toHaveBeenCalledTimes(1))

    const unload = loader.unload()
    expect(loader.document).toBeNull()
    expect(loader.totalPages).toBe(0)
    expect(loader.isLoading).toBe(false)
    expect(loader.fileName).toBe('')
    await expect(unload).resolves.toBeUndefined()
    expect(task.destroy).toHaveBeenCalledTimes(1)

    result.resolve(staleDocument)
    await expect(load).resolves.toBe(false)
    expect(staleDocument.destroy).toHaveBeenCalledTimes(1)
    expect(loader.document).toBeNull()
    expect(loader.error).toBeNull()
  })

  it('exportPdf가 saveDocument의 정확한 view 범위만 독립 ArrayBuffer로 반환한다', async () => {
    const loadedDocument = createDocument('forms')
    const backing = new Uint8Array([0, 0x25, 0x50, 0x44, 0x46, 0])
    loadedDocument.saveDocument.mockResolvedValue(backing.subarray(1, 5))
    pdfJsMock.getDocument.mockReturnValueOnce(createTask(Promise.resolve(loadedDocument)))

    const loader = createPdfLoader()
    await expect(loader.loadFromUrl('/forms.pdf')).resolves.toBe(true)
    const exported = await loader.exportPdf()

    expect(loadedDocument.saveDocument).toHaveBeenCalledTimes(1)
    expect(exported).toBeInstanceOf(ArrayBuffer)
    expect(exported?.byteLength).toBe(4)
    expect(Array.from(new Uint8Array(exported!))).toEqual([0x25, 0x50, 0x44, 0x46])
    expect(exported).not.toBe(backing.buffer)
  })
})
