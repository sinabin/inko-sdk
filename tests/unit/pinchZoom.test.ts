import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinchZoom } from '../../src/lib/interaction/pinchZoom.svelte'

type TouchPoint = { clientX: number; clientY: number }

function touchEvent(type: string, points: TouchPoint[]) {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: points })
  return event
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('pinchZoom', () => {
  it('두 손가락 중심·문서 좌표를 계산해 start/change/end와 CSS preview를 연결한다', () => {
    const target = document.createElement('div')
    const container = document.createElement('div')
    const content = document.createElement('div')
    Object.defineProperties(container, {
      scrollLeft: { configurable: true, value: 30, writable: true },
      scrollTop: { configurable: true, value: 50, writable: true }
    })
    container.getBoundingClientRect = () => ({
      left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300,
      x: 10, y: 20, toJSON: () => ({})
    } as DOMRect)
    const onZoomStart = vi.fn()
    const onZoomChange = vi.fn()
    const onZoomEnd = vi.fn()
    const zoom = createPinchZoom({
      minScale: 0.5, maxScale: 3,
      getScrollContainer: () => container,
      getContentElement: () => content,
      onZoomStart, onZoomChange, onZoomEnd
    })
    zoom.attach(target)

    target.dispatchEvent(touchEvent('touchstart', [{ clientX: 20, clientY: 40 }]))
    expect(zoom.isPinching).toBe(false)
    const start = touchEvent('touchstart', [
      { clientX: 20, clientY: 40 }, { clientX: 120, clientY: 40 }
    ])
    target.dispatchEvent(start)
    expect(zoom.isPinching).toBe(true)
    expect(zoom.centerX).toBe(70)
    expect(zoom.centerY).toBe(40)
    expect(onZoomStart).toHaveBeenCalledWith({
      clientX: 70, clientY: 40,
      containerX: 60, containerY: 20,
      documentX: 90, documentY: 70
    })

    const ignoredMove = touchEvent('touchmove', [{ clientX: 20, clientY: 40 }])
    target.dispatchEvent(ignoredMove)
    expect(onZoomChange).not.toHaveBeenCalled()
    const move = touchEvent('touchmove', [
      { clientX: 20, clientY: 60 }, { clientX: 220, clientY: 60 }
    ])
    const preventDefault = vi.spyOn(move, 'preventDefault')
    target.dispatchEvent(move)
    expect(zoom.currentScale).toBe(2)
    expect(zoom.centerX).toBe(120)
    expect(zoom.centerY).toBe(60)
    expect(content.style.transition).toBe('none')
    expect(content.style.transformOrigin).toBe('90px 70px')
    expect(content.style.transform).toBe('translate(50px, 20px) scale(2)')
    expect(preventDefault).toHaveBeenCalled()
    expect(onZoomChange).toHaveBeenCalledWith(2, expect.objectContaining({ documentX: 140, documentY: 90 }))

    target.dispatchEvent(touchEvent('touchend', [
      { clientX: 20, clientY: 60 }, { clientX: 220, clientY: 60 }
    ]))
    expect(zoom.isPinching).toBe(true)
    target.dispatchEvent(touchEvent('touchend', [{ clientX: 20, clientY: 60 }]))
    expect(zoom.isPinching).toBe(false)
    expect(content.style.transform).toBe('')
    expect(content.style.transformOrigin).toBe('')
    expect(onZoomEnd).toHaveBeenCalledWith(2, expect.objectContaining({ clientX: 120, clientY: 60 }))
  })

  it('min/max clamp, setScale, disabled, reset 상태를 적용한다', () => {
    const target = document.createElement('div')
    const onZoomChange = vi.fn()
    const zoom = createPinchZoom({ minScale: 0.75, maxScale: 2, onZoomChange })
    zoom.attach(target)
    zoom.setScale(99)
    expect(zoom.currentScale).toBe(2)
    zoom.setScale(-1)
    expect(zoom.currentScale).toBe(0.75)

    zoom.setEnabled(false)
    target.dispatchEvent(touchEvent('touchstart', [
      { clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }
    ]))
    expect(zoom.isPinching).toBe(false)
    zoom.setEnabled(true)
    target.dispatchEvent(touchEvent('touchstart', [
      { clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }
    ]))
    target.dispatchEvent(touchEvent('touchmove', [
      { clientX: 49, clientY: 0 }, { clientX: 51, clientY: 0 }
    ]))
    expect(zoom.currentScale).toBe(0.75)
    target.dispatchEvent(touchEvent('touchmove', [
      { clientX: -500, clientY: 0 }, { clientX: 500, clientY: 0 }
    ]))
    expect(zoom.currentScale).toBe(2)
    zoom.setEnabled(false)
    expect(zoom.isPinching).toBe(false)
    target.dispatchEvent(touchEvent('touchend', []))
    zoom.reset()
    expect(zoom.currentScale).toBe(1)
    expect(zoom.centerX).toBe(0)
    expect(zoom.centerY).toBe(0)
  })

  it('container/content/callback이 없어도 viewport 좌표로 동작하고 attach 교체·detach한다', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const firstRemove = vi.spyOn(first, 'removeEventListener')
    const secondRemove = vi.spyOn(second, 'removeEventListener')
    const zoom = createPinchZoom()
    zoom.detach()
    zoom.attach(first)
    zoom.attach(second)
    expect(firstRemove).toHaveBeenCalledTimes(4)

    second.dispatchEvent(touchEvent('touchmove', [
      { clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }
    ]))
    second.dispatchEvent(touchEvent('touchend', []))
    second.dispatchEvent(touchEvent('touchstart', [
      { clientX: 10, clientY: 20 }, { clientX: 30, clientY: 40 }
    ]))
    second.dispatchEvent(touchEvent('touchmove', [
      { clientX: 0, clientY: 10 }, { clientX: 40, clientY: 50 }
    ]))
    expect(zoom.centerX).toBe(20)
    expect(zoom.centerY).toBe(30)
    second.dispatchEvent(touchEvent('touchcancel', []))
    expect(zoom.isPinching).toBe(false)
    zoom.detach()
    expect(secondRemove).toHaveBeenCalledTimes(4)
  })
})
