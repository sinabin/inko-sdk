import { describe, expect, it, vi } from 'vitest'
import type { UserCanvasInfo } from '../../src/types'
import type {
  PageCanvasManager,
  PageCanvasManagerOptions
} from '../../src/lib/canvas/pageCanvasManager.svelte'
import type { UserOverlay } from '../../src/lib/canvas/userOverlay.svelte'
import type { PdfSearchState } from '../../src/lib/pdf/pdfSearch.svelte'
import {
  applyPageSearchHighlights,
  clearPageSearchHighlights,
  createPageLayerCoordinator,
  type PageLayerCoordinatorOptions
} from '../../src/lib/viewer/pageLayerCoordinator.svelte'

const page = (label: string) => JSON.stringify(['Layer', {
  children: [['PointText', { content: label }]]
}])

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createOptions(
  overrides: Partial<PageLayerCoordinatorOptions> = {}
): PageLayerCoordinatorOptions {
  const dimensions = new Map([[1, { width: 612, height: 792 }]])
  return {
    getIsReadOnly: () => true,
    getViewportScale: () => 1,
    getCurrentTool: () => 'select',
    getBrushSettings: () => ({
      color: '#000000',
      width: 2,
      pressureSensitivity: 50,
      fontSize: 16
    }),
    getPageDimensions: (pageNumber) => dimensions.get(pageNumber) ?? null,
    setPageDimensions: (pageNumber, value) => {
      dimensions.set(pageNumber, value)
    },
    getScrollContainer: () => null,
    getHistoryManager: () => null,
    getReviewEntries: () => [],
    getCurrentEditCanvasId: () => '',
    afterDomUpdate: async () => {},
    ...overrides
  }
}

function sourceCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 612
  canvas.height = 792
  return canvas
}

function presentationCanvas(drawImage = vi.fn()): {
  canvas: HTMLCanvasElement
  drawImage: ReturnType<typeof vi.fn>
} {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'getContext', {
    value: vi.fn(() => ({ drawImage }))
  })
  return { canvas, drawImage }
}

function createManagerHarness(initialSnapshot: string) {
  let snapshot = initialSnapshot
  let managerOptions: PageCanvasManagerOptions | null = null
  const manager = {
    init: vi.fn(),
    dispose: vi.fn(),
    setZoom: vi.fn(),
    setBaseDimensions: vi.fn(),
    clear: vi.fn(),
    exportJSON: vi.fn(() => snapshot),
    importJSON: vi.fn((json: string) => {
      snapshot = json
      return true
    }),
    setDrawingMode: vi.fn(),
    setBrushColor: vi.fn(),
    setBrushWidth: vi.fn(),
    setBrushPressureSensitivity: vi.fn(),
    setFontSize: vi.fn(),
    addText: vi.fn(),
    confirmText: vi.fn(),
    cancelText: vi.fn(),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
    get canUndo() { return false },
    get canRedo() { return false },
    deleteSelected: vi.fn(),
    get hasSelection() { return false },
    get accessibilityState() {
      return {
        pageNumber: 1,
        annotationCount: 0,
        selectedIndex: null,
        selectedKind: null,
        selectedText: null,
        selectedX: null,
        selectedY: null
      } as const
    },
    get paperCanvas() { return null },
    get isReady() { return true }
  } satisfies PageCanvasManager

  return {
    manager,
    factory(options: PageCanvasManagerOptions): PageCanvasManager {
      managerOptions = options
      return manager
    },
    setSnapshot(value: string): void {
      snapshot = value
    },
    notifyCanvasChange(): void {
      managerOptions?.onCanvasChange?.()
    },
    notifyAccessibilityChange(): void {
      managerOptions?.onAccessibilityChange?.(manager.accessibilityState)
    }
  }
}

