import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVisibilityManager } from '../../src/lib/scroll/visibilityManager.svelte'

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void

let observerCallback: ObserverCallback

class TestIntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds = []
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])

  constructor(callback: ObserverCallback) {
    observerCallback = callback
  }
}

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 600,
    bottom: top + height,
    left: 0,
    width: 600,
    height,
    toJSON: () => ({})
  } as DOMRect
}

describe('visibilityManager center page', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  })

  it('두 페이지가 관찰될 때 번호 중앙값이 아니라 뷰포트 중심에 가까운 페이지를 선택한다', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => rect(0, 600)
    Object.defineProperty(container, 'clientHeight', { value: 600 })

    const page11 = document.createElement('div')
    const page12 = document.createElement('div')
    page11.getBoundingClientRect = () => rect(-900, 700)
    page12.getBoundingClientRect = () => rect(-180, 700)

    const manager = createVisibilityManager({
      scrollContainer: container,
      totalPages: 12,
      onVisibilityChange: vi.fn()
    })
    manager.observe(11, page11)
    manager.observe(12, page12)

    observerCallback([
      { target: page11, isIntersecting: true } as IntersectionObserverEntry,
      { target: page12, isIntersecting: true } as IntersectionObserverEntry
    ])

    expect(manager.getCenterPage()).toBe(12)
  })

  it('가시 Set이 그대로여도 threshold 갱신 시 중심 페이지를 다시 계산한다', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => rect(0, 600)
    Object.defineProperty(container, 'clientHeight', { value: 600 })

    let page1Top = -50
    let page2Top = 650
    const page1 = document.createElement('div')
    const page2 = document.createElement('div')
    page1.getBoundingClientRect = () => rect(page1Top, 700)
    page2.getBoundingClientRect = () => rect(page2Top, 700)

    const onVisibilityChange = vi.fn()
    const manager = createVisibilityManager({
      scrollContainer: container,
      totalPages: 2,
      onVisibilityChange
    })
    manager.observe(1, page1)
    manager.observe(2, page2)
    observerCallback([
      { target: page1, isIntersecting: true } as IntersectionObserverEntry,
      { target: page2, isIntersecting: true } as IntersectionObserverEntry
    ])
    expect(manager.getCenterPage()).toBe(1)

    page1Top = -700
    page2Top = 0
    observerCallback([
      { target: page2, isIntersecting: true } as IntersectionObserverEntry
    ])

    expect(manager.getCenterPage()).toBe(2)
    expect(onVisibilityChange).toHaveBeenCalledTimes(2)
  })
})
