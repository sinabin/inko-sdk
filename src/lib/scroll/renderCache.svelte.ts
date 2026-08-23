/**
 * Render Cache - LRU 방식 렌더 캐시
 *
 * 메모리 제한: 300MB, 100페이지 (Galaxy Tab S9 FE+ 최적화)
 */

export interface CacheEntry {
  pageNum: number
  scale: number
  canvas: HTMLCanvasElement
  width: number
  height: number
  timestamp: number
  memorySize: number  // bytes
}

export interface RenderCacheOptions {
  maxMemoryMB?: number  // default: 100
  maxPages?: number     // default: 50
}

export interface CacheStats {
  hits: number
  misses: number
  evictions: number
  currentMemoryMB: number
  currentPageCount: number
}

export interface RenderCache {
  // Cache operations
  get: (pageNum: number, scale: number) => HTMLCanvasElement | null
  set: (pageNum: number, scale: number, canvas: HTMLCanvasElement) => void
  has: (pageNum: number, scale: number) => boolean
  remove: (pageNum: number) => void
  clear: () => void

  // Stats
  getStats: () => CacheStats

  // Memory management
  getCurrentMemoryMB: () => number
  evictOldest: () => void

  // Readonly state
  readonly size: number
}

// 캔버스 메모리 크기 계산 (RGBA = 4 bytes per pixel)
function calculateCanvasMemory(canvas: HTMLCanvasElement): number {
  return canvas.width * canvas.height * 4
}

// 캐시 키 생성
function getCacheKey(pageNum: number, scale: number): string {
  // scale을 소수점 2자리로 반올림하여 키 생성
  const roundedScale = Math.round(scale * 100) / 100
  return `${pageNum}_${roundedScale}`
}

export function createRenderCache(options: RenderCacheOptions = {}): RenderCache {
  const maxMemoryBytes = (options.maxMemoryMB ?? 100) * 1024 * 1024
  const maxPages = options.maxPages ?? 50

  let cache = $state<Map<string, CacheEntry>>(new Map())
  let currentMemory = $state(0)

  // Stats tracking
  let hits = 0
  let misses = 0
  let evictions = 0

  // LRU: 가장 오래된 항목 제거
  function evictOldest(): void {
    if (cache.size === 0) return

    let oldestKey: string | null = null
    let oldestTime = Infinity

    cache.forEach((entry, key) => {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    })

    if (oldestKey) {
      const entry = cache.get(oldestKey)
      if (entry) {
        currentMemory -= entry.memorySize
        const newCache = new Map(cache)
        newCache.delete(oldestKey)
        cache = newCache
        evictions++
      }
    }
  }

  // 메모리/페이지 제한 확인 및 필요시 제거
  function ensureCapacity(requiredMemory: number): void {
    // 메모리 제한 확인
    while (currentMemory + requiredMemory > maxMemoryBytes && cache.size > 0) {
      evictOldest()
    }

    // 페이지 수 제한 확인
    while (cache.size >= maxPages) {
      evictOldest()
    }
  }

  // 캐시에서 가져오기
  function get(pageNum: number, scale: number): HTMLCanvasElement | null {
    const key = getCacheKey(pageNum, scale)
    const entry = cache.get(key)

    if (entry) {
      // LRU: 접근 시 타임스탬프 업데이트
      const newCache = new Map(cache)
      newCache.set(key, { ...entry, timestamp: Date.now() })
      cache = newCache
      hits++
      return entry.canvas
    }

    misses++
    return null
  }

  // 캐시에 저장
  function set(pageNum: number, scale: number, canvas: HTMLCanvasElement): void {
    const key = getCacheKey(pageNum, scale)
    const memorySize = calculateCanvasMemory(canvas)

    // 기존 항목 제거
    const existing = cache.get(key)
    if (existing) {
      currentMemory -= existing.memorySize
    }

    // 용량 확보
    ensureCapacity(memorySize)

    // 새 항목 추가
    const newCache = new Map(cache)
    newCache.set(key, {
      pageNum,
      scale,
      canvas,
      width: canvas.width,
      height: canvas.height,
      timestamp: Date.now(),
      memorySize
    })
    cache = newCache
    currentMemory += memorySize
  }

  // 캐시에 있는지 확인
  function has(pageNum: number, scale: number): boolean {
    const key = getCacheKey(pageNum, scale)
    return cache.has(key)
  }

  // 특정 페이지의 모든 캐시 제거
  function remove(pageNum: number): void {
    const keysToRemove: string[] = []

    cache.forEach((entry, key) => {
      if (entry.pageNum === pageNum) {
        keysToRemove.push(key)
        currentMemory -= entry.memorySize
      }
    })

    if (keysToRemove.length > 0) {
      const newCache = new Map(cache)
      keysToRemove.forEach(key => newCache.delete(key))
      cache = newCache
    }
  }

  // 전체 캐시 클리어
  function clear(): void {
    cache = new Map()
    currentMemory = 0
  }

  // 통계 가져오기
  function getStats(): CacheStats {
    return {
      hits,
      misses,
      evictions,
      currentMemoryMB: currentMemory / (1024 * 1024),
      currentPageCount: cache.size
    }
  }

  // 현재 메모리 사용량 (MB)
  function getCurrentMemoryMB(): number {
    return currentMemory / (1024 * 1024)
  }

  return {
    get,
    set,
    has,
    remove,
    clear,
    getStats,
    getCurrentMemoryMB,
    evictOldest,

    get size() { return cache.size }
  }
}
