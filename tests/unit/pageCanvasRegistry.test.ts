import { describe, expect, it, vi } from 'vitest'
import { createDocumentCanvasStore } from '../../src/lib/canvas/documentCanvasStore'
import { createPageCanvasRegistry } from '../../src/lib/canvas/pageCanvasRegistry'
import type {
  DocumentCanvasStorePort,
  PageCanvasPort
} from '../../src/lib/viewer/viewerPorts'

const page = (label: string) => JSON.stringify(['Layer', {
  children: [['PointText', { content: label }]]
}])

function createManager(initial: string, log?: string[]): PageCanvasPort {
  let snapshot = initial
  return {
    exportJSON: vi.fn(() => {
      log?.push('export')
      return snapshot
    }),
    importJSON: vi.fn((json: string) => {
      snapshot = json
      return true
    }),
    clear: vi.fn(),
    dispose: vi.fn(() => {
      log?.push('dispose')
    })
  }
}

function createLoggingStore(log: string[]): DocumentCanvasStorePort {
  return {
    isDisposed: false,
    get: vi.fn(() => null),
    getAll: vi.fn(() => new Map()),
    serialize: vi.fn(() => '{}'),
    set: vi.fn(),
    replace: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn(),
    commitLiveSnapshot: vi.fn((_pageNumber, manager) => {
      manager.exportJSON()
      log.push('snapshot')
      return true
    }),
    attachLivePage: vi.fn(() => {
      log.push('attach')
      return true
    }),
    detachLivePage: vi.fn(() => log.push('detach')),
    subscribeLiveDisconnect: vi.fn(() => () => {}),
    dispose: vi.fn()
  }
}

