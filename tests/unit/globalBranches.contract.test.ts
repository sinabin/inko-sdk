import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'

vi.mock('pdfjs-dist', () => ({
  createValidAbsoluteUrl: (url: string, baseUrl: string | null = null) => {
    try {
      const parsed = baseUrl ? new URL(url, baseUrl) : new URL(url)
      return ['http:', 'https:', 'ftp:', 'mailto:', 'tel:'].includes(parsed.protocol)
        ? parsed
        : null
    } catch {
      return null
    }
  },
  isValidExplicitDest: (dest: unknown) => Array.isArray(dest) && dest.length >= 2
}))

import { createPageCanvasManager } from '../../src/lib/canvas/pageCanvasManager.svelte'
import { createPaperCanvas } from '../../src/lib/canvas/paperCanvas.svelte'
import {
  InkoPdfLinkService,
  createPdfLinkService,
  type PdfLinkScrollTarget
} from '../../src/lib/pdf/pdfLinkService'
import type { HistoryManager } from '../../src/lib/history'

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return canvas
}

function makeTouchEvent(type: string, touchCount: number): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    configurable: true,
    value: Array.from({ length: touchCount }, () => ({}))
  })
  return event as TouchEvent
}

function makePointerEvent(isPrimary: boolean, pointerId = 1): PointerEvent {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    isPrimary: { configurable: true, value: isPrimary },
    pointerId: { configurable: true, value: pointerId }
  })
  return event as PointerEvent
}

function createHistoryStub(options: {
  undo?: string | null
  redo?: string | null
  canUndo?: boolean
  canRedo?: boolean
} = {}): HistoryManager {
  return {
    get canUndo() { return options.canUndo ?? false },
    get canRedo() { return options.canRedo ?? false },
    get activePage() { return 3 },
    setActivePage: vi.fn(),
    pushSnapshot: vi.fn(),
    setBaseline: vi.fn(),
    undo: vi.fn(() => options.undo ?? null),
    redo: vi.fn(() => options.redo ?? null),
    canUndoPage: vi.fn(() => options.canUndo ?? false),
    canRedoPage: vi.fn(() => options.canRedo ?? false),
    clear: vi.fn(),
    dispose: vi.fn()
  }
}

interface DocumentControls {
  destination?: unknown[] | null | Promise<unknown[] | null>
  cachedPage?: number | null
  pageIndex?: number | Promise<number>
  optionalConfig?: { setOCGState: ReturnType<typeof vi.fn> } | Promise<{ setOCGState: ReturnType<typeof vi.fn> }>
}

