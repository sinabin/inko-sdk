import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import paper from 'paper'

const input = vi.hoisted(() => ({ stylus: false }))
vi.mock('../../src/lib/utils/inputDetection', () => ({
  isStylusInput: () => input.stylus,
  getStylusPressure: (event: PointerEvent) =>
    event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : null
}))

import { createDrawingMode } from '../../src/lib/tools/drawingMode.svelte'
import { createHighlighterMode } from '../../src/lib/tools/highlighterMode.svelte'
import { createShapeTools } from '../../src/lib/tools/shapeTools.svelte'

function scopeFixture() {
  const scope = new paper.PaperScope()
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  canvas.getBoundingClientRect = () => ({
    left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600,
    x: 10, y: 20, toJSON: () => ({})
  } as DOMRect)
  ;(canvas as any).setPointerCapture = vi.fn()
  ;(canvas as any).releasePointerCapture = vi.fn()
  document.body.append(canvas)
  scope.setup(canvas)
  return { scope, canvas }
}

function pointer(type: string, options: {
  x?: number; y?: number; id?: number; pointerType?: string; pressure?: number;
  button?: number; buttons?: number; primary?: boolean
} = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    clientX: options.x ?? 30,
    clientY: options.y ?? 40,
    pointerId: options.id ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    pressure: options.pressure ?? 0,
    button: options.button ?? 0,
    buttons: options.buttons ?? (type === 'pointerup' ? 0 : 1),
    isPrimary: options.primary ?? true
  })
  return event
}

beforeEach(() => {
  input.stylus = false
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('drawingMode', () => {
  it('scope/canvas 부재는 경고하고 비활성 상태를 유지한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const noScope = createDrawingMode({ getScope: () => null, getBrush: () => ({ color: '#000', width: 2 }) })
    noScope.activate()
    expect(noScope.isActive).toBe(false)
    const emptyScope = new paper.PaperScope()
    const noCanvas = createDrawingMode({ getScope: () => emptyScope, getBrush: () => ({ color: '#000', width: 2 }) })
    noCanvas.activate()
    expect(noCanvas.isActive).toBe(true)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('primary 좌클릭 stroke만 생성하고 pointerup에서 유효 Path를 확정한다', () => {
    const { scope, canvas } = scopeFixture()
    const onPathCreated = vi.fn()
    const onDrawStart = vi.fn()
    const onDrawEnd = vi.fn()
    const mode = createDrawingMode({
      getScope: () => scope,
      getBrush: () => ({ color: '#123456', width: 4, opacity: 0.6 }),
      onPathCreated, onDrawStart, onDrawEnd
    })
    mode.activate()
    expect(mode.isActive).toBe(true)
    canvas.dispatchEvent(pointer('pointerdown', { primary: false }))
    canvas.dispatchEvent(pointer('pointerdown', { button: 2 }))
    expect(onDrawStart).not.toHaveBeenCalled()

    canvas.dispatchEvent(pointer('pointerdown', { x: 30, y: 40, id: 7 }))
    expect(mode.isDrawing).toBe(true)
    canvas.dispatchEvent(pointer('pointermove', { x: 80, y: 100, id: 99 }))
    canvas.dispatchEvent(pointer('pointermove', { x: 31, y: 41, id: 7, buttons: 1 }))
    canvas.dispatchEvent(pointer('pointermove', { x: 80, y: 100, id: 7, buttons: 1 }))
    canvas.dispatchEvent(pointer('pointerup', { x: 100, y: 120, id: 7 }))

    expect(mode.isDrawing).toBe(false)
    expect(onPathCreated).toHaveBeenCalledTimes(1)
    const path = onPathCreated.mock.calls[0][0] as paper.Path
    expect(path.strokeColor?.toCSS(true)).toBe('#123456')
    expect(path.strokeWidth).toBe(4)
    expect(path.opacity).toBeCloseTo(0.6)
    expect(path.segments.length).toBeGreaterThan(1)
    expect(onDrawEnd).toHaveBeenCalledTimes(1)
    expect((canvas as any).releasePointerCapture).toHaveBeenCalledWith(7)

    canvas.dispatchEvent(pointer('pointerup', { id: 100 }))
    mode.deactivate()
    expect(mode.isActive).toBe(false)
  })

  it('button 누락 move는 finalize하고 단일 점/cancel/deactivate는 잔여 Path를 제거한다', () => {
    const { scope, canvas } = scopeFixture()
    const onPathCreated = vi.fn()
    const onDrawEnd = vi.fn()
    const mode = createDrawingMode({
      getScope: () => scope,
      getBrush: () => ({ color: '#000', width: 2 }),
      onPathCreated, onDrawEnd
    })
    mode.toggle()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, buttons: 0 }))
    expect(onPathCreated).not.toHaveBeenCalled()
    expect(onDrawEnd).toHaveBeenCalledTimes(1)

    canvas.dispatchEvent(pointer('pointerdown', { id: 2 }))
    mode.cancelOperation()
    expect(mode.isDrawing).toBe(false)
    canvas.dispatchEvent(pointer('pointerdown', { id: 3 }))
    mode.toggle()
    expect(mode.isActive).toBe(false)
    mode.cancelOperation()
    mode.deactivate()
  })

  it('stylus pressure와 감도가 Path 굵기에 반영되며 0 감도는 고정 폭이다', () => {
    input.stylus = true
    const { scope, canvas } = scopeFixture()
    let sensitivity = 100
    const created: paper.Path[] = []
    const mode = createDrawingMode({
      getScope: () => scope,
      getBrush: () => ({ color: '#000', width: 10, pressureSensitivity: sensitivity }),
      onPathCreated: (path) => created.push(path)
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1, pointerType: 'pen', pressure: 0.2 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, pointerType: 'pen', pressure: 0.8, x: 80, y: 80 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 1, pointerType: 'pen' }))
    expect(created[0].strokeWidth).toBeGreaterThan(10)

    sensitivity = 0
    canvas.dispatchEvent(pointer('pointerdown', { id: 2, pointerType: 'pen', pressure: 0.8 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 2, pointerType: 'pen', pressure: 0.8, x: 100, y: 100 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 2, pointerType: 'pen' }))
    expect(created[1].strokeWidth).toBe(10)
  })
})

