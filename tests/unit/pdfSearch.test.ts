import { describe, expect, it, vi } from 'vitest'
import {
  createPdfSearch,
  type PdfSearchDocument,
  type PdfSearchPage
} from '../../src/lib/pdf/pdfSearch.svelte'

type TextItem = { str: string; hasEOL?: boolean }

function createDocument(contents: Array<TextItem[] | Error>): {
  document: PdfSearchDocument
  getPage: ReturnType<typeof vi.fn>
  getTextContent: Array<ReturnType<typeof vi.fn>>
} {
  const getTextContent = contents.map((content) => vi.fn(async () => {
    if (content instanceof Error) throw content
    return { items: content }
  }))
  const getPage = vi.fn(async (pageNumber: number): Promise<PdfSearchPage> => ({
    getTextContent: getTextContent[pageNumber - 1]
  }))
  return {
    document: { numPages: contents.length, getPage },
    getPage,
    getTextContent
  }
}

describe('createPdfSearch 전체 문서 인덱스', () => {
  it('화면에 렌더되지 않은 페이지까지 getTextContent로 찾아 literal 메타문자를 그대로 검색한다', async () => {
    const source = createDocument([
      [{ str: '첫 페이지' }],
      [{ str: '수식 a+b? 와 A+B?' }],
      [{ str: '마지막 페이지' }]
    ])
    const search = createPdfSearch({ pdfDocument: source.document })

    const state = await search.search('a+b?')

    expect(source.getPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3])
    expect(source.getTextContent[1]).toHaveBeenCalledWith({ disableNormalization: true })
    expect(state.matches).toEqual([
      { pageNumber: 2, offset: 3, length: 4 },
      { pageNumber: 2, offset: 10, length: 4 }
    ])
    expect(state.indexedPages).toBe(3)
    expect(state.totalMatches).toBe(2)
  })

  it('NFC 정규화와 기본 Unicode 대소문자 무시를 적용한다', async () => {
    const source = createDocument([[{ str: 'Cafe\u0301 한글 PDF' }]])
    const search = createPdfSearch({ pdfDocument: source.document })

    const state = await search.search('CAFÉ')

    expect(state.matches).toEqual([{ pageNumber: 1, offset: 0, length: 4 }])
  })

  it('caseSensitive=true이면 대소문자를 구분한다', async () => {
    const source = createDocument([[{ str: 'Alpha alpha ALPHA' }]])
    const search = createPdfSearch({ pdfDocument: source.document })

    const exact = await search.search('Alpha', { caseSensitive: true })
    expect(exact.totalMatches).toBe(1)

    const folded = await search.search('alpha')
    expect(folded.totalMatches).toBe(3)
  })

  it('TextItem의 hasEOL을 줄바꿈으로 인덱싱한다', async () => {
    const source = createDocument([[
      { str: '첫 줄', hasEOL: true },
      { str: '둘째 줄' }
    ]])
    const search = createPdfSearch({ pdfDocument: source.document })

    const state = await search.search('첫 줄\n둘째')
    expect(state.totalMatches).toBe(1)
  })

  it('여러 TextItem 경계에 걸친 literal도 한 페이지 문자열에서 찾는다', async () => {
    const source = createDocument([[
      { str: 'INKO_' },
      { str: 'SEARCH_' },
      { str: 'TARGET_008' }
    ]])
    const search = createPdfSearch({ pdfDocument: source.document })

    const state = await search.search('INKO_SEARCH_TARGET_008')

    expect(state.matches).toEqual([{ pageNumber: 1, offset: 0, length: 22 }])
  })

  it('손상된 한 페이지는 failedPages로 격리하고 나머지 페이지 검색을 계속한다', async () => {
    const source = createDocument([
      [{ str: 'target one' }],
      new Error('broken page'),
      [{ str: 'target two' }]
    ])
    const search = createPdfSearch({ pdfDocument: source.document })

    const state = await search.search('target')

    expect(state.matches.map((match) => match.pageNumber)).toEqual([1, 3])
    expect(state.indexedPages).toBe(2)
    expect(state.failedPages).toEqual([2])
    expect(state.status).toBe('ready')
  })

  it('설정한 동시성 안에서 모든 페이지를 인덱싱한다', async () => {
    let active = 0
    let maxActive = 0
    const getPage = vi.fn(async (): Promise<PdfSearchPage> => ({
      getTextContent: async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active--
        return { items: [{ str: 'text' }] }
      }
    }))
    const search = createPdfSearch({
      pdfDocument: { numPages: 9, getPage },
      concurrency: 3
    })

    await expect(search.index()).resolves.toBe(true)

    expect(getPage).toHaveBeenCalledTimes(9)
    expect(maxActive).toBeGreaterThan(1)
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(search.indexedPages).toBe(9)
  })
})

