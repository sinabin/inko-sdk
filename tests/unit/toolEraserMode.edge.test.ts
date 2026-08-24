import { beforeEach, describe, expect, it, vi } from 'vitest'
import paper from 'paper'

const outline = vi.hoisted(() => ({
  factory: null as null | ((...args: any[]) => any),
  convert: vi.fn((...args: any[]) => outline.factory?.(...args) ?? null)
}))

vi.mock('../../src/lib/utils/pathOutline', () => ({
  MIN_AREA: 4,
  eraserStrokeToOutline: outline.convert
}))

import { createEraserMode } from '../../src/lib/tools/eraserMode.svelte'

function fixture() {
  const scope = new paper.PaperScope()
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300,
    x: 0, y: 0, toJSON: () => ({})
  } as DOMRect)
  ;(canvas as any).setPointerCapture = vi.fn()
  ;(canvas as any).releasePointerCapture = vi.fn()
  document.body.append(canvas)
  scope.setup(canvas)
  return { scope, canvas }
}

function event(type: string, id = 1, x = 100, y = 100) {
  return new PointerEvent(type, {
    bubbles: true, clientX: x, clientY: y, pointerId: id,
    pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1,
    isPrimary: true
  })
}

function erase(canvas: HTMLCanvasElement) {
  canvas.dispatchEvent(event('pointerdown'))
  canvas.dispatchEvent(event('pointermove', 1, 110, 110))
  canvas.dispatchEvent(event('pointerup', 1, 110, 110))
}

function largeOutline(scope: paper.PaperScope) {
  return new scope.Path.Rectangle({ point: [0, 0], size: [300, 250], insert: false })
}

beforeEach(() => {
  document.body.innerHTML = ''
  outline.factory = null
  outline.convert.mockClear()
})

