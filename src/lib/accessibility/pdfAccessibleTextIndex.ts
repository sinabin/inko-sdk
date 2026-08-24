/**
 * 가상화된 캔버스와 독립적으로 전 페이지의 읽기 순서 텍스트를 준비한다.
 * PDF.js 공개 getPage/getTextContent 계약만 사용하며, 취소할 수 없는 worker
 * 왕복은 문서 세대 검사로 이전 결과가 새 문서에 반영되지 않게 한다.
 */

export interface PdfAccessibleTextContent {
  readonly items: readonly unknown[]
}

export interface PdfAccessibleTextPage {
  getTextContent(options?: {
    includeMarkedContent?: boolean
    disableNormalization?: boolean
  }): Promise<PdfAccessibleTextContent>
}

/** 접근성 텍스트 인덱스가 요구하는 PDFDocumentProxy의 최소 공개 계약 */
export interface PdfAccessibleTextDocument {
  readonly numPages: number
  getPage(pageNumber: number): Promise<PdfAccessibleTextPage>
}

export type PdfAccessiblePageTextStatus =
  | 'pending'
  | 'loading'
  | 'ready'
  | 'image-only'
  | 'error'

export interface PdfAccessiblePageTextState {
  /** 1-base PDF 페이지 번호 */
  readonly pageNumber: number
  readonly status: PdfAccessiblePageTextStatus
  /** ready 상태에서만 비어 있지 않은 NFC 텍스트 */
  readonly text: string
}

export interface PdfAccessibleTextIndexOptions {
  /** PDF 렌더 작업과 CPU/worker 시간을 경쟁하지 않도록 1~4로 제한 */
  concurrency?: number
  /** 새 문서를 설정하거나 취소할 때 한 번 호출 */
  onReset?: (states: readonly PdfAccessiblePageTextState[]) => void
  /** 개별 페이지 상태 변경 콜백 */
  onPageStateChange?: (state: PdfAccessiblePageTextState) => void
}

const DEFAULT_CONCURRENCY = 2
const MAX_CONCURRENCY = 4
const EMPTY_STATES = Object.freeze([]) as readonly PdfAccessiblePageTextState[]

function freezeState(
  pageNumber: number,
  status: PdfAccessiblePageTextStatus,
  text = ''
): PdfAccessiblePageTextState {
  return Object.freeze({ pageNumber, status, text })
}

/** marked-content 항목은 건너뛰고 PDF.js가 반환한 읽기 순서를 보존한다. */
export function extractPdfAccessiblePageText(content: PdfAccessibleTextContent): string {
  const chunks: string[] = []
  for (const item of content.items) {
    if (!item || typeof item !== 'object') continue
    const value = item as { str?: unknown; hasEOL?: unknown }
    if (typeof value.str !== 'string') continue
    chunks.push(value.str.replaceAll('\u0000', ''))
    if (value.hasEOL === true) chunks.push('\n')
  }
  return chunks.join('').normalize('NFC').trim()
}

export function createPdfAccessibleTextIndex(options: PdfAccessibleTextIndexOptions = {}) {
  const requestedConcurrency = Number.isFinite(options.concurrency)
    ? Math.floor(options.concurrency as number)
    : DEFAULT_CONCURRENCY
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, requestedConcurrency))

  let onReset = options.onReset
  let onPageStateChange = options.onPageStateChange
  let pdfDocument: PdfAccessibleTextDocument | null = null
  let states: PdfAccessiblePageTextState[] = []
  let indexPromise: Promise<boolean> | null = null
  let generation = 0
  let disposed = false

  function safeReset(nextStates: readonly PdfAccessiblePageTextState[]): void {
    try {
      onReset?.(nextStates)
    } catch {
      // 호스트의 접근성 UI 콜백은 인덱싱 수명주기와 분리한다.
    }
  }

  function publish(
    pageNumber: number,
    status: PdfAccessiblePageTextStatus,
    text = '',
    expectedGeneration = generation
  ): boolean {
    if (disposed || expectedGeneration !== generation || !pdfDocument) return false
    const state = freezeState(pageNumber, status, text)
    // 페이지마다 전체 배열을 복사하지 않아 대용량 문서에서도 O(pageCount)를 유지한다.
    states[pageNumber - 1] = state
    try {
      onPageStateChange?.(state)
    } catch {
      // 호스트의 접근성 UI 콜백은 다른 페이지 인덱싱을 막지 않는다.
    }
    return true
  }

  /** 새 문서를 설정하면 이전 문서 작업을 무효화하고 즉시 전 페이지 인덱싱을 시작한다. */
  function setDocument(document: PdfAccessibleTextDocument | null): Promise<boolean> {
    if (disposed) return Promise.resolve(false)
    if (document === pdfDocument && indexPromise) return indexPromise

    const documentGeneration = ++generation
    pdfDocument = document
    indexPromise = null

    if (!document) {
      states = []
      safeReset(EMPTY_STATES)
      return Promise.resolve(false)
    }

    const pageCount = Number.isFinite(document.numPages)
      ? Math.max(0, Math.floor(document.numPages))
      : 0
    states = Array.from(
      { length: pageCount },
      (_, index) => freezeState(index + 1, 'pending')
    )
    safeReset(Object.freeze(states.slice()))

    let cursor = 0
    const isCurrent = () => (
      !disposed &&
      generation === documentGeneration &&
      pdfDocument === document
    )

    const task = (async () => {
      const worker = async () => {
        while (isCurrent()) {
          const pageNumber = ++cursor
          if (pageNumber > pageCount) return
          if (!publish(pageNumber, 'loading', '', documentGeneration)) return

          try {
            const page = await document.getPage(pageNumber)
            if (!isCurrent()) return
            const content = await page.getTextContent({
              includeMarkedContent: true,
              disableNormalization: false
            })
            if (!isCurrent()) return
            const text = extractPdfAccessiblePageText(content)
            if (!publish(
              pageNumber,
              text.length > 0 ? 'ready' : 'image-only',
              text,
              documentGeneration
            )) return
          } catch {
            if (!isCurrent()) return
            if (!publish(pageNumber, 'error', '', documentGeneration)) return
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(concurrency, pageCount) }, () => worker())
      )
      return isCurrent()
    })()

    indexPromise = task
    void task.finally(() => {
      if (indexPromise === task) indexPromise = null
    })
    return task
  }

  /** 진행 중인 문서를 취소하고 보관한 텍스트와 문서 참조를 해제한다. */
  function cancel(): void {
    if (disposed) return
    generation++
    pdfDocument = null
    indexPromise = null
    states = []
    safeReset(EMPTY_STATES)
  }

  function dispose(): void {
    if (disposed) return
    generation++
    pdfDocument = null
    indexPromise = null
    states = []
    onReset = undefined
    onPageStateChange = undefined
    disposed = true
  }

  return {
    get states() { return states },
    get concurrency() { return concurrency },
    get isDisposed() { return disposed },
    setDocument,
    cancel,
    dispose
  }
}

export type PdfAccessibleTextIndex = ReturnType<typeof createPdfAccessibleTextIndex>
