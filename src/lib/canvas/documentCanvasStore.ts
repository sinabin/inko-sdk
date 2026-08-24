import {
  canvasDataMapToRecord,
  normalizeCanvasDataRecord,
  serializeCanvasDataMap,
  type CanvasDataRecord
} from './canvasDataCodec'
import type {
  DocumentCanvasStorePort,
  LiveCanvasDisconnectListener,
  LiveCanvasDisconnectReason,
  PageCanvasPort
} from '../viewer/viewerPorts'

export type LiveCanvasOperation = 'export' | 'import' | 'clear'

export interface DocumentCanvasStoreOptions {
  onLiveError?: (pageNumber: number, operation: LiveCanvasOperation, error: unknown) => void
}

function assertPageNumber(pageNumber: number): void {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new TypeError('pageNumber must be a positive integer')
  }
}

function normalizeInput(
  data: CanvasDataRecord | ReadonlyMap<number, string>
): CanvasDataRecord {
  return data instanceof Map
    ? canvasDataMapToRecord(data)
    : normalizeCanvasDataRecord(data)
}

/** clear/replace 직후 빈 Paper layer 알림이 삭제 페이지를 되살리는지 판정 */
function isEmptyPaperSnapshot(pageJson: string): boolean {
  try {
    const parsed = JSON.parse(pageJson)
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return true
      if (parsed[0] === 'Layer' && parsed[1] && typeof parsed[1] === 'object') {
        const children = (parsed[1] as { children?: unknown }).children
        return !Array.isArray(children) || children.length === 0
      }
      return false
    }
    if (parsed && typeof parsed === 'object' && 'children' in parsed) {
      const children = (parsed as { children?: unknown }).children
      return Array.isArray(children) && children.length === 0
    }
    return false
  } catch {
    return false
  }
}

