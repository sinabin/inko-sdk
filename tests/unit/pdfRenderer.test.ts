/**
 * pdfRenderer 순수 로직 단위 테스트
 * — getPageDimensions·isAlreadyRendered·reset·cancelRender
 * 실제 렌더링은 jsdom canvas 한계로 e2e에서 검증
 */
import { describe, it, expect, vi } from 'vitest'
import { createPdfRenderer } from '../../src/lib/pdf/pdfRenderer.svelte'

function mockPage(width = 612, height = 792, pageNumber = 1): any {
  return {
    pageNumber,
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: width * scale,
      height: height * scale
    })
  }
}

describe('pdfRenderer.getPageDimensions', () => {
  it('scale=1일 때 원본 크기 그대로 반환', () => {
    const r = createPdfRenderer()
    const dims = r.getPageDimensions(mockPage(612, 792), 1)
    expect(dims).toEqual({
      originalWidth: 612,
      originalHeight: 792,
      width: 612,
      height: 792
    })
  })

  it('scale 적용 시 width/height만 스케일됨, original은 보존', () => {
    const r = createPdfRenderer()
    const dims = r.getPageDimensions(mockPage(612, 792), 2)
    expect(dims.originalWidth).toBe(612)
    expect(dims.originalHeight).toBe(792)
    expect(dims.width).toBe(1224)
    expect(dims.height).toBe(1584)
  })

  it('default scale은 1', () => {
    const r = createPdfRenderer()
    const dims = r.getPageDimensions(mockPage(100, 200))
    expect(dims.width).toBe(100)
  })
})

describe('pdfRenderer.isAlreadyRendered', () => {
  it('초기 상태에서는 모든 페이지 미렌더', () => {
    const r = createPdfRenderer()
    expect(r.isAlreadyRendered(1, 1)).toBe(false)
  })

  it('reset 후 미렌더 상태로 복귀', () => {
    const r = createPdfRenderer()
    // 내부 lastRendered 상태는 reset()이 null로 초기화
    r.reset()
    expect(r.isAlreadyRendered(1, 1)).toBe(false)
    expect(r.lastRenderedPage).toBe(null)
    expect(r.lastRenderedScale).toBe(null)
    expect(r.isRendering).toBe(false)
  })
})

describe('pdfRenderer.cancelRender', () => {
  it('진행 중 작업 없을 때 cancelRender 호출 시 예외 없음', () => {
    const r = createPdfRenderer()
    expect(() => r.cancelRender()).not.toThrow()
  })
})

describe('pdfRenderer 초기 상태', () => {
  it('isRendering=false, lastRendered* = null', () => {
    const r = createPdfRenderer()
    expect(r.isRendering).toBe(false)
    expect(r.lastRenderedPage).toBe(null)
    expect(r.lastRenderedScale).toBe(null)
  })
})
