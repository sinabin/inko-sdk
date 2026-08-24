import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeRenderDpr, createScrollMode } from '../../src/lib/scroll/scrollMode.svelte'

class ObserverMock {
  static instances: ObserverMock[] = []
  callback: IntersectionObserverCallback
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  root = null
  rootMargin = ''
  thresholds = []
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    ObserverMock.instances.push(this)
  }
  emit(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

const originalObserver = globalThis.IntersectionObserver

function immediatePdf(numPages = 5) {
  const renderCalls: any[] = []
  const getPage = vi.fn(async (pageNumber: number) => ({
    pageNumber,
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
    render: (params: any) => {
      renderCalls.push(params)
      return { promise: Promise.resolve(), cancel: vi.fn() }
    }
  }))
  return { document: { numPages, getPage } as any, getPage, renderCalls }
}

async function flush(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
}

beforeEach(() => {
  ObserverMock.instances = []
  globalThis.IntersectionObserver = ObserverMock as unknown as typeof IntersectionObserver
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  globalThis.IntersectionObserver = originalObserver
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('scrollMode orchestration edges', () => {
  it('computeRenderDpr은 invalid DPR/치수와 1x 경로를 정규화한다', () => {
    expect(computeRenderDpr(100, 200, 1)).toBe(1)
    expect(computeRenderDpr(100, 200, 0)).toBe(1)
    expect(computeRenderDpr(100, 200, Number.NaN)).toBe(1)
    expect(computeRenderDpr(Number.NaN, 200, 2)).toBe(2)
    expect(computeRenderDpr(100, Number.POSITIVE_INFINITY, 2)).toBe(2)
    expect(computeRenderDpr(0, -1, 2)).toBe(2)
  })

  it('초기화 전 optional manager API와 total=0 initial render는 no-op이다', async () => {
    const mode = createScrollMode({
      getPdfDoc: () => null, getTotalPages: () => 0, getViewportScale: () => 1,
      onPageRendered: vi.fn(), onPageUnrendered: vi.fn()
    })
    mode.registerPage(1, document.createElement('div'))
    mode.unregisterPage(1)
    mode.updateTotalPages(3.9)
    mode.triggerInitialRender()
    expect(mode.visibilityManager).toBeNull()
    expect(await mode.getPageDimensions(1)).toBeNull()
    mode.requestRender(1)
    expect(mode.pageStateManager.isQueued(1)).toBe(true)
    mode.requestRender(1)
    mode.cancelRender(1)
    expect(mode.pageStateManager.getState(1)).toBe('idle')
    mode.cancelRender(999)
    mode.dispose()
    expect(mode.currentPage).toBe(1)
  })

  it('가시성 callback은 현재 페이지·buffer render·범위 밖 unload를 동기화한다', async () => {
    const pdf = immediatePdf(5)
    const onPageRendered = vi.fn()
    const onPageUnrendered = vi.fn()
    const onCurrentPageChange = vi.fn()
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document, getTotalPages: () => 5, getViewportScale: () => 1,
      onPageRendered, onPageUnrendered, onCurrentPageChange
    })
    await mode.forceRenderPage(1)
    expect(mode.pageStateManager.isRendered(1)).toBe(true)
    const container = document.createElement('div')
    mode.initialize(container)
    const page5 = document.createElement('div')
    mode.registerPage(5, page5)
    ObserverMock.instances[0].emit([{ target: page5, isIntersecting: true }])
    await flush()
    expect(mode.currentPage).toBe(5)
    expect(onCurrentPageChange).toHaveBeenCalledWith(5)
    expect(onPageUnrendered).toHaveBeenCalledWith(1)
    expect(pdf.getPage).toHaveBeenCalledWith(3)
    expect(pdf.getPage).toHaveBeenCalledWith(4)
    expect(pdf.getPage).toHaveBeenCalledWith(5)
    expect(mode.pageStateManager.isRendered(5)).toBe(true)
    mode.unregisterPage(5)
    mode.updateTotalPages(-2)
    mode.dispose()
  })

  it('범위 밖 active render를 cancel하고 near가 아니면 재queue하지 않는다', async () => {
    let rejectRender!: (error: Error) => void
    const task = {
      promise: new Promise<void>((_resolve, reject) => { rejectRender = reject }),
      cancel: vi.fn(() => {
        const error = new Error('cancelled')
        error.name = 'RenderingCancelledException'
        rejectRender(error)
      })
    }
    const pdf = {
      numPages: 5,
      getPage: vi.fn(async (pageNumber: number) => ({
        pageNumber,
        getViewport: () => ({ width: 100, height: 200 }),
        render: () => task
      }))
    } as any
    const mode = createScrollMode({
      getPdfDoc: () => pdf, getTotalPages: () => 5, getViewportScale: () => 1,
      onPageRendered: vi.fn(), onPageUnrendered: vi.fn()
    })
    const container = document.createElement('div')
    mode.initialize(container)
    mode.requestRender(1)
    await flush()
    const page5 = document.createElement('div')
    mode.registerPage(5, page5)
    ObserverMock.instances[0].emit([{ target: page5, isIntersecting: true }])
    await flush()
    expect(task.cancel).toHaveBeenCalledTimes(1)
    expect(mode.pageStateManager.getState(1)).toBe('idle')
    mode.dispose()
  })

  it('cache hit은 PDF 접근 없이 즉시 rendered callback을 호출한다', async () => {
    const pdf = immediatePdf(1)
    const rendered = vi.fn()
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document, getTotalPages: () => 1, getViewportScale: () => 1,
      onPageRendered: rendered, onPageUnrendered: vi.fn()
    })
    const cached = document.createElement('canvas')
    cached.width = 10
    cached.height = 10
    mode.renderCache.set(1, 1, cached)
    await mode.forceRenderPage(1)
    expect(pdf.getPage).not.toHaveBeenCalled()
    expect(rendered).toHaveBeenCalledWith(1, cached)
    expect(mode.pageStateManager.getRenderedScale(1)).toBe(1)
  })

  it('1x render metadata/undefined transform과 page dimensions 성공·실패를 반환한다', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
    const pdf = immediatePdf(2)
    const rendered = vi.fn()
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document, getTotalPages: () => 2, getViewportScale: () => 1,
      onPageRendered: rendered, onPageUnrendered: vi.fn()
    })
    await mode.forceRenderPage(1)
    const canvas = rendered.mock.calls[0][1] as any
    expect(canvas.__renderDpr).toBe(1)
    expect(canvas.__pdfPage.pageNumber).toBe(1)
    expect(canvas.__logicalViewport).toEqual({ width: 100, height: 200 })
    expect(canvas.__annotationCanvasMap).toBeInstanceOf(Map)
    expect(pdf.renderCalls[0].transform).toBeUndefined()
    await expect(mode.getPageDimensions(2)).resolves.toEqual({ width: 100, height: 200 })
    pdf.getPage.mockRejectedValueOnce(new Error('missing page'))
    await expect(mode.getPageDimensions(9)).resolves.toBeNull()
  })

  it('일반 getPage/render 오류를 error FSM으로 기록한다', async () => {
    const failure = new Error('load failed')
    const pdf = { numPages: 1, getPage: vi.fn(async () => { throw failure }) } as any
    const mode = createScrollMode({
      getPdfDoc: () => pdf, getTotalPages: () => 1, getViewportScale: () => 1,
      onPageRendered: vi.fn(), onPageUnrendered: vi.fn()
    })
    await mode.forceRenderPage(1)
    expect(mode.pageStateManager.getInfo(1)).toMatchObject({ state: 'error', error: failure })
    expect(console.error).toHaveBeenCalledWith('[ScrollMode] Failed to render page 1:', failure)
  })

  it('rendered scale 일치 항목은 유지하고 불일치 near 항목만 재렌더한다', async () => {
    const pdf = immediatePdf(2)
    let scale = 1
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document, getTotalPages: () => 2, getViewportScale: () => scale,
      onPageRendered: vi.fn(), onPageUnrendered: vi.fn()
    })
    const container = document.createElement('div')
    mode.initialize(container)
    await mode.forceRenderPage(1)
    await mode.forceRenderPage(2)
    const calls = pdf.getPage.mock.calls.length
    mode.handleScaleChange(1)
    expect(pdf.getPage).toHaveBeenCalledTimes(calls)
    scale = 2
    mode.handleScaleChange(2)
    await flush()
    expect(pdf.getPage.mock.calls.length).toBeGreaterThan(calls)
    expect(mode.pageStateManager.getRenderedScale(1)).toBe(2)
    mode.dispose()
  })

  it('triggerInitialRender는 총 페이지 중 최대 3개만 요청하고 중복 상태를 건너뛴다', async () => {
    const pdf = immediatePdf(10)
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document, getTotalPages: () => 10, getViewportScale: () => 1,
      onPageRendered: vi.fn(), onPageUnrendered: vi.fn(), maxConcurrentRenders: 3
    })
    mode.triggerInitialRender()
    mode.triggerInitialRender()
    await flush()
    expect(new Set(pdf.getPage.mock.calls.map(([page]) => page))).toEqual(new Set([1, 2, 3]))
    expect(mode.pageStateManager.getRenderedPages()).toEqual([1, 2, 3])
  })

  it('dispose는 scroll idle timer/listener/manager/cache를 반복 안전하게 정리한다', async () => {
    vi.useFakeTimers()
    const pdf = immediatePdf(1)
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document, getTotalPages: () => 1, getViewportScale: () => 1,
      onPageRendered: vi.fn(), onPageUnrendered: vi.fn()
    })
    const container = document.createElement('div')
    mode.initialize(container)
    vi.setSystemTime(1000)
    container.dispatchEvent(new Event('scroll'))
    mode.dispose()
    await vi.advanceTimersByTimeAsync(200)
    expect(mode.visibilityManager).toBeNull()
    expect(mode.pageStateManager.pageStates.size).toBe(0)
    expect(mode.renderCache.size).toBe(0)
    mode.dispose()
  })
})
