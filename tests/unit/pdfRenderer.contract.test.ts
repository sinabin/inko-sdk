import { beforeEach, describe, expect, it, vi } from 'vitest'

const errors = vi.hoisted(() => ({ reportError: vi.fn() }))
vi.mock('../../src/lib/utils/errorReporter.svelte', () => errors)

import { createPdfRenderer } from '../../src/lib/pdf/pdfRenderer.svelte'

function context() {
  return {
    scale: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: ''
  } as unknown as CanvasRenderingContext2D
}

function canvasFixture(ctx: CanvasRenderingContext2D | null = context()) {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx)
  return canvas
}

function pageFixture(options: {
  pageNumber?: number
  width?: number
  height?: number
  render?: (params: any) => any
} = {}) {
  const { pageNumber = 2, width = 400, height = 600 } = options
  return {
    pageNumber,
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale })),
    render: vi.fn(options.render ?? (() => ({ promise: Promise.resolve(), cancel: vi.fn() })))
  } as any
}

beforeEach(() => {
  errors.reportError.mockClear()
})

describe('pdfRenderer render contract', () => {
  it('DPR 제한·canvas/CSS/context·intent를 적용하고 성공 상태를 기록한다', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 })
    const ctx = context()
    const canvas = canvasFixture(ctx)
    const task = { promise: Promise.resolve(), cancel: vi.fn() }
    const page = pageFixture({ render: () => task })
    const renderer = createPdfRenderer()
    await expect(renderer.renderPage(page, canvas, { scale: 1.25, intent: 'print' })).resolves.toBe(true)
    expect(canvas.width).toBe(750)
    expect(canvas.height).toBe(1125)
    expect(canvas.style.width).toBe('500px')
    expect(canvas.style.height).toBe('750px')
    expect(ctx.scale).toHaveBeenCalledWith(1.5, 1.5)
    expect(ctx.fillStyle).toBe('white')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 500, 750)
    expect(page.render).toHaveBeenCalledWith(expect.objectContaining({
      canvasContext: ctx, intent: 'print', canvas
    }))
    expect(renderer.lastRenderedPage).toBe(2)
    expect(renderer.lastRenderedScale).toBe(1.25)
    expect(renderer.isAlreadyRendered(2, 1.25)).toBe(true)
    expect(renderer.isRendering).toBe(false)
  })

  it('진행 중 task를 cancel하고 cancelRender/reset도 예외를 격리한다', async () => {
    let resolve!: () => void
    const task = {
      promise: new Promise<void>((done) => { resolve = done }),
      cancel: vi.fn(() => { throw new Error('cancel unavailable') })
    }
    const renderer = createPdfRenderer()
    const pending = renderer.renderPage(pageFixture({ render: () => task }), canvasFixture(), {
      devicePixelRatio: 1
    })
    expect(renderer.isRendering).toBe(true)
    expect(() => renderer.cancelRender()).not.toThrow()
    expect(task.cancel).toHaveBeenCalledTimes(1)
    resolve()
    await expect(pending).resolves.toBe(true)

    let finishSecond!: () => void
    const secondTask = {
      promise: new Promise<void>((done) => { finishSecond = done }),
      cancel: vi.fn(() => { throw new Error('ignore') })
    }
    const second = renderer.renderPage(pageFixture({ render: () => secondTask }), canvasFixture())
    renderer.reset()
    finishSecond()
    await second
    expect(renderer.lastRenderedPage).toBe(2)
    renderer.reset()
    expect(renderer.lastRenderedPage).toBeNull()
    expect(renderer.lastRenderedScale).toBeNull()
  })

  it('RenderingCancelledException은 정상 false, 일반 오류는 reportError 후 false다', async () => {
    const cancelled = new Error('cancelled')
    cancelled.name = 'RenderingCancelledException'
    const renderer = createPdfRenderer()
    await expect(renderer.renderPage(pageFixture({
      render: () => ({ promise: Promise.reject(cancelled), cancel: vi.fn() })
    }), canvasFixture())).resolves.toBe(false)
    expect(errors.reportError).not.toHaveBeenCalled()

    const failure = new Error('render failed')
    const page = pageFixture({ pageNumber: 7, render: () => { throw failure } })
    await expect(renderer.renderPage(page, canvasFixture())).resolves.toBe(false)
    expect(errors.reportError).toHaveBeenCalledWith(
      'render', '페이지 7 렌더링에 실패했습니다', failure
    )
  })

  it('2D context 부재를 명시 오류로 보고한다', async () => {
    const renderer = createPdfRenderer()
    await expect(renderer.renderPage(pageFixture(), canvasFixture(null))).resolves.toBe(false)
    expect(errors.reportError).toHaveBeenCalledWith(
      'render', '페이지 2 렌더링에 실패했습니다', expect.objectContaining({ message: 'Cannot get 2D context' })
    )
  })

  it('preview는 원본 폭 기준 scale·DPR1 display 렌더를 위임한다', async () => {
    const ctx = context()
    const canvas = canvasFixture(ctx)
    const page = pageFixture({ width: 400, height: 800 })
    const renderer = createPdfRenderer()
    await expect(renderer.renderPreview(page, canvas, 100)).resolves.toBe(true)
    expect(page.getViewport).toHaveBeenNthCalledWith(1, { scale: 1 })
    expect(page.getViewport).toHaveBeenNthCalledWith(2, { scale: 0.25 })
    expect(ctx.scale).toHaveBeenCalledWith(1, 1)
    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(200)
  })
})
