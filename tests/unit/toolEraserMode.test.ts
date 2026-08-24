import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import paper from 'paper'
import { createEraserMode } from '../../src/lib/tools/eraserMode.svelte'

function scopeFixture() {
  const scope = new paper.PaperScope()
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    x: 0, y: 0, toJSON: () => ({})
  } as DOMRect)
  ;(canvas as any).setPointerCapture = vi.fn()
  ;(canvas as any).releasePointerCapture = vi.fn()
  document.body.append(canvas)
  scope.setup(canvas)
  return { scope, canvas }
}

function pointer(type: string, options: {
  x?: number; y?: number; id?: number; pointerType?: string;
  button?: number; buttons?: number; primary?: boolean
} = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    clientX: options.x ?? 20,
    clientY: options.y ?? 30,
    pointerId: options.id ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    button: options.button ?? 0,
    buttons: options.buttons ?? (type === 'pointerup' ? 0 : 1),
    isPrimary: options.primary ?? true
  })
}

function erase(canvas: HTMLCanvasElement, points: Array<[number, number]>, id = 1) {
  const [[startX, startY], ...rest] = points
  canvas.dispatchEvent(pointer('pointerdown', { id, x: startX, y: startY }))
  for (const [x, y] of rest) {
    canvas.dispatchEvent(pointer('pointermove', { id, x, y }))
  }
  const [endX, endY] = points.at(-1)!
  canvas.dispatchEvent(pointer('pointerup', { id, x: endX, y: endY }))
}

