import type { PdfDimensionDocumentPort } from '../viewer/viewerPorts'

export interface PageDimensions {
  width: number
  height: number
}

export interface PageDimensionStoreOptions {
  initialPageCount?: number
  publishBatchSize?: number
  onPageError?: (pageNumber: number, error: unknown) => void
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`)
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`)
  }
}

/** 문서 세대별 1.0x 페이지 치수를 비동기 로드하고 stale 완료를 차단 */
export function createPageDimensionStore(
  options: PageDimensionStoreOptions = {}
) {
  const initialPageCount = options.initialPageCount ?? 5
  const publishBatchSize = options.publishBatchSize ?? 10
  assertNonNegativeInteger(initialPageCount, 'initialPageCount')
  assertPositiveInteger(publishBatchSize, 'publishBatchSize')

  let dimensions = $state<Map<number, PageDimensions>>(new Map())
  let isLoading = $state(false)
  let generation = $state(0)
  let disposed = false
  let activeCompletion: Promise<void> = Promise.resolve()
  let settleActiveCompletion: (() => void) | null = null

  function isCurrent(requestGeneration: number): boolean {
    return !disposed && generation === requestGeneration
  }

  function publish(collected: Map<number, PageDimensions>, requestGeneration: number): void {
    if (!isCurrent(requestGeneration)) return
    dimensions = new Map(collected)
  }

  function reportPageError(pageNumber: number, error: unknown): void {
    try {
      options.onPageError?.(pageNumber, error)
    } catch {
      // 관측 콜백 실패가 나머지 페이지 치수 로드를 중단하지 않게 격리
    }
  }

  function startCompletion(): () => void {
    // 새 문서 세대는 이전 background 대기자도 즉시 해제
    settleActiveCompletion?.()
    let settled = false
    let resolveCompletion!: () => void
    activeCompletion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })

    const settle = () => {
      if (settled) return
      settled = true
      resolveCompletion()
      if (settleActiveCompletion === settle) settleActiveCompletion = null
    }
    settleActiveCompletion = settle
    return settle
  }

  async function collectPage(
    document: PdfDimensionDocumentPort,
    pageNumber: number,
    requestGeneration: number,
    collected: Map<number, PageDimensions>
  ): Promise<boolean> {
    try {
      const page = await document.getPage(pageNumber)
      if (!isCurrent(requestGeneration)) return false

      const viewport = page.getViewport({ scale: 1 })
      if (!Number.isFinite(viewport.width) || viewport.width <= 0 ||
          !Number.isFinite(viewport.height) || viewport.height <= 0) {
        throw new TypeError(`page ${pageNumber} returned invalid dimensions`)
      }

      collected.set(pageNumber, {
        width: viewport.width,
        height: viewport.height
      })
    } catch (error) {
      if (!isCurrent(requestGeneration)) return false
      reportPageError(pageNumber, error)
    }
    return isCurrent(requestGeneration)
  }

  async function loadRemainingPages(
    document: PdfDimensionDocumentPort,
    startPage: number,
    totalPages: number,
    requestGeneration: number,
    collected: Map<number, PageDimensions>,
    settle: () => void
  ): Promise<void> {
    try {
      for (let pageNumber = startPage; pageNumber <= totalPages; pageNumber++) {
        if (!await collectPage(document, pageNumber, requestGeneration, collected)) return
        if (pageNumber % publishBatchSize === 0 || pageNumber === totalPages) {
          publish(collected, requestGeneration)
        }
      }
    } finally {
      if (isCurrent(requestGeneration)) isLoading = false
      settle()
    }
  }

  /** 새 문서를 완전 교체하고 초기 페이지 게시 후 나머지는 background에서 조회 */
  async function loadDocument(
    document: PdfDimensionDocumentPort | null,
    totalPages: number
  ): Promise<void> {
    if (disposed) throw new Error('PageDimensionStore has been disposed')
    assertNonNegativeInteger(totalPages, 'totalPages')

    const requestGeneration = ++generation
    const settle = startCompletion()
    dimensions = new Map()
    isLoading = document !== null && totalPages > 0
    if (!document || totalPages === 0) {
      settle()
      return
    }

    const collected = new Map<number, PageDimensions>()
    const initialBoundary = Math.min(initialPageCount, totalPages)

    for (let pageNumber = 1; pageNumber <= initialBoundary; pageNumber++) {
      if (!await collectPage(document, pageNumber, requestGeneration, collected)) {
        settle()
        return
      }
    }
    publish(collected, requestGeneration)

    if (!isCurrent(requestGeneration)) {
      settle()
      return
    }
    if (initialBoundary >= totalPages) {
      isLoading = false
      settle()
      return
    }

    void loadRemainingPages(
      document,
      initialBoundary + 1,
      totalPages,
      requestGeneration,
      collected,
      settle
    )
  }

  /** 현재 문서의 background 치수 조회가 끝나거나 세대 교체로 무효화될 때까지 대기 */
  function waitForIdle(): Promise<void> {
    return activeCompletion
  }

  function get(pageNumber: number): PageDimensions | null {
    assertPositiveInteger(pageNumber, 'pageNumber')
    const value = dimensions.get(pageNumber)
    return value ? { ...value } : null
  }

  function getAll(): Map<number, PageDimensions> {
    return new Map(
      Array.from(dimensions.entries(), ([pageNumber, value]) => [pageNumber, { ...value }])
    )
  }

  /** 진행 중 문서 요청의 세대를 무효화하고 모든 참조 해제 */
  function dispose(): void {
    if (disposed) return
    disposed = true
    generation++
    settleActiveCompletion?.()
    settleActiveCompletion = null
    dimensions = new Map()
    isLoading = false
  }

  return {
    get dimensions() { return getAll() },
    get size() { return dimensions.size },
    get isLoading() { return isLoading },
    get generation() { return generation },
    get isDisposed() { return disposed },
    loadDocument,
    waitForIdle,
    get,
    getAll,
    dispose
  }
}

export type PageDimensionStore = ReturnType<typeof createPageDimensionStore>
