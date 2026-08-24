import { describe, expect, it } from 'vitest'
import { createRenderCache } from '../../src/lib/scroll/renderCache.svelte'

function canvas(width: number, height: number): HTMLCanvasElement {
  const value = document.createElement('canvas')
  value.width = width
  value.height = height
  return value
}

describe('renderCache 성능 계약', () => {
  it('페이지·스케일 조합을 최대 100개만 보존한다', () => {
    const cache = createRenderCache({ maxMemoryMB: 300, maxPages: 100 })

    for (let page = 1; page <= 101; page++) {
      cache.set(page, 1, canvas(1, 1))
      expect(cache.size).toBeLessThanOrEqual(100)
    }

    expect(cache.has(1, 1)).toBe(false)
    expect(cache.has(2, 1)).toBe(true)
    expect(cache.getStats().evictions).toBe(1)
  })

  it('조회한 항목을 최신으로 승격해 실제 LRU 순서로 축출한다', () => {
    const cache = createRenderCache({ maxMemoryMB: 10, maxPages: 3 })
    cache.set(1, 1, canvas(10, 10))
    cache.set(2, 1, canvas(10, 10))
    cache.set(3, 1, canvas(10, 10))

    expect(cache.get(1, 1)).not.toBeNull()
    cache.set(4, 1, canvas(10, 10))

    expect(cache.has(1, 1)).toBe(true)
    expect(cache.has(2, 1)).toBe(false)
    expect(cache.has(3, 1)).toBe(true)
    expect(cache.has(4, 1)).toBe(true)
  })

  it('논리 RGBA 메모리가 한도를 넘지 않으며 단일 초과 항목은 캐시하지 않는다', () => {
    const cache = createRenderCache({ maxMemoryMB: 1, maxPages: 100 })
    const oneMiB = canvas(512, 512)

    cache.set(1, 1, oneMiB)
    expect(cache.getCurrentMemoryMB()).toBe(1)

    cache.set(2, 1, canvas(512, 512))
    expect(cache.getCurrentMemoryMB()).toBeLessThanOrEqual(1)
    expect(cache.has(1, 1)).toBe(false)
    expect(cache.has(2, 1)).toBe(true)

    cache.set(3, 1, canvas(513, 513))
    expect(cache.has(3, 1)).toBe(false)
    expect(cache.getCurrentMemoryMB()).toBeLessThanOrEqual(1)
  })
})
