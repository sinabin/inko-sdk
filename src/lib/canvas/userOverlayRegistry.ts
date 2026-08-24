import type { UserOverlayPort } from '../viewer/viewerPorts'

export interface UserOverlayRegistryOptions {
  onDisposeError?: (pageNumber: number, error: unknown) => void
}

function assertPageNumber(pageNumber: number): void {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new TypeError('pageNumber must be a positive integer')
  }
}

/** 페이지별 사용자 overlay 인스턴스의 교체·해제 소유권 관리 */
export function createUserOverlayRegistry<TOverlay extends UserOverlayPort = UserOverlayPort>(
  options: UserOverlayRegistryOptions = {}
) {
  const { onDisposeError } = options
  const overlays = new Map<number, TOverlay>()
  let disposed = false

  function safeDispose(pageNumber: number, overlay: TOverlay): void {
    try {
      overlay.dispose()
    } catch (error) {
      try {
        onDisposeError?.(pageNumber, error)
      } catch {
        // 관측 콜백 실패가 나머지 overlay 해제를 중단하지 않게 격리
      }
    }
  }

  /** overlay 등록. 오래된 cleanup은 같은 페이지의 새 overlay를 제거하지 않음 */
  function register(pageNumber: number, overlay: TOverlay): () => void {
    assertPageNumber(pageNumber)
    if (disposed) {
      safeDispose(pageNumber, overlay)
      return () => {}
    }

    const existing = overlays.get(pageNumber)
    if (existing && existing !== overlay) {
      overlays.delete(pageNumber)
      safeDispose(pageNumber, existing)
    }
    if (disposed) {
      safeDispose(pageNumber, overlay)
      return () => {}
    }
    const reentrantOverlay = overlays.get(pageNumber)
    if (reentrantOverlay && reentrantOverlay !== overlay) {
      safeDispose(pageNumber, overlay)
      return () => {}
    }
    overlays.set(pageNumber, overlay)

    return () => {
      unregister(pageNumber, overlay)
    }
  }

  /** 페이지 overlay 조건부 해제. 같은 cleanup 반복 호출은 무해 */
  function unregister(pageNumber: number, overlay?: TOverlay): boolean {
    assertPageNumber(pageNumber)
    const current = overlays.get(pageNumber)
    if (!current || (overlay && current !== overlay)) return false
    overlays.delete(pageNumber)
    safeDispose(pageNumber, current)
    return true
  }

  function get(pageNumber: number): TOverlay | null {
    assertPageNumber(pageNumber)
    return overlays.get(pageNumber) ?? null
  }

  function getAll(): Map<number, TOverlay> {
    return new Map(overlays)
  }

  /** 모든 overlay를 한 번씩 영구 해제 */
  function dispose(): void {
    if (disposed) return
    disposed = true
    Array.from(overlays.entries()).forEach(([pageNumber, overlay]) => {
      if (overlays.get(pageNumber) !== overlay) return
      overlays.delete(pageNumber)
      safeDispose(pageNumber, overlay)
    })
  }

  return {
    get size() { return overlays.size },
    get isDisposed() { return disposed },
    register,
    unregister,
    get,
    getAll,
    dispose
  }
}

export type UserOverlayRegistry = ReturnType<typeof createUserOverlayRegistry>
