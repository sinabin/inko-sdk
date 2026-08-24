import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageStateManager, VALID_TRANSITIONS } from '../../src/lib/scroll/pageStateManager.svelte'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-25T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pageStateManager', () => {
  it('상태 전이 표는 모든 상태를 명시한다', () => {
    expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual([
      'error', 'idle', 'queued', 'rendered', 'rendering'
    ])
  })

  it('idle→queued→rendering→rendered 정상 전이와 scale/timestamp를 보존한다', () => {
    const manager = createPageStateManager()
    expect(manager.getState(1)).toBe('idle')
    expect(manager.getInfo(1)).toBeUndefined()
    expect(manager.transition(1, 'queued')).toBe(true)
    expect(manager.isQueued(1)).toBe(true)
    expect(manager.transition(1, 'rendering')).toBe(true)
    expect(manager.isRendering(1)).toBe(true)
    expect(manager.transition(1, 'rendered', 1.5)).toBe(true)
    expect(manager.isRendered(1)).toBe(true)
    expect(manager.getRenderedScale(1)).toBe(1.5)
    expect(manager.getInfo(1)).toMatchObject({
      state: 'rendered', scale: 1.5, timestamp: Date.now()
    })
    expect(manager.pageStates).not.toBeInstanceOf(WeakMap)
  })

  it('invalid 전이와 error 전이 조건을 경고하며 상태를 보존한다', () => {
    const manager = createPageStateManager()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(manager.transition(1, 'rendered')).toBe(false)
    expect(manager.transitionToError(1, new Error('bad'))).toBe(false)
    manager.transition(1, 'queued')
    manager.transition(1, 'rendering')
    const error = new Error('render failed')
    expect(manager.transitionToError(1, error)).toBe(true)
    expect(manager.getInfo(1)).toMatchObject({ state: 'error', error })
    expect(manager.getRenderedScale(1)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('캐시 hit·cancel·unload·retry의 허용 전이를 모두 지원한다', () => {
    const manager = createPageStateManager()
    manager.transition(1, 'queued')
    expect(manager.transition(1, 'rendered', 1)).toBe(true)
    expect(manager.transition(1, 'idle')).toBe(true)
    expect(manager.transition(1, 'queued')).toBe(true)
    expect(manager.transition(1, 'idle')).toBe(true)
    expect(manager.transition(1, 'queued')).toBe(true)
    expect(manager.transition(1, 'rendering')).toBe(true)
    expect(manager.transition(1, 'idle')).toBe(true)
    expect(manager.transition(1, 'queued')).toBe(true)
    expect(manager.transition(1, 'rendering')).toBe(true)
    expect(manager.transitionToError(1, new Error('x'))).toBe(true)
    expect(manager.transition(1, 'queued')).toBe(true)
    expect(manager.transition(1, 'rendering')).toBe(true)
    expect(manager.transitionToError(1, new Error('y'))).toBe(true)
    expect(manager.transition(1, 'idle')).toBe(true)
  })

  it('bulk 목록을 정렬하고 resetPage/resetAll로 불변 map을 교체한다', () => {
    const manager = createPageStateManager()
    for (const page of [5, 1]) {
      manager.transition(page, 'queued')
      manager.transition(page, 'rendering')
      manager.transition(page, 'rendered', 1)
    }
    for (const page of [6, 2]) manager.transition(page, 'queued')
    for (const page of [7, 3]) {
      manager.transition(page, 'queued')
      manager.transition(page, 'rendering')
    }
    expect(manager.getRenderedPages()).toEqual([1, 5])
    expect(manager.getQueuedPages()).toEqual([2, 6])
    expect(manager.getRenderingPages()).toEqual([3, 7])
    const before = manager.pageStates
    manager.resetPage(5)
    expect(manager.pageStates).not.toBe(before)
    expect(manager.getState(5)).toBe('idle')
    manager.resetPage(999)
    manager.resetAll()
    expect(manager.pageStates.size).toBe(0)
  })
})
