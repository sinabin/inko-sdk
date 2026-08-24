import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => ({
  createValidAbsoluteUrl: (url: string, baseUrl: string | null = null) => {
    try {
      const parsed = baseUrl ? new URL(url, baseUrl) : new URL(url)
      return ['http:', 'https:', 'ftp:', 'mailto:', 'tel:'].includes(parsed.protocol) ? parsed : null
    } catch {
      return null
    }
  },
  isValidExplicitDest: (dest: unknown) => Array.isArray(dest) && dest.length >= 2
}))

import {
  createPdfLinkService,
  type PdfLinkScrollTarget
} from '../../src/lib/pdf/pdfLinkService'
import type { PDFDocumentProxy } from 'pdfjs-dist'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createDocument(options: {
  numPages?: number
  namedDestination?: unknown[] | null
  cachedPage?: number | null
  pageIndex?: number
} = {}): PDFDocumentProxy {
  const optionalContentConfig = { setOCGState: vi.fn() }
  return {
    numPages: options.numPages ?? 8,
    getDestination: vi.fn(async () => options.namedDestination ?? null),
    cachedPageNumber: vi.fn(() => options.cachedPage ?? null),
    getPageIndex: vi.fn(async () => options.pageIndex ?? 0),
    getOptionalContentConfig: vi.fn(async () => optionalContentConfig)
  } as unknown as PDFDocumentProxy
}

describe('createPdfLinkService', () => {
  let currentPage: number
  let scrollPageIntoView: ReturnType<typeof vi.fn>
  let ensurePageVisible: ReturnType<typeof vi.fn>
  let setCurrentPage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    currentPage = 1
    scrollPageIntoView = vi.fn()
    ensurePageVisible = vi.fn()
    setCurrentPage = vi.fn((pageNumber: number) => { currentPage = pageNumber })
  })

  function createService() {
    return createPdfLinkService({
      getCurrentPage: () => currentPage,
      setCurrentPage: setCurrentPage as (pageNumber: number) => void,
      ensurePageVisible: ensurePageVisible as (pageNumber: number) => void | Promise<void>,
      scrollPageIntoView: scrollPageIntoView as (target: PdfLinkScrollTarget) => void,
      pageLabelToPageNumber: (label) => label === 'appendix' ? 7 : null
    })
  }

  it('explicit destination을 1-base 페이지로 변환해 ensure 후 스크롤한다', async () => {
    const link = createService()
    link.setDocument(createDocument())
    const destination = [2, { name: 'Fit' }]

    await link.service.goToDestination(destination)

    expect(ensurePageVisible).toHaveBeenCalledWith(3)
    expect(setCurrentPage).toHaveBeenCalledWith(3)
    expect(scrollPageIntoView).toHaveBeenCalledWith({
      pageNumber: 3,
      destArray: destination,
      ignoreDestinationZoom: true
    })
  })

  it('named destination의 Ref는 cache 후 getPageIndex 순으로 해석한다', async () => {
    const ref = { num: 41, gen: 0 }
    const document = createDocument({
      namedDestination: [ref, { name: 'XYZ' }, 10, 20, null],
      cachedPage: null,
      pageIndex: 4
    })
    const link = createService()
    link.setDocument(document)

    await link.service.goToDestination('chapter-five')

    expect(document.getDestination).toHaveBeenCalledWith('chapter-five')
    expect(document.cachedPageNumber).toHaveBeenCalledWith(ref)
    expect(document.getPageIndex).toHaveBeenCalledWith(ref)
    expect(scrollPageIntoView).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 5 }))
  })

  it('비동기 ensure 중 문서가 교체되면 이전 목적지를 스크롤하지 않는다', async () => {
    const gate = deferred()
    ensurePageVisible.mockReturnValueOnce(gate.promise)
    const link = createService()
    link.setDocument(createDocument())

    link.service.goToPage(4)
    link.setDocument(createDocument())
    gate.resolve()
    await gate.promise
    await Promise.resolve()

    expect(scrollPageIntoView).not.toHaveBeenCalled()
  })

  it('페이지 라벨과 named action도 같은 호스트 이동 경로를 사용한다', () => {
    const link = createService()
    link.setDocument(createDocument())

    link.service.goToPage('appendix')
    link.service.executeNamedAction('NextPage')

    expect(scrollPageIntoView).toHaveBeenNthCalledWith(1, { pageNumber: 7 })
    expect(scrollPageIntoView).toHaveBeenNthCalledWith(2, { pageNumber: 8 })
  })

  it('외부 링크는 새 창·opener/referrer 차단으로 고정한다', () => {
    const link = createService()
    link.setDocument(createDocument())
    const anchor = document.createElement('a')

    link.service.addLinkAttributes(anchor, 'https://example.com/document')

    expect(anchor.href).toBe('https://example.com/document')
    expect(anchor.target).toBe('_blank')
    expect(anchor.rel).toBe('noopener noreferrer nofollow')
  })

  it('javascript/data 프로토콜은 href를 부여하지 않는다', () => {
    const link = createService()
    link.setDocument(createDocument())

    for (const unsafeUrl of ['javascript:alert(1)', 'data:text/html,unsafe']) {
      const anchor = document.createElement('a')
      link.service.addLinkAttributes(anchor, unsafeUrl)
      expect(anchor.hasAttribute('href')).toBe(false)
      expect(anchor.hasAttribute('target')).toBe(false)
      expect(anchor.rel).toBe('noopener noreferrer nofollow')
    }
  })

  it('dispose 후 이동은 무시한다', async () => {
    const link = createService()
    link.setDocument(createDocument())
    link.dispose()

    link.service.goToPage(2)
    await link.service.goToDestination([1, { name: 'Fit' }])

    expect(scrollPageIntoView).not.toHaveBeenCalled()
  })
})
