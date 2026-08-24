import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import paper from 'paper'

const input = vi.hoisted(() => ({ stylus: false }))
const selection = vi.hoisted(() => {
  const boxes: Array<{
    hitTestHandle: ReturnType<typeof vi.fn>
    draw: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }> = []

  return {
    boxes,
    createSelectionBox: vi.fn(() => {
      const box = {
        hitTestHandle: vi.fn(() => null),
        draw: vi.fn(),
        update: vi.fn(),
        remove: vi.fn()
      }
      boxes.push(box)
      return box
    })
  }
})

vi.mock('../../src/lib/utils/inputDetection', () => ({
  isStylusInput: () => input.stylus,
  getStylusPressure: (event: PointerEvent) =>
    event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : null,
  getInputConfig: () => ({ hitTestTolerance: 17 })
}))

vi.mock('../../src/lib/canvas/selectionBox.svelte', () => ({
  createSelectionBox: selection.createSelectionBox
}))

import { createDrawingMode } from '../../src/lib/tools/drawingMode.svelte'
import { createHighlighterMode } from '../../src/lib/tools/highlighterMode.svelte'
import { createSelectionMode } from '../../src/lib/tools/selectionMode.svelte'
import { createShapeTools } from '../../src/lib/tools/shapeTools.svelte'
import { createTextMode } from '../../src/lib/tools/textMode.svelte'

type CapturedHandlers = Partial<Record<string, (event: any) => void>>

function fixture() {
  const scope = new paper.PaperScope()
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect)
  ;(canvas as any).setPointerCapture = vi.fn()
  ;(canvas as any).releasePointerCapture = vi.fn()
  document.body.append(canvas)
  scope.setup(canvas)

  const handlers: CapturedHandlers = {}
  const nativeAdd = canvas.addEventListener.bind(canvas)
  vi.spyOn(canvas, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type.startsWith('pointer') || type === 'touchstart') {
      handlers[type] = listener as (event: Event) => void
    }
    nativeAdd(type, listener, options)
  }) as typeof canvas.addEventListener)

  return { scope, canvas, handlers }
}

function pointer(type: string, options: {
  x?: number
  y?: number
  id?: number
  pointerType?: string
  pressure?: number
  button?: number
  buttons?: number
  primary?: boolean
} = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: options.x ?? 20,
    clientY: options.y ?? 30,
    pointerId: options.id ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    pressure: options.pressure ?? 0,
    button: options.button ?? 0,
    buttons: options.buttons ?? (type === 'pointerup' ? 0 : 1),
    isPrimary: options.primary ?? true
  })
}

function stalePointer(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    pointerId: null,
    clientX: 0,
    clientY: 0,
    buttons: 0,
    ...overrides
  } as unknown as PointerEvent
}

function touchStart(x = 20, y = 30): TouchEvent {
  const event = new TouchEvent('touchstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: [{ clientX: x, clientY: y }]
  })
  return event
}

