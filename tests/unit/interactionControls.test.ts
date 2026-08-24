import { describe, expect, it, vi } from 'vitest'
import { applyZoomAnchor, captureZoomAnchor } from '../../src/lib/interaction/zoomAnchor'
import { createZoomControl } from '../../src/lib/interaction/zoomControl.svelte'
import { createPageNavigation } from '../../src/lib/pdf/pageNavigation.svelte'
import { createBrushSettings } from '../../src/lib/tools/brushSettings.svelte'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => ({}) } as DOMRect
}

describe('zoomAnchor', () => {
  it('페이지가 없으면 null을 반환한다', () => {
    expect(captureZoomAnchor(document.createElement('div'))).toBeNull()
  })

  it('지점을 덮는 페이지를 우선하고 기본 중앙 좌표도 지원한다', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => rect(10, 20, 400, 300)
    const first = document.createElement('div')
    const second = document.createElement('div')
    first.dataset.page = '1'
    second.dataset.page = '2'
    first.getBoundingClientRect = () => rect(20, 30, 200, 100)
    second.getBoundingClientRect = () => rect(20, 180, 200, 100)
    container.append(first, second)

    expect(captureZoomAnchor(container, 80, 220)).toMatchObject({
      pageEl: second, offsetX: 60, offsetY: 40, clientX: 80, clientY: 220
    })
    expect(captureZoomAnchor(container)).toMatchObject({
      pageEl: second, offsetX: 190, offsetY: -10, clientX: 210, clientY: 170
    })
  })

  it('페이지 사이에서는 가장 가까운 페이지를 선택한다', () => {
    const container = document.createElement('div')
    const first = document.createElement('div')
    const second = document.createElement('div')
    first.dataset.page = '1'
    second.dataset.page = '2'
    first.getBoundingClientRect = () => rect(0, 0, 100, 100)
    second.getBoundingClientRect = () => rect(0, 200, 100, 100)
    container.append(first, second)
    expect(captureZoomAnchor(container, 10, 130)?.pageEl).toBe(first)
    expect(captureZoomAnchor(container, 10, 180)?.pageEl).toBe(second)
  })

  it('연결된 페이지는 비율 기반으로 보정하고 분리된 페이지는 무시한다', () => {
    const container = document.createElement('div')
    const page = document.createElement('div')
    page.dataset.page = '1'
    page.getBoundingClientRect = () => rect(40, 60, 100, 100)
    container.append(page)
    document.body.append(container)
    container.scrollLeft = 10
    container.scrollTop = 20
    applyZoomAnchor(container, {
      pageEl: page, offsetX: 25, offsetY: 30, clientX: 50, clientY: 80
    }, 2)
    expect(container.scrollLeft).toBe(50)
    expect(container.scrollTop).toBe(60)
    page.remove()
    applyZoomAnchor(container, {
      pageEl: page, offsetX: 100, offsetY: 100, clientX: 0, clientY: 0
    }, 3)
    expect(container.scrollLeft).toBe(50)
    expect(container.scrollTop).toBe(60)
    container.remove()
  })
})

describe('zoomControl', () => {
  it('모든 줌 경로를 clamp하고 실제 변경만 통지한다', () => {
    const onZoomChange = vi.fn()
    const zoom = createZoomControl({ initialScale: 1, minScale: 0.5, maxScale: 2, step: 0.5, onZoomChange })
    expect(zoom.scalePercent).toBe(100)
    expect(zoom.presets).toContain(500)
    zoom.zoomIn()
    zoom.zoomIn()
    zoom.zoomIn()
    expect(zoom.scale).toBe(2)
    expect(zoom.canZoomIn).toBe(false)
    zoom.zoomOut()
    zoom.setScale(-10)
    zoom.zoomOut()
    expect(zoom.scale).toBe(0.5)
    expect(zoom.canZoomOut).toBe(false)
    zoom.setScale(0.5)
    expect(onZoomChange).toHaveBeenCalledTimes(4)
    zoom.resetZoom()
    expect(zoom.scale).toBe(1)
  })

  it('fit/percent 입력을 계산하고 0 content는 no-op 처리한다', () => {
    const zoom = createZoomControl()
    zoom.fitToWidth(500, 1000)
    expect(zoom.scale).toBe(0.5)
    zoom.fitToHeight(900, 600)
    expect(zoom.scale).toBe(1.5)
    zoom.fitToContainer(400, 300, 800, 300)
    expect(zoom.scale).toBe(0.5)
    zoom.setZoomPercent(125)
    expect(zoom.scale).toBe(1.25)
    zoom.fitToWidth(1, 0)
    zoom.fitToHeight(1, 0)
    zoom.fitToContainer(1, 1, 0, 1)
    expect(zoom.scale).toBe(1.25)
  })
})

