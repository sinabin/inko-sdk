import { describe, expect, it } from 'vitest'
import { createRenderCache } from '../../src/lib/scroll/renderCache.svelte'

function canvas(width: number, height: number): HTMLCanvasElement {
  const value = document.createElement('canvas')
  value.width = width
  value.height = height
  return value
}

describe('renderCache full contract', () => {
  it('scale key를 소수 2자리로 정규화하고 hit/miss 통계를 기록한다', () => {
    const cache = createRenderCache({ maxMemoryMB: 1, maxPages: 3 })
    const value = canvas(10, 20)
    cache.set(1, 1.234, value)
    expect(cache.has(1, 1.23)).toBe(true)
    expect(cache.get(1, 1.2349)).toBe(value)
    expect(cache.get(2, 1)).toBeNull()
    expect(cache.getStats()).toMatchObject({ hits: 1, misses: 1, currentPageCount: 1 })
    expect(cache.getCurrentMemoryMB()).toBeCloseTo(800 / 1024 / 1024)
  })

  it('같은 key 교체 시 기존 메모리를 빼고 새 canvas만 유지한다', () => {
    const cache = createRenderCache({ maxMemoryMB: 1, maxPages: 2 })
    const first = canvas(10, 10)
    const replacement = canvas(20, 20)
    cache.set(1, 1, first)
    cache.set(1, 1, replacement)
    expect(cache.size).toBe(1)
    expect(cache.get(1, 1)).toBe(replacement)
    expect(cache.getCurrentMemoryMB()).toBeCloseTo(1600 / 1024 / 1024)
  })

  it('page 제거는 해당 page의 모든 scale만 제거하고 빈 제거는 no-op이다', () => {
    const cache = createRenderCache({ maxMemoryMB: 1, maxPages: 5 })
    cache.set(1, 1, canvas(10, 10))
    cache.set(1, 2, canvas(20, 20))
    cache.set(2, 1, canvas(30, 30))
    cache.remove(1)
    expect(cache.has(1, 1)).toBe(false)
    expect(cache.has(1, 2)).toBe(false)
    expect(cache.has(2, 1)).toBe(true)
    const memory = cache.getCurrentMemoryMB()
    cache.remove(999)
    expect(cache.getCurrentMemoryMB()).toBe(memory)
  })

  it('0 page/0 memory/비유한 메모리 항목을 거부하고 빈 evict가 안전하다', () => {
    const zeroPages = createRenderCache({ maxMemoryMB: 1, maxPages: 0 })
    zeroPages.set(1, 1, canvas(1, 1))
    expect(zeroPages.size).toBe(0)
    zeroPages.evictOldest()

    const zeroMemory = createRenderCache({ maxMemoryMB: -1, maxPages: 2 })
    zeroMemory.set(1, 1, canvas(1, 1))
    expect(zeroMemory.size).toBe(0)

    const invalid = createRenderCache({ maxMemoryMB: 1, maxPages: 2 })
    invalid.set(1, 1, { width: Number.NaN, height: 1 } as HTMLCanvasElement)
    expect(invalid.size).toBe(0)
  })

  it('clear는 entries/memory를 비우고 누적 통계는 보존한다', () => {
    const cache = createRenderCache()
    cache.set(1, 1, canvas(10, 10))
    cache.get(1, 1)
    cache.get(2, 1)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.getCurrentMemoryMB()).toBe(0)
    expect(cache.getStats()).toMatchObject({ hits: 1, misses: 1, currentPageCount: 0 })
    cache.evictOldest()
  })
})
