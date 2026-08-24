import { describe, expect, it, vi } from 'vitest'
import { createDocumentCanvasStore } from '../../src/lib/canvas/documentCanvasStore'
import type { PageCanvasPort } from '../../src/lib/viewer/viewerPorts'

const emptyPage = JSON.stringify(['Layer', { children: [] }])
const page = (label: string) => JSON.stringify(['Layer', {
  children: [['PointText', { content: label }]]
}])

function createManager(initial = emptyPage, importResult = true) {
  let snapshot = initial
  const manager: PageCanvasPort & { setSnapshot(value: string): void } = {
    exportJSON: vi.fn(() => snapshot),
    importJSON: vi.fn((json: string) => {
      if (importResult) snapshot = json
      return importResult
    }),
    clear: vi.fn(() => {
      snapshot = emptyPage
    }),
    dispose: vi.fn(),
    setSnapshot(value: string) {
      snapshot = value
    }
  }
  return manager
}

describe('documentCanvasStore — 문서 편집 상태 단일 정본', () => {
  it('초기 저장본이 없어도 등록된 live manager 스냅샷을 조회 정본으로 사용', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager(page('live-only'))

    store.attachLivePage(1, manager)

    expect(store.get(1)).toBe(page('live-only'))
    expect(store.getAll()).toEqual(new Map([[1, page('live-only')]]))
  })

  it('렌더 중 manager 스냅샷을 저장 복사본보다 우선', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager()
    store.replace({ '1': page('stored') })
    store.attachLivePage(1, manager)

    manager.setSnapshot(page('live'))

    expect(store.get(1)).toBe(page('live'))
    expect(store.getAll()).toEqual(new Map([[1, page('live')]]))
  })

  it('replace는 기존 페이지와 활성 manager의 빈 잔재를 결과에서 완전히 제거', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager()
    store.replace({ '1': page('v1'), '2': page('stale') })
    store.attachLivePage(2, manager)
    manager.setSnapshot(page('live-stale'))

    store.replace({ '1': page('v2') })

    expect(manager.clear).toHaveBeenCalledTimes(1)
    expect(store.get(2)).toBeNull()
    expect(store.getAll()).toEqual(new Map([[1, page('v2')]]))
    expect(JSON.parse(store.serialize())).toEqual({ '1': page('v2') })

    store.detachLivePage(2, manager)
    const remountedManager = createManager(emptyPage)
    store.attachLivePage(2, remountedManager)
    expect(store.get(2)).toBeNull()
  })

  it('clear 뒤 manager의 빈 JSON을 제외하고 새 live 변경이 오면 다시 포함', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager()
    store.replace({ '1': page('before') })
    store.attachLivePage(1, manager)

    store.clear(1)

    expect(store.get(1)).toBeNull()
    expect(store.getAll().size).toBe(0)

    store.detachLivePage(1, manager)
    const remountedManager = createManager(emptyPage)
    store.attachLivePage(1, remountedManager)
    expect(store.get(1)).toBeNull()

    remountedManager.setSnapshot(page('after'))
    store.commitLiveSnapshot(1, remountedManager)
    expect(store.get(1)).toBe(page('after'))
  })

  it('replace/clear 뒤 늦은 빈 manager 알림이 삭제 페이지를 되살리지 않음', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager(page('before'))
    store.attachLivePage(1, manager)

    store.replace({})

    expect(store.commitLiveSnapshot(1, manager)).toBe(false)
    expect(store.getAll().size).toBe(0)
  })

  it('live import 실패 manager의 후속 snapshot이 요청 상태를 덮지 못함', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager(page('stale'), false)
    store.attachLivePage(1, manager)

    store.set(1, page('requested'))

    expect(store.commitLiveSnapshot(1, manager)).toBe(false)
    expect(store.get(1)).toBe(page('requested'))
  })

  it('live import가 실패하면 요청한 저장 스냅샷을 안전한 fallback으로 반환', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager(page('unrelated-live'), false)
    store.replace({ '1': page('requested') })
    store.attachLivePage(1, manager)

    expect(store.get(1)).toBe(page('requested'))
    expect(store.getAll()).toEqual(new Map([[1, page('requested')]]))
  })

  it('replace 중 live import 실패를 호출자에게 전파하고 요청 스냅샷은 보존', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager(page('before'), false)
    store.attachLivePage(1, manager)

    expect(() => store.replace({ '1': page('requested') }))
      .toThrow('Failed to restore canvas data for pages: 1')
    expect(store.get(1)).toBe(page('requested'))
  })

  it('Phase 1 codec으로 Map 입력과 페이지 키·Paper JSON 유효성을 동일하게 검증', () => {
    const store = createDocumentCanvasStore()
    store.replace(new Map([[2, page('two')]]))
    expect(store.getAll()).toEqual(new Map([[2, page('two')]]))

    expect(() => store.replace({ '0': page('bad-page') })).toThrow(TypeError)
    expect(() => store.replace({ '1': '{broken' })).toThrow(TypeError)
    expect(() => store.set(1, { children: [] } as unknown as string)).toThrow(TypeError)
  })

  it('getAll 반환 Map과 factory 인스턴스는 서로 독립', () => {
    const first = createDocumentCanvasStore()
    const second = createDocumentCanvasStore()
    first.replace({ '1': page('first') })

    const copy = first.getAll()
    copy.set(2, page('outside'))

    expect(first.get(2)).toBeNull()
    expect(second.getAll().size).toBe(0)
  })

  it('dispose는 반복 호출해도 안전하고 registry 소유 manager를 대신 dispose하지 않음', () => {
    const store = createDocumentCanvasStore()
    const manager = createManager()
    store.attachLivePage(1, manager)

    store.dispose()
    store.dispose()

    expect(store.isDisposed).toBe(true)
    expect(store.getAll().size).toBe(0)
    expect(manager.dispose).not.toHaveBeenCalled()
    expect(() => store.set(1, page('late'))).toThrow('DocumentCanvasStore has been disposed')
  })
})