describe('highlighterMode', () => {
  it('scope/canvas 부재를 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createHighlighterMode({ getScope: () => null, getBrush: () => ({ color: '#ff0', width: 20 }) }).activate()
    const empty = new paper.PaperScope()
    const mode = createHighlighterMode({ getScope: () => empty, getBrush: () => ({ color: '#ff0', width: 20 }) })
    mode.activate()
    expect(mode.isActive).toBe(true)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('균일 폭 multiply Path를 만들고 invalid pointer를 무시한다', () => {
    const { scope, canvas } = scopeFixture()
    const onPathCreated = vi.fn()
    const onDrawStart = vi.fn()
    const onDrawEnd = vi.fn()
    const mode = createHighlighterMode({
      getScope: () => scope,
      getBrush: () => ({ color: '#ffee00', width: 18 }),
      onPathCreated, onDrawStart, onDrawEnd
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { primary: false }))
    canvas.dispatchEvent(pointer('pointerdown', { button: 2 }))
    canvas.dispatchEvent(pointer('pointerdown', { id: 8 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 9, x: 80, y: 80 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 8, x: 31, y: 41 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 8, x: 90, y: 90 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 8 }))
    expect(onPathCreated).toHaveBeenCalledTimes(1)
    const path = onPathCreated.mock.calls[0][0] as paper.Path
    expect(path.strokeWidth).toBe(18)
    expect(path.opacity).toBeCloseTo(0.3)
    expect(path.blendMode).toBe('multiply')
    expect(path.data.isHighlighter).toBe(true)
    expect(onDrawStart).toHaveBeenCalledTimes(1)
    expect(onDrawEnd).toHaveBeenCalledTimes(1)
    canvas.dispatchEvent(pointer('pointerup', { id: 99 }))
    mode.deactivate()
  })

  it('single point/button-loss/cancel/deactivate 경로를 정리한다', () => {
    const { scope, canvas } = scopeFixture()
    const onPathCreated = vi.fn()
    const onDrawEnd = vi.fn()
    const mode = createHighlighterMode({
      getScope: () => scope, getBrush: () => ({ color: '#ff0', width: 10 }),
      onPathCreated, onDrawEnd
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, buttons: 0 }))
    expect(onPathCreated).not.toHaveBeenCalled()
    expect(onDrawEnd).toHaveBeenCalledTimes(1)
    canvas.dispatchEvent(pointer('pointerdown', { id: 2 }))
    mode.cancelOperation()
    canvas.dispatchEvent(pointer('pointerdown', { id: 3 }))
    mode.deactivate()
    mode.cancelOperation()
    expect(mode.isActive).toBe(false)
  })
})