beforeEach(() => {
  input.stylus = false
  selection.boxes.length = 0
  selection.createSelectionBox.mockClear()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('tool defensive branch contracts', () => {
  it('drawing은 재진입 stroke를 먼저 확정하고 기본 압력 감도와 stale move를 안전하게 처리한다', () => {
    input.stylus = true
    const { scope, canvas, handlers } = fixture()
    let currentScope: paper.PaperScope | null = scope
    const created: paper.Path[] = []
    const mode = createDrawingMode({
      getScope: () => currentScope,
      getBrush: () => ({ color: '#000000', width: 10 }),
      onPathCreated: (path) => created.push(path)
    })

    mode.cancelOperation()
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1, pointerType: 'pen', pressure: 0.3 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, pointerType: 'pen', pressure: 0.8, x: 80, y: 80 }))
    canvas.dispatchEvent(pointer('pointerdown', { id: 2, pointerType: 'pen', pressure: 0.4, x: 100, y: 100 }))
    expect(created).toHaveLength(1)
    canvas.dispatchEvent(pointer('pointermove', { id: 2, pointerType: 'pen', pressure: 0.7, x: 160, y: 160 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 2, pointerType: 'pen', x: 160, y: 160 }))
    expect(created[1].strokeWidth).toBeGreaterThan(10)

    currentScope = null
    canvas.dispatchEvent(pointer('pointerdown', { id: 3 }))
    mode.cancelOperation()
    expect(() => handlers.pointermove?.(stalePointer())).not.toThrow()
    expect(mode.isDrawing).toBe(false)
  })

  it('highlighter는 재진입·근접점 무시·동적 scope 상실과 비활성 no-op을 보장한다', () => {
    const { scope, canvas, handlers } = fixture()
    let currentScope: paper.PaperScope | null = scope
    const created: paper.Path[] = []
    const mode = createHighlighterMode({
      getScope: () => currentScope,
      getBrush: () => ({ color: '#ffff00', width: 16 }),
      onPathCreated: (path) => created.push(path)
    })

    mode.deactivate()
    mode.cancelOperation()
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, x: 80, y: 80 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, x: 81, y: 81 }))
    canvas.dispatchEvent(pointer('pointerdown', { id: 2, x: 100, y: 100 }))
    expect(created).toHaveLength(1)
    canvas.dispatchEvent(pointer('pointerup', { id: 2, x: 140, y: 140 }))

    currentScope = null
    canvas.dispatchEvent(pointer('pointerdown', { id: 3 }))
    mode.cancelOperation()
    expect(() => handlers.pointermove?.(stalePointer())).not.toThrow()
    expect(mode.isDrawing).toBe(false)
  })

  it('shape mode는 scope 상실, stale callbacks, 잘못된 런타임 shape와 빈 fill을 no-op 처리한다', () => {
    {
      const { scope, canvas } = fixture()
      let currentScope: paper.PaperScope | null = scope
      const tools = createShapeTools({ getScope: () => currentScope, getBrush: () => ({ color: '#123456', width: 2 }) })
      tools.activate('rectangle')
      currentScope = null
      canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
      expect(tools.currentShape).toBe('rectangle')
      tools.deactivate()
    }

    {
      const { scope, canvas } = fixture()
      let calls = 0
      const tools = createShapeTools({
        getScope: () => {
          calls += 1
          return calls === 3 ? null : scope
        },
        getBrush: () => ({ color: '#123456', width: 2 })
      })
      tools.activate('circle')
      canvas.dispatchEvent(pointer('pointerdown', { id: 2, x: 50, y: 50 }))
      canvas.dispatchEvent(pointer('pointerup', { id: 2, x: 80, y: 80 }))
    }

    {
      const { scope, canvas, handlers } = fixture()
      let currentScope: paper.PaperScope | null = scope
      const tools = createShapeTools({ getScope: () => currentScope, getBrush: () => ({ color: '#123456', width: 2 }) })
      tools.cancelOperation()
      tools.activate('line')
      canvas.dispatchEvent(pointer('pointerdown', { id: 3 }))
      currentScope = null
      canvas.dispatchEvent(pointer('pointermove', { id: 3, x: 80, y: 80 }))
      canvas.dispatchEvent(pointer('pointerup', { id: 3, x: 80, y: 80 }))
      tools.cancelOperation()
      handlers.pointermove?.(stalePointer())
      handlers.pointerup?.(stalePointer())
    }

    {
      const { scope, canvas } = fixture()
      const tools = createShapeTools({ getScope: () => scope, getBrush: () => ({ color: '#123456', width: 2 }) })
      tools.activate('triangle' as any)
      canvas.dispatchEvent(pointer('pointerdown', { id: 4 }))
      canvas.dispatchEvent(pointer('pointermove', { id: 4, x: 100, y: 100 }))
      canvas.dispatchEvent(pointer('pointerup', { id: 4, x: 100, y: 100 }))
      const rectangle = tools.addRectangle(0, 0, 20, 10)
      expect(rectangle?.fillColor).toBeNull()
    }
  })

  it('selection은 동일 항목 재선택과 selection UI 포인터를 상태 변화 없이 처리한다', () => {
    const { scope, canvas } = fixture()
    const item = new scope.Path.Rectangle({ point: [10, 10], size: [100, 80], strokeColor: 'black' })
    const ui = new scope.Path.Rectangle({ point: [20, 20], size: [10, 10] })
    ui.data = { isSelectionUI: true }
    const hitTest = vi.spyOn(scope.project, 'hitTest')
    const mode = createSelectionMode({ getScope: () => scope })
    mode.activate()
    mode.selectItem(item)

    hitTest.mockReturnValueOnce({ item } as any)
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 1 }))
    expect(mode.selectedItem).toBe(item)

    hitTest.mockReturnValueOnce({ item: ui } as any)
    canvas.dispatchEvent(pointer('pointerdown', { id: 2 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 2, x: 50, y: 50 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 2 }))
    expect(mode.selectedItem).toBe(item)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  })

  it('selection은 동적 scope 상실과 선택 없는 touch를 안전하게 무시한다', () => {
    {
      const { scope, canvas, handlers } = fixture()
      let currentScope: paper.PaperScope | null = scope
      const mode = createSelectionMode({ getScope: () => currentScope })
      mode.activate()
      handlers.touchstart?.(touchStart())
      currentScope = null
      canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
      handlers.touchstart?.(touchStart())
      expect(mode.hasSelection).toBe(false)
      mode.deactivate()
    }

    {
      const { scope, canvas } = fixture()
      let calls = 0
      const mode = createSelectionMode({
        getScope: () => {
          calls += 1
          return calls === 3 ? null : scope
        }
      })
      mode.activate()
      vi.spyOn(scope.project, 'hitTest').mockReturnValue(null)
      canvas.dispatchEvent(pointer('pointerdown', { id: 2 }))
      expect(mode.hasSelection).toBe(false)
    }
  })

  it('selection resize는 invalid handle과 zero style 값을 변경하지 않는다', () => {
    const { scope, canvas } = fixture()
    const mode = createSelectionMode({ getScope: () => scope })
    mode.activate()
    const box = selection.boxes.at(-1)!
    const item = new scope.Path.Rectangle({ point: [100, 100], size: [100, 80], strokeColor: null, strokeWidth: 0 })
    ;(item as any).fontSize = 0
    mode.selectItem(item)

    box.hitTestHandle.mockReturnValueOnce('bottomRight')
    canvas.dispatchEvent(pointer('pointerdown', { id: 1, x: 200, y: 180 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, x: 300, y: 260 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, x: 250, y: 220 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 1 }))
    expect(item.strokeWidth).toBe(0)
    expect((item as any).fontSize).toBeFalsy()

    box.hitTestHandle.mockReturnValueOnce('unknown')
    canvas.dispatchEvent(pointer('pointerdown', { id: 2, x: 150, y: 140 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 2, x: 180, y: 170 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 2 }))
  })

  it('selection key handler는 null target도 안전하게 통과시킨다', () => {
    const { scope } = fixture()
    let keyHandler: ((event: KeyboardEvent) => void) | null = null
    const nativeAdd = document.addEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === 'keydown') keyHandler = listener as (event: KeyboardEvent) => void
      nativeAdd(type, listener, options)
    }) as typeof document.addEventListener)
    const mode = createSelectionMode({ getScope: () => scope })
    mode.activate()
    expect(() => keyHandler?.({ target: null, key: 'Unidentified' } as unknown as KeyboardEvent)).not.toThrow()
    mode.deactivate()
  })

  it('text mode는 동적 scope 상실과 stale 포인터 콜백을 정리한다', () => {
    const { scope, canvas, handlers } = fixture()
    let currentScope: paper.PaperScope | null = scope
    const mode = createTextMode({ getScope: () => currentScope, getBrush: () => ({ color: '#000000' }) })
    mode.deactivate()
    mode.activate()

    currentScope = null
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    currentScope = scope
    canvas.dispatchEvent(pointer('pointerup', { id: 1 }))
    mode.cancelText()

    canvas.dispatchEvent(pointer('pointerdown', { id: 2 }))
    currentScope = null
    canvas.dispatchEvent(pointer('pointermove', { id: 2, x: 100, y: 100 }))
    mode.cancelOperation()
    currentScope = scope
    handlers.pointermove?.(stalePointer())
    expect(mode.pendingPosition).toBeNull()
  })

  it('text cursor의 지연 callback은 cursor 제거 후에도 no-op이다', () => {
    vi.useFakeTimers()
    const callbacks: Array<() => void> = []
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: TimerHandler) => {
      callbacks.push(callback as () => void)
      return 1 as any
    }) as typeof setInterval)

    const { scope, canvas } = fixture()
    const mode = createTextMode({ getScope: () => scope, getBrush: () => ({ color: '#000000' }) })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 1 }))
    expect(callbacks).toHaveLength(1)
    mode.cancelText()
    expect(() => callbacks[0]()).not.toThrow()
  })

  it('text cursor 요청 직전에 scope가 사라지면 입력 위치만 유지한다', () => {
    const { scope, canvas } = fixture()
    let calls = 0
    const mode = createTextMode({
      getScope: () => {
        calls += 1
        return calls === 5 ? null : scope
      },
      getBrush: () => ({ color: '#000000' })
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1, x: 30, y: 40 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 1, x: 30, y: 40 }))
    expect(mode.pendingPosition).not.toBeNull()
    expect(scope.project.activeLayer.children.some((item) => item.data?.isTextCursor)).toBe(false)
  })
})
