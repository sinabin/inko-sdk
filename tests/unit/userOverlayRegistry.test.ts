import { describe, expect, it, vi } from 'vitest'
import { createUserOverlayRegistry } from '../../src/lib/canvas/userOverlayRegistry'
import type { UserOverlayPort } from '../../src/lib/viewer/viewerPorts'

function createOverlay(): UserOverlayPort {
  return { dispose: vi.fn() }
}

describe('userOverlayRegistry — overlay 생명주기', () => {
  it('같은 페이지 overlay 교체 시 기존 인스턴스만 즉시 dispose', () => {
    const registry = createUserOverlayRegistry()
    const oldOverlay = createOverlay()
    const newOverlay = createOverlay()
    const cleanupOld = registry.register(1, oldOverlay)
    const cleanupNew = registry.register(1, newOverlay)

    expect(oldOverlay.dispose).toHaveBeenCalledTimes(1)
    expect(registry.get(1)).toBe(newOverlay)

    cleanupOld()
    expect(newOverlay.dispose).not.toHaveBeenCalled()

    cleanupNew()
    cleanupNew()
    expect(newOverlay.dispose).toHaveBeenCalledTimes(1)
  })

  it('unregister는 대상 불일치·반복 호출에 멱등', () => {
    const registry = createUserOverlayRegistry()
    const overlay = createOverlay()
    const other = createOverlay()
    registry.register(1, overlay)

    expect(registry.unregister(1, other)).toBe(false)
    expect(registry.unregister(1, overlay)).toBe(true)
    expect(registry.unregister(1, overlay)).toBe(false)
    expect(overlay.dispose).toHaveBeenCalledTimes(1)
    expect(other.dispose).not.toHaveBeenCalled()
  })

  it('dispose는 모든 overlay를 한 번씩 정리하고 이후 등록 자원도 즉시 해제', () => {
    const registry = createUserOverlayRegistry()
    const first = createOverlay()
    const second = createOverlay()
    const late = createOverlay()
    registry.register(1, first)
    registry.register(2, second)

    registry.dispose()
    registry.dispose()
    registry.register(3, late)

    expect(registry.isDisposed).toBe(true)
    expect(registry.size).toBe(0)
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).toHaveBeenCalledTimes(1)
    expect(late.dispose).toHaveBeenCalledTimes(1)
  })

  it('기존 overlay dispose가 registry.dispose로 재진입해도 새 후보를 등록하지 않음', () => {
    const registry = createUserOverlayRegistry()
    const oldOverlay = createOverlay()
    const newOverlay = createOverlay()
    vi.mocked(oldOverlay.dispose).mockImplementation(() => registry.dispose())
    registry.register(1, oldOverlay)

    registry.register(1, newOverlay)

    expect(registry.isDisposed).toBe(true)
    expect(registry.size).toBe(0)
    expect(oldOverlay.dispose).toHaveBeenCalledTimes(1)
    expect(newOverlay.dispose).toHaveBeenCalledTimes(1)
  })

  it('기존 overlay dispose 중 재진입 등록이 생겨도 바깥 후보가 이를 덮어 누수하지 않음', () => {
    const registry = createUserOverlayRegistry()
    const oldOverlay = createOverlay()
    const reentrantOverlay = createOverlay()
    const outerCandidate = createOverlay()
    vi.mocked(oldOverlay.dispose).mockImplementation(() => {
      registry.register(1, reentrantOverlay)
    })
    registry.register(1, oldOverlay)

    registry.register(1, outerCandidate)

    expect(registry.get(1)).toBe(reentrantOverlay)
    expect(outerCandidate.dispose).toHaveBeenCalledTimes(1)
    registry.dispose()
    expect(reentrantOverlay.dispose).toHaveBeenCalledTimes(1)
  })

  it('dispose snapshot 순회 중 앞 overlay가 뒤 overlay를 해제해도 중복 dispose하지 않음', () => {
    const registry = createUserOverlayRegistry()
    const first = createOverlay()
    const second = createOverlay()
    vi.mocked(first.dispose).mockImplementation(() => {
      registry.unregister(2, second)
    })
    registry.register(1, first)
    registry.register(2, second)

    registry.dispose()

    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })

  it('서로 다른 factory registry가 상태와 dispose를 공유하지 않음', () => {
    const first = createUserOverlayRegistry()
    const second = createUserOverlayRegistry()
    const overlay = createOverlay()
    first.register(1, overlay)

    first.dispose()

    expect(second.isDisposed).toBe(false)
    expect(second.size).toBe(0)
    second.dispose()
  })
})