describe('pageCanvasRegistry — Paper manager 생명주기', () => {
  it('unregister 시 export→store snapshot→detach→dispose 순서를 보장', () => {
    const log: string[] = []
    const store = createLoggingStore(log)
    const manager = createManager(page('latest'), log)
    const registry = createPageCanvasRegistry({ store })
    registry.register(1, manager)
    log.length = 0

    registry.unregister(1, manager)

    expect(log).toEqual(['export', 'snapshot', 'detach', 'dispose'])
  })

  it('unregister 뒤 live 최신 스냅샷이 문서 저장소에 남음', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager(page('latest'))
    const registry = createPageCanvasRegistry({ store })
    const cleanup = registry.register(1, manager)

    cleanup()

    expect(store.get(1)).toBe(page('latest'))
    expect(manager.dispose).toHaveBeenCalledTimes(1)
  })

  it('manager.dispose가 실행되는 시점에는 registry에서 이미 제거', () => {
    const store = createDocumentCanvasStore()
    const registry = createPageCanvasRegistry({ store })
    const manager = createManager(page('latest'))
    vi.mocked(manager.dispose).mockImplementation(() => {
      expect(registry.get(1)).toBeNull()
    })
    registry.register(1, manager)

    registry.unregister(1)

    expect(manager.dispose).toHaveBeenCalledTimes(1)
  })

  it('같은 페이지 manager 교체 후 오래된 cleanup은 새 manager를 해제하지 않음', () => {
    const store = createDocumentCanvasStore()
    const oldManager = createManager(page('old'))
    const newManager = createManager(page('new'))
    const registry = createPageCanvasRegistry({ store })
    const cleanupOld = registry.register(1, oldManager)
    const cleanupNew = registry.register(1, newManager)

    cleanupOld()

    expect(registry.get(1)).toBe(newManager)
    expect(oldManager.dispose).toHaveBeenCalledTimes(1)
    expect(newManager.dispose).not.toHaveBeenCalled()

    cleanupNew()
    cleanupNew()
    expect(newManager.dispose).toHaveBeenCalledTimes(1)
  })

  it('저장 스냅샷 import 실패 후보는 등록하지 않고 안정 상태를 보존', () => {
    const store = createDocumentCanvasStore()
    store.replace({ '1': page('stable') })
    const failed = createManager(page('candidate'))
    vi.mocked(failed.importJSON).mockReturnValue(false)
    const registry = createPageCanvasRegistry({ store })

    expect(() => registry.register(1, failed)).toThrow(
      'Failed to restore canvas data for page 1'
    )
    expect(registry.get(1)).toBeNull()
    expect(failed.dispose).toHaveBeenCalledTimes(1)
    expect(store.get(1)).toBe(page('stable'))
  })

  it('manager import가 store.dispose로 재진입해도 후보를 registry에 남기지 않음', () => {
    const store = createDocumentCanvasStore()
    store.replace({ '1': page('stable') })
    const manager = createManager(page('candidate'))
    vi.mocked(manager.importJSON).mockImplementation(() => {
      store.dispose()
      return true
    })
    const registry = createPageCanvasRegistry({ store })

    expect(() => registry.register(1, manager)).toThrow(
      'Failed to restore canvas data for page 1'
    )
    expect(store.isDisposed).toBe(true)
    expect(registry.size).toBe(0)
    expect(manager.dispose).toHaveBeenCalledTimes(1)
  })

  it('활성 manager의 set import 실패 시 registry가 stale manager를 즉시 폐기', () => {
    const store = createDocumentCanvasStore()
    const registry = createPageCanvasRegistry({ store })
    const manager = createManager(page('stale'))
    registry.register(1, manager)
    vi.mocked(manager.importJSON).mockReturnValue(false)

    store.set(1, page('requested'))

    expect(registry.get(1)).toBeNull()
    expect(manager.dispose).toHaveBeenCalledTimes(1)
    expect(store.get(1)).toBe(page('requested'))
  })

  it('활성 manager clear 실패 시 registry가 화면 자원을 즉시 폐기하고 삭제 상태 유지', () => {
    const store = createDocumentCanvasStore()
    const registry = createPageCanvasRegistry({ store })
    const manager = createManager(page('stale'))
    registry.register(1, manager)
    vi.mocked(manager.clear).mockImplementation(() => {
      throw new Error('clear failed')
    })

    store.clear(1)

    expect(registry.get(1)).toBeNull()
    expect(manager.dispose).toHaveBeenCalledTimes(1)
    expect(store.get(1)).toBeNull()
  })

  it('dispose는 모든 manager를 한 번씩 정리하고 이후 등록 자원도 즉시 해제', () => {
    const store = createDocumentCanvasStore()
    const first = createManager(page('one'))
    const second = createManager(page('two'))
    const late = createManager(page('late'))
    const registry = createPageCanvasRegistry({ store })
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

  it('기존 manager dispose가 registry.dispose로 재진입해도 새 후보를 등록하지 않음', () => {
    const store = createDocumentCanvasStore()
    const registry = createPageCanvasRegistry({ store })
    const oldManager = createManager(page('old'))
    const newManager = createManager(page('new'))
    vi.mocked(oldManager.dispose).mockImplementation(() => registry.dispose())
    registry.register(1, oldManager)

    const cleanup = registry.register(1, newManager)
    cleanup()

    expect(registry.isDisposed).toBe(true)
    expect(registry.size).toBe(0)
    expect(oldManager.dispose).toHaveBeenCalledTimes(1)
    expect(newManager.dispose).toHaveBeenCalledTimes(1)
  })

  it('snapshot 중 unregister 재진입도 같은 manager를 한 번만 dispose', () => {
    const store = createDocumentCanvasStore()
    const registry = createPageCanvasRegistry({ store })
    const manager = createManager(page('latest'))
    vi.mocked(manager.exportJSON).mockImplementation(() => {
      registry.unregister(1, manager)
      return page('latest')
    })
    registry.register(1, manager)

    registry.unregister(1, manager)

    expect(registry.size).toBe(0)
    expect(manager.dispose).toHaveBeenCalledTimes(1)
  })

  it('기존 manager snapshot 중 재진입 후보를 즉시 해제하고 바깥 등록을 일관되게 완료', () => {
    const store = createDocumentCanvasStore()
    const registry = createPageCanvasRegistry({ store })
    const oldManager = createManager(page('old'))
    const reentrantManager = createManager(page('reentrant'))
    const outerCandidate = createManager(page('outer'))
    vi.mocked(oldManager.exportJSON).mockImplementation(() => {
      registry.register(1, reentrantManager)
      return page('old')
    })
    registry.register(1, oldManager)

    registry.register(1, outerCandidate)

    expect(registry.get(1)).toBe(outerCandidate)
    expect(reentrantManager.dispose).toHaveBeenCalledTimes(1)
    registry.dispose()
    expect(outerCandidate.dispose).toHaveBeenCalledTimes(1)
  })

  it('서로 다른 factory 인스턴스의 page registry가 독립', () => {
    const first = createPageCanvasRegistry({ store: createDocumentCanvasStore() })
    const second = createPageCanvasRegistry({ store: createDocumentCanvasStore() })
    const manager = createManager(page('first'))
    first.register(1, manager)

    expect(first.size).toBe(1)
    expect(second.size).toBe(0)

    first.dispose()
    second.dispose()
  })
})
