import { describe, expect, it } from 'vitest'
import {
  createTouchActionManager,
  getGlobalTouchActionManager,
  getTouchActionForTool,
  propagateTouchAction,
  setupCanvasTouchAction,
  setupScrollContainerTouchAction
} from '../../src/lib/utils/touchActionManager'

describe('touchActionManager', () => {
  it('모드 변경·요소 교체·dispose가 스타일 소유권을 정리한다', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const manager = createTouchActionManager()
    expect(manager.getMode()).toBe('scroll')

    manager.setElement(first)
    expect(first.style.getPropertyValue('touch-action')).toBe('pan-y pan-x')
    expect(first.style.getPropertyPriority('touch-action')).toBe('important')

    manager.setMode('edit')
    expect(first.style.getPropertyValue('touch-action')).toBe('none')
    expect(first.style.getPropertyValue('user-select')).toBe('none')

    manager.setElement(second)
    expect(first.style.getPropertyValue('touch-action')).toBe('')
    expect(second.style.getPropertyValue('touch-action')).toBe('none')

    manager.setMode('none')
    expect(second.style.getPropertyValue('touch-action')).toBe('auto')
    expect(second.style.getPropertyValue('user-select')).toBe('')
    manager.dispose()
    expect(second.getAttribute('style')).toBe('')

    manager.setMode('scroll')
    expect(manager.getMode()).toBe('scroll')
  })

  it('전역 manager는 같은 인스턴스를 재사용한다', () => {
    expect(getGlobalTouchActionManager()).toBe(getGlobalTouchActionManager())
  })

  it('부모 또는 선택된 자식에 touch-action을 전파한다', () => {
    const parent = document.createElement('div')
    parent.innerHTML = '<span class="hit"></span><span class="hit"></span><span></span>'
    propagateTouchAction(parent, 'none', '.hit')
    expect([...parent.querySelectorAll<HTMLElement>('.hit')].every((el) =>
      el.style.getPropertyValue('touch-action') === 'none')).toBe(true)
    expect(parent.style.getPropertyValue('touch-action')).toBe('')
    propagateTouchAction(parent, 'pan-y')
    expect(parent.style.getPropertyValue('touch-action')).toBe('pan-y')
  })

  it('canvas와 scroll container에 목적별 CSS를 적용한다', () => {
    const canvas = document.createElement('canvas')
    setupCanvasTouchAction(canvas)
    expect(canvas.style.getPropertyValue('touch-action')).toBe('none')
    expect(canvas.style.getPropertyValue('user-select')).toBe('none')
    expect(canvas.style.getPropertyValue('pointer-events')).toBe('auto')

    const container = document.createElement('div')
    setupScrollContainerTouchAction(container)
    expect(container.style.getPropertyValue('touch-action')).toBe('pan-y pan-x')
  })

  it.each([
    ['select', false, 'scroll'],
    ['pen', false, 'edit'],
    ['highlighter', false, 'edit'],
    ['eraser', false, 'edit'],
    ['text', false, 'edit'],
    ['rectangle', false, 'edit'],
    ['circle', false, 'edit'],
    ['line', false, 'edit'],
    ['unknown', false, 'scroll'],
    ['pen', true, 'scroll']
  ] as const)('%s / readOnly=%s -> %s', (tool, readOnly, expected) => {
    expect(getTouchActionForTool(tool, readOnly)).toBe(expected)
  })
})