function createDocument(controls: DocumentControls = {}, numPages = 8): PDFDocumentProxy {
  const optionalConfig = controls.optionalConfig ?? { setOCGState: vi.fn() }
  return {
    numPages,
    getDestination: vi.fn(() => Promise.resolve(controls.destination ?? null)),
    cachedPageNumber: vi.fn(() => controls.cachedPage ?? null),
    getPageIndex: vi.fn(() => Promise.resolve(controls.pageIndex ?? 0)),
    getOptionalContentConfig: vi.fn(() => Promise.resolve(optionalConfig))
  } as unknown as PDFDocumentProxy
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('PageCanvasManager public lifecycle and guard branches', () => {
  it('is safely callable before initialization and after disposal', () => {
    const manager = createPageCanvasManager()

    expect(manager.paperCanvas).toBeNull()
    expect(manager.isReady).toBe(false)
    expect(manager.hasSelection).toBe(false)
    expect(manager.canUndo).toBe(false)
    expect(manager.canRedo).toBe(false)
    expect(manager.exportJSON()).toBe('[]')
    expect(manager.importJSON('')).toBe(false)
    expect(manager.importJSON('[]')).toBe(false)
    expect(manager.undo()).toBe(false)
    expect(manager.redo()).toBe(false)

    manager.setDrawingMode('pen')
    manager.setBrushColor('#123456')
    manager.setBrushWidth(7)
    manager.setBrushPressureSensitivity(80)
    manager.setFontSize(22)
    manager.setZoom(2)
    manager.setBaseDimensions(300, 400)
    manager.addText('ignored', 1, 2)
    manager.confirmText('ignored')
    manager.cancelText()
    manager.deleteSelected()
    manager.dispose()

    expect(manager.isReady).toBe(false)
    expect(manager.exportJSON()).toBe('[]')
  })

  it('exercises every tool, multi-touch cancellation, state export and history callbacks', () => {
    vi.useFakeTimers()
    const onCanvasChange = vi.fn()
    const onTextInputRequest = vi.fn()
    const onSelectionChange = vi.fn()
    const history = createHistoryStub({
      undo: '["undo-state"]',
      redo: '["redo-state"]',
      canUndo: true,
      canRedo: true
    })
    const manager = createPageCanvasManager({
      onCanvasChange,
      onTextInputRequest,
      onSelectionChange,
      getScrollContainer: () => document.body,
      historyManager: history,
      pageNum: 3
    })
    const canvas = makeCanvas()
    manager.init(canvas, 612, 792, 1)

    expect(manager.isReady).toBe(true)
    expect(manager.paperCanvas).not.toBeNull()
    expect(manager.hasSelection).toBe(false)
    expect(manager.canUndo).toBe(true)
    expect(manager.canRedo).toBe(true)
    expect(history.setBaseline).toHaveBeenCalledWith(3, expect.any(String))

    manager.setBrushColor('#abcdef')
    manager.setBrushWidth(9)
    manager.setBrushPressureSensitivity(65)
    manager.setFontSize(28)
    manager.setZoom(1.25)
    manager.setBaseDimensions(620, 800)

    const downstreamPointer = vi.fn()
    canvas.addEventListener('pointerdown', downstreamPointer)
    const tools = ['pen', 'highlighter', 'eraser', 'select', 'rectangle', 'circle', 'line', 'text'] as const
    for (const tool of tools) {
      manager.setDrawingMode(tool)
      canvas.dispatchEvent(makeTouchEvent('touchstart', 2))
      canvas.dispatchEvent(makeTouchEvent('touchstart', 2))
      canvas.dispatchEvent(makePointerEvent(true, 9))
      canvas.dispatchEvent(makeTouchEvent('touchend', 2))
      canvas.dispatchEvent(makeTouchEvent('touchend', 0))
      canvas.dispatchEvent(makeTouchEvent('touchcancel', 0))
      vi.advanceTimersByTime(300)
    }
    expect(downstreamPointer).not.toHaveBeenCalled()

    const scope = manager.paperCanvas?.scope
    if (!scope) throw new Error('PaperScope initialization failed')
    scope.activate()
    const drawing = new scope.Path({
      segments: [[10, 10], [20, 20]],
      strokeColor: 'black'
    })
    const selectionUi = new scope.Path({
      segments: [[30, 30], [40, 40]],
      strokeColor: 'blue'
    })
    selectionUi.data.isSelectionUI = true

    const json = manager.exportJSON()
    expect(json).not.toContain('isSelectionUI')
    expect(scope.project.activeLayer.children).toContain(drawing)
    expect(scope.project.activeLayer.children).toContain(selectionUi)

    manager.addText('history entry', 50, 60)
    expect(history.pushSnapshot).toHaveBeenCalledWith(3, expect.any(String))
    expect(onCanvasChange).toHaveBeenCalled()
    manager.confirmText('no pending text')
    manager.cancelText()
    manager.deleteSelected()

    expect(manager.importJSON(json)).toBe(true)
    expect(history.setBaseline).toHaveBeenCalledWith(3, json)
    ;(history.undo as ReturnType<typeof vi.fn>).mockReturnValue(json)
    ;(history.redo as ReturnType<typeof vi.fn>).mockReturnValue(json)
    expect(manager.undo()).toBe(true)
    expect(manager.redo()).toBe(true)
    expect(history.undo).toHaveBeenCalledWith(3)
    expect(history.redo).toHaveBeenCalledWith(3)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(manager.importJSON('{invalid-json')).toBe(false)
    expect(warn).toHaveBeenCalled()

    manager.dispose()
    expect(manager.paperCanvas).toBeNull()
    expect(manager.isReady).toBe(false)
  })

  it('keeps read-only canvases in select mode and ignores destructive changes', () => {
    const onCanvasChange = vi.fn()
    const manager = createPageCanvasManager({ isReadOnly: true, onCanvasChange })
    manager.setDrawingMode('pen')
    manager.clear()

    const canvas = makeCanvas()
    manager.init(canvas, 100, 120, 1)
    const baseline = manager.exportJSON()
    manager.setDrawingMode('text')
    manager.clear()

    expect(manager.exportJSON()).toBe(baseline)
    expect(onCanvasChange).not.toHaveBeenCalled()
    manager.dispose()
  })

  it('returns false when history has no undo or redo state', () => {
    const history = createHistoryStub()
    const manager = createPageCanvasManager({ historyManager: history })
    manager.init(makeCanvas(), 100, 100, 1)

    expect(manager.undo()).toBe(false)
    expect(manager.redo()).toBe(false)
    manager.dispose()
  })
})

describe('PaperCanvas public lifecycle and no-op branches', () => {
  it('exposes stable empty state before init and restores it after dispose', () => {
    const canvas = createPaperCanvas()

    expect(canvas.scope).toBeNull()
    expect(canvas.project).toBeNull()
    expect(canvas.view).toBeNull()
    expect(canvas.canvas).toBeNull()
    expect(canvas.isReady).toBe(false)
    expect(canvas.isReadOnly).toBe(false)
    expect(canvas.baseWidth).toBe(0)
    expect(canvas.baseHeight).toBe(0)
    expect(canvas.zoom).toBe(1)
    expect(canvas.getZoom()).toBe(1)
    expect(canvas.getActiveLayer()).toBeNull()
    expect(canvas.exportJSON()).toBe('[]')
    expect(canvas.getDrawnItems()).toEqual([])

    canvas.setZoom(2)
    canvas.setBaseDimensions(10, 20)
    canvas.clear()
    canvas.render()
    canvas.importJSON('[]')
    canvas.activate()
    canvas.dispose()

    expect(canvas.isReady).toBe(false)
  })

  it('applies DPR fallback, pointer capture, read-only locking and drawing filters', () => {
    const originalDpr = window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 })
    const canvasElement = makeCanvas()
    const setPointerCapture = vi.fn()
    Object.defineProperty(canvasElement, 'setPointerCapture', {
      configurable: true,
      value: setPointerCapture
    })
    const canvas = createPaperCanvas({ isReadOnly: true })
    canvas.init(canvasElement, 200, 300, 1.5)

    expect(canvas.isReady).toBe(true)
    expect(canvas.isReadOnly).toBe(true)
    expect(canvas.project?.activeLayer.locked).toBe(true)
    expect(canvas.getZoom()).toBe(1.5)
    expect(canvas.getActiveLayer()).toBe(canvas.project?.activeLayer)

    canvasElement.dispatchEvent(makePointerEvent(false, 4))
    canvasElement.dispatchEvent(makePointerEvent(true, 5))
    expect(setPointerCapture).toHaveBeenCalledWith(5)

    const scope = canvas.scope
    if (!scope) throw new Error('PaperScope initialization failed')
    scope.activate()
    const drawing = new scope.Path({ segments: [[1, 1], [2, 2]], strokeColor: 'black' })
    const ui = new scope.Path({ segments: [[3, 3], [4, 4]], strokeColor: 'red' })
    ui.data.isSelectionUI = true
    expect(canvas.getDrawnItems()).toEqual([drawing])

    const update = vi.spyOn(canvas.view!, 'update')
    canvas.setBaseDimensions(240, 360)
    canvas.render()
    expect(canvas.baseWidth).toBe(240)
    expect(canvas.baseHeight).toBe(360)
    expect(update).toHaveBeenCalled()

    canvas.clear()
    expect(canvas.getDrawnItems()).toEqual([])
    canvas.dispose()
    expect(canvas.isReady).toBe(false)
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalDpr })
  })

  it('tolerates pointer-capture failures in embedded canvases', () => {
    const canvasElement = makeCanvas()
    Object.defineProperty(canvasElement, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(() => { throw new Error('capture unavailable') })
    })
    const canvas = createPaperCanvas()
    canvas.init(canvasElement, 100, 100, 1, 2)

    expect(() => canvasElement.dispatchEvent(makePointerEvent(true, 77))).not.toThrow()
    canvas.dispose()
  })
})

