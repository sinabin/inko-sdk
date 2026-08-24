import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVisibilityManager } from '../../src/lib/scroll/visibilityManager.svelte'

class ObserverMock {
  static instances: ObserverMock[] = []
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
  root = null
  rootMargin = ''
  thresholds = []

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    ObserverMock.instances.push(this)
  }

  emit(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

const originalObserver = globalThis.IntersectionObserver

beforeEach(() => {
  ObserverMock.instances = []
  globalThis.IntersectionObserver = ObserverMock as unknown as typeof IntersectionObserver
})

afterEach(() => {
  globalThis.IntersectionObserver = originalObserver
})

function element(page?: string) {
  const node = document.createElement('div')
  if (page !== undefined) node.setAttribute('data-page', page)
  return node
}

describe('visibilityManager', () => {
  it('동적 rootMargin으로 관찰하고 재관찰/해제를 관리한다', () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 801 })
    const manager = createVisibilityManager({
      scrollContainer, totalPages: 10, onVisibilityChange: vi.fn()
    })
    const first = element()
    const replacement = element()
    manager.observe(3, first)
    expect(ObserverMock.instances).toHaveLength(1)
    const observer = ObserverMock.instances[0]
    expect(observer.options).toEqual({
      root: scrollContainer,
      rootMargin: '401px 0px 401px 0px',
      threshold: [0.01, 0.5]
    })
    expect(first.getAttribute('data-page')).toBe('3')
    expect(observer.observe).toHaveBeenCalledWith(first)
    manager.observe(3, replacement)
    expect(observer.unobserve).toHaveBeenCalledWith(first)
    expect(observer.observe).toHaveBeenCalledWith(replacement)
    manager.unobserve(3)
    expect(observer.unobserve).toHaveBeenCalledWith(replacement)
    manager.unobserve(3)
  })

  it('교차 entries로 visible range·중앙값·buffer·callback을 갱신한다', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.getBoundingClientRect = () => ({
      top: 0, bottom: 1_000, left: 0, right: 800,
      width: 800, height: 1_000, x: 0, y: 0, toJSON: () => ({})
    })
    const onVisibilityChange = vi.fn()
    const manager = createVisibilityManager({
      scrollContainer, totalPages: 8, bufferPages: 2, onVisibilityChange
    })
    const p2 = element()
    const p5 = element()
    const p7 = element()
    p2.getBoundingClientRect = () => ({
      top: 0, bottom: 200, left: 0, right: 800,
      width: 800, height: 200, x: 0, y: 0, toJSON: () => ({})
    })
    p5.getBoundingClientRect = () => ({
      top: 400, bottom: 600, left: 0, right: 800,
      width: 800, height: 200, x: 0, y: 400, toJSON: () => ({})
    })
    p7.getBoundingClientRect = () => ({
      top: 800, bottom: 1_000, left: 0, right: 800,
      width: 800, height: 200, x: 0, y: 800, toJSON: () => ({})
    })
    manager.observe(2, p2)
    manager.observe(5, p5)
    manager.observe(7, p7)
    const observer = ObserverMock.instances[0]
    observer.emit([
      { target: element(), isIntersecting: true },
      { target: element('0'), isIntersecting: true },
      { target: p5, isIntersecting: true },
      { target: p2, isIntersecting: true },
      { target: p7, isIntersecting: true }
    ])
    expect([...manager.visiblePages]).toEqual([5, 2, 7])
    expect(manager.getVisibleRange()).toEqual({ start: 2, end: 7 })
    expect(manager.getCenterPage()).toBe(5)
    expect(manager.centerPage).toBe(5)
    expect(manager.getBufferedRange()).toEqual({ start: 1, end: 8 })
    expect(manager.isInViewport(5)).toBe(true)
    expect(manager.isInViewport(4)).toBe(false)
    expect(manager.isNearViewport(1)).toBe(true)
    expect(onVisibilityChange).toHaveBeenCalledTimes(1)

    observer.emit([{ target: p5, isIntersecting: true }])
    observer.emit([{ target: p5, isIntersecting: false }])
    observer.emit([{ target: p5, isIntersecting: false }])
    expect(manager.getVisibleRange()).toEqual({ start: 2, end: 7 })
    expect(manager.centerPage).toBe(2)
    expect(onVisibilityChange).toHaveBeenCalledTimes(2)
  })

  it('빈 상태·총 페이지 변경·모두 비가시·dispose를 처리한다', () => {
    const scrollContainer = document.createElement('div')
    const onVisibilityChange = vi.fn()
    const manager = createVisibilityManager({
      scrollContainer, totalPages: 3, onVisibilityChange
    })
    expect(manager.getVisibleRange()).toEqual({ start: 1, end: 1 })
    expect(manager.getBufferedRange()).toEqual({ start: 1, end: 3 })
    expect(manager.centerPage).toBe(1)
    manager.updateTotalPages(20)
    expect(manager.getBufferedRange()).toEqual({ start: 1, end: 3 })
    expect(manager.isNearViewport(4)).toBe(false)

    const p1 = element()
    manager.observe(1, p1)
    const observer = ObserverMock.instances[0]
    observer.emit([{ target: p1, isIntersecting: true }])
    observer.emit([{ target: p1, isIntersecting: false }])
    expect(manager.visiblePages.size).toBe(0)
    expect(manager.centerPage).toBe(1)
    manager.dispose()
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(manager.visiblePages.size).toBe(0)
    manager.dispose()
  })
})