describe('eraserMode rare branch contracts', () => {
  it('finalize 시 scope 상실과 outline 변환 실패를 각각 안전하게 종료한다', () => {
    const first = fixture()
    let current: paper.PaperScope | null = first.scope
    outline.factory = (_path, _width, scope) => largeOutline(scope)
    const onComplete = vi.fn()
    const mode = createEraserMode({ getScope: () => current, onEraseComplete: onComplete })
    mode.activate()
    first.canvas.dispatchEvent(event('pointerdown'))
    current = null
    first.canvas.dispatchEvent(event('pointerup'))
    expect(onComplete).toHaveBeenCalledTimes(1)

    const second = fixture()
    outline.factory = () => null
    const nullOutline = createEraserMode({ getScope: () => second.scope })
    nullOutline.activate()
    erase(second.canvas)
    expect(outline.convert).toHaveBeenCalled()
  })

  it('한 교차점이고 전부 내부인 Path를 삭제한다', () => {
    const { scope, canvas } = fixture()
    outline.factory = (_path, _width, currentScope) => largeOutline(currentScope)
    const target = new scope.Path.Line({ from: [50, 50], to: [80, 50], strokeColor: 'black' })
    vi.spyOn(target, 'getIntersections').mockReturnValue([{ offset: 10 }] as any)
    const mode = createEraserMode({ getScope: () => scope })
    mode.activate()
    erase(canvas)
    expect(target.parent).toBeNull()
  })

  it('닫힌 Path split 후 교차점이 사라지면 포함 판정으로 제거한다', () => {
    const { scope, canvas } = fixture()
    const eraserOutline = largeOutline(scope)
    outline.factory = () => eraserOutline
    const target = new scope.Path.Circle({ center: [80, 80], radius: 30, strokeColor: 'black' })
    const open = new scope.Path.Line({ from: [50, 80], to: [110, 80], insert: false })
    vi.spyOn(open, 'getIntersections').mockReturnValue([])
    vi.spyOn(target, 'getIntersections').mockReturnValue([
      { offset: 20 }, { offset: 40 }
    ] as any)
    vi.spyOn(target, 'splitAt').mockReturnValue(open)
    const mode = createEraserMode({ getScope: () => scope })
    mode.activate()
    erase(canvas)
    expect(open.parent).toBeNull()
  })

  it('빈 split fragment는 제거하고 detached fragment는 원래 layer에 재삽입한다', () => {
    const { scope, canvas } = fixture()
    const eraserOutline = largeOutline(scope)
    vi.spyOn(eraserOutline, 'contains').mockReturnValue(false)
    outline.factory = () => eraserOutline
    const target = new scope.Path.Line({
      from: [20, 100], to: [200, 100], strokeColor: 'red', strokeWidth: 3,
      data: { source: 'edge-fragment' }
    })
    const empty = new scope.Path({ insert: false })
    const detached = new scope.Path.Line({ from: [150, 100], to: [200, 100], insert: false })
    vi.spyOn(target, 'getIntersections').mockReturnValue([
      { offset: 100 }, { offset: 50 }
    ] as any)
    vi.spyOn(target, 'splitAt')
      .mockReturnValueOnce(empty)
      .mockReturnValueOnce(detached)
    const mode = createEraserMode({ getScope: () => scope })
    mode.activate()
    erase(canvas)
    expect(empty.parent).toBeNull()
    expect(detached.parent).toBe(scope.project.activeLayer)
    expect(detached.strokeWidth).toBe(3)
    expect(detached.data.source).toBe('edge-fragment')
  })

  it('빈 CompoundPath subtract 결과를 제거한다', () => {
    const { scope, canvas } = fixture()
    outline.factory = (_path, _width, currentScope) => largeOutline(currentScope)
    const legacy = new scope.Path.Rectangle({
      point: [20, 20], size: [100, 100], fillColor: 'black', data: { isOutline: true }
    })
    const emptyResult = new scope.CompoundPath({ insert: false })
    Object.defineProperty(emptyResult, 'area', { configurable: true, value: 10 })
    vi.spyOn(legacy, 'subtract').mockReturnValue(emptyResult)
    const mode = createEraserMode({ getScope: () => scope })
    mode.activate()
    erase(canvas)
    expect(emptyResult.parent).toBeNull()
    expect(legacy.parent).toBeNull()
  })

  it('포함 판정은 midpoint/start/end 각각의 외부 상태를 구분한다', () => {
    const { scope, canvas } = fixture()
    const eraserOutline = largeOutline(scope)
    const contains = vi.spyOn(eraserOutline, 'contains')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true).mockReturnValueOnce(false)
      .mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false)
    outline.factory = () => eraserOutline
    const targets = [40, 80, 120].map((y) =>
      new scope.Path.Line({ from: [20, y], to: [200, y], strokeColor: 'black' }))
    targets.forEach((target) => vi.spyOn(target, 'getIntersections').mockReturnValue([]))
    const mode = createEraserMode({ getScope: () => scope })
    mode.activate()
    erase(canvas)
    expect(contains).toHaveBeenCalledTimes(6)
    expect(targets.every((target) => target.parent === scope.project.activeLayer)).toBe(true)
  })

  it('pointer 좌표 변환 시 두 번째 scope 조회가 사라지면 원점으로 폴백한다', () => {
    const { scope, canvas } = fixture()
    outline.factory = (_path, _width, currentScope) => largeOutline(currentScope)
    let calls = 0
    const mode = createEraserMode({
      getScope: () => {
        calls += 1
        if (calls === 3) return null
        return scope
      }
    })
    mode.activate()
    canvas.dispatchEvent(event('pointerdown', 1, 200, 200))
    const eraserPath = scope.project.activeLayer.children.find((item) =>
      item instanceof paper.Path && item.strokeColor === null) as paper.Path
    expect(eraserPath.firstSegment.point.equals(new scope.Point(0, 0))).toBe(true)
    canvas.dispatchEvent(event('pointerup'))
  })
})