describe('pageNavigation', () => {
  it('범위·콜백·파생 상태를 일관되게 유지한다', () => {
    const onPageChange = vi.fn()
    const nav = createPageNavigation({ initialPage: 2, onPageChange })
    nav.setTotalPages(3)
    expect(nav.hasPrevPage).toBe(true)
    expect(nav.hasNextPage).toBe(true)
    expect(nav.goToPage(0)).toBe(false)
    expect(nav.goToPage(4)).toBe(false)
    expect(nav.goToPage(2)).toBe(true)
    expect(onPageChange).not.toHaveBeenCalled()
    expect(nav.nextPage()).toBe(true)
    expect(nav.isLastPage).toBe(true)
    expect(nav.nextPage()).toBe(false)
    expect(nav.prevPage()).toBe(true)
    expect(nav.firstPage()).toBe(true)
    expect(nav.isFirstPage).toBe(true)
    expect(nav.lastPage()).toBe(true)
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('페이지 축소·직접 설정·reset을 안전하게 처리한다', () => {
    const nav = createPageNavigation({ initialPage: 9 })
    nav.setTotalPages(4)
    expect(nav.currentPage).toBe(4)
    nav.setCurrentPage(2)
    nav.setCurrentPage(0)
    nav.setCurrentPage(5)
    expect(nav.currentPage).toBe(2)
    nav.reset()
    expect(nav.currentPage).toBe(1)
    expect(nav.totalPages).toBe(0)
    expect(nav.lastPage()).toBe(false)
  })
})

describe('brushSettings', () => {
  it('값을 clamp하고 Paper 색을 opacity에 맞게 반환한다', () => {
    const brush = createBrushSettings()
    expect(brush.settings).toMatchObject({ color: '#000000', width: 2, opacity: 1 })
    expect(brush.colorPresets).toHaveLength(9)
    brush.setColor('#112233')
    brush.setWidth(0)
    expect(brush.width).toBe(1)
    brush.setWidth(99)
    expect(brush.width).toBe(50)
    brush.setOpacity(-1)
    expect(brush.opacity).toBe(0)
    brush.setOpacity(2)
    expect(brush.opacity).toBe(1)
    expect(brush.getPaperColor()).toBe('#112233')
    brush.setOpacity(0.25)
    expect(brush.getPaperColor()).toBe('rgba(17, 34, 51, 0.25)')
    brush.setFontSize(1)
    expect(brush.fontSize).toBe(8)
    brush.setFontSize(100)
    expect(brush.fontSize).toBe(96)
    brush.setFontFamily('serif')
    brush.setPressureSensitivity(-1)
    expect(brush.pressureSensitivity).toBe(0)
    brush.setPressureSensitivity(101)
    expect(brush.pressureSensitivity).toBe(100)
  })

  it('custom 초기값으로 reset한다', () => {
    const brush = createBrushSettings({
      initialColor: '#abcdef', initialWidth: 7, initialOpacity: 0.7,
      initialFontSize: 24, initialFontFamily: 'Inter', initialPressureSensitivity: 70
    })
    brush.setColor('#000000')
    brush.setWidth(1)
    brush.setOpacity(0)
    brush.setFontSize(8)
    brush.setFontFamily('sans-serif')
    brush.setPressureSensitivity(0)
    brush.reset()
    expect(brush.settings).toEqual({
      color: '#abcdef', width: 7, opacity: 0.7,
      fontSize: 24, fontFamily: 'Inter', pressureSensitivity: 70
    })
  })
})