describe('pageLayerCoordinator — 검색 DOM', () => {
  it('현재 검색 결과만 selected로 표시하고 clear 시 원문 DOM을 복원', () => {
    const layer = document.createElement('div')
    layer.textContent = 'test test'
    const state: PdfSearchState = {
      status: 'ready',
      query: 'test',
      caseSensitive: false,
      matches: [
        { pageNumber: 1, offset: 0, length: 4 },
        { pageNumber: 1, offset: 5, length: 4 }
      ],
      currentIndex: 1,
      currentMatch: { pageNumber: 1, offset: 5, length: 4 },
      totalMatches: 2,
      wrapped: false,
      indexedPages: 1,
      failedPages: []
    }

    applyPageSearchHighlights(layer, 1, state)

    const highlights = layer.querySelectorAll('[data-inko-search-highlight]')
    expect(highlights).toHaveLength(2)
    expect(layer.querySelectorAll('.highlight.selected')).toHaveLength(1)
    expect(layer.querySelector('.highlight.selected')?.textContent).toBe('test')

    clearPageSearchHighlights(layer)
    expect(layer.textContent).toBe('test test')
    expect(layer.querySelector('[data-inko-search-highlight]')).toBeNull()
  })

  it('가상화된 TextLayer 완료를 기다린 뒤 선택 결과의 실제 좌표로 스크롤한다', async () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(container, 'scrollTop', { configurable: true, value: 100, writable: true })
    container.getBoundingClientRect = () => ({
      x: 0, y: 50, left: 0, top: 50, right: 800, bottom: 650,
      width: 800, height: 600, toJSON: () => ({})
    })
    const scrollTo = vi.fn()
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo })
    const coordinator = createPageLayerCoordinator(createOptions({
      getScrollContainer: () => container
    }))
    const match = { pageNumber: 8, offset: 7, length: 4 }
    const state: PdfSearchState = {
      status: 'ready', query: 'test', caseSensitive: false,
      matches: [match], currentIndex: 0, currentMatch: match,
      totalMatches: 1, wrapped: false, indexedPages: 12, failedPages: []
    }
    coordinator.setSearchState(state)

    const pending = coordinator.scrollToSearchMatch(match)
    const layer = document.createElement('div')
    layer.textContent = 'before test after'
    coordinator.handleDomLayersReady({ pageNumber: 8, textLayer: layer })
    const selected = layer.querySelector<HTMLElement>('.highlight.selected')!
    selected.getBoundingClientRect = () => ({
      x: 100, y: 500, left: 100, top: 500, right: 140, bottom: 520,
      width: 40, height: 20, toJSON: () => ({})
    })

    await expect(pending).resolves.toBe(true)
    expect(scrollTo).toHaveBeenCalledWith({
      top: expect.closeTo(356.67, 1),
      behavior: 'auto'
    })
    coordinator.dispose()
  })

  it('대기 중 선택 결과가 바뀌면 오래된 결과 좌표로 스크롤하지 않는다', async () => {
    const container = document.createElement('div')
    const scrollTo = vi.fn()
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo })
    const coordinator = createPageLayerCoordinator(createOptions({
      getScrollContainer: () => container
    }))
    const first = { pageNumber: 2, offset: 0, length: 4 }
    const second = { pageNumber: 3, offset: 0, length: 4 }
    coordinator.setSearchState({
      status: 'ready', query: 'test', caseSensitive: false,
      matches: [first], currentIndex: 0, currentMatch: first,
      totalMatches: 1, wrapped: false, indexedPages: 3, failedPages: []
    })
    const pending = coordinator.scrollToSearchMatch(first)
    coordinator.setSearchState({
      status: 'ready', query: 'test', caseSensitive: false,
      matches: [second], currentIndex: 0, currentMatch: second,
      totalMatches: 1, wrapped: false, indexedPages: 3, failedPages: []
    })
    const layer = document.createElement('div')
    layer.textContent = 'test'
    coordinator.handleDomLayersReady({ pageNumber: 2, textLayer: layer })

    await expect(pending).resolves.toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
    coordinator.dispose()
  })
})

