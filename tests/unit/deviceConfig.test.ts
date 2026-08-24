import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkMemoryWarning,
  getBufferPages,
  getCacheMemoryLimit,
  getDeviceConfig,
  getDeviceOrientation,
  getMaxRenderedPages,
  getOptimalRenderScale,
  getSafeAreaInsets,
  getViewportDimensions,
  onOrientationChange
} from '../../src/lib/utils/deviceConfig'

const originalMatchMedia = window.matchMedia

function setWindowNumber(name: 'devicePixelRatio' | 'innerHeight' | 'innerWidth', value: number) {
  Object.defineProperty(window, name, { configurable: true, value })
}

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = {
    matches,
    media: '(orientation: portrait)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    emit(next: boolean) {
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent)
    }
  }
  window.matchMedia = vi.fn(() => media as unknown as MediaQueryList)
  return media
}

afterEach(() => {
  window.matchMedia = originalMatchMedia
  document.documentElement.removeAttribute('style')
  delete (window.performance as Performance & { memory?: unknown }).memory
})

describe('deviceConfig', () => {
  it('DPR과 터치 기능을 안전한 렌더 상한으로 정규화한다', () => {
    setWindowNumber('devicePixelRatio', 3)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 2 })
    expect(getDeviceConfig()).toEqual({
      maxRenderedPages: 15,
      renderCacheMaxMB: 200,
      devicePixelRatio: 1.5,
      canvasPixelRatio: 2,
      bufferPages: 3,
      isHighDensity: true,
      isTouchDevice: true
    })

    setWindowNumber('devicePixelRatio', 0)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
    expect(getDeviceConfig()).toMatchObject({
      devicePixelRatio: 1,
      canvasPixelRatio: 1,
      isHighDensity: false
    })
  })

  it.each([
    [0.49, 25], [0.5, 20], [0.69, 20], [0.7, 15], [0.99, 15], [1, 10]
  ])('scale %s의 렌더 페이지 상한은 %s다', (scale, expected) => {
    expect(getMaxRenderedPages(scale)).toBe(expected)
  })

  it.each([
    [0.99, 200], [1, 160], [1.49, 160], [1.5, 120]
  ])('scale %s의 캐시 메모리 상한은 %sMB다', (scale, expected) => {
    expect(getCacheMemoryLimit(scale)).toBe(expected)
  })

  it('화면 높이에 따라 버퍼를 선택하고 뷰포트 치수를 반환한다', () => {
    setWindowNumber('innerWidth', 1440)
    setWindowNumber('innerHeight', 1200)
    expect(getBufferPages()).toBe(3)
    expect(getViewportDimensions()).toEqual({ width: 1440, height: 1200 })
    setWindowNumber('innerHeight', 800)
    expect(getBufferPages()).toBe(2)
    setWindowNumber('innerHeight', 600)
    expect(getBufferPages()).toBe(1)
  })

  it('CSS 안전영역을 숫자로 읽고 비어 있으면 0으로 폴백한다', () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '12px')
    document.documentElement.style.setProperty('--safe-area-inset-right', '3px')
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '8px')
    expect(getSafeAreaInsets()).toEqual({ top: 12, right: 3, bottom: 8, left: 0 })
  })

  it('최적 스케일은 제한된 PDF DPR을 적용한다', () => {
    setWindowNumber('devicePixelRatio', 2)
    expect(getOptimalRenderScale(1.2)).toBeCloseTo(1.8)
  })

  it('heap 사용률이 70%를 넘을 때만 경고한다', () => {
    const perf = window.performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
    expect(checkMemoryWarning()).toBe(false)
    perf.memory = { usedJSHeapSize: 71, jsHeapSizeLimit: 100 }
    expect(checkMemoryWarning()).toBe(true)
    perf.memory = { usedJSHeapSize: 70, jsHeapSizeLimit: 100 }
    expect(checkMemoryWarning()).toBe(false)
  })

  it('방향을 읽고 change 구독을 정확히 해제한다', () => {
    const media = mockMatchMedia(true)
    expect(getDeviceOrientation()).toBe('portrait')
    media.matches = false
    expect(getDeviceOrientation()).toBe('landscape')

    const callback = vi.fn()
    const cleanup = onOrientationChange(callback)
    media.emit(false)
    media.emit(true)
    expect(callback).toHaveBeenNthCalledWith(1, 'landscape')
    expect(callback).toHaveBeenNthCalledWith(2, 'portrait')
    cleanup()
    media.emit(false)
    expect(callback).toHaveBeenCalledTimes(2)
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