/** 저장 스냅샷과 현재 렌더 중인 manager를 하나의 문서 편집 상태로 조정 */
export function createDocumentCanvasStore(
  options: DocumentCanvasStoreOptions = {}
): DocumentCanvasStorePort {
  const { onLiveError } = options

  let stored = new Map<number, string>()
  const liveManagers = new Map<number, PageCanvasPort>()
  const liveSnapshotPages = new Set<number>()
  const suppressedLivePages = new Set<number>()
  const disconnectListeners = new Set<LiveCanvasDisconnectListener>()
  let hasReplacementBaseline = false
  let disposed = false

  function assertActive(): void {
    if (disposed) throw new Error('DocumentCanvasStore has been disposed')
  }

  function reportLiveError(
    pageNumber: number,
    operation: LiveCanvasOperation,
    error: unknown
  ): void {
    try {
      onLiveError?.(pageNumber, operation, error)
    } catch {
      // 관측 콜백 실패가 저장소 fallback·정리 경로를 중단하지 않게 격리
    }
  }

  function readLiveSnapshot(pageNumber: number): string | null {
    if (!liveSnapshotPages.has(pageNumber)) return null
    const manager = liveManagers.get(pageNumber)
    if (!manager) return null

    try {
      const pageJson = manager.exportJSON()
      if (disposed || liveManagers.get(pageNumber) !== manager) return null
      return normalizeCanvasDataRecord({ [pageNumber]: pageJson })[String(pageNumber)] ?? null
    } catch (error) {
      reportLiveError(pageNumber, 'export', error)
      disconnectLivePage(pageNumber, manager, 'export')
      return null
    }
  }

  function syncLivePage(pageNumber: number, pageJson: string): boolean {
    const manager = liveManagers.get(pageNumber)
    if (!manager) return false

    try {
      const imported = manager.importJSON(pageJson)
      return imported && !disposed && liveManagers.get(pageNumber) === manager
    } catch (error) {
      reportLiveError(pageNumber, 'import', error)
      return false
    }
  }

  function disconnectLivePage(
    pageNumber: number,
    manager: PageCanvasPort,
    reason?: LiveCanvasDisconnectReason
  ): void {
    if (liveManagers.get(pageNumber) !== manager) return
    liveManagers.delete(pageNumber)
    liveSnapshotPages.delete(pageNumber)
    if (reason) {
      Array.from(disconnectListeners).forEach((listener) => {
        try {
          listener(pageNumber, manager, reason)
        } catch {
          // 한 registry 관측 실패가 다른 소유자의 정리를 막지 않게 격리
        }
      })
    }
  }

  function clearLivePage(pageNumber: number): boolean {
    const manager = liveManagers.get(pageNumber)
    if (!manager) return true

    try {
      manager.clear()
      return !disposed && liveManagers.get(pageNumber) === manager
    } catch (error) {
      reportLiveError(pageNumber, 'clear', error)
      disconnectLivePage(pageNumber, manager, 'clear')
      return false
    }
  }

  function get(pageNumber: number): string | null {
    assertPageNumber(pageNumber)
    if (disposed) return null
    return readLiveSnapshot(pageNumber) ?? stored.get(pageNumber) ?? null
  }

  function getAll(): Map<number, string> {
    if (disposed) return new Map()

    const result = new Map(stored)
    liveSnapshotPages.forEach((pageNumber) => {
      const liveSnapshot = readLiveSnapshot(pageNumber)
      if (liveSnapshot !== null) result.set(pageNumber, liveSnapshot)
    })
    return result
  }

  function serialize(): string {
    return serializeCanvasDataMap(getAll())
  }

  /** 외부에서 주입한 한 페이지 상태를 저장하고 현재 manager에도 동기화 */
  function set(pageNumber: number, pageJson: string): void {
    assertActive()
    assertPageNumber(pageNumber)
    const normalized = normalizeCanvasDataRecord({ [pageNumber]: pageJson })
    const value = normalized[String(pageNumber)]!
    const manager = liveManagers.get(pageNumber)
    const liveSynced = manager ? syncLivePage(pageNumber, value) : false
    if (disposed) return

    stored.set(pageNumber, value)
    suppressedLivePages.delete(pageNumber)
    if (manager && liveSynced) liveSnapshotPages.add(pageNumber)
    else {
      liveSnapshotPages.delete(pageNumber)
      if (manager) disconnectLivePage(pageNumber, manager, 'import')
    }
  }

  /** 현재 등록 manager에서 즉시 읽은 최신 스냅샷만 반영 */
  function commitLiveSnapshot(pageNumber: number, manager: PageCanvasPort): boolean {
    if (disposed) return false
    assertPageNumber(pageNumber)
    if (liveManagers.get(pageNumber) !== manager) return false

    let pageJson: string
    try {
      pageJson = manager.exportJSON()
      if (disposed || liveManagers.get(pageNumber) !== manager) return false
      pageJson = normalizeCanvasDataRecord({ [pageNumber]: pageJson })[String(pageNumber)]!
    } catch (error) {
      reportLiveError(pageNumber, 'export', error)
      disconnectLivePage(pageNumber, manager, 'export')
      return false
    }

    // authoritative clear/replace가 만든 빈 layer 알림은 삭제 상태를 유지
    if (suppressedLivePages.has(pageNumber) && isEmptyPaperSnapshot(pageJson)) return false

    stored.set(pageNumber, pageJson)
    suppressedLivePages.delete(pageNumber)
    liveSnapshotPages.add(pageNumber)
    return true
  }

  /** 문서 상태 완전 교체. 누락 페이지는 렌더 중 manager가 있어도 결과에서 제거 */
  function replace(data: CanvasDataRecord | ReadonlyMap<number, string>): void {
    assertActive()
    const normalized = normalizeInput(data)
    const nextStored = new Map<number, string>(
      Object.entries(normalized).map(([pageNumber, pageJson]) => [Number(pageNumber), pageJson])
    )
    const nextLiveSnapshotPages = new Set<number>()

    const attachedManagers = Array.from(liveManagers.entries())
    const nextSuppressedPages = new Set<number>()
    for (const [pageNumber, manager] of attachedManagers) {
      const pageJson = nextStored.get(pageNumber)
      if (pageJson === undefined) {
        clearLivePage(pageNumber)
        nextSuppressedPages.add(pageNumber)
      } else if (syncLivePage(pageNumber, pageJson)) {
        nextLiveSnapshotPages.add(pageNumber)
      } else {
        disconnectLivePage(pageNumber, manager, 'import')
      }
      if (disposed) return
    }

    // manager.clear/import가 동기 변경 콜백을 발생시켜도 완전 교체 입력을 최종 정본으로 확정
    stored = nextStored
    hasReplacementBaseline = true
    suppressedLivePages.clear()
    nextSuppressedPages.forEach((pageNumber) => suppressedLivePages.add(pageNumber))
    liveSnapshotPages.clear()
    nextLiveSnapshotPages.forEach((pageNumber) => liveSnapshotPages.add(pageNumber))
  }

  /** 한 페이지 상태 제거. manager의 빈 Paper JSON이 삭제 페이지를 되살리지 않게 차단 */
  function clear(pageNumber: number): void {
    assertActive()
    assertPageNumber(pageNumber)
    clearLivePage(pageNumber)
    if (disposed) return
    stored.delete(pageNumber)
    liveSnapshotPages.delete(pageNumber)
    suppressedLivePages.add(pageNumber)
  }

  /** 문서 전체 상태 제거 */
  function clearAll(): void {
    assertActive()
    const attachedPageNumbers = Array.from(liveManagers.keys())
    for (const pageNumber of attachedPageNumbers) {
      clearLivePage(pageNumber)
      if (disposed) return
    }
    stored.clear()
    hasReplacementBaseline = true
    liveSnapshotPages.clear()
    suppressedLivePages.clear()
    attachedPageNumbers.forEach((pageNumber) => suppressedLivePages.add(pageNumber))
  }

  /** 렌더 중 페이지 manager 연결 및 저장 스냅샷 복원 */
  function attachLivePage(pageNumber: number, manager: PageCanvasPort): boolean {
    assertActive()
    assertPageNumber(pageNumber)
    liveManagers.set(pageNumber, manager)

    const saved = stored.get(pageNumber)
    if (saved === undefined) {
      // 초기 live manager는 그 자체가 정본이지만, replace/clearAll 이후 누락 페이지는
      // 새 manager가 생겨도 다시 나타나지 않게 authoritative baseline을 유지
      if (hasReplacementBaseline || suppressedLivePages.has(pageNumber)) {
        liveSnapshotPages.delete(pageNumber)
        suppressedLivePages.add(pageNumber)
      } else {
        liveSnapshotPages.add(pageNumber)
      }
      return true
    }

    if (syncLivePage(pageNumber, saved)) {
      liveSnapshotPages.add(pageNumber)
      return true
    }

    if (disposed) return false

    // 복원 실패 manager가 live-first 조회에서 안정 스냅샷을 가리지 않도록 연결 취소
    disconnectLivePage(pageNumber, manager, 'import')
    return false
  }

  /** 동일 페이지의 오래된 destroy 콜백이 새 manager 연결을 해제하지 않게 조건부 분리 */
  function detachLivePage(pageNumber: number, manager?: PageCanvasPort): void {
    if (disposed) return
    assertPageNumber(pageNumber)
    if (manager && liveManagers.get(pageNumber) !== manager) return
    liveManagers.delete(pageNumber)
    liveSnapshotPages.delete(pageNumber)
  }

  /** manager 동기화 실패를 registry 소유자에게 전달 */
  function subscribeLiveDisconnect(listener: LiveCanvasDisconnectListener): () => void {
    if (disposed) return () => {}
    disconnectListeners.add(listener)
    return () => {
      disconnectListeners.delete(listener)
    }
  }

  /** 저장소 참조 영구 해제. manager 자원 소유권은 registry에 유지 */
  function dispose(): void {
    if (disposed) return
    disposed = true
    stored.clear()
    liveManagers.clear()
    liveSnapshotPages.clear()
    suppressedLivePages.clear()
    disconnectListeners.clear()
    hasReplacementBaseline = false
  }

  return {
    get isDisposed() { return disposed },
    get,
    getAll,
    serialize,
    set,
    replace,
    clear,
    clearAll,
    commitLiveSnapshot,
    attachLivePage,
    detachLivePage,
    subscribeLiveDisconnect,
    dispose
  }
}

export type DocumentCanvasStore = ReturnType<typeof createDocumentCanvasStore>
