import { describe, expect, it, vi } from 'vitest'
import { createDocumentCanvasStore } from '../../src/lib/canvas/documentCanvasStore'
import type { PageCanvasPort } from '../../src/lib/viewer/viewerPorts'

const emptyPage = JSON.stringify(['Layer', { children: [] }])
const page = (label: string) => JSON.stringify(['Layer', {
  children: [['PointText', { content: label }]]
}])

function manager(snapshot = emptyPage): PageCanvasPort {
  return {
    exportJSON: vi.fn(() => snapshot),
    importJSON: vi.fn(() => true),
    clear: vi.fn(),
    dispose: vi.fn()
  }
}

describe('documentCanvasStore failure and lifecycle branches', () => {
  it('isolates export observer/listener failures and disconnects the broken manager', () => {
    const onLiveError = vi.fn(() => { throw new Error('observer failed') })
    const store = createDocumentCanvasStore({ onLiveError })
    const broken = manager(page('broken'))
    vi.mocked(broken.exportJSON).mockImplementation(() => { throw new Error('export failed') })
    const firstListener = vi.fn(() => { throw new Error('listener failed') })
    const secondListener = vi.fn()
    store.subscribeLiveDisconnect(firstListener)
    const unsubscribe = store.subscribeLiveDisconnect(secondListener)
    store.attachLivePage(1, broken)

    expect(store.get(1)).toBeNull()
    expect(onLiveError).toHaveBeenCalledWith(1, 'export', expect.any(Error))
    expect(firstListener).toHaveBeenCalledWith(1, broken, 'export')
    expect(secondListener).toHaveBeenCalledWith(1, broken, 'export')

    unsubscribe()
    expect(store.commitLiveSnapshot(1, broken)).toBe(false)
  })

  it('disconnects a manager whose import throws while retaining the validated fallback', () => {
    const onLiveError = vi.fn()
    const disconnected = vi.fn()
    const store = createDocumentCanvasStore({ onLiveError })
    const broken = manager()
    vi.mocked(broken.importJSON).mockImplementation(() => { throw new Error('import failed') })
    store.subscribeLiveDisconnect(disconnected)
    store.attachLivePage(1, broken)

    store.set(1, page('stored'))

    expect(onLiveError).toHaveBeenCalledWith(1, 'import', expect.any(Error))
    expect(disconnected).toHaveBeenCalledWith(1, broken, 'import')
    expect(store.get(1)).toBe(page('stored'))
  })

  it('disconnects a manager whose clear throws and clearAll keeps an authoritative empty baseline', () => {
    const onLiveError = vi.fn()
    const store = createDocumentCanvasStore({ onLiveError })
    const broken = manager(page('one'))
    vi.mocked(broken.clear).mockImplementation(() => { throw new Error('clear failed') })
    const healthy = manager(page('two'))
    store.attachLivePage(1, broken)
    store.attachLivePage(2, healthy)

    store.clearAll()

    expect(onLiveError).toHaveBeenCalledWith(1, 'clear', expect.any(Error))
    expect(healthy.clear).toHaveBeenCalledTimes(1)
    expect(store.getAll().size).toBe(0)

    const remounted = manager(page('late'))
    store.attachLivePage(3, remounted)
    expect(store.get(3)).toBeNull()
  })

  it('does not let reentrant dispose from import or clear commit partial state', () => {
    const importStore = createDocumentCanvasStore()
    const importing = manager()
    vi.mocked(importing.importJSON).mockImplementation(() => {
      importStore.dispose()
      return true
    })
    importStore.attachLivePage(1, importing)
    importStore.set(1, page('ignored'))
    expect(importStore.isDisposed).toBe(true)
    expect(importStore.getAll().size).toBe(0)

    const clearStore = createDocumentCanvasStore()
    const clearing = manager(page('one'))
    vi.mocked(clearing.clear).mockImplementation(() => clearStore.dispose())
    clearStore.attachLivePage(1, clearing)
    clearStore.clear(1)
    expect(clearStore.isDisposed).toBe(true)
  })

  it('ignores stale detach handles and offers a no-op subscription after dispose', () => {
    const store = createDocumentCanvasStore()
    const current = manager(page('current'))
    const stale = manager(page('stale'))
    store.attachLivePage(1, current)

    store.detachLivePage(1, stale)
    expect(store.get(1)).toBe(page('current'))

    store.detachLivePage(1)
    expect(store.get(1)).toBeNull()
    store.dispose()
    const unsubscribe = store.subscribeLiveDisconnect(vi.fn())
    expect(unsubscribe()).toBeUndefined()
    store.detachLivePage(1, current)
    expect(store.commitLiveSnapshot(1, current)).toBe(false)
  })
})
