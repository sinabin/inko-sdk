import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeRenderDpr,
  createScrollMode,
  PDFJS_ANNOTATION_MODE_ENABLE_FORMS
} from '../../src/lib/scroll/scrollMode.svelte'

interface DeferredRender {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
  cancel: ReturnType<typeof vi.fn>
  settled: boolean
}

function deferredRender(onStart: () => void, onSettle: () => void): DeferredRender {
  let resolvePromise!: () => void
  let rejectPromise!: (error: Error) => void
  const task: DeferredRender = {
    promise: new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    }).finally(onSettle),
    resolve: () => {
      if (task.settled) return
      task.settled = true
      resolvePromise()
    },
    reject: (error) => {
      if (task.settled) return
      task.settled = true
      rejectPromise(error)
    },
    cancel: vi.fn(),
    settled: false
  }
  task.cancel.mockImplementation(() => {
    const error = new Error('cancelled')
    error.name = 'RenderingCancelledException'
    task.reject(error)
  })
  onStart()
  return task
}

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

function createDeferredPdf(totalPages: number) {
  let active = 0
  let peak = 0
  const tasks: DeferredRender[] = []
  const renderCalls: Record<string, unknown>[] = []
  const getPage = vi.fn(async (pageNumber: number) => ({
    pageNumber,
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
    render: (parameters: Record<string, unknown>) => {
      renderCalls.push(parameters)
      const task = deferredRender(
        () => {
          active++
          peak = Math.max(peak, active)
        },
        () => { active-- }
      )
      tasks.push(task)
      return task
    }
  }))

  return {
    document: { numPages: totalPages, getPage } as any,
    getPage,
    tasks,
    renderCalls,
    get active() { return active },
    get peak() { return peak }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('scrollMode 성능 계약', () => {
  it('고해상도 렌더를 동시에 최대 3개만 실행한다', async () => {
    const pdf = createDeferredPdf(8)
    const rendered: number[] = []
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 8,
      getViewportScale: () => 1,
      onPageRendered: (page) => rendered.push(page),
      onPageUnrendered: () => {},
      maxConcurrentRenders: 3
    })

    for (let page = 1; page <= 8; page++) mode.requestRender(page)
    await flushMicrotasks()
    expect(pdf.peak).toBe(3)
    expect(pdf.active).toBe(3)

    while (rendered.length < 8) {
      const next = pdf.tasks.find((task) => !task.settled)
      expect(next).toBeDefined()
      next!.resolve()
      await flushMicrotasks()
      expect(pdf.peak).toBeLessThanOrEqual(3)
    }

    expect(rendered).toHaveLength(8)
    mode.dispose()
  })

  it('logical viewport와 DPR transform에 ENABLE_FORMS/공용 annotationCanvasMap을 전달한다', async () => {
    const pdf = createDeferredPdf(1)
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 1,
      getViewportScale: () => 1.25,
      onPageRendered: () => {},
      onPageUnrendered: () => {}
    })

    mode.requestRender(1)
    await flushMicrotasks()
    expect(PDFJS_ANNOTATION_MODE_ENABLE_FORMS).toBe(2)
    expect(pdf.renderCalls[0]).toEqual(expect.objectContaining({
      annotationMode: PDFJS_ANNOTATION_MODE_ENABLE_FORMS,
      annotationCanvasMap: expect.any(Map)
    }))
    expect((pdf.renderCalls[0]!.viewport as { width: number }).width).toBe(765)

    pdf.tasks[0]!.resolve()
    await flushMicrotasks()
    mode.dispose()
  })

  it('1500px/s 초과 스크롤 중 큐를 멈추고 150ms idle 뒤 재개한다', async () => {
    vi.useFakeTimers()
    const pdf = createDeferredPdf(1)
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 1,
      getViewportScale: () => 1,
      onPageRendered: () => {},
      onPageUnrendered: () => {}
    })
    const container = document.createElement('div')
    mode.initialize(container)

    vi.setSystemTime(new Date(1_000))
    container.scrollTop = 0
    container.dispatchEvent(new Event('scroll'))
    vi.setSystemTime(new Date(1_010))
    container.scrollTop = 20
    container.dispatchEvent(new Event('scroll'))
    expect(mode.isScrollingFast).toBe(true)

    mode.requestRender(1)
    await flushMicrotasks()
    expect(pdf.getPage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(149)
    expect(pdf.getPage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flushMicrotasks()
    expect(pdf.getPage).toHaveBeenCalledTimes(1)
    expect(mode.isScrollingFast).toBe(false)

    pdf.tasks[0]!.resolve()
    await flushMicrotasks()
    mode.dispose()
  })

  it('빠른 스크롤 중 취소한 대기 작업은 idle 뒤에도 시작하지 않는다', async () => {
    vi.useFakeTimers()
    const pdf = createDeferredPdf(1)
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 1,
      getViewportScale: () => 1,
      onPageRendered: () => {},
      onPageUnrendered: () => {}
    })
    const container = document.createElement('div')
    mode.initialize(container)

    vi.setSystemTime(new Date(1_000))
    container.dispatchEvent(new Event('scroll'))
    vi.setSystemTime(new Date(1_010))
    container.scrollTop = 20
    container.dispatchEvent(new Event('scroll'))

    mode.requestRender(1)
    mode.cancelRender(1)
    expect(mode.pageStateManager.getState(1)).toBe('idle')
    await vi.advanceTimersByTimeAsync(200)
    await flushMicrotasks()

    expect(pdf.getPage).not.toHaveBeenCalled()
    mode.dispose()
  })

  it('dispose가 진행 중인 렌더 작업을 취소한다', async () => {
    const pdf = createDeferredPdf(1)
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 1,
      getViewportScale: () => 1,
      onPageRendered: () => {},
      onPageUnrendered: () => {}
    })

    mode.requestRender(1)
    await flushMicrotasks()
    expect(pdf.tasks).toHaveLength(1)
    mode.dispose()
    expect(pdf.tasks[0]!.cancel).toHaveBeenCalledTimes(1)
    await flushMicrotasks()
  })

  it('cancel 요청 뒤 늦게 완료된 render는 dispose된 cache·FSM·callback을 되살리지 않는다', async () => {
    let resolveRender!: () => void
    const task = {
      promise: new Promise<void>((resolve) => { resolveRender = resolve }),
      // pdf.js cancellation이 이미 완료 직전인 작업을 항상 reject한다는 전제에 기대지 않는다.
      cancel: vi.fn()
    }
    const pdf = {
      numPages: 1,
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 612, height: 792 }),
        render: () => task
      }))
    } as any
    const onPageRendered = vi.fn()
    const mode = createScrollMode({
      getPdfDoc: () => pdf,
      getTotalPages: () => 1,
      getViewportScale: () => 1,
      onPageRendered,
      onPageUnrendered: () => {}
    })

    mode.requestRender(1)
    await flushMicrotasks()
    mode.dispose()
    expect(task.cancel).toHaveBeenCalledTimes(1)

    resolveRender()
    await flushMicrotasks(16)

    expect(onPageRendered).not.toHaveBeenCalled()
    expect(mode.renderCache.size).toBe(0)
    expect(mode.pageStateManager.pageStates.size).toBe(0)
  })

  it('dispose 후 재initialize해도 이전 세대 완료가 새 페이지 task·FSM을 침범하지 않는다', async () => {
    const tasks: Array<{ promise: Promise<void>; resolve: () => void; cancel: ReturnType<typeof vi.fn> }> = []
    const pdf = {
      numPages: 1,
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 612, height: 792 }),
        render: () => {
          let resolve!: () => void
          const task = {
            promise: new Promise<void>((done) => { resolve = done }),
            resolve: () => resolve(),
            cancel: vi.fn()
          }
          tasks.push(task)
          return task
        }
      }))
    } as any
    const onPageRendered = vi.fn()
    const mode = createScrollMode({
      getPdfDoc: () => pdf,
      getTotalPages: () => 1,
      getViewportScale: () => 1,
      onPageRendered,
      onPageUnrendered: () => {}
    })

    mode.requestRender(1)
    await flushMicrotasks()
    mode.dispose()

    mode.initialize(document.createElement('div'))
    mode.requestRender(1)
    await flushMicrotasks()
    expect(tasks).toHaveLength(2)
    expect(mode.pageStateManager.getState(1)).toBe('rendering')

    tasks[0]!.resolve()
    await flushMicrotasks(16)
    expect(onPageRendered).not.toHaveBeenCalled()
    expect(mode.renderCache.size).toBe(0)
    expect(mode.pageStateManager.getState(1)).toBe('rendering')

    tasks[1]!.resolve()
    await flushMicrotasks(16)
    expect(onPageRendered).toHaveBeenCalledTimes(1)
    expect(mode.pageStateManager.getState(1)).toBe('rendered')
    mode.dispose()
  })

  it('초기 fit-width로 scale이 바뀌면 stale 결과를 폐기하고 최신 scale로 다시 렌더한다', async () => {
    const pdf = createDeferredPdf(1)
    const rendered: HTMLCanvasElement[] = []
    let scale = 1
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 1,
      getViewportScale: () => scale,
      onPageRendered: (_page, canvas) => rendered.push(canvas),
      onPageUnrendered: () => {}
    })

    mode.requestRender(1)
    await flushMicrotasks()
    expect(pdf.tasks).toHaveLength(1)

    scale = 2
    pdf.tasks[0]!.resolve()
    await flushMicrotasks(16)

    expect(pdf.getPage).toHaveBeenCalledTimes(2)
    expect(pdf.tasks).toHaveLength(2)
    expect(rendered).toHaveLength(0)

    pdf.tasks[1]!.resolve()
    await flushMicrotasks(16)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]!.width).toBe(1_224)
    expect(mode.pageStateManager.getRenderedScale(1)).toBe(2)
    mode.dispose()
  })

  it('scale 변경으로 진행 중 작업을 cancel해도 초기 페이지를 최신 scale로 재queue한다', async () => {
    const pdf = createDeferredPdf(1)
    let scale = 1
    const rendered: HTMLCanvasElement[] = []
    const mode = createScrollMode({
      getPdfDoc: () => pdf.document,
      getTotalPages: () => 1,
      getViewportScale: () => scale,
      onPageRendered: (_page, canvas) => rendered.push(canvas),
      onPageUnrendered: () => {}
    })

    mode.requestRender(1)
    await flushMicrotasks()
    scale = 2
    mode.handleScaleChange(scale)
    await flushMicrotasks(16)

    expect(pdf.tasks[0]!.cancel).toHaveBeenCalledTimes(1)
    expect(pdf.getPage).toHaveBeenCalledTimes(2)
    expect(pdf.tasks).toHaveLength(2)

    pdf.tasks[1]!.resolve()
    await flushMicrotasks(16)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]!.width).toBe(1_224)
    expect(mode.pageStateManager.getRenderedScale(1)).toBe(2)
    mode.dispose()
  })
})

describe('scrollMode DPR 상한', () => {
  it('기기 DPR을 2.5로 제한한다', () => {
    expect(computeRenderDpr(612, 792, 3)).toBe(2.5)
  })

  it('고배율 페이지의 backing dimension을 4096px 이하로 낮춘다', () => {
    const dpr = computeRenderDpr(3_000, 4_000, 3)
    expect(3_000 * dpr).toBeLessThanOrEqual(4_096)
    expect(4_000 * dpr).toBeLessThanOrEqual(4_096)
  })

  it('CSS 크기 자체가 4096px을 넘어도 실제 backing dimension 상한을 지킨다', () => {
    const dpr = computeRenderDpr(5_000, 7_000, 2)
    expect(5_000 * dpr).toBeLessThanOrEqual(4_096)
    expect(7_000 * dpr).toBeLessThanOrEqual(4_096)
    expect(dpr).toBeLessThan(1)
  })
})
