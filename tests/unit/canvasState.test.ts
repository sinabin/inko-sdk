import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reportError: vi.fn(),
  tempLayers: [] as Array<{ children: unknown[]; removed: boolean }>
}))

vi.mock('paper', () => {
  class Layer {
    children: unknown[] = []
    removed = false

    constructor() {
      mocks.tempLayers.push(this)
    }

    exportJSON() {
      return JSON.stringify(this.children)
    }

    remove() {
      this.removed = true
    }
  }

  return { default: { Layer } }
})

vi.mock('../../src/lib/utils/errorReporter.svelte', () => ({
  reportError: mocks.reportError
}))

import { createCanvasState } from '../../src/lib/canvas/canvasState.svelte'

interface FakeLayer {
  children: any[]
  removeChildren: ReturnType<typeof vi.fn>
  importJSON: ReturnType<typeof vi.fn>
}

function createScope() {
  const layer: FakeLayer = {
    children: [],
    removeChildren: vi.fn(function (this: FakeLayer) {
      this.children = []
    }),
    importJSON: vi.fn()
  }
  const scope = {
    project: { activeLayer: layer },
    view: { update: vi.fn() }
  }
  return { scope, layer }
}

function drawable(id: string, data: Record<string, unknown> = {}) {
  return {
    data,
    clone: vi.fn(() => ({
      copyTo: vi.fn((layer: { children: unknown[] }) => {
        layer.children.push({ id })
      })
    }))
  }
}