function path(scope: paper.PaperScope, points: Array<[number, number]>, options: Record<string, unknown> = {}) {
  return new scope.Path({
    segments: points,
    strokeColor: '#123456',
    strokeWidth: 5,
    strokeCap: 'square',
    strokeJoin: 'bevel',
    opacity: 0.7,
    dashArray: [4, 2],
    data: { source: 'test' },
    ...options
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('eraserMode', () => {
  it('scope/canvas 부재를 경고하고 width를 5..100으로 clamp한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const noScope = createEraserMode({ getScope: () => null, eraserWidth: 20 })
    noScope.activate()
    expect(noScope.isActive).toBe(false)
    noScope.setEraserWidth(1)
    expect(noScope.eraserWidth).toBe(5)
    noScope.setEraserWidth(101)
    expect(noScope.eraserWidth).toBe(100)

    const empty = new paper.PaperScope()
    const noCanvas = createEraserMode({ getScope: () => empty })
    noCanvas.activate()
    expect(noCanvas.isActive).toBe(true)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('pointer 상태·invalid pointer·cancel·toggle/deactivate를 정리한다', () => {
    const { scope, canvas } = scopeFixture()
    const onEraseComplete = vi.fn()
    const mode = createEraserMode({ getScope: () => scope, onEraseComplete })
    mode.toggle()
    canvas.dispatchEvent(pointer('pointerdown', { primary: false }))
    canvas.dispatchEvent(pointer('pointerdown', { button: 2 }))
    expect(mode.isErasing).toBe(false)
    canvas.dispatchEvent(pointer('pointerdown', { id: 4, x: 10, y: 10 }))
    expect(mode.isErasing).toBe(true)
    canvas.dispatchEvent(pointer('pointermove', { id: 99, x: 20, y: 20 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 99 }))
    mode.cancelOperation()
    expect(mode.isErasing).toBe(false)
    expect((canvas as any).releasePointerCapture).toHaveBeenCalledWith(4)

    canvas.dispatchEvent(pointer('pointerdown', { id: 5, x: 20, y: 20 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 5, x: 40, y: 40 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 5, x: 40, y: 40 }))
    expect(onEraseComplete).toHaveBeenCalledTimes(1)
    canvas.dispatchEvent(pointer('pointerdown', { id: 6 }))
    mode.toggle()
    expect(mode.isActive).toBe(false)
    mode.cancelOperation()
    mode.deactivate()
  })

  it('pointerdown 도중 scope가 사라져도 경로를 시작하지 않는다', () => {
    const { scope, canvas } = scopeFixture()
    let current: paper.PaperScope | null = scope
    const mode = createEraserMode({ getScope: () => current })
    mode.activate()
    current = null
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    expect(mode.isErasing).toBe(false)
    mode.deactivate()
  })

  it('교차점 없는 완전 포함 Path/PointText를 삭제하고 외부·UI·preview는 보존한다', () => {
    const { scope, canvas } = scopeFixture()
    const inside = path(scope, [[100, 100]])
    const outside = path(scope, [[400, 400], [500, 400]])
    const ui = path(scope, [[95, 98], [105, 98]], { data: { isSelectionUI: true } })
    const preview = path(scope, [[95, 102], [105, 102]], { data: { isPreview: true } })
    const textInside = new scope.PointText({ point: [100, 100], content: 'inside', fontSize: 12 })
    const textOutside = new scope.PointText({ point: [500, 500], content: 'outside', fontSize: 12 })
    const mode = createEraserMode({ getScope: () => scope, eraserWidth: 60 })
    mode.activate()
    erase(canvas, [[70, 100], [100, 100], [130, 100]])
    expect(inside.parent).toBeNull()
    expect(textInside.parent).toBeNull()
    expect(outside.parent).not.toBeNull()
    expect(textOutside.parent).not.toBeNull()
    expect(ui.parent).not.toBeNull()
    expect(preview.parent).not.toBeNull()
  })

  it('open Path를 centerline 교차점에서 분할해 중앙만 지우고 스타일을 보존한다', () => {
    const { scope, canvas } = scopeFixture()
    const original = path(scope, [[0, 100], [200, 100]])
    const mode = createEraserMode({ getScope: () => scope, eraserWidth: 40 })
    mode.activate()
    erase(canvas, [[100, 70], [100, 100], [100, 130]])

    const fragments = scope.project.activeLayer.children.filter((item): item is paper.Path =>
      item instanceof paper.Path && item.data?.source === 'test')
    expect(original.parent === null || fragments.includes(original)).toBe(true)
    expect(fragments.length).toBeGreaterThanOrEqual(2)
    expect(fragments.every((fragment) => fragment.strokeWidth === 5)).toBe(true)
    expect(fragments.every((fragment) => fragment.strokeCap === 'square')).toBe(true)
    expect(fragments.every((fragment) => fragment.strokeJoin === 'bevel')).toBe(true)
    expect(fragments.every((fragment) => fragment.opacity === 0.7)).toBe(true)
    expect(fragments.every((fragment) => fragment.dashArray.join(',') === '4,2')).toBe(true)
    expect(fragments.every((fragment) => !fragment.contains(new scope.Point(100, 100)))).toBe(true)
  })

  it('닫힌 Path를 open 변환 후 분할한다', () => {
    const { scope, canvas } = scopeFixture()
    const circle = new scope.Path.Circle({
      center: [100, 100], radius: 60, strokeColor: 'red', strokeWidth: 4,
      data: { source: 'closed' }
    })
    const mode = createEraserMode({ getScope: () => scope, eraserWidth: 30 })
    mode.activate()
    erase(canvas, [[100, 20], [100, 100], [100, 180]])
    expect(circle.closed).toBe(false)
    const fragments = scope.project.activeLayer.children.filter((item) => item.data?.source === 'closed')
    expect(fragments.length).toBeGreaterThan(0)
  })

  it('CompoundPath 자식을 추출해 개별 분할하고 원본을 제거한다', () => {
    const { scope, canvas } = scopeFixture()
    const childA = new scope.Path.Circle({ center: [80, 100], radius: 30, insert: false })
    const childB = new scope.Path.Circle({ center: [160, 100], radius: 30, insert: false })
    const compound = new scope.CompoundPath({
      children: [childA, childB], strokeColor: '#00aa00', strokeWidth: 3,
      data: { source: 'compound' }
    })
    const mode = createEraserMode({ getScope: () => scope, eraserWidth: 25 })
    mode.activate()
    erase(canvas, [[120, 50], [120, 100], [120, 150]])
    expect(compound.parent).toBeNull()
    expect(scope.project.activeLayer.children.some((item) =>
      item instanceof paper.Path && item.strokeColor?.toCSS(true) === '#00aa00')).toBe(true)
  })

  it('legacy outline은 boolean subtract 결과로 교체하고 스타일/data를 유지한다', () => {
    const { scope, canvas } = scopeFixture()
    const legacy = new scope.Path.Rectangle({
      point: [50, 50], size: [120, 100], fillColor: '#993300',
      strokeColor: null, data: { isOutline: true, source: 'legacy' }
    })
    const mode = createEraserMode({ getScope: () => scope, eraserWidth: 30 })
    mode.activate()
    erase(canvas, [[110, 20], [110, 100], [110, 180]])
    expect(legacy.parent).toBeNull()
    const replacement = scope.project.activeLayer.children.find((item) => item.data?.source === 'legacy')!
    expect(replacement).toBeTruthy()
    expect(replacement.data.isOutline).toBe(true)
    expect(replacement.strokeColor).toBeNull()
    expect(replacement.strokeWidth).toBe(0)
  })

  it('legacy subtract 실패와 미세 결과는 원본까지 제거한다', () => {
    const { scope, canvas } = scopeFixture()
    const broken = new scope.Path.Rectangle({
      point: [80, 80], size: [40, 40], fillColor: 'black', data: { isOutline: true }
    })
    vi.spyOn(broken, 'subtract').mockImplementation(() => { throw new Error('boolean failed') })
    const tiny = new scope.Path.Rectangle({
      point: [99, 99], size: [1, 1], fillColor: 'black', data: { isOutline: true }
    })
    const mode = createEraserMode({ getScope: () => scope, eraserWidth: 50 })
    mode.activate()
    erase(canvas, [[100, 70], [100, 100], [100, 130]])
    expect(broken.parent).toBeNull()
    expect(tiny.parent).toBeNull()
  })

  it('cleanup은 짧은 stroke·작은 outline·작은 CompoundPath 잔해를 제거한다', () => {
    const { scope, canvas } = scopeFixture()
    const short = path(scope, [[500, 500], [501, 500]])
    const tinyOutline = new scope.Path.Rectangle({
      point: [550, 500], size: [1, 1], fillColor: 'black', data: { isOutline: true }
    })
    const tinyChild = new scope.Path.Circle({ center: [600, 500], radius: 0.5, insert: false })
    const tinyCompound = new scope.CompoundPath({ children: [tinyChild], fillColor: 'black' })
    const mode = createEraserMode({ getScope: () => scope, eraserWidth: 20 })
    mode.activate()
    erase(canvas, [[10, 10]])
    expect(short.parent).toBeNull()
    expect(tinyOutline.parent).toBeNull()
    expect(tinyCompound.parent).toBeNull()
  })

  it('두 번째 pointerdown은 미완성 erase를 먼저 finalize한다', () => {
    const { scope, canvas } = scopeFixture()
    const onEraseComplete = vi.fn()
    const mode = createEraserMode({ getScope: () => scope, onEraseComplete })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1, x: 10, y: 10 }))
    canvas.dispatchEvent(pointer('pointerdown', { id: 2, x: 20, y: 20 }))
    expect(onEraseComplete).toHaveBeenCalledTimes(1)
    canvas.dispatchEvent(pointer('pointerup', { id: 2, x: 20, y: 20 }))
    expect(onEraseComplete).toHaveBeenCalledTimes(2)
  })
})
