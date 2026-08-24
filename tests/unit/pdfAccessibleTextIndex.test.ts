import { describe, expect, it, vi } from 'vitest'
import {
  createPdfAccessibleTextIndex,
  extractPdfAccessiblePageText,
  type PdfAccessibleTextDocument,
  type PdfAccessibleTextPage
} from '../../src/lib/accessibility/pdfAccessibleTextIndex'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function textPage(items: readonly unknown[]): PdfAccessibleTextPage {
  return {
    getTextContent: vi.fn(async () => ({ items }))
  }
}

describe('PDF 접근성 텍스트 인덱스', () => {
  it('읽기 순서·줄바꿈·Unicode NFC를 보존하고 이미지 전용/실패 상태를 구분한다', async () => {
    expect(extractPdfAccessiblePageText({
      items: [
        { str: 'Cafe\u0301', hasEOL: true },
        { type: 'beginMarkedContent' },
        { str: '\u0000다음 줄' }
      ]
    })).toBe('Café\n다음 줄')

    const firstPage = textPage([{ str: '첫 페이지', hasEOL: true }, { str: '본문' }])
    const secondPage = textPage([{ type: 'beginMarkedContent' }])
    const document = {
      numPages: 3,
      getPage: vi.fn(async (pageNumber: number) => {
        if (pageNumber === 1) return firstPage
        if (pageNumber === 2) return secondPage
        throw new Error('worker failure')
      })
    } satisfies PdfAccessibleTextDocument
    const updates: string[] = []
    const index = createPdfAccessibleTextIndex({
      onPageStateChange: (state) => updates.push(`${state.pageNumber}:${state.status}`)
    })

    await expect(index.setDocument(document)).resolves.toBe(true)

    expect(index.states).toEqual([
      { pageNumber: 1, status: 'ready', text: '첫 페이지\n본문' },
      { pageNumber: 2, status: 'image-only', text: '' },
      { pageNumber: 3, status: 'error', text: '' }
    ])
    expect(firstPage.getTextContent).toHaveBeenCalledWith({
      includeMarkedContent: true,
      disableNormalization: false
    })
    expect(updates).toEqual(expect.arrayContaining([
      '1:loading', '1:ready', '2:image-only', '3:error'
    ]))
  })

  it('대용량 문서에서도 동시 작업을 4개로 제한하고 페이지마다 배열 전체를 재할당하지 않는다', async () => {
    let active = 0
    let maximumActive = 0
    const document = {
      numPages: 120,
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: async () => {
          active++
          maximumActive = Math.max(maximumActive, active)
          await new Promise(resolve => setTimeout(resolve, 0))
          active--
          return { items: [{ str: `page ${pageNumber}` }] }
        }
      }))
    } satisfies PdfAccessibleTextDocument
    const resetSnapshots: Array<readonly unknown[]> = []
    const index = createPdfAccessibleTextIndex({
      concurrency: 99,
      onReset: (states) => resetSnapshots.push(states)
    })

    const indexing = index.setDocument(document)
    const stateArray = index.states
    await expect(indexing).resolves.toBe(true)

    expect(index.concurrency).toBe(4)
    expect(maximumActive).toBe(4)
    expect(document.getPage).toHaveBeenCalledTimes(120)
    expect(index.states).toBe(stateArray)
    expect(index.states).toHaveLength(120)
    expect(index.states[119]).toEqual({ pageNumber: 120, status: 'ready', text: 'page 120' })
    expect(resetSnapshots).toHaveLength(1)
  })

  it('문서 교체 시 완료가 늦은 이전 세대의 텍스트를 새 문서에 섞지 않는다', async () => {
    const oldContent = deferred<{ items: { str: string }[] }>()
    const oldDocument = {
      numPages: 1,
      getPage: vi.fn(async () => ({
        getTextContent: vi.fn(() => oldContent.promise)
      }))
    } satisfies PdfAccessibleTextDocument
    const newDocument = {
      numPages: 1,
      getPage: vi.fn(async () => textPage([{ str: '새 문서' }]))
    } satisfies PdfAccessibleTextDocument
    const publishedText: string[] = []
    const index = createPdfAccessibleTextIndex({
      onPageStateChange: (state) => {
        if (state.text) publishedText.push(state.text)
      }
    })

    const oldTask = index.setDocument(oldDocument)
    await vi.waitFor(() => expect(oldDocument.getPage).toHaveBeenCalledTimes(1))
    const newTask = index.setDocument(newDocument)
    await expect(newTask).resolves.toBe(true)
    oldContent.resolve({ items: [{ str: '이전 문서' }] })

    await expect(oldTask).resolves.toBe(false)
    expect(index.states).toEqual([{ pageNumber: 1, status: 'ready', text: '새 문서' }])
    expect(publishedText).toEqual(['새 문서'])
  })

  it('cancel/dispose 뒤 늦은 worker 결과와 콜백을 반영하지 않는다', async () => {
    const content = deferred<{ items: { str: string }[] }>()
    const onPageStateChange = vi.fn()
    const document = {
      numPages: 1,
      getPage: vi.fn(async () => ({ getTextContent: () => content.promise }))
    } satisfies PdfAccessibleTextDocument
    const index = createPdfAccessibleTextIndex({ onPageStateChange })

    const task = index.setDocument(document)
    await vi.waitFor(() => expect(onPageStateChange).toHaveBeenCalledWith(
      { pageNumber: 1, status: 'loading', text: '' }
    ))
    index.cancel()
    index.dispose()
    const callsAtDispose = onPageStateChange.mock.calls.length
    content.resolve({ items: [{ str: '늦은 결과' }] })

    await expect(task).resolves.toBe(false)
    expect(index.isDisposed).toBe(true)
    expect(index.states).toEqual([])
    expect(onPageStateChange).toHaveBeenCalledTimes(callsAtDispose)
    await expect(index.setDocument(document)).resolves.toBe(false)
  })
})