describe('canvasState', () => {
  beforeEach(() => {
    mocks.reportError.mockReset()
    mocks.tempLayers.length = 0
  })

  it('starts clean and safely no-ops canvas operations while no scope is mounted', () => {
    const onStateChange = vi.fn()
    const state = createCanvasState({ getScope: () => null, onStateChange })

    expect(state.currentPageNum).toBe(1)
    expect(state.canvasDataByPage).toEqual({})
    expect(state.hasData).toBe(false)
    expect(state.isDirty).toBe(false)

    state.savePageState()
    state.loadPageState(4)
    expect(state.currentPageNum).toBe(1)

    state.clearAll()
    state.clearCurrentPage()
    expect(state.isDirty).toBe(true)
    expect(onStateChange).toHaveBeenCalledTimes(2)
  })

  it('saves only drawable content, removes its temporary export layer, and returns copies', () => {
    const { scope, layer } = createScope()
    const onStateChange = vi.fn()
    const ink = drawable('ink')
    const selection = drawable('selection', { isSelectionUI: true })
    const preview = drawable('preview', { isPreview: true })
    layer.children = [ink, selection, preview]
    const state = createCanvasState({ getScope: () => scope as any, onStateChange })

    state.savePageState(2)

    expect(state.canvasDataByPage).toEqual({ 2: '[{"id":"ink"}]' })
    expect(state.hasPageData(2)).toBe(true)
    expect(state.hasData).toBe(true)
    expect(state.isDirty).toBe(true)
    expect(ink.clone).toHaveBeenCalledTimes(1)
    expect(selection.clone).not.toHaveBeenCalled()
    expect(preview.clone).not.toHaveBeenCalled()
    expect(mocks.tempLayers).toHaveLength(1)
    expect(mocks.tempLayers[0].removed).toBe(true)
    expect(onStateChange).toHaveBeenCalledTimes(1)

    const copy = state.getAllData()
    delete copy[2]
    expect(state.hasPageData(2)).toBe(true)
  })

  it('removes saved page data when the active layer has no exportable items', () => {
    const { scope, layer } = createScope()
    layer.children = [drawable('selection', { isSelectionUI: true })]
    const state = createCanvasState({ getScope: () => scope as any })
    state.setPageData(3, 'old-data')

    state.savePageState(3)

    expect(state.hasPageData(3)).toBe(false)
    expect(mocks.tempLayers).toHaveLength(0)
  })

  it('loads stored data into a cleared layer and refreshes the view', () => {
    const { scope, layer } = createScope()
    const state = createCanvasState({ getScope: () => scope as any })
    state.setPageData(7, '["paper-data"]')
    layer.children = [drawable('stale')]

    state.loadPageState(7)

    expect(state.currentPageNum).toBe(7)
    expect(layer.removeChildren).toHaveBeenCalledTimes(1)
    expect(layer.importJSON).toHaveBeenCalledWith('["paper-data"]')
    expect(scope.view.update).toHaveBeenCalledTimes(1)
  })

  it('loads an empty page without importing and reports malformed Paper.js data', () => {
    const { scope, layer } = createScope()
    const state = createCanvasState({ getScope: () => scope as any })

    state.loadPageState(2)
    expect(layer.importJSON).not.toHaveBeenCalled()
    expect(scope.view.update).toHaveBeenCalledTimes(1)

    state.setPageData(3, 'broken-paper-json')
    const parseFailure = new Error('bad paper data')
    layer.importJSON.mockImplementationOnce(() => { throw parseFailure })
    state.loadPageState(3)

    expect(mocks.reportError).toHaveBeenCalledWith(
      'render',
      '페이지 3 캔버스 로드에 실패했습니다',
      parseFailure
    )
    expect(scope.view.update).toHaveBeenCalledTimes(2)
  })

  it('exports array, object, and malformed page payloads in the public envelope', () => {
    const state = createCanvasState({ getScope: () => null })
    state.setAllData({
      1: '["Path",{"strokeColor":"#000"}]',
      2: '{"type":"Shape"}',
      3: 'not-json'
    })

    expect(JSON.parse(state.exportToJSON())).toEqual({
      1: { version: 'paper', children: ['Path', { strokeColor: '#000' }] },
      2: { version: 'paper', children: [{ type: 'Shape' }] },
      3: { version: 'paper', children: [] }
    })
    expect(state.isDirty).toBe(false)
  })

  it('imports envelope and direct-string forms, ignores invalid page entries, and reloads the current page', () => {
    const { scope, layer } = createScope()
    const state = createCanvasState({ getScope: () => scope as any })
    state.loadPageState(2)
    layer.removeChildren.mockClear()
    scope.view.update.mockClear()

    state.importFromJSON(JSON.stringify({
      2: { version: 'paper', children: ['Path', { id: 2 }] },
      10: '["direct"]',
      invalid: { children: ['ignored'] },
      11: { version: 'paper' }
    }))

    expect(state.getAllData()).toEqual({
      2: '["Path",{"id":2}]',
      10: '["direct"]'
    })
    expect(state.getPagesWithData()).toEqual([2, 10])
    expect(state.isDirty).toBe(false)
    expect(layer.removeChildren).toHaveBeenCalledTimes(1)
    expect(layer.importJSON).toHaveBeenCalledWith('["Path",{"id":2}]')
    expect(scope.view.update).toHaveBeenCalledTimes(1)
  })

  it('reports malformed or null imports and ignores valid primitive JSON without mutating data', () => {
    const state = createCanvasState({ getScope: () => null })
    state.setAllData({ 1: '["kept"]' })

    state.importFromJSON('not-json')
    state.importFromJSON('null')
    state.importFromJSON('"primitive"')

    expect(mocks.reportError).toHaveBeenCalledTimes(2)
    expect(mocks.reportError.mock.calls[0].slice(0, 2)).toEqual([
      'parse', '캔버스 데이터를 불러올 수 없습니다'
    ])
    expect(state.getAllData()).toEqual({ 1: '["kept"]' })
  })

  it('sets, deletes, sorts, and marks page data clean through the public API', () => {
    const state = createCanvasState({ getScope: () => null })

    state.setPageData(10, 'ten')
    state.setPageData(2, 'two')
    state.setPageData(1, 'one')
    expect(state.getPagesWithData()).toEqual([1, 2, 10])
    expect(state.isDirty).toBe(true)

    state.setPageData(2, '')
    expect(state.hasPageData(2)).toBe(false)
    state.markClean()
    expect(state.isDirty).toBe(false)
  })

  it('clears either the current page or all pages and refreshes a mounted canvas', () => {
    const { scope, layer } = createScope()
    const onStateChange = vi.fn()
    const state = createCanvasState({ getScope: () => scope as any, onStateChange })
    state.setAllData({ 1: 'one', 2: 'two' })

    state.loadPageState(2)
    layer.removeChildren.mockClear()
    scope.view.update.mockClear()
    state.clearCurrentPage()

    expect(state.getAllData()).toEqual({ 1: 'one' })
    expect(layer.removeChildren).toHaveBeenCalledTimes(1)
    expect(scope.view.update).toHaveBeenCalledTimes(1)

    state.clearAll()
    expect(state.getAllData()).toEqual({})
    expect(state.hasData).toBe(false)
    expect(layer.removeChildren).toHaveBeenCalledTimes(2)
    expect(scope.view.update).toHaveBeenCalledTimes(2)
    expect(onStateChange).toHaveBeenCalledTimes(2)
  })
})
