import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const instances: any[] = []
  const createPaperCanvas = vi.fn(() => {
    const items = [
      { strokeColor: 'old' },
      { strokeColor: null }
    ]
    const instance = {
      init: vi.fn(),
      setZoom: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
      setBaseDimensions: vi.fn(),
      scope: {
        project: {
          activeLayer: {
            children: items,
            importJSON: vi.fn()
          }
        }
      }
    }
    instances.push(instance)
    return instance
  })
  class Color {
    value: string
    constructor(value: string) { this.value = value }
  }
  return { instances, createPaperCanvas, Color }
})

vi.mock('../../src/lib/canvas/paperCanvas.svelte', () => ({
  createPaperCanvas: mocks.createPaperCanvas
}))

vi.mock('paper', () => ({
  default: { Color: mocks.Color }
}))

import { createUserOverlay } from '../../src/lib/canvas/userOverlay.svelte'

function user(overrides: Record<string, unknown> = {}) {
  return {
    canvasId: 'canvas-a',
    userId: 'user-a',
    userName: 'Reviewer A',
    canvasData: JSON.stringify({
      version: 'paper',
      children: [['Path', { segments: [[0, 0], [10, 10]] }]]
    }),
    color: '#ff0000',
    enabled: true,
    ...overrides
  } as any
}

function setDimensions(element: HTMLElement, clientWidth: number, clientHeight: number,
  offsetWidth = clientWidth, offsetHeight = clientHeight) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    clientHeight: { configurable: true, value: clientHeight },
    offsetWidth: { configurable: true, value: offsetWidth },
    offsetHeight: { configurable: true, value: offsetHeight }
  })
}

beforeEach(() => {
  mocks.instances.length = 0
  mocks.createPaperCanvas.mockClear()
  document.body.innerHTML = ''
})

