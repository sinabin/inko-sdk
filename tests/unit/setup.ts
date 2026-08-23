/**
 * Vitest setup — jsdom 환경에서 누락된 폴리필·전역 mock 제공
 */
import { vi } from 'vitest'

// jsdom에 누락된 API 보강
if (typeof window !== 'undefined') {
  // matchMedia
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })
  }

  // IntersectionObserver
  if (!('IntersectionObserver' in window)) {
    class MockIntersectionObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      takeRecords = vi.fn(() => [])
      root = null
      rootMargin = ''
      thresholds = []
    }
    ;(window as any).IntersectionObserver = MockIntersectionObserver
  }

  // ResizeObserver
  if (!('ResizeObserver' in window)) {
    class MockResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    ;(window as any).ResizeObserver = MockResizeObserver
  }

  // requestAnimationFrame
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number
    window.cancelAnimationFrame = (id: number) => clearTimeout(id)
  }

  // Canvas 2D context — jsdom 미제공. Paper.js 데이터 계층(Project·Path·exportJSON)은
  // 실제 그리기 호출 결과에 의존하지 않으므로 no-op stub으로 충분.
  if (typeof HTMLCanvasElement !== 'undefined') {
    const proto = HTMLCanvasElement.prototype as any
    if (!proto.getContext || proto.getContext.toString().includes('[native code]') === false) {
      // 이미 패치된 경우 건너뜀 (멱등)
    }
    const noop = () => {}
    const ctxStub: any = {
      canvas: null as any,
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
      font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
      shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0,
      filter: 'none', imageSmoothingEnabled: true,
      save: noop, restore: noop, beginPath: noop, closePath: noop,
      moveTo: noop, lineTo: noop, bezierCurveTo: noop, quadraticCurveTo: noop,
      arc: noop, arcTo: noop, ellipse: noop, rect: noop,
      fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
      fillText: noop, strokeText: noop, measureText: () => ({ width: 0 } as TextMetrics),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' }),
      putImageData: noop, createImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      drawImage: noop, isPointInPath: () => false, isPointInStroke: () => false,
      translate: noop, rotate: noop, scale: noop, transform: noop, setTransform: noop, resetTransform: noop,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, is2D: true, isIdentity: true,
        multiply: noop, invertSelf: noop, translateSelf: noop, rotateSelf: noop, scaleSelf: noop }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null,
      setLineDash: noop, getLineDash: () => [] as number[], lineDashOffset: 0
    }
    proto.getContext = function (this: HTMLCanvasElement, type: string) {
      if (type === '2d') {
        const ctx = Object.create(ctxStub)
        ctx.canvas = this
        return ctx
      }
      return null
    }
  }
}