describe('pageLayerCoordinator — 비동기 페이지 수명주기', () => {
  it('unrender 뒤 늦게 완료된 DOM presentation은 stale canvas에 그리지 않음', async () => {
    const gate = deferred()
    const coordinator = createPageLayerCoordinator(createOptions({
      afterDomUpdate: () => gate.promise
    }))
    const target = presentationCanvas()
    coordinator.pdfCanvasAction(target.canvas, 1)

    coordinator.handlePageRendered(1, sourceCanvas())
    coordinator.handlePageUnrendered(1)
    gate.resolve()
    await gate.promise
    await Promise.resolve()

    expect(target.drawImage).not.toHaveBeenCalled()
    coordinator.dispose()
    await expect(coordinator.waitUntilFirstPageReady()).rejects.toThrow(
      'PDF viewer was destroyed before the first page became ready'
    )
  })

  it('live 변경과 unrender snapshot을 단일 정본에 보존하고 manager를 한 번만 해제', async () => {
    const harness = createManagerHarness(page('initial'))
    const onCanvasChange = vi.fn()
    const coordinator = createPageLayerCoordinator(createOptions({
      getIsReadOnly: () => false,
      createCanvasManager: harness.factory,
      onCanvasChange
    }))
    const target = presentationCanvas()
    coordinator.pdfCanvasAction(target.canvas, 1)
    coordinator.handlePageRendered(1, sourceCanvas())
    const paperCanvas = document.createElement('canvas')
    const paperAction = coordinator.paperCanvasAction(paperCanvas, 1)
    await Promise.resolve()

    harness.setSnapshot(page('latest'))
    harness.notifyCanvasChange()

    expect(onCanvasChange).toHaveBeenCalledWith(1, page('latest'))
    expect(coordinator.getCanvasData(1)).toBe(page('latest'))

    coordinator.handlePageUnrendered(1)
    paperAction.destroy()
    expect(coordinator.getCanvasData(1)).toBe(page('latest'))
    expect(harness.manager.dispose).toHaveBeenCalledTimes(1)

    coordinator.dispose()
    coordinator.dispose()
    expect(harness.manager.dispose).toHaveBeenCalledTimes(1)
  })

  it('페이지 manager의 키보드 접근성 상태를 페이지 번호와 함께 전달한다', () => {
    const harness = createManagerHarness(page('initial'))
    const onCanvasAccessibilityChange = vi.fn()
    const coordinator = createPageLayerCoordinator(createOptions({
      getIsReadOnly: () => false,
      createCanvasManager: harness.factory,
      onCanvasAccessibilityChange
    }))
    coordinator.handlePageRendered(1, sourceCanvas())
    coordinator.paperCanvasAction(document.createElement('canvas'), 1)

    harness.notifyAccessibilityChange()

    expect(onCanvasAccessibilityChange).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ pageNumber: 1, annotationCount: 0 })
    )
    coordinator.dispose()
  })

  it('검토본은 페이지 JSON만 전달하고 현재 편집 캔버스를 중복 overlay에서 제외', () => {
    const setUserData = vi.fn()
    const overlay = {
      get users() { return [] },
      get visibleUsers() { return [] },
      get userCount() { return 0 },
      setContainer: vi.fn(),
      setDisplayScale: vi.fn(),
      setUserData,
      removeUser: vi.fn(),
      toggleUserVisibility: vi.fn(),
      updateCanvasSize: vi.fn(),
      clearAll: vi.fn(),
      dispose: vi.fn()
    } as unknown as UserOverlay
    const reviews: UserCanvasInfo[] = [
      {
        canvasId: 'editing',
        userName: '나',
        userId: 'me',
        canvasData: JSON.stringify({ '1': page('current') }),
        enabled: true,
        color: '#000000'
      },
      {
        canvasId: 'review',
        userName: '검토자',
        userId: 'reviewer',
        canvasData: JSON.stringify({ '1': page('review') }),
        enabled: true,
        color: '#ff0000'
      }
    ]
    const coordinator = createPageLayerCoordinator(createOptions({
      getReviewEntries: () => reviews,
      getCurrentEditCanvasId: () => 'editing',
      createOverlay: () => overlay
    }))

    coordinator.handlePageRendered(1, sourceCanvas())
    coordinator.overlayContainerAction(document.createElement('div'), 1)

    expect(setUserData).toHaveBeenCalledTimes(1)
    expect(setUserData).toHaveBeenCalledWith(expect.objectContaining({
      canvasId: 'review',
      canvasData: JSON.stringify({
        children: [['PointText', { content: 'review' }]]
      })
    }))
    coordinator.dispose()
    expect(overlay.dispose).toHaveBeenCalledTimes(1)
  })
})
