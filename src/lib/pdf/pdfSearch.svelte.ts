/** 가상화 범위 밖을 포함한 PDF 전체 텍스트 검색 상태 */

interface PdfSearchTextContent {
  items: unknown[]
}

export interface PdfSearchPage {
  getTextContent(options?: {
    includeMarkedContent?: boolean
    disableNormalization?: boolean
  }): Promise<PdfSearchTextContent>
}

/** 검색에 필요한 PDFDocumentProxy의 최소 공개 계약 */
export interface PdfSearchDocument {
  readonly numPages: number
  getPage(pageNumber: number): Promise<PdfSearchPage>
}

export interface PdfSearchMatch {
  /** 1-base PDF 페이지 번호 */
  readonly pageNumber: number
  /** NFC 정규화된 페이지 문자열에서의 UTF-16 오프셋 */
  readonly offset: number
  readonly length: number
}

export type PdfSearchStatus = 'idle' | 'indexing' | 'ready' | 'cancelled' | 'disposed'

export interface PdfSearchState {
  readonly status: PdfSearchStatus
  readonly query: string
  readonly caseSensitive: boolean
  readonly matches: readonly PdfSearchMatch[]
  /** 0-base 결과 인덱스. 결과가 없으면 -1 */
  readonly currentIndex: number
  readonly currentMatch: PdfSearchMatch | null
  readonly totalMatches: number
  /** 마지막 next/previous가 문서 끝을 순환했는지 여부 */
  readonly wrapped: boolean
  readonly indexedPages: number
  readonly failedPages: readonly number[]
}

export interface PdfSearchOptions {
  pdfDocument: PdfSearchDocument
  onNavigate?: (match: PdfSearchMatch, state: PdfSearchState) => void
  onStateChange?: (state: PdfSearchState) => void
  /** worker 동시성. 렌더링 응답성을 위해 최대 8로 제한 */
  concurrency?: number
}

export interface PdfSearchQueryOptions {
  caseSensitive?: boolean
}

interface IndexedPage {
  normalized: string
  folded: string
}

const EMPTY_MATCHES = Object.freeze([]) as readonly PdfSearchMatch[]
const EMPTY_PAGES = Object.freeze([]) as readonly number[]
const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 8

function freezeMatch(match: PdfSearchMatch): PdfSearchMatch {
  return Object.freeze(match)
}

/** PDF.js TextContent를 upstream find controller와 같은 평탄 문자열로 변환 */
function extractPageText(content: PdfSearchTextContent): string {
  const chunks: string[] = []
  for (const item of content.items) {
    if (!item || typeof item !== 'object') continue
    const text = (item as { str?: unknown }).str
    if (typeof text !== 'string') continue
    chunks.push(text)
    if ((item as { hasEOL?: unknown }).hasEOL === true) chunks.push('\n')
  }
  return chunks.join('').normalize('NFC')
}

/** 문자열·정규식 메타문자를 해석하지 않는 비중첩 literal 매치 */
function findLiteralMatches(
  pages: readonly (IndexedPage | undefined)[],
  query: string,
  caseSensitive: boolean
): readonly PdfSearchMatch[] {
  const normalizedQuery = query.normalize('NFC')
  const needle = caseSensitive ? normalizedQuery : normalizedQuery.toLowerCase()
  if (needle.length === 0) return EMPTY_MATCHES

  const matches: PdfSearchMatch[] = []
  pages.forEach((page, pageIndex) => {
    if (!page) return
    const haystack = caseSensitive ? page.normalized : page.folded
    let from = 0
    while (from <= haystack.length - needle.length) {
      const offset = haystack.indexOf(needle, from)
      if (offset < 0) break
      matches.push(freezeMatch({ pageNumber: pageIndex + 1, offset, length: needle.length }))
      from = offset + needle.length
    }
  })
  return Object.freeze(matches)
}

/**
 * 전 페이지 텍스트를 PDF.js 공개 getTextContent API로 인덱싱하는 검색 facade.
 * 취소할 수 없는 worker 왕복은 세대 검사로 결과 반영만 차단한다.
 */
