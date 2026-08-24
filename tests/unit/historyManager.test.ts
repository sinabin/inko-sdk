import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHistoryManager } from '../../src/lib/history/historyManager.svelte'

describe('historyManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts on page 1 with no history and switches the active-page view independently', () => {
    const history = createHistoryManager()

    expect(history.activePage).toBe(1)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.canUndoPage(99)).toBe(false)
    expect(history.canRedoPage(99)).toBe(false)

    history.setBaseline(1, 'page-1/base')
    history.pushSnapshot(1, 'page-1/edit')
    vi.advanceTimersByTime(300)

    expect(history.canUndo).toBe(true)
    history.setActivePage(2)
    expect(history.activePage).toBe(2)
    expect(history.canUndo).toBe(false)
    expect(history.canUndoPage(1)).toBe(true)
  })

  it('round-trips baseline and edits through undo/redo and emits only real changes', () => {
    const onHistoryChange = vi.fn()
    const history = createHistoryManager({ debounceMs: 10, onHistoryChange })

    history.setBaseline(1, 'base')
    history.pushSnapshot(1, 'edit-1')
    vi.advanceTimersByTime(10)

    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
    expect(onHistoryChange).toHaveBeenCalledTimes(1)

    expect(history.undo(1)).toBe('base')
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
    expect(history.canRedoPage(1)).toBe(true)
    expect(history.redo(1)).toBe('edit-1')
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
    expect(history.canRedoPage(1)).toBe(false)
    expect(onHistoryChange).toHaveBeenCalledTimes(3)

    history.pushSnapshot(1, 'edit-1')
    vi.advanceTimersByTime(10)
    expect(onHistoryChange).toHaveBeenCalledTimes(3)
  })

  it('keeps only the final snapshot in a debounce window', () => {
    const onHistoryChange = vi.fn()
    const history = createHistoryManager({ debounceMs: 25, onHistoryChange })

    history.setBaseline(1, 'base')
    history.pushSnapshot(1, 'stale-edit')
    vi.advanceTimersByTime(20)
    history.pushSnapshot(1, 'final-edit')

    vi.advanceTimersByTime(24)
    expect(history.canUndo).toBe(false)
    vi.advanceTimersByTime(1)

    expect(history.undo(1)).toBe('base')
    expect(history.redo(1)).toBe('final-edit')
    expect(onHistoryChange).toHaveBeenCalledTimes(3)
  })

  it('cancels a stale debounced edit when a new baseline is registered', () => {
    const history = createHistoryManager({ debounceMs: 10 })

    history.setBaseline(1, 'base-0')
    history.pushSnapshot(1, 'edit-1')
    vi.advanceTimersByTime(10)

    history.pushSnapshot(1, 'stale-pending-edit')
    history.setBaseline(1, 'replacement-baseline')
    vi.runAllTimers()

    expect(history.undo(1)).toBe('base-0')
    expect(history.redo(1)).toBe('replacement-baseline')
  })

  it('discards the oldest undo states once maxHistorySize is reached', () => {
    const history = createHistoryManager({ debounceMs: 1, maxHistorySize: 2 })

    history.setBaseline(1, 'v0')
    for (const state of ['v1', 'v2', 'v3']) {
      history.pushSnapshot(1, state)
      vi.advanceTimersByTime(1)
    }

    expect(history.undo(1)).toBe('v2')
    expect(history.undo(1)).toBe('v1')
    expect(history.undo(1)).toBeNull()
  })

  it('treats the first snapshot without a baseline as the current state, not undo history', () => {
    const onHistoryChange = vi.fn()
    const history = createHistoryManager({ debounceMs: 0, onHistoryChange })

    history.pushSnapshot(3, 'first')
    vi.runAllTimers()

    expect(history.canUndoPage(3)).toBe(false)
    expect(history.undo(3)).toBeNull()
    expect(history.redo(3)).toBeNull()
    expect(onHistoryChange).toHaveBeenCalledTimes(1)
  })

  it('clears one page without disturbing another and cancels that page pending work', () => {
    const onHistoryChange = vi.fn()
    const history = createHistoryManager({ debounceMs: 10, onHistoryChange })

    history.setBaseline(1, 'p1/base')
    history.pushSnapshot(1, 'p1/edit')
    vi.advanceTimersByTime(10)
    history.setBaseline(2, 'p2/base')
    history.pushSnapshot(2, 'p2/edit')
    vi.advanceTimersByTime(10)

    history.pushSnapshot(1, 'p1/pending')
    history.clear(1)
    vi.runAllTimers()

    expect(history.canUndoPage(1)).toBe(false)
    expect(history.undo(1)).toBeNull()
    expect(history.canUndoPage(2)).toBe(true)
    expect(history.undo(2)).toBe('p2/base')
    expect(onHistoryChange).toHaveBeenCalledTimes(4)
  })

  it('clear-all and dispose cancel every timer and reset all page state', () => {
    const onHistoryChange = vi.fn()
    const history = createHistoryManager({ debounceMs: 50, onHistoryChange })

    history.setBaseline(1, 'p1/base')
    history.setBaseline(2, 'p2/base')
    history.pushSnapshot(1, 'p1/pending')
    history.pushSnapshot(2, 'p2/pending')
    expect(vi.getTimerCount()).toBe(2)

    history.clear()
    expect(vi.getTimerCount()).toBe(0)
    expect(history.canUndoPage(1)).toBe(false)
    expect(history.canUndoPage(2)).toBe(false)
    expect(onHistoryChange).toHaveBeenCalledTimes(1)

    history.setBaseline(1, 'new/base')
    history.pushSnapshot(1, 'new/pending')
    expect(vi.getTimerCount()).toBe(1)
    history.dispose()

    expect(vi.getTimerCount()).toBe(0)
    expect(history.canUndoPage(1)).toBe(false)
    expect(onHistoryChange).toHaveBeenCalledTimes(1)
  })
})