describe('PdfLinkService public navigation, error and no-op branches', () => {
  it('exposes defaults and validates page, rotation and external-link state', () => {
    const scroll = vi.fn()
    const service = new InkoPdfLinkService({
      getCurrentPage: () => Number.NaN,
      scrollPageIntoView: scroll
    })

    expect(service.pagesCount).toBe(0)
    expect(service.page).toBe(1)
    service.page = 2
    expect(service.rotation).toBe(0)
    service.rotation = 45
    service.rotation = 90
    expect(service.isInPresentationMode).toBe(false)
    expect(service.externalLinkEnabled).toBe(true)
    service.externalLinkEnabled = false
    expect(service.externalLinkEnabled).toBe(false)
    service.externalLinkEnabled = 'yes' as unknown as boolean
    expect(service.externalLinkEnabled).toBe(false)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('supports rotation, direct page/XY navigation, labels and all named actions', () => {
    let currentPage = 3
    let rotation = 0
    const setCurrentPage = vi.fn((page: number) => { currentPage = page })
    const setRotation = vi.fn((value: number) => { rotation = value })
    const scroll = vi.fn()
    const onNamedAction = vi.fn()
    const service = new InkoPdfLinkService({
      getCurrentPage: () => currentPage,
      setCurrentPage,
      scrollPageIntoView: scroll,
      pageLabelToPageNumber: (label) => label === 'A-1' ? 6 : null,
      getRotation: () => rotation,
      setRotation,
      onNamedAction
    })
    service.setDocument(createDocument())

    expect(service.pagesCount).toBe(8)
    expect(service.page).toBe(3)
    service.page = 4
    service.goToPage('A-1')
    service.goToPage('5')
    service.goToPage(0)
    service.goToPage(9)
    service.goToPage(1.5)
    service.goToPage('missing')
    service.goToXY(2, 10, 20)
    service.goToXY(0, 10, 20)
    service.rotation = 180
    service.rotation = 91
    expect(service.rotation).toBe(180)
    expect(setRotation).toHaveBeenCalledTimes(1)

    for (const action of ['NextPage', 'PrevPage', 'FirstPage', 'LastPage', 'Print']) {
      service.executeNamedAction(action)
    }
    expect(onNamedAction).toHaveBeenCalledWith('Print')
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({
      pageNumber: 2,
      destArray: [null, { name: 'XYZ' }, 10, 20],
      ignoreDestinationZoom: true
    }))
  })

  it('resolves integer, cached and uncached destinations and rejects invalid ones', async () => {
    const scroll = vi.fn()
    const error = vi.fn()
    const service = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      scrollPageIntoView: scroll,
      onNavigationError: error
    })
    const ref = { num: 9, gen: 0 }

    service.setDocument(createDocument({ cachedPage: 7 }))
    await service.goToDestination([ref, { name: 'Fit' }])
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ pageNumber: 7 }))

    service.setDocument(createDocument({ cachedPage: null, pageIndex: 4 }))
    await service.goToDestination([ref, { name: 'Fit' }])
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ pageNumber: 5 }))

    service.setDocument(createDocument())
    await service.goToDestination([1, { name: 'Fit' }])
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ pageNumber: 2 }))
    const count = scroll.mock.calls.length
    await service.goToDestination([])
    await service.goToDestination([null, { name: 'Fit' }])
    await service.goToDestination([99, { name: 'Fit' }])
    await service.goToDestination('missing')
    expect(scroll).toHaveBeenCalledTimes(count)
    expect(error).not.toHaveBeenCalled()
  })

  it('drops stale destination resolution and reports only current-document failures', async () => {
    const navigationError = vi.fn()
    const service = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      scrollPageIntoView: vi.fn(),
      onNavigationError: navigationError
    })
    const gate = deferred<unknown[] | null>()
    const oldDocument = createDocument({ destination: gate.promise })
    service.setDocument(oldDocument)
    const staleNavigation = service.goToDestination('slow')
    service.setDocument(createDocument())
    gate.resolve([0, { name: 'Fit' }])
    await staleNavigation
    expect(navigationError).not.toHaveBeenCalled()

    const failure = new Error('destination failed')
    const failingDocument = createDocument()
    ;(failingDocument.getDestination as ReturnType<typeof vi.fn>).mockRejectedValue(failure)
    service.setDocument(failingDocument)
    await service.goToDestination('broken')
    expect(navigationError).toHaveBeenCalledWith(failure)

    const pageFailure = new Error('page index failed')
    const pageDocument = createDocument({ cachedPage: null })
    ;(pageDocument.getPageIndex as ReturnType<typeof vi.fn>).mockRejectedValue(pageFailure)
    service.setDocument(pageDocument)
    await service.goToDestination([{ num: 1, gen: 0 }, { name: 'Fit' }])
    expect(navigationError).toHaveBeenCalledWith(pageFailure)
  })

  it('secures relative, disabled and unsafe links and produces safe hashes', () => {
    const service = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      scrollPageIntoView: vi.fn()
    })
    service.setDocument(createDocument(), 'https://example.com/manual.pdf')

    const relative = document.createElement('a')
    service.addLinkAttributes(relative, './chapter-2')
    expect(relative.href).toBe('https://example.com/chapter-2')
    expect(relative.target).toBe('_blank')
    expect(relative.rel).toBe('noopener noreferrer nofollow')

    service.externalLinkEnabled = false
    const disabled = document.createElement('a')
    service.addLinkAttributes(disabled, 'https://safe.example/path')
    expect(disabled.hasAttribute('href')).toBe(false)
    expect(disabled.title).toContain('Disabled:')
    expect(disabled.onclick?.(makePointerEvent(true))).toBe(false)

    const unsafe = document.createElement('a')
    service.addLinkAttributes(unsafe, 'javascript:alert(1)')
    expect(unsafe.title).toBe('Blocked unsafe link')

    expect(service.getAnchorUrl('#page=2')).toBe('https://example.com/manual.pdf#page=2')
    expect(service.getDestinationHash('chapter 2')).toContain('#chapter%202')
    expect(service.getDestinationHash([1, { name: 'Fit' }])).toContain('%5B1%2C')
    expect(service.getDestinationHash('')).toBe('https://example.com/manual.pdf')
    const circular: unknown[] = []
    circular.push(circular)
    expect(service.getDestinationHash(circular)).toBe('https://example.com/manual.pdf')

    service.setDocument(createDocument())
    expect(service.getAnchorUrl('#page=1')).toBe('#page=1')
  })

  it('parses supported hash forms and ignores malformed or unavailable navigation', async () => {
    const documentProxy = createDocument({
      destination: [2, { name: 'Fit' }]
    })
    const scroll = vi.fn()
    const service = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      scrollPageIntoView: scroll
    })

    service.setHash('#page=2')
    service.setDocument(documentProxy)
    service.setHash('#page=2&nameddest=chapter')
    service.setHash(encodeURIComponent(JSON.stringify([3, { name: 'Fit' }])))
    service.setHash('chapter')
    service.setHash('%E0%A4%A')
    service.setHash(42 as unknown as string)
    await flushPromises()

    expect(scroll).toHaveBeenCalledWith({ pageNumber: 2 })
    expect(documentProxy.getDestination).toHaveBeenCalledWith('chapter')
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 4 }))
    service.dispose()
    service.setHash('#page=3')
  })

  it('applies optional-content state, ignores stale work and reports current failures', async () => {
    const changed = vi.fn()
    const navigationError = vi.fn()
    const service = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      scrollPageIntoView: vi.fn(),
      onOptionalContentConfigChanged: changed,
      onNavigationError: navigationError
    })
    const config = { setOCGState: vi.fn() }
    service.setDocument(createDocument({ optionalConfig: config }))
    const action = { state: ['ON', 'layer-1'], preserveRB: true }
    await service.executeSetOCGState(action)
    expect(config.setOCGState).toHaveBeenCalledWith(action)
    expect(changed).toHaveBeenCalledWith(config)

    const gate = deferred<{ setOCGState: ReturnType<typeof vi.fn> }>()
    service.setDocument(createDocument({ optionalConfig: gate.promise }))
    const stale = service.executeSetOCGState(action)
    service.setDocument(createDocument())
    gate.resolve({ setOCGState: vi.fn() })
    await stale
    expect(changed).toHaveBeenCalledTimes(1)

    const failure = new Error('optional content failed')
    const failing = createDocument()
    ;(failing.getOptionalContentConfig as ReturnType<typeof vi.fn>).mockRejectedValue(failure)
    service.setDocument(failing)
    await service.executeSetOCGState(action)
    expect(navigationError).toHaveBeenCalledWith(failure)

    service.dispose()
    await service.executeSetOCGState(action)
  })

  it('handles sync and async host callbacks without leaking stale navigation', async () => {
    const errors = vi.fn()
    const scroll = vi.fn()
    const service = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      setCurrentPage: vi.fn(async () => { throw new Error('select rejected') }),
      ensurePageVisible: vi.fn(),
      scrollPageIntoView: vi.fn(async () => { throw new Error('scroll rejected') }),
      onNavigationError: errors
    })
    service.setDocument(createDocument())
    service.goToPage(2)
    await flushPromises()
    expect(errors).toHaveBeenCalledTimes(2)

    const syncFailure = new Error('ensure threw')
    const throwingEnsure = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      ensurePageVisible: () => { throw syncFailure },
      scrollPageIntoView: scroll,
      onNavigationError: errors
    })
    throwingEnsure.setDocument(createDocument())
    throwingEnsure.goToPage(2)
    expect(errors).toHaveBeenCalledWith(syncFailure)

    const rejectedEnsure = new Error('ensure rejected')
    const asyncEnsure = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      ensurePageVisible: () => Promise.reject(rejectedEnsure),
      scrollPageIntoView: scroll,
      onNavigationError: errors
    })
    asyncEnsure.setDocument(createDocument())
    asyncEnsure.goToPage(2)
    await flushPromises()
    expect(errors).toHaveBeenCalledWith(rejectedEnsure)

    const finishGate = deferred<void>()
    const staleScroll = vi.fn()
    const stale = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      ensurePageVisible: () => finishGate.promise,
      scrollPageIntoView: staleScroll
    })
    stale.setDocument(createDocument())
    stale.goToPage(2)
    stale.dispose()
    finishGate.resolve()
    await flushPromises()
    expect(staleScroll).not.toHaveBeenCalled()

    const syncCallbackFailure = new Error('set page threw')
    const throwingFinish = new InkoPdfLinkService({
      getCurrentPage: () => 1,
      setCurrentPage: () => { throw syncCallbackFailure },
      scrollPageIntoView: scroll,
      onNavigationError: errors
    })
    throwingFinish.setDocument(createDocument())
    throwingFinish.goToPage(2)
    expect(errors).toHaveBeenCalledWith(syncCallbackFailure)
  })

  it('factory lifecycle reconnects after disposal', () => {
    const scroll = vi.fn()
    const link = createPdfLinkService({
      getCurrentPage: () => 1,
      scrollPageIntoView: scroll
    })
    link.setDocument(createDocument())
    link.dispose()
    link.service.goToPage(2)
    expect(scroll).not.toHaveBeenCalled()

    link.setDocument(createDocument())
    link.service.goToPage(2)
    expect(scroll).toHaveBeenCalledWith({ pageNumber: 2 })
  })
})
