import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import paper from 'paper'
import { createTextMode } from '../../src/lib/tools/textMode.svelte'

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
    cancelable: true,
    clientX: options.x ?? 20,
    clientY: options.y ?? 30,
    pointerId: options.id ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    button: options.button ?? 0,
    buttons: options.buttons ?? (type === 'pointerup' ? 0 : 1),
    isPrimary: options.primary ?? true
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('textMode', () => {
  it('scope/canvas 부재를 경고하고 addTextAt은 null을 반환한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const noScope = createTextMode({ getScope: () => null, getBrush: () => ({ color: '#000' }) })
    noScope.activate()
    expect(noScope.isActive).toBe(false)
    expect(noScope.addTextAt(1, 2, 'x')).toBeNull()
    noScope.confirmText('x')
    const empty = new paper.PaperScope()
    const noCanvas = createTextMode({ getScope: () => empty, getBrush: () => ({ color: '#000' }) })
    noCanvas.activate()
    expect(noCanvas.isActive).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('addTextAt이 기본·명시 typography와 생성 callback을 보존한다', () => {
    const { scope } = scopeFixture()
    const onTextCreated = vi.fn()
    const mode = createTextMode({
      getScope: () => scope,
      getBrush: () => ({ color: '#112233' }),
      getFontSize: () => 22,
      getFontFamily: () => 'Inter',
      onTextCreated
    })
    const defaultText = mode.addTextAt(10, 20, 'default')!
    const customText = mode.addTextAt(30, 40, 'custom', {
      color: '#abcdef', fontSize: 30, fontFamily: 'serif'
    })!
    expect(defaultText.content).toBe('default')
    expect(defaultText.fillColor?.toCSS(true)).toBe('#112233')
    expect(defaultText.fontSize).toBe(22)
    expect(defaultText.fontFamily).toBe('Inter')
    expect(customText.fillColor?.toCSS(true)).toBe('#abcdef')
    expect(customText.fontSize).toBe(30)
    expect(customText.fontFamily).toBe('serif')
    expect(onTextCreated).toHaveBeenCalledTimes(2)
  })

  it('tap 새 텍스트 요청 후 confirm으로 생성하고 cursor blink를 정리한다', () => {
    const { scope, canvas } = scopeFixture()
    const onRequestInput = vi.fn()
    const onTextCreated = vi.fn()
    const mode = createTextMode({
      getScope: () => scope, getBrush: () => ({ color: '#334455' }),
      onRequestInput, onTextCreated
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { primary: false }))
    canvas.dispatchEvent(pointer('pointerdown', { button: 2 }))
    const down = pointer('pointerdown', { id: 4, x: 100, y: 120 })
    const prevent = vi.spyOn(down, 'preventDefault')
    canvas.dispatchEvent(down)
    expect(prevent).toHaveBeenCalled()
    canvas.dispatchEvent(pointer('pointermove', { id: 99, x: 200, y: 200 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 99 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 4, x: 104, y: 124 }))
    expect(onRequestInput).toHaveBeenCalledWith()
    expect(mode.pendingPosition?.x).toBeCloseTo(100)
    expect(mode.isEditing).toBe(false)
    const cursor = scope.project.activeLayer.children.find((item) => item.data?.isTextCursor)!
    expect(cursor).toBeTruthy()
    vi.advanceTimersByTime(530)
    expect(cursor.visible).toBe(false)
    mode.confirmText('  hello  ')
    expect(onTextCreated).toHaveBeenCalledTimes(1)
    expect((onTextCreated.mock.calls[0][0] as paper.PointText).content).toBe('  hello  ')
    expect(mode.pendingPosition).toBeNull()
    expect(scope.project.activeLayer.children.some((item) => item.data?.isTextCursor)).toBe(false)
  })

  it('기존 PointText tap은 수정·빈 값 삭제를 callback으로 통지한다', () => {
    const { scope, canvas } = scopeFixture()
    const existing = new scope.PointText({ point: [50, 60], content: 'old' })
    const hitTest = vi.spyOn(scope.project, 'hitTest').mockReturnValue({ item: existing } as any)
    const onRequestInput = vi.fn()
    const onTextEdit = vi.fn()
    const mode = createTextMode({
      getScope: () => scope, getBrush: () => ({ color: '#000' }), onRequestInput, onTextEdit
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1, x: 50, y: 60 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 1, x: 50, y: 60 }))
    expect(hitTest).toHaveBeenCalled()
    expect(onRequestInput).toHaveBeenCalledWith('old')
    expect(mode.isEditing).toBe(true)
    mode.confirmText('new')
    expect(existing.content).toBe('new')
    expect(onTextEdit).toHaveBeenCalledWith(existing)

    canvas.dispatchEvent(pointer('pointerdown', { id: 2, x: 50, y: 60 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 2, x: 50, y: 60 }))
    mode.confirmText('   ')
    expect(existing.parent).toBeNull()
    expect(onTextEdit).toHaveBeenCalledTimes(2)
  })

  it('drag는 좌상단 기준 pending position을 만들고 preview를 제거한다', () => {
    const { scope, canvas } = scopeFixture()
    const onRequestInput = vi.fn()
    const mode = createTextMode({
      getScope: () => scope, getBrush: () => ({ color: '#000' }), onRequestInput
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 3, x: 200, y: 100 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 3, x: 80, y: 180 }))
    const preview = scope.project.activeLayer.children.find((item) => item.data?.isPreview)
    expect(preview?.data.isSelectionUI).toBe(true)
    canvas.dispatchEvent(pointer('pointerup', { id: 3, x: 80, y: 180 }))
    expect(mode.pendingPosition?.x).toBeCloseTo(80)
    expect(mode.pendingPosition?.y).toBeCloseTo(180)
    expect(scope.project.activeLayer.children.some((item) => item.data?.isPreview)).toBe(false)
    expect(onRequestInput).toHaveBeenCalledWith()
    mode.cancelText()
    expect(mode.pendingPosition).toBeNull()
  })

  it('touch 30px threshold와 pointerup 도중 scope 상실을 안전하게 처리한다', () => {
    const { scope, canvas } = scopeFixture()
    let currentScope: paper.PaperScope | null = scope
    const onRequestInput = vi.fn()
    const mode = createTextMode({
      getScope: () => currentScope, getBrush: () => ({ color: '#000' }), onRequestInput
    })
    mode.activate()
    canvas.dispatchEvent(pointer('pointerdown', { id: 1, pointerType: 'touch', x: 10, y: 10 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 1, pointerType: 'touch', x: 30, y: 10 }))
    expect(scope.project.activeLayer.children.some((item) => item.data?.isPreview)).toBe(false)
    canvas.dispatchEvent(pointer('pointerup', { id: 1, pointerType: 'touch', x: 30, y: 10 }))
    expect(onRequestInput).toHaveBeenCalledTimes(1)
    mode.cancelText()

    canvas.dispatchEvent(pointer('pointerdown', { id: 2 }))
    currentScope = null
    canvas.dispatchEvent(pointer('pointerup', { id: 2 }))
    expect(mode.pendingPosition).toBeNull()
    currentScope = scope
  })

  it('confirm no-op/빈 신규/cancelOperation/deactivate가 모든 transient 상태를 정리한다', () => {
    const { scope, canvas } = scopeFixture()
    const onTextCreated = vi.fn()
    const mode = createTextMode({
      getScope: () => scope, getBrush: () => ({ color: '#000' }), onTextCreated
    })
    mode.activate()
    mode.confirmText('nothing pending')
    canvas.dispatchEvent(pointer('pointerdown', { id: 1 }))
    canvas.dispatchEvent(pointer('pointerup', { id: 1 }))
    mode.confirmText('   ')
    expect(onTextCreated).not.toHaveBeenCalled()
    canvas.dispatchEvent(pointer('pointerdown', { id: 2 }))
    canvas.dispatchEvent(pointer('pointermove', { id: 2, x: 200, y: 200 }))
    mode.cancelOperation()
    expect(scope.project.activeLayer.children.some((item) => item.data?.isPreview)).toBe(false)
    canvas.dispatchEvent(pointer('pointerdown', { id: 3 }))
    mode.deactivate()
    expect(mode.isActive).toBe(false)
    expect(mode.pendingPosition).toBeNull()
    mode.cancelOperation()
  })
})