describe('userOverlay', () => {
  it('초기 상태와 container 미설정 경고를 안전하게 처리한다', () => {
    const onChange = vi.fn()
    const overlay = createUserOverlay({ onOverlayChange: onChange })
    expect(overlay.users).toEqual([])
    expect(overlay.visibleUsers).toEqual([])
    expect(overlay.userCount).toBe(0)
    overlay.setDisplayScale(2)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    overlay.setUserData(user())
    expect(warn).toHaveBeenCalledWith('[UserOverlay] No container element set')
    expect(overlay.userCount).toBe(1)
    expect(overlay.visibleUsers).toHaveLength(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(mocks.createPaperCanvas).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('enabled overlay를 생성·import·색상화하고 zoom/size를 전파한다', () => {
    const container = document.createElement('div')
    setDimensions(container, 600, 800)
    document.body.append(container)
    const overlay = createUserOverlay()
    overlay.setContainer(container)
    overlay.setDisplayScale(2)
    overlay.setUserData(user())

    const instance = mocks.instances[0]
    const canvas = container.querySelector('canvas')!
    expect(mocks.createPaperCanvas).toHaveBeenCalledWith({ isReadOnly: true })
    expect(instance.init).toHaveBeenCalledWith(canvas, 300, 400, 2)
    expect(instance.clear).toHaveBeenCalledTimes(1)
    expect(instance.scope.project.activeLayer.importJSON).toHaveBeenCalledWith(
      JSON.stringify(['Path', { segments: [[0, 0], [10, 10]] }])
    )
    expect(instance.scope.project.activeLayer.children[0].strokeColor)
      .toBeInstanceOf(mocks.Color)
    expect(instance.scope.project.activeLayer.children[0].strokeColor.value).toBe('#ff0000')
    expect(instance.scope.project.activeLayer.children[1].strokeColor).toBeNull()
    expect(instance.render).toHaveBeenCalledTimes(1)
    expect(canvas.style.display).toBe('block')
    expect(canvas.style.pointerEvents).toBe('none')

    overlay.setDisplayScale(1.5)
    expect(instance.setZoom).toHaveBeenCalledWith(1.5)
    overlay.updateCanvasSize(612, 792)
    expect(instance.setBaseDimensions).toHaveBeenCalledWith(612, 792)
  })

  it('base size를 렌더 전에 저장하면 container 치수보다 우선한다', () => {
    const container = document.createElement('div')
    setDimensions(container, 0, 0, 900, 1200)
    const overlay = createUserOverlay()
    overlay.setContainer(container)
    overlay.updateCanvasSize(500, 700)
    overlay.setDisplayScale(3)
    overlay.setUserData(user())
    expect(mocks.instances[0].init).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 500, 700, 3)
  })

  it('기존 user 업데이트와 visibility 토글은 같은 canvas/instance를 재사용한다', () => {
    const container = document.createElement('div')
    setDimensions(container, 300, 400)
    const onChange = vi.fn()
    const overlay = createUserOverlay({ onOverlayChange: onChange })
    overlay.setContainer(container)
    overlay.setUserData(user())
    const canvas = container.querySelector('canvas')!
    const instance = mocks.instances[0]

    overlay.setUserData(user({ userName: 'Updated', canvasData: '[]', color: undefined }))
    expect(overlay.users[0].userName).toBe('Updated')
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    expect(mocks.createPaperCanvas).toHaveBeenCalledTimes(1)
    expect(instance.clear).toHaveBeenCalledTimes(2)

    overlay.toggleUserVisibility('missing')
    expect(onChange).toHaveBeenCalledTimes(2)
    overlay.toggleUserVisibility('canvas-a')
    expect(canvas.style.display).toBe('none')
    expect(overlay.visibleUsers).toHaveLength(0)
    overlay.toggleUserVisibility('canvas-a')
    expect(canvas.style.display).toBe('block')
    expect(overlay.visibleUsers).toHaveLength(1)
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('disabled 신규 user는 canvas를 만들지 않고 기존 disabled user는 숨긴다', () => {
    const container = document.createElement('div')
    setDimensions(container, 300, 400)
    const overlay = createUserOverlay()
    overlay.setContainer(container)
    overlay.setUserData(user({ canvasId: 'disabled', enabled: false }))
    expect(container.querySelectorAll('canvas')).toHaveLength(0)
    overlay.setUserData(user())
    const canvas = container.querySelector('canvas')!
    overlay.setUserData(user({ enabled: false }))
    expect(canvas.style.display).toBe('none')
  })

  it('Paper object/직접 배열/손상·기타 JSON을 모두 안전하게 정규화한다', () => {
    const container = document.createElement('div')
    setDimensions(container, 300, 400)
    const overlay = createUserOverlay()
    overlay.setContainer(container)
    const states = [
      JSON.stringify({ children: [['Path', { id: 1 }]] }),
      JSON.stringify([['Path', { id: 2 }]]),
      JSON.stringify({ unknown: true }),
      '{broken'
    ]
    states.forEach((canvasData, index) => {
      overlay.setUserData(user({ canvasId: `c-${index}`, canvasData, color: '' }))
    })
    expect(mocks.instances[0].scope.project.activeLayer.importJSON)
      .toHaveBeenCalledWith(JSON.stringify(['Path', { id: 1 }]))
    expect(mocks.instances[1].scope.project.activeLayer.importJSON)
      .toHaveBeenCalledWith(JSON.stringify(['Path', { id: 2 }]))
    expect(mocks.instances[2].scope.project.activeLayer.importJSON).not.toHaveBeenCalled()
    expect(mocks.instances[3].scope.project.activeLayer.importJSON).not.toHaveBeenCalled()
    expect(mocks.instances.every((instance) => instance.render.mock.calls.length === 1)).toBe(true)
  })

  it('scope 없는 instance와 import 예외를 격리하고 render 계약을 유지한다', () => {
    const container = document.createElement('div')
    setDimensions(container, 300, 400)
    const overlay = createUserOverlay()
    overlay.setContainer(container)

    mocks.createPaperCanvas.mockImplementationOnce(() => {
      const instance = {
        init: vi.fn(), setZoom: vi.fn(), clear: vi.fn(), render: vi.fn(), dispose: vi.fn(),
        setBaseDimensions: vi.fn(), scope: null
      }
      mocks.instances.push(instance)
      return instance as any
    })
    overlay.setUserData(user({ canvasId: 'no-scope' }))
    expect(mocks.instances[0].render).toHaveBeenCalledTimes(1)

    const error = new Error('bad import')
    mocks.createPaperCanvas.mockImplementationOnce(() => {
      const instance = {
        init: vi.fn(), setZoom: vi.fn(), clear: vi.fn(), render: vi.fn(), dispose: vi.fn(),
        setBaseDimensions: vi.fn(),
        scope: { project: { activeLayer: { children: [], importJSON: vi.fn(() => { throw error }) } } }
      }
      mocks.instances.push(instance)
      return instance as any
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    overlay.setUserData(user({ canvasId: 'bad-import', userName: 'Broken' }))
    expect(errorSpy).toHaveBeenCalledWith(
      '[UserOverlay] Failed to render overlay for Broken:', error
    )
    expect(mocks.instances[1].render).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('remove/clearAll/dispose가 instance와 DOM을 정리하고 반복 호출도 안전하다', () => {
    const container = document.createElement('div')
    setDimensions(container, 300, 400)
    const onChange = vi.fn()
    const overlay = createUserOverlay({ onOverlayChange: onChange })
    overlay.setContainer(container)
    overlay.setUserData(user({ canvasId: 'a' }))
    overlay.setUserData(user({ canvasId: 'b' }))
    overlay.removeUser('a')
    expect(mocks.instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    expect(overlay.userCount).toBe(1)

    overlay.removeUser('missing')
    expect(overlay.userCount).toBe(1)
    overlay.clearAll()
    expect(mocks.instances[1].dispose).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('canvas')).toHaveLength(0)
    expect(overlay.users).toEqual([])
    overlay.dispose()
    overlay.setDisplayScale(2)
    expect(onChange).toHaveBeenCalledTimes(6)
  })
})
