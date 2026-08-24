import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHistoryManager } from '../../src/lib/history'
import { createPageCanvasManager } from '../../src/lib/canvas/pageCanvasManager.svelte'

function key(canvas: HTMLCanvasElement, value: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: value,
    shiftKey,
    bubbles: true,
    cancelable: true
  })
  canvas.dispatchEvent(event)
  return event
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('PageCanvasManager 키보드 편집 계약', () => {
  it('생성·선택·이동·삭제가 동일 onChange/store/history 계약을 거쳐 undo/redo된다', () => {
    const onCanvasChange = vi.fn()
    const states: Array<{ annotationCount: number; selectedIndex: number | null }> = []
    const history = createHistoryManager({ debounceMs: 20 })
    const manager = createPageCanvasManager({
      pageNum: 1,
      historyManager: history,
      onCanvasChange,
      onAccessibilityChange: (state) => states.push(state)
    })
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    manager.init(canvas, 612, 792, 1)
    canvas.focus()

    manager.setDrawingMode('rectangle')
    expect(key(canvas, 'Enter').defaultPrevented).toBe(true)
    vi.advanceTimersByTime(21)
    expect(manager.accessibilityState.annotationCount).toBe(1)
    expect(onCanvasChange).toHaveBeenCalledTimes(1)

    manager.setDrawingMode('select')
    key(canvas, 'Enter')
    expect(manager.accessibilityState.selectedIndex).toBe(1)
    const beforeMove = manager.exportJSON()
    key(canvas, 'ArrowRight')
    key(canvas, 'ArrowDown', true)
    vi.advanceTimersByTime(21)
    const afterMove = manager.exportJSON()
    expect(afterMove).not.toBe(beforeMove)
    expect(afterMove).not.toContain('isSelectionUI')

    key(canvas, 'Delete')
    vi.advanceTimersByTime(21)
    expect(manager.accessibilityState.annotationCount).toBe(0)
    expect(manager.undo()).toBe(true)
    expect(manager.accessibilityState.annotationCount).toBe(1)
    expect(manager.accessibilityState.selectedIndex).toBeNull()
    expect(manager.redo()).toBe(true)
    expect(manager.accessibilityState.annotationCount).toBe(0)
    expect(states.at(-1)?.annotationCount).toBe(0)

    manager.dispose()
    history.dispose()
  })

  it('text 도구 Enter 요청과 confirm이 중앙 PointText를 만들고 상태를 갱신한다', () => {
    const onTextInputRequest = vi.fn()
    const onCanvasChange = vi.fn()
    const manager = createPageCanvasManager({ onTextInputRequest, onCanvasChange, pageNum: 4 })
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    manager.init(canvas, 600, 800, 1)
    manager.setDrawingMode('text')
    canvas.focus()

    key(canvas, 'Enter')
    expect(onTextInputRequest).toHaveBeenCalledWith(undefined)
    manager.confirmText('키보드 텍스트')
    expect(manager.accessibilityState).toMatchObject({
      pageNumber: 4,
      annotationCount: 1,
      selectedIndex: null
    })
    expect(onCanvasChange).toHaveBeenCalledTimes(1)
    manager.dispose()
  })
})