export function createPdfSearch(options: PdfSearchOptions) {
  const requestedConcurrency = Number.isFinite(options.concurrency)
    ? Math.floor(options.concurrency as number)
    : DEFAULT_CONCURRENCY
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, requestedConcurrency))
  const pageCount = Number.isFinite(options.pdfDocument.numPages)
    ? Math.max(0, Math.floor(options.pdfDocument.numPages))
    : 0

  let pdfDocument: PdfSearchDocument | null = options.pdfDocument
  let onNavigate = options.onNavigate
  let onStateChange = options.onStateChange
  let disposed = false
  let generation = 0
  let searchRequest = 0
  let indexed = false
  let indexedPages = 0
  let pages: (IndexedPage | undefined)[] = new Array(pageCount)
  let failedPages: readonly number[] = EMPTY_PAGES
  let indexPromise: Promise<boolean> | null = null
  let state: PdfSearchState = Object.freeze({
    status: 'idle',
    query: '',
    caseSensitive: false,
    matches: EMPTY_MATCHES,
    currentIndex: -1,
    currentMatch: null,
    totalMatches: 0,
    wrapped: false,
    indexedPages: 0,
    failedPages: EMPTY_PAGES
  })

  /** 콜백 예외를 검색 상태 머신과 분리 */
  function notifyState(next: PdfSearchState): void {
    try {
      onStateChange?.(next)
    } catch {
      // 호스트 UI 콜백 실패는 검색 인덱스를 훼손하지 않음
    }
  }

  function setState(patch: Partial<PdfSearchState>, notify = true): PdfSearchState {
    state = Object.freeze({ ...state, ...patch })
    if (notify && !disposed) notifyState(state)
    return state
  }

  function navigate(match: PdfSearchMatch): void {
    try {
      onNavigate?.(match, state)
    } catch {
      // 스크롤 어댑터 실패가 다음 검색 이동을 막지 않도록 격리
    }
  }

  /** 현재 세대의 전체 페이지 인덱스 생성 */
  function ensureIndex(): Promise<boolean> {
    if (disposed || !pdfDocument) return Promise.resolve(false)
    if (indexed) return Promise.resolve(true)
    if (indexPromise) return indexPromise

    const indexGeneration = generation
    const document = pdfDocument
    let cursor = 0
    let successCount = 0
    const failures: number[] = []
    const nextPages: (IndexedPage | undefined)[] = new Array(pageCount)

    const task = (async () => {
      const isCurrent = () => !disposed && generation === indexGeneration
      const worker = async () => {
        while (isCurrent()) {
          const pageNumber = ++cursor
          if (pageNumber > pageCount) return

          try {
            const page = await document.getPage(pageNumber)
            if (!isCurrent()) return
            const content = await page.getTextContent({ disableNormalization: true })
            if (!isCurrent()) return
            const normalized = extractPageText(content)
            nextPages[pageNumber - 1] = {
              normalized,
        folded: normalized.toLowerCase()
            }
            successCount++
          } catch {
            if (!isCurrent()) return
            failures.push(pageNumber)
            nextPages[pageNumber - 1] = { normalized: '', folded: '' }
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, pageCount) }, worker))
      if (!isCurrent()) return false

      pages = nextPages
      indexedPages = successCount
      failedPages = Object.freeze(failures.sort((a, b) => a - b))
      indexed = true
      return true
    })()

    indexPromise = task
    void task.finally(() => {
      if (indexPromise === task) indexPromise = null
    })
    return task
  }

  /** UI 선로딩용 전체 문서 인덱싱 */
  async function index(): Promise<boolean> {
    if (disposed) return false
    if (!indexed) {
      setState({ status: 'indexing', indexedPages, failedPages, wrapped: false })
    }
    const indexGeneration = generation
    const success = await ensureIndex()
    if (!success || disposed || generation !== indexGeneration) return false
    setState({ status: 'ready', indexedPages, failedPages })
    return true
  }

  /** 새 literal 질의 실행. 첫 결과가 있으면 즉시 이동 */
  async function search(
    query: string,
    queryOptions: PdfSearchQueryOptions = {}
  ): Promise<PdfSearchState> {
    if (disposed) return state

    const request = ++searchRequest
    const searchGeneration = generation
    const caseSensitive = queryOptions.caseSensitive === true

    if (query.length === 0) {
      return setState({
        status: 'idle',
        query,
        caseSensitive,
        matches: EMPTY_MATCHES,
        currentIndex: -1,
        currentMatch: null,
        totalMatches: 0,
        wrapped: false,
        indexedPages,
        failedPages
      })
    }

    setState({
      status: 'indexing',
      query,
      caseSensitive,
      matches: EMPTY_MATCHES,
      currentIndex: -1,
      currentMatch: null,
      totalMatches: 0,
      wrapped: false,
      indexedPages,
      failedPages
    })

    const success = await ensureIndex()
    if (
      !success || disposed || generation !== searchGeneration || request !== searchRequest
    ) return state

    const matches = findLiteralMatches(pages, query, caseSensitive)
    const currentMatch = matches[0] ?? null
    setState({
      status: 'ready',
      matches,
      currentIndex: currentMatch ? 0 : -1,
      currentMatch,
      totalMatches: matches.length,
      wrapped: false,
      indexedPages,
      failedPages
    })
    if (currentMatch) navigate(currentMatch)
    return state
  }

  function move(direction: 1 | -1): PdfSearchMatch | null {
    if (disposed || state.status !== 'ready' || state.matches.length === 0) return null

    let nextIndex = state.currentIndex
    let wrapped = false
    if (nextIndex < 0) {
      nextIndex = direction === 1 ? 0 : state.matches.length - 1
    } else {
      nextIndex += direction
      if (nextIndex >= state.matches.length) {
        nextIndex = 0
        wrapped = true
      } else if (nextIndex < 0) {
        nextIndex = state.matches.length - 1
        wrapped = true
      }
    }

    const match = state.matches[nextIndex]
    setState({ currentIndex: nextIndex, currentMatch: match, wrapped })
    navigate(match)
    return match
  }

  /** 다음 결과로 이동. 마지막 결과 다음은 첫 결과로 순환 */
  function next(): PdfSearchMatch | null {
    return move(1)
  }

  /** 이전 결과로 이동. 첫 결과 이전은 마지막 결과로 순환 */
  function previous(): PdfSearchMatch | null {
    return move(-1)
  }

  /** 진행 중 인덱싱·질의 결과 반영 취소 */
  function cancel(): void {
    if (disposed) return
    generation++
    searchRequest++
    indexPromise = null
    if (!indexed) {
      pages = new Array(pageCount)
      indexedPages = 0
      failedPages = EMPTY_PAGES
    }
    setState({
      status: 'cancelled',
      query: '',
      matches: EMPTY_MATCHES,
      currentIndex: -1,
      currentMatch: null,
      totalMatches: 0,
      wrapped: false,
      indexedPages,
      failedPages
    })
  }

  /** 문서 참조와 인덱스 영구 해제 */
  function dispose(): void {
    if (disposed) return
    generation++
    searchRequest++
    indexPromise = null
    indexed = false
    indexedPages = 0
    pages = []
    failedPages = EMPTY_PAGES
    pdfDocument = null
    onNavigate = undefined
    onStateChange = undefined
    disposed = true
    setState({
      status: 'disposed',
      query: '',
      matches: EMPTY_MATCHES,
      currentIndex: -1,
      currentMatch: null,
      totalMatches: 0,
      wrapped: false,
      indexedPages: 0,
      failedPages: EMPTY_PAGES
    }, false)
  }

  return {
    get state() { return state },
    get indexedPages() { return indexedPages },
    get isIndexed() { return indexed },
    get isDisposed() { return disposed },
    index,
    search,
    next,
    previous,
    cancel,
    dispose
  }
}

export type PdfSearch = ReturnType<typeof createPdfSearch>
