import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import paper from 'paper'

const selection = vi.hoisted(() => {
  const boxes: any[] = []
  const createSelectionBox = vi.fn(() => {
    const box = {
      hitTestHandle: vi.fn(() => null),
      draw: vi.fn(),
      update: vi.fn(),
      remove: vi.fn()
    }
    boxes.push(box)
    return box
  })
  return { boxes, createSelectionBox }
})

vi.mock('../../src/lib/canvas/selectionBox.svelte', () => ({
  createSelectionBox: selection.createSelectionBox
}))
vi.mock('../../src/lib/utils/inputDetection', () => ({
  getInputConfig: () => ({ hitTestTolerance: 17 })
}))

import { createSelectionMode } from '../../src/lib/tools/selectionMode.svelte'

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

function touchStart(x: number, y: number, count = 1): TouchEvent {
  const event = new TouchEvent('touchstart', { bubbles: true, cancelable: true })
  const touches = Array.from({ length: count }, () => ({ clientX: x, clientY: y }))
  Object.defineProperty(event, 'touches', { value: touches })
  return event
}

function rectangle(scope: paper.PaperScope, x = 10, y = 10, width = 100, height = 80) {
  return new scope.Path.Rectangle({
    point: [x, y], size: [width, height], strokeColor: 'black', strokeWidth: 2
  })
}

