import type {
  DocumentCanvasStorePort,
  PageCanvasPort
} from '../viewer/viewerPorts'

export type PageCanvasLifecycleOperation = 'snapshot' | 'detach' | 'dispose'

export interface PageCanvasRegistryOptions {
  store: DocumentCanvasStorePort
  onLifecycleError?: (
    pageNumber: number,
    operation: PageCanvasLifecycleOperation,
    error: unknown
  ) => void
}

function assertPageNumber(pageNumber: number): void {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new TypeError('pageNumber must be a positive integer')
  }
}

/** 페이지별 Paper manager의 등록·스냅샷·해제를 단일 소유자로 관리 */
export function createPageCanvasRegistry(options: PageCanvasRegistryOptions) {
  const { store, onLifecycleError } = options
  const managers = new Map<number, PageCanvasPort>()
  const releasingManagers = new Set<PageCanvasPort>()
  let disposed = false
  const unsubscribeLiveDisconnect = store.isDisposed
    ? () => {}
    : store.subscribeLiveDisconnect((pageNumber, manager) => {
      discard(pageNumber, manager)
    })

  function report(
    pageNumber: number,
    operation: PageCanvasLifecycleOperation,
    error: unknown
  ): void {
    try {
      onLifecycleError?.(pageNumber, operation, error)
    } catch {
      // 관측 콜백 실패가 manager 해제 경로를 중단하지 않게 격리
    }
  }

  function safeDispose(pageNumber: number, manager: PageCanvasPort): void {
    try {
      manager.dispose()
    } catch (error) {
      report(pageNumber, 'dispose', error)
    }
  }

  function safeDetach(pageNumber: number, manager: PageCanvasPort): void {
    if (store.isDisposed) return
    try {
      store.detachLivePage(pageNumber, manager)
    } catch (error) {
      report(pageNumber, 'detach', error)
    }
  }

  /** 저장소가 동기화 실패로 권위를 끊은 manager를 stale snapshot 없이 폐기 */
  function discard(pageNumber: number, manager: PageCanvasPort): void {
    if (managers.get(pageNumber) !== manager || releasingManagers.has(manager)) return
    managers.delete(pageNumber)
    safeDetach(pageNumber, manager)
    safeDispose(pageNumber, manager)
  }

  function release(pageNumber: number, manager: PageCanvasPort): void {
    if (managers.get(pageNumber) !== manager || releasingManagers.has(manager)) return
    releasingManagers.add(manager)

    // PaperScope 해제 전에 최신 1.0x JSON을 반드시 문서 정본에 보존
    if (!store.isDisposed) {
      try {
        store.commitLiveSnapshot(pageNumber, manager)
      } catch (error) {
        report(pageNumber, 'snapshot', error)
      }
    }

    // snapshot 후 registry에서는 먼저 제거하여 dispose 재진입이 같은 manager를 재해제하지 않게 함
    if (managers.get(pageNumber) === manager) managers.delete(pageNumber)

    safeDetach(pageNumber, manager)

    safeDispose(pageNumber, manager)
    releasingManagers.delete(manager)
  }

  /** manager 등록. 반환 cleanup은 교체 후 호출되어도 새 manager에 영향을 주지 않음 */
  function register(pageNumber: number, manager: PageCanvasPort): () => void {
    assertPageNumber(pageNumber)
    if (disposed) {
      safeDispose(pageNumber, manager)
      return () => {}
    }

    const existing = managers.get(pageNumber)
    if (existing && existing !== manager) release(pageNumber, existing)
    if (disposed) {
      safeDispose(pageNumber, manager)
      return () => {}
    }
    const reentrantManager = managers.get(pageNumber)
    if (reentrantManager && reentrantManager !== manager) {
      safeDispose(pageNumber, manager)
      return () => {}
    }
    if (managers.get(pageNumber) !== manager) {
      try {
        if (!store.attachLivePage(pageNumber, manager)) {
          throw new Error(`Failed to restore canvas data for page ${pageNumber}`)
        }
        if (disposed) {
          safeDetach(pageNumber, manager)
          safeDispose(pageNumber, manager)
          return () => {}
        }
        // 저장 스냅샷 복원 성공 후에만 live registry에 승격
        managers.set(pageNumber, manager)
      } catch (error) {
        safeDetach(pageNumber, manager)
        safeDispose(pageNumber, manager)
        throw error
      }
    }

    return () => {
      unregister(pageNumber, manager)
    }
  }

  /** 페이지 manager 조건부 해제. 같은 cleanup 반복 호출은 무해 */
  function unregister(pageNumber: number, manager?: PageCanvasPort): boolean {
    assertPageNumber(pageNumber)
    const current = managers.get(pageNumber)
    if (!current || (manager && current !== manager)) return false
    release(pageNumber, current)
    return true
  }

  function get(pageNumber: number): PageCanvasPort | null {
    assertPageNumber(pageNumber)
    return managers.get(pageNumber) ?? null
  }

  function getAll(): Map<number, PageCanvasPort> {
    return new Map(managers)
  }

  /** 모든 manager를 snapshot-before-dispose 순서로 한 번씩 해제 */
  function dispose(): void {
    if (disposed) return
    disposed = true
    unsubscribeLiveDisconnect()
    Array.from(managers.entries()).forEach(([pageNumber, manager]) => {
      release(pageNumber, manager)
    })
  }

  return {
    get size() { return managers.size },
    get isDisposed() { return disposed },
    register,
    unregister,
    get,
    getAll,
    dispose
  }
}

export type PageCanvasRegistry = ReturnType<typeof createPageCanvasRegistry>
