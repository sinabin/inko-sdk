import { describe, expect, it, vi } from 'vitest'
import { createPdfSearch, type PdfSearchDocument } from '../../src/lib/pdf/pdfSearch.svelte'

function documentWith(items: unknown[], numPages = 1): PdfSearchDocument & { getPage: ReturnType<typeof vi.fn> } {
  return {
    numPages,
    getPage: vi.fn(async () => ({
      getTextContent: vi.fn(async () => ({ items }))
    }))
  }
}

describe('pdfSearch defensive and cache branches', () => {
  it('ignores malformed TextContent items while indexing valid strings', async () => {
    const pdf = documentWith([
      null,
      12,
      {},
      { str: 99 },
      { str: 'valid' },
      { str: ' line', hasEOL: false }
    ])
    const search = createPdfSearch({ pdfDocument: pdf })

    await expect(search.search('valid line')).resolves.toMatchObject({ totalMatches: 1 })
    expect(search.isIndexed).toBe(true)
  })

  it.each([
    [Number.NaN, Number.NaN],
    [0, -4],
    [99, 0]
  ])('normalizes invalid concurrency %s and page count %s safely', async (concurrency, numPages) => {
    const pdf = documentWith([], numPages)
    const search = createPdfSearch({ pdfDocument: pdf, concurrency })

    await expect(search.index()).resolves.toBe(true)
    expect(search.indexedPages).toBe(0)
    expect(pdf.getPage).not.toHaveBeenCalled()
    await expect(search.search('missing')).resolves.toMatchObject({ totalMatches: 0 })
    expect(search.next()).toBeNull()
    expect(search.previous()).toBeNull()
  })

  it('shares an in-flight index and reuses the completed index for later searches', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const getTextContent = vi.fn(async () => {
      await gate
      return { items: [{ str: 'cached target' }] }
    })
    const getPage = vi.fn(async () => ({ getTextContent }))
    const search = createPdfSearch({ pdfDocument: { numPages: 1, getPage } })

    const first = search.index()
    const second = search.index()
    await vi.waitFor(() => expect(getPage).toHaveBeenCalledTimes(1))
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    await expect(search.index()).resolves.toBe(true)
    await expect(search.search('target')).resolves.toMatchObject({ totalMatches: 1 })
    expect(getPage).toHaveBeenCalledTimes(1)
  })

  it('keeps a completed index across cancel and handles case-sensitive empty reset', async () => {
    const pdf = documentWith([{ str: 'Alpha' }])
    const search = createPdfSearch({ pdfDocument: pdf })
    await search.search('alpha')

    search.cancel()
    expect(search.state.status).toBe('cancelled')
    await expect(search.search('', { caseSensitive: true })).resolves.toMatchObject({
      status: 'idle',
      caseSensitive: true
    })
    await expect(search.search('Alpha')).resolves.toMatchObject({ totalMatches: 1 })
    expect(pdf.getPage).toHaveBeenCalledTimes(1)
  })

  it('makes cancel/dispose idempotent and rejects index after disposal', async () => {
    const search = createPdfSearch({ pdfDocument: documentWith([{ str: 'x' }]) })
    search.cancel()
    search.dispose()
    search.cancel()
    search.dispose()

    await expect(search.index()).resolves.toBe(false)
    expect(search.next()).toBeNull()
    expect(search.previous()).toBeNull()
  })
})