beforeEach(() => {
  selection.boxes.length = 0
  selection.createSelectionBox.mockClear()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('selectionMode', () => {
  it('scope/canvas 부재는 경고 또는 안전한 활성 상태로 처리한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const noScope = createSelectionMode({ getScope: () => null })
    noScope.activate()
    expect(noScope.isActive).toBe(false)
    const empty = new paper.PaperScope()
    const noCanvas = createSelectionMode({ getScope: () => empty })
    noCanvas.activate()
    expect(noCanvas.isActive).toBe(true)
    noCanvas.deactivate()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('직접 선택·이동·삭제 API가 selection box와 callback을 동기화한다', () => {
    const { scope } = scopeFixture()
    const onSelectionChange = vi.fn()
    const onItemModified = vi.fn()
    const onItemDeleted = vi.fn()
    const mode = createSelectionMode({
      getScope: () => scope, onSelectionChange, onItemModified, onItemDeleted
    })
    mode.activate()
    const box = selection.boxes[0]
    const item = rectangle(scope)
    const ui = rectangle(scope)
    ui.data = { isSelectionUI: true }
    mode.selectItem(ui)
    expect(mode.hasSelection).toBe(false)
    mode.moveSelected(1, 1)
    mode.deleteSelected()

    mode.selectItem(item)
    expect(mode.selectedItem).toBe(item)
    expect(mode.hasSelection).toBe(true)
    expect(box.draw).toHaveBeenCalledWith([item])
    const before = item.position.clone()
    mode.moveSelected(5, -3)
    expect(item.position.x).toBeCloseTo(before.x + 5)
    expect(item.position.y).toBeCloseTo(before.y - 3)
    expect(box.update).toHaveBeenCalledWith([item])
    expect(onItemModified).toHaveBeenCalledTimes(1)
    mode.deleteSelected()
    expect(item.parent).toBeNull()
    expect(mode.hasSelection).toBe(false)
    expect(onItemDeleted).toHaveBeenCalledTimes(1)
    mode.clearSelection()
  })

  it('pointer hit item을 최상위 Group으로 선택해 drag하고 release 시 scroll을 복원한다', () => {
    const { scope, canvas } = scopeFixture()
    const scroll = document.createElement('div')
    const onItemModified = vi.fn()
    const group = new scope.Group()
    const child = rectangle(scope)
    group.addChild(child)
    const hitTest = vi.spyOn(scope.project, 'hitTest').mockReturnValue({ item: child } as any)
    const mode = createSelectionMode({
      getScope: () => scope, getScrollContainer: () => scroll, onItemModified
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { primary: false }))
    canvas.dispatchEvent(pointer('pointerdown', { button: 2 }))
    canvas.dispatchEvent(pointer('pointerdown', { id: 4, x: 30, y: 30 }))
    expect(mode.selectedItem).toBe(group)
    expect(scroll.style.touchAction).toBe('none')
    const start = group.position.clone()
    canvas.dispatchEvent(pointer('pointermove', { id: 99, x: 100, y: 100 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 4, x: 80, y: 90 }))
    expect(group.position.equals(start)).toBe(false)
    canvas.dispatchEvent(pointer('pointerup', { id: 99 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 4 }))
    expect(onItemModified).toHaveBeenCalledTimes(1)
    expect(scroll.style.touchAction).toBe('pan-y pan-x')
    expect(hitTest).toHaveBeenCalledWith(expect.any(paper.Point), expect.objectContaining({ tolerance: 17 }))
  })

  it('cancelOperation은 drag 위치를 복원하고 빈 공간/selection UI hit은 선택하지 않는다', () => {
    const { scope, canvas } = scopeFixture()
    const scroll = document.createElement('div')
    const item = rectangle(scope)
    const ui = rectangle(scope)
    ui.data = { isSelectionUI: true }
    const hitTest = vi.spyOn(scope.project, 'hitTest')
    const mode = createSelectionMode({ getScope: () => scope, getScrollContainer: () => scroll })
    mode.activate()
    hitTest.mockReturnValueOnce({ item } as any)
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    const start = item.position.clone()
    canvas.dispatchEvent(pointer('pointermove', { id: 1, x: 100, y: 100 }))
    mode.cancelOperation()
    expect(item.position.equals(start)).toBe(true)
    expect(scroll.style.touchAction).toBe('pan-y pan-x')

    hitTest.mockReturnValueOnce({ item: ui } as any)
    canvas.dispatchEvent(pointer('pointerdown', { id: 2 }))
    expect(mode.selectedItem).toBe(item)
    hitTest.mockReturnValueOnce(null)
    canvas.dispatchEvent(pointer('pointerdown', { id: 3 }))
    expect(mode.selectedItem).toBeNull()
    mode.cancelOperation()
  })

  it.each([
    'topLeft', 'topCenter', 'topRight', 'leftCenter',
    'rightCenter', 'bottomLeft', 'bottomCenter', 'bottomRight'
  ])('%s handle resize가 균일 scale과 callback을 적용한다', (handle) => {
    const { scope, canvas } = scopeFixture()
    const scroll = document.createElement('div')
    const item = rectangle(scope, 100, 100, 100, 80)
    ;(item as any).fontSize = 16
    const onItemModified = vi.fn()
    const mode = createSelectionMode({
      getScope: () => scope, getScrollContainer: () => scroll, onItemModified
    })
    mode.activate()
    mode.selectItem(item)
    const box = selection.boxes[0]
    box.hitTestHandle.mockReturnValue(handle)
    canvas.dispatchEvent(pointer('pointerdown', { id: 5, x: 150, y: 140 }))
    expect(scroll.style.touchAction).toBe('none')
    canvas.dispatchEvent(pointer('pointermove', { id: 5, x: 260, y: 260 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 5, x: 1000, y: 1000 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 5 }))
    expect(item.bounds.width).toBeGreaterThan(0)
    expect(item.bounds.width).toBeLessThanOrEqual(1_100)
    expect(onItemModified).toHaveBeenCalledTimes(1)
    expect(box.update).toHaveBeenCalled()
  })

  it('resize startDist<1·최소크기 clamp와 cancel resize 경로를 처리한다', () => {
    const { scope, canvas } = scopeFixture()
    const item = rectangle(scope, 10, 10, 100, 80)
    const mode = createSelectionMode({ getScope: () => scope })
    mode.activate()
    mode.selectItem(item)
    const box = selection.boxes[0]
    box.hitTestHandle.mockReturnValue('topLeft')
    const anchor = item.bounds.bottomRight
    canvas.dispatchEvent(pointer('pointerdown', { id: 1, x: anchor.x, y: anchor.y }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, x: anchor.x, y: anchor.y }))
    mode.cancelOperation()

    box.hitTestHandle.mockReturnValue('bottomRight')
    canvas.dispatchEvent(pointer('pointerdown', { id: 2, x: item.bounds.bottomRight.x, y: item.bounds.bottomRight.y }))
    canvas.dispatchEvent(pointer('pointermove', { id: 2, x: item.bounds.topLeft.x + 1, y: item.bounds.topLeft.y + 1 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 2 }))
    expect(Math.min(item.bounds.width, item.bounds.height)).toBeGreaterThanOrEqual(9)
  })

  it('키보드는 편집 target을 존중하고 Delete/Backspace/Escape를 처리한다', () => {
    const { scope } = scopeFixture()
    const onItemDeleted = vi.fn()
    const mode = createSelectionMode({ getScope: () => scope, onItemDeleted })
    mode.activate()
    const item = rectangle(scope)
    mode.selectItem(item)
    for (const target of [document.createElement('input'), document.createElement('textarea')]) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    }
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    expect(item.parent).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(mode.hasSelection).toBe(false)
    mode.selectItem(item)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    expect(item.parent).toBeNull()
    expect(onItemDeleted).toHaveBeenCalledTimes(1)
  })

  it('touchstart는 단일 handle/item에서만 preventDefault한다', () => {
    const { scope, canvas } = scopeFixture()
    const item = rectangle(scope)
    const hitTest = vi.spyOn(scope.project, 'hitTest')
    const nativeAdd = canvas.addEventListener.bind(canvas)
    let touchHandler: EventListener | null = null
    vi.spyOn(canvas, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'touchstart') {
        touchHandler = listener as EventListener
        return
      }
      nativeAdd(type, listener, options)
    })
    const mode = createSelectionMode({ getScope: () => scope })
    mode.activate()
    mode.selectItem(item)
    const box = selection.boxes[0]
    const dispatchTouch = (event: TouchEvent) => touchHandler!(event)

    const multi = touchStart(10, 10, 2)
    const multiPrevent = vi.spyOn(multi, 'preventDefault')
    dispatchTouch(multi)
    expect(multiPrevent).not.toHaveBeenCalled()

    box.hitTestHandle.mockReturnValueOnce('topLeft')
    const handleTouch = touchStart(10, 10)
    const handlePrevent = vi.spyOn(handleTouch, 'preventDefault')
    dispatchTouch(handleTouch)
    expect(handlePrevent).toHaveBeenCalled()

    box.hitTestHandle.mockReturnValue(null)
    hitTest.mockReturnValueOnce({ item } as any)
    const itemTouch = touchStart(20, 20)
    const itemPrevent = vi.spyOn(itemTouch, 'preventDefault')
    dispatchTouch(itemTouch)
    expect(itemPrevent).toHaveBeenCalled()

    const ui = rectangle(scope)
    ui.data = { isSelectionUI: true }
    hitTest.mockReturnValueOnce({ item: ui } as any).mockReturnValueOnce(null)
    const uiTouch = touchStart(30, 30)
    const uiPrevent = vi.spyOn(uiTouch, 'preventDefault')
    dispatchTouch(uiTouch)
    expect(uiPrevent).not.toHaveBeenCalled()
    const emptyTouch = touchStart(40, 40)
    const emptyPrevent = vi.spyOn(emptyTouch, 'preventDefault')
    dispatchTouch(emptyTouch)
    expect(emptyPrevent).not.toHaveBeenCalled()
  })

  it('selection UI parent인 child는 top-level 승격하지 않고 toggle/deactivate가 listener를 정리한다', () => {
    const { scope, canvas } = scopeFixture()
    const uiGroup = new scope.Group()
    uiGroup.data = { isSelectionUI: true }
    const child = rectangle(scope)
    uiGroup.addChild(child)
    vi.spyOn(scope.project, 'hitTest').mockReturnValue({ item: child } as any)
    const mode = createSelectionMode({ getScope: () => scope })
    mode.toggle()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    expect(mode.selectedItem).toBe(child)
    mode.toggle()
    expect(mode.isActive).toBe(false)
    mode.cancelOperation()
    mode.deactivate()
  })
})