describe('createPdfSearch 이동·세대 계약', () => {
  it('next/previous가 결과 사이를 이동하고 양 끝에서 순환한다', async () => {
    const source = createDocument([[{ str: 'x x' }]])
    const onNavigate = vi.fn()
    const search = createPdfSearch({ pdfDocument: source.document, onNavigate })

    await search.search('x')
    expect(onNavigate.mock.calls[0][0]).toMatchObject({ offset: 0 })

    expect(search.next()).toMatchObject({ offset: 2 })
    expect(search.state).toMatchObject({ currentIndex: 1, wrapped: false })

    expect(search.next()).toMatchObject({ offset: 0 })
    expect(search.state).toMatchObject({ currentIndex: 0, wrapped: true })

    expect(search.previous()).toMatchObject({ offset: 2 })
    expect(search.state).toMatchObject({ currentIndex: 1, wrapped: true })
  })

  it('인덱싱 중 더 최신 질의가 오면 오래된 질의 결과를 상태에 반영하지 않는다', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const getTextContent = vi.fn(async () => {
      await gate
      return { items: [{ str: 'old new' }] }
    })
    const document: PdfSearchDocument = {
      numPages: 1,
      getPage: vi.fn(async () => ({ getTextContent }))
    }
    const onNavigate = vi.fn()
    const search = createPdfSearch({ pdfDocument: document, onNavigate })

    const oldSearch = search.search('old')
    await vi.waitFor(() => expect(getTextContent).toHaveBeenCalledOnce())
    const newSearch = search.search('new')
    release()

    await oldSearch
    const state = await newSearch
    expect(state.query).toBe('new')
    expect(state.currentMatch).toMatchObject({ offset: 4 })
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate.mock.calls[0][0]).toMatchObject({ offset: 4 })
  })

  it('cancel 후 늦게 끝난 worker는 DOM 이동·상태 콜백·인덱스에 반영되지 않는다', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const getTextContent = vi.fn(async () => {
      await gate
      return { items: [{ str: 'target' }] }
    })
    const onNavigate = vi.fn()
    const onStateChange = vi.fn()
    const search = createPdfSearch({
      pdfDocument: {
        numPages: 1,
        getPage: vi.fn(async () => ({ getTextContent }))
      },
      onNavigate,
      onStateChange
    })

    const pending = search.search('target')
    await vi.waitFor(() => expect(getTextContent).toHaveBeenCalledOnce())
    search.cancel()
    const callbackCountAfterCancel = onStateChange.mock.calls.length
    release()

    await pending
    expect(search.state.status).toBe('cancelled')
    expect(search.indexedPages).toBe(0)
    expect(onNavigate).not.toHaveBeenCalled()
    expect(onStateChange).toHaveBeenCalledTimes(callbackCountAfterCancel)
  })

  it('dispose는 진행 중 결과를 폐기하고 이후 모든 동작을 무효화한다', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const getTextContent = vi.fn(async () => {
      await gate
      return { items: [{ str: 'target' }] }
    })
    const onNavigate = vi.fn()
    const onStateChange = vi.fn()
    const search = createPdfSearch({
      pdfDocument: {
        numPages: 1,
        getPage: vi.fn(async () => ({ getTextContent }))
      },
      onNavigate,
      onStateChange
    })

    const pending = search.search('target')
    await vi.waitFor(() => expect(getTextContent).toHaveBeenCalledOnce())
    search.dispose()
    const callbackCountAtDispose = onStateChange.mock.calls.length
    release()

    await pending
    expect(search.state.status).toBe('disposed')
    expect(search.isDisposed).toBe(true)
    expect(search.next()).toBeNull()
    await expect(search.search('target')).resolves.toBe(search.state)
    expect(onNavigate).not.toHaveBeenCalled()
    expect(onStateChange).toHaveBeenCalledTimes(callbackCountAtDispose)
  })

  it('빈 질의는 문서를 인덱싱하지 않고 상태만 초기화한다', async () => {
    const source = createDocument([[{ str: 'anything' }]])
    const search = createPdfSearch({ pdfDocument: source.document })

    const state = await search.search('')

    expect(state.status).toBe('idle')
    expect(state.totalMatches).toBe(0)
    expect(source.getPage).not.toHaveBeenCalled()
  })

  it('외부 콜백 예외와 상태 객체 변경 시도를 검색 로직에서 격리한다', async () => {
    const source = createDocument([[{ str: 'target' }]])
    const search = createPdfSearch({
      pdfDocument: source.document,
      onNavigate: () => { throw new Error('host navigation failed') },
      onStateChange: () => { throw new Error('host state failed') }
    })

    await expect(search.search('target')).resolves.toMatchObject({ totalMatches: 1 })
    expect(Object.isFrozen(search.state)).toBe(true)
    expect(Object.isFrozen(search.state.matches)).toBe(true)
  })
})
