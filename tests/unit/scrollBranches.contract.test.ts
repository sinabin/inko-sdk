import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLowResPreview } from '../../src/lib/scroll/lowResPreview.svelte'
import { computeRenderDpr, createScrollMode } from '../../src/lib/scroll/scrollMode.svelte'

class ObserverHarness {
  static instances: ObserverHarness[] = []

  readonly callback: IntersectionObserverCallback
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()
  readonly takeRecords = vi.fn(() => [])
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: number[] = []

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    ObserverHarness.instances.push(this)
  }

  emit(entries: Array<{ target: Element; isIntersecting: boolean }>): void {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

const originalObserver = globalThis.IntersectionObserver

async function flushMicrotasks(rounds = 16): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve()
}

function resolvedPdf(totalPages = 5) {
  const renderCalls: Array<Record<string, unknown>> = []
  const getPage = vi.fn(async (pageNum: number) => ({
    pageNum,
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
    render: (parameters: Record<string, unknown>) => {
      renderCalls.push(parameters)
      return { promise: Promise.resolve(), cancel: vi.fn() }
    }
  }))

  return {
    document: { numPages: totalPages, getPage } as any,
    getPage,
    renderCalls
  }
}

function previewPdf(numPages: number) {
  return {
    numPages,
    getPage: vi.fn(async () => ({
      getViewport: () => ({ width: 90, height: 120 }),
      render: () => ({ promise: Promise.resolve() })
    }))
  } as any
}

beforeEach(() => {
  ObserverHarness.instances = []
  globalThis.IntersectionObserver = ObserverHarness as unknown as typeof IntersectionObserver
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  globalThis.IntersectionObserver = originalObserver
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('scroll lifecycle branch contracts', () => {
  it('환경 기본 DPR이 없거나 0이면 1x로 복구한다', () => {
    vi.stubGlobal('window', { devicePixelRatio: 0 })
    expect(computeRenderDpr(100, 200)).toBe(1)
    vi.unstubAllGlobals()

    vi.stubGlobal('window', undefined)
    expect(computeRenderDpr(100, 200)).toBe(1)
  })

  it('2x 환경은 PDF 렌더 태스크에 backing-store transform을 전달한다', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })

    try {
      const pdf = resolvedPdf(1)
      const mode = createScrollMode({
        getPdfDoc: () => pdf.document,
        getTotalPages: () => 1,
        getViewportScale: () => 1,
        onPageRendered: vi.fn(),
        onPageUnrendered: vi.fn()
      })

      await mode.forceRenderPage(1)

      expect(pdf.renderCalls[0]?.transform).toEqual([2, 0, 0, 2, 0, 0])
      mode.dispose()
    } finally {
      if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor)
    }
  })

  it('dispose 뒤 도착한 stale observer callback을 안전하게 무시한다', () => {
    const pdf = resolvedPdf(1)
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 1,
      getViewportScale: () => 1,
      onPageRendered: vi.fn(),
      onPageUnrendered: vi.fn()
    })
    const container = document.createElement('div')
    const page = document.createElement('div')

    mode.initialize(container)
    mode.registerPage(1, page)
    const observer = ObserverHarness.instances[0]!
    mode.dispose()

    expect(() => observer.emit([{ target: page, isIntersecting: true }])).not.toThrow()
    expect(pdf.getPage).not.toHaveBeenCalled()
  })

  it('상단 가시 범위는 이미 렌더된 페이지를 건너뛰고 아래쪽 렌더·작업을 해제한다', async () => {
    let rejectPage4!: (error: Error) => void
    const page4Task = {
      promise: new Promise<void>((_resolve, reject) => { rejectPage4 = reject }),
      cancel: vi.fn(() => {
        const error = new Error('outside buffered range')
        error.name = 'RenderingCancelledException'
        rejectPage4(error)
      })
    }
    const getPage = vi.fn(async (pageNum: number) => ({
      pageNum,
      getViewport: () => ({ width: 100, height: 200 }),
      render: () => pageNum === 4
        ? page4Task
        : { promise: Promise.resolve(), cancel: vi.fn() }
    }))
    const pdf = { numPages: 5, getPage } as any
    const onPageUnrendered = vi.fn()
    const onCurrentPageChange = vi.fn()
    const mode = createScrollMode({
      getPdfDoc: () => pdf,
      getTotalPages: () => 5,
      getViewportScale: () => 1,
      onPageRendered: vi.fn(),
      onPageUnrendered,
      onCurrentPageChange
    })

    await mode.forceRenderPage(1)
    await mode.forceRenderPage(5)
    mode.requestRender(4)
    await flushMicrotasks()

    const container = document.createElement('div')
    const page1 = document.createElement('div')
    mode.initialize(container)
    mode.registerPage(1, page1)
    ObserverHarness.instances[0]!.emit([{ target: page1, isIntersecting: true }])
    await flushMicrotasks()

    expect(mode.currentPage).toBe(1)
    expect(onCurrentPageChange).not.toHaveBeenCalled()
    expect(onPageUnrendered).toHaveBeenCalledWith(5)
    expect(page4Task.cancel).toHaveBeenCalledTimes(1)
    expect(mode.pageStateManager.getState(4)).toBe('idle')
    mode.dispose()
  })

  it('빠른 스크롤로 멈춘 큐는 상태 재설정 경쟁에서도 중복 삽입되지 않고 강제 렌더된다', async () => {
    vi.useFakeTimers()
    const pdf = resolvedPdf(1)
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 1,
      getViewportScale: () => 1,
      onPageRendered: vi.fn(),
      onPageUnrendered: vi.fn()
    })
    const container = document.createElement('div')
    mode.initialize(container)

    vi.setSystemTime(1_000)
    container.dispatchEvent(new Event('scroll'))
    vi.setSystemTime(1_010)
    container.scrollTop = 20
    container.dispatchEvent(new Event('scroll'))
    expect(mode.isScrollingFast).toBe(true)

    mode.requestRender(1)
    mode.pageStateManager.resetPage(1)
    mode.requestRender(1)
    await mode.forceRenderPage(1)

    expect(pdf.getPage).toHaveBeenCalledTimes(1)
    expect(mode.pageStateManager.isRendered(1)).toBe(true)
    mode.dispose()
  })
})

