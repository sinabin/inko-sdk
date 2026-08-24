import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pdfjs: {
    GlobalWorkerOptions: { workerSrc: '' },
    VerbosityLevel: { ERRORS: 0 },
    getDocument: vi.fn()
  },
  reportError: vi.fn()
}))

vi.mock('pdfjs-dist', () => mocks.pdfjs)
vi.mock('../../src/lib/utils/errorReporter.svelte', () => ({
  reportError: mocks.reportError
}))

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

function createTask(promise: Promise<any>, destroy = vi.fn().mockResolvedValue(undefined)) {
  return { promise, destroy }
}

function createDocument(numPages = 3) {
  return {
    numPages,
    destroy: vi.fn().mockResolvedValue(undefined),
    getPage: vi.fn(),
    getData: vi.fn(),
    saveDocument: vi.fn()
  }
}

async function load(loader: ReturnType<typeof createPdfLoader>, document = createDocument()) {
  mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(document)))
  await expect(loader.loadFromUrl('/fixture.pdf')).resolves.toBe(true)
  return document
}

beforeEach(() => {
  mocks.pdfjs.getDocument.mockReset()
  mocks.reportError.mockReset()
  vi.restoreAllMocks()
})

describe('PdfLoader public contract', () => {
  it('starts empty and passes hardened local-resource options to URL loading', async () => {
    const loader = createPdfLoader()
    const document = createDocument(4)
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(document)))

    expect(loader.document).toBeNull()
    expect(loader.totalPages).toBe(0)
    expect(loader.isLoading).toBe(false)
    expect(loader.error).toBeNull()
    expect(loader.fileName).toBe('')
    expect(loader.hasDocument).toBe(false)

    await expect(loader.loadFromUrl('/docs/%ED%95%9C%EA%B8%80.pdf?token=x#page=2')).resolves.toBe(true)

    expect(loader.fileName).toBe('한글.pdf')
    expect(loader.totalPages).toBe(4)
    expect(loader.hasDocument).toBe(true)
    expect(mocks.pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      url: '/docs/%ED%95%9C%EA%B8%80.pdf?token=x#page=2',
      cMapPacked: true,
      isEvalSupported: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true
    }))
  })

  it.each([
    ['/plain.pdf?token=x#page=2', 'plain.pdf'],
    ['/bad/%E0%A4%A.pdf', '%E0%A4%A.pdf'],
    ['/', 'document.pdf'],
    ['', 'document.pdf']
  ])('normalizes inferred URL filename %s', async (url, expected) => {
    const loader = createPdfLoader()
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(createDocument())))

    await loader.loadFromUrl(url)

    expect(loader.fileName).toBe(expected)
  })

  it('honors an explicit decoded filename and strips its non-file suffix', async () => {
    const loader = createPdfLoader()
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(createDocument())))

    await loader.loadFromUrl('/ignored.pdf', 'report%20final.pdf?download=1#top')

    expect(loader.fileName).toBe('report final.pdf')
  })

  it('decodes base64 into bytes and applies the default filename', async () => {
    const loader = createPdfLoader()
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(createDocument())))

    await expect(loader.loadFromBase64('AAH/')).resolves.toBe(true)

    const options = mocks.pdfjs.getDocument.mock.calls[0][0]
    expect(Array.from(options.data as Uint8Array)).toEqual([0, 1, 255])
    expect(loader.fileName).toBe('document.pdf')
  })

  it.each([
    [new ArrayBuffer(3), 'buffer.pdf'],
    [new Uint8Array([7, 8]), 'bytes.pdf']
  ])('passes ArrayBuffer-like data through without replacing its identity', async (data, name) => {
    const loader = createPdfLoader()
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(createDocument())))

    await expect(loader.loadFromArrayBuffer(data, name)).resolves.toBe(true)

    expect(mocks.pdfjs.getDocument.mock.calls[0][0].data).toBe(data)
    expect(loader.fileName).toBe(name)
  })

  it.each([
    [new Error('broken PDF'), 'broken PDF'],
    ['not-an-error', 'PDF 로드 실패']
  ])('surfaces a current load failure without retaining a document', async (reason, message) => {
    const loader = createPdfLoader()
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.reject(reason)))

    await expect(loader.loadFromUrl('/broken.pdf')).resolves.toBe(false)

    expect(loader.error).toBe(message)
    expect(loader.document).toBeNull()
    expect(loader.totalPages).toBe(0)
    expect(loader.isLoading).toBe(false)
  })

  it('handles a synchronous loading-task factory failure', async () => {
    const loader = createPdfLoader()
    mocks.pdfjs.getDocument.mockImplementationOnce(() => {
      throw new Error('factory failed')
    })

    await expect(loader.loadFromUrl('/broken.pdf')).resolves.toBe(false)

    expect(loader.error).toBe('factory failed')
    expect(loader.isLoading).toBe(false)
  })

  it('absorbs destroy failures while replacing and unloading resources', async () => {
    const loader = createPdfLoader()
    const first = createDocument()
    first.destroy.mockRejectedValueOnce(new Error('document cleanup failed'))
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(first)))
    await loader.loadFromUrl('/first.pdf')

    const activeDestroy = vi.fn().mockRejectedValue(new Error('task cleanup failed'))
    const pending = deferred<ReturnType<typeof createDocument>>()
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(pending.promise, activeDestroy))
    const replacement = loader.loadFromUrl('/second.pdf')
    await vi.waitFor(() => expect(mocks.pdfjs.getDocument).toHaveBeenCalledTimes(2))

    await expect(loader.unload()).resolves.toBeUndefined()
    pending.reject(new Error('cancelled'))
    await expect(replacement).resolves.toBe(false)
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(activeDestroy).toHaveBeenCalledTimes(1)
    expect(loader.error).toBeNull()
  })

  it('abandons a load superseded while prior document cleanup is pending', async () => {
    const loader = createPdfLoader()
    const cleanup = deferred<void>()
    const first = createDocument()
    first.destroy.mockReturnValueOnce(cleanup.promise)
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(first)))
    await loader.loadFromUrl('/first.pdf')

    const secondLoad = loader.loadFromUrl('/second.pdf')
    const thirdDocument = createDocument(8)
    mocks.pdfjs.getDocument.mockReturnValueOnce(createTask(Promise.resolve(thirdDocument)))
    const thirdLoad = loader.loadFromUrl('/third.pdf')
    cleanup.resolve()

    await expect(secondLoad).resolves.toBe(false)
    await expect(thirdLoad).resolves.toBe(true)
    expect(mocks.pdfjs.getDocument).toHaveBeenCalledTimes(2)
    expect(loader.totalPages).toBe(8)
  })

  it('returns null and warns when getPage has no current or valid page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loader = createPdfLoader()

    await expect(loader.getPage(1)).resolves.toBeNull()
    const document = await load(loader, createDocument(2))
    await expect(loader.getPage(0)).resolves.toBeNull()
    await expect(loader.getPage(3)).resolves.toBeNull()

    expect(document.getPage).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('returns a current page and reports only current page failures', async () => {
    const loader = createPdfLoader()
    const document = await load(loader)
    const page = { pageNumber: 2 }
    document.getPage.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('page failed'))

    await expect(loader.getPage(2)).resolves.toBe(page)
    await expect(loader.getPage(2)).resolves.toBeNull()

    expect(mocks.reportError).toHaveBeenCalledWith(
      'render',
      '페이지 2을 불러올 수 없습니다',
      expect.any(Error)
    )
  })

  it.each(['resolve', 'reject'] as const)(
    'drops a stale getPage %s result without reporting it',
    async (outcome) => {
      const loader = createPdfLoader()
      const document = await load(loader)
      const pageResult = deferred<any>()
      document.getPage.mockReturnValueOnce(pageResult.promise)

      const pagePromise = loader.getPage(1)
      await loader.unload()
      outcome === 'resolve'
        ? pageResult.resolve({ pageNumber: 1 })
        : pageResult.reject(new Error('stale page'))

      await expect(pagePromise).resolves.toBeNull()
      expect(mocks.reportError).not.toHaveBeenCalled()
    }
  )

  it('returns exact independent original bytes and reports a current read failure', async () => {
    const loader = createPdfLoader()
    const document = await load(loader)
    const backing = new Uint8Array([9, 1, 2, 3, 9])
    document.getData.mockResolvedValueOnce(backing.subarray(1, 4))

    const data = await loader.getDataAsArrayBuffer()
    expect(Array.from(new Uint8Array(data!))).toEqual([1, 2, 3])
    expect(data).not.toBe(backing.buffer)

    document.getData.mockRejectedValueOnce(new Error('read failed'))
    await expect(loader.getDataAsArrayBuffer()).resolves.toBeNull()
    expect(mocks.reportError).toHaveBeenLastCalledWith(
      'render',
      'PDF 원본 데이터 추출에 실패했습니다',
      expect.any(Error)
    )
  })

  it.each(['data', 'export'] as const)('returns null for %s when no document exists', async (kind) => {
    const loader = createPdfLoader()
    const result = kind === 'data'
      ? loader.getDataAsArrayBuffer()
      : loader.exportPdf()
    await expect(result).resolves.toBeNull()
  })

  it.each(['resolve', 'reject'] as const)(
    'drops a stale original-data %s result without reporting it',
    async (outcome) => {
      const loader = createPdfLoader()
      const document = await load(loader)
      const result = deferred<Uint8Array>()
      document.getData.mockReturnValueOnce(result.promise)

      const read = loader.getDataAsArrayBuffer()
      await loader.unload()
      outcome === 'resolve'
        ? result.resolve(new Uint8Array([1]))
        : result.reject(new Error('stale read'))

      await expect(read).resolves.toBeNull()
      expect(mocks.reportError).not.toHaveBeenCalled()
    }
  )

  it('reports a current PDF export failure', async () => {
    const loader = createPdfLoader()
    const document = await load(loader)
    document.saveDocument.mockRejectedValueOnce(new Error('save failed'))

    await expect(loader.exportPdf()).resolves.toBeNull()

    expect(mocks.reportError).toHaveBeenCalledWith(
      'render',
      'PDF 양식 데이터를 내보내지 못했습니다',
      expect.any(Error)
    )
  })

  it.each(['resolve', 'reject'] as const)(
    'drops a stale PDF export %s result without reporting it',
    async (outcome) => {
      const loader = createPdfLoader()
      const document = await load(loader)
      const result = deferred<Uint8Array>()
      document.saveDocument.mockReturnValueOnce(result.promise)

      const exported = loader.exportPdf()
      await loader.unload()
      outcome === 'resolve'
        ? result.resolve(new Uint8Array([1]))
        : result.reject(new Error('stale export'))

      await expect(exported).resolves.toBeNull()
      expect(mocks.reportError).not.toHaveBeenCalled()
    }
  )
})