describe('shapeTools', () => {
  it('직접 add API가 brush/fill과 callback을 보존하고 scope 부재는 null이다', () => {
    const onShapeCreated = vi.fn()
    const noScope = createShapeTools({ getScope: () => null, getBrush: () => ({ color: '#123', width: 3 }) })
    expect(noScope.addRectangle(0, 0, 1, 1)).toBeNull()
    expect(noScope.addCircle(0, 0, 1)).toBeNull()
    expect(noScope.addLine(0, 0, 1, 1)).toBeNull()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    noScope.activate('line')
    expect(warn).toHaveBeenCalled()

    const { scope } = scopeFixture()
    const tools = createShapeTools({
      getScope: () => scope, getBrush: () => ({ color: '#123456', width: 3 }), onShapeCreated
    })
    const rectangle = tools.addRectangle(10, 20, 30, 40, '#ffffff')!
    const circle = tools.addCircle(50, 60, 12)!
    const line = tools.addLine(1, 2, 3, 4)!
    expect(rectangle.fillColor?.toCSS(true)).toBe('#ffffff')
    expect(circle.fillColor).toBeNull()
    expect(line.strokeWidth).toBe(3)
    expect(onShapeCreated).toHaveBeenCalledTimes(3)
  })

  it.each(['rectangle', 'circle', 'line'] as const)('%s pointer gesture에서 preview 후 final shape을 생성한다', (shapeType) => {
    const { scope, canvas } = scopeFixture()
    const onShapeCreated = vi.fn()
    const tools = createShapeTools({
      getScope: () => scope, getBrush: () => ({ color: '#0088ff', width: 2 }), onShapeCreated
    })
    tools.activate(shapeType)
    expect(tools.isActive).toBe(true)
    expect(tools.currentShape).toBe(shapeType)
    canvas.dispatchEvent(pointer('pointerdown', { primary: false }))
    canvas.dispatchEvent(pointer('pointerdown', { button: 2 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, x: 80, y: 80 }))
    canvas.dispatchEvent(pointer('pointerdown', { id: 4, x: 30, y: 40 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 99, x: 100, y: 100 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 4, x: 100, y: 100 }))
    const preview = scope.project.activeLayer.children.find((item) => item.data?.isPreview)
    expect(preview).toBeTruthy()
    expect((preview as paper.Path).dashArray).toEqual([8, 6])
    canvas.dispatchEvent(pointer('pointerup', { id: 4, x: 120, y: 120 }))
    expect(onShapeCreated).toHaveBeenCalledTimes(1)
    expect(scope.project.activeLayer.children.some((item) => item.data?.isPreview)).toBe(false)
    canvas.dispatchEvent(pointer('pointerup', { id: 99 }))
    tools.deactivate()
  })

  it('재활성화/cancel은 preview·capture 상태를 제거한다', () => {
    const { scope, canvas } = scopeFixture()
    const tools = createShapeTools({ getScope: () => scope, getBrush: () => ({ color: '#000', width: 1 }) })
    tools.activate('rectangle')
    canvas.dispatchEvent(pointer('pointerdown', { id: 5 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 5, x: 100, y: 100 }))
    tools.cancelOperation()
    expect(scope.project.activeLayer.children.some((item) => item.data?.isPreview)).toBe(false)
    tools.activate('circle')
    expect(tools.currentShape).toBe('circle')
    const empty = new paper.PaperScope()
    const noCanvas = createShapeTools({ getScope: () => empty, getBrush: () => ({ color: '#000', width: 1 }) })
    noCanvas.activate('line')
    expect(noCanvas.isActive).toBe(true)
    noCanvas.deactivate()
  })
})