describe('low-resolution preview generation branch contracts', () => {
  beforeEach(() => {
    let nextUrl = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:branch-${++nextUrl}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob(['preview'], { type: 'image/jpeg' }))
    })
  })

  it('캐시 hit 배치가 clear와 경합하면 배치 완료 지점에서 stale 세대를 폐기한다', async () => {
    const pdf = previewPdf(1)
    const preview = createLowResPreview()
    await preview.generateSinglePreview(pdf, 1)

    const generation = preview.generateAllPreviews(pdf)
    preview.clearPreviews()
    await generation

    expect(preview.getCacheSize()).toBe(0)
    expect(preview.generationProgress).toBe(0)
  })

  it('진행률 callback에서 clear되면 다음 배치는 작업 시작 전에 stale로 종료된다', async () => {
    const pdf = previewPdf(6)
    const preview = createLowResPreview()
    for (let pageNum = 1; pageNum <= 5; pageNum += 1) {
      await preview.generateSinglePreview(pdf, pageNum)
    }
    const callsBeforeBatch = pdf.getPage.mock.calls.length

    await preview.generateAllPreviews(pdf, () => preview.clearPreviews())

    expect(pdf.getPage).toHaveBeenCalledTimes(callsBeforeBatch)
    expect(preview.getCacheSize()).toBe(0)
    expect(preview.isGenerating).toBe(false)
  })

  it('페이지 조회가 canvas 생성 전에 실패하면 빈 finally 경로로 원 오류를 보존한다', async () => {
    const failure = new Error('page unavailable')
    const pdf = { numPages: 1, getPage: vi.fn(async () => { throw failure }) } as any
    const preview = createLowResPreview()

    await expect(preview.generateSinglePreview(pdf, 1)).rejects.toBe(failure)
    expect(console.warn).toHaveBeenCalledWith(
      '[LowResPreview] 페이지 1 프리뷰 생성 실패:',
      failure
    )
  })
})
