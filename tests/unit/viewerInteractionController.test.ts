import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ToolMode } from '../../src/types'
import { createViewerInteractionController } from '../../src/lib/viewer/viewerInteractionController.svelte'

function createHarness() {
  let tool: ToolMode = 'select'
  let readOnly = false
  let canUndo = true
  let canRedo = true
  let searchEnabled = true
  const onUndo = vi.fn()
  const onRedo = vi.fn()
  const onOpenSearch = vi.fn()
  const document = {
    getPage: vi.fn(async () => ({
      getViewport: () => ({ width: 500, height: 700 })
    }))
  } as unknown as PDFDocumentProxy
  const controller = createViewerInteractionController({
    getPdfDocument: () => document,
    getCurrentTool: () => tool,
    getReadOnly: () => readOnly,
    getCanUndo: () => canUndo,
    getCanRedo: () => canRedo,
    onUndo,
    onRedo,
    onOpenSearch,
    getSearchEnabled: () => searchEnabled,
    afterDomUpdate: async () => undefined
  })
  const element = documentForTest()

  return {
    controller,
    element,
    onUndo,
    onRedo,
    onOpenSearch,
    setTool: (value: ToolMode) => { tool = value },
    setReadOnly: (value: boolean) => { readOnly = value },
    setCanUndo: (value: boolean) => { canUndo = value },
    setCanRedo: (value: boolean) => { canRedo = value },
    setSearchEnabled: (value: boolean) => { searchEnabled = value }
  }
}

function documentForTest(): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: 1000 })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 700 })
  element.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700,
    width: 1000, height: 700, toJSON: () => ({})
  })
  const content = document.createElement('div')
  content.className = 'scroll-content'
  content.style.paddingLeft = '16px'
  content.style.paddingRight = '16px'
  element.append(content)
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('viewerInteractionController', () => {
  it('fit-width와 도구별 touch-action을 실제 scroll DOM에 적용', async () => {
    const harness = createHarness()
    harness.controller.setScrollElement(harness.element)
    await harness.controller.applyFitWidth()

    expect(harness.controller.scale).toBeCloseTo(1.936)
    expect(harness.element.style.getPropertyValue('touch-action')).toBe('pan-y pan-x')

    harness.setTool('pen')
    harness.controller.syncInteractionMode()
    expect(harness.element.style.getPropertyValue('touch-action')).toBe('none')

    harness.setReadOnly(true)
    harness.controller.syncInteractionMode()
    expect(harness.element.style.getPropertyValue('touch-action')).toBe('pan-y pan-x')
    harness.controller.dispose()
  })

  it('Ctrl/Meta wheel만 가로채고 detach 후 native listener가 동작하지 않음', async () => {
    const harness = createHarness()
    harness.controller.setScrollElement(harness.element)
    await harness.controller.applyFitWidth()
    const initialScale = harness.controller.scale

    const plainWheel = new WheelEvent('wheel', { deltaY: -200, cancelable: true })
    harness.element.dispatchEvent(plainWheel)
    expect(plainWheel.defaultPrevented).toBe(false)
    expect(harness.controller.scale).toBe(initialScale)

    const zoomWheel = new WheelEvent('wheel', {
      deltaY: -200,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
      cancelable: true
    })
    harness.element.dispatchEvent(zoomWheel)
    expect(zoomWheel.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(harness.controller.scale).toBeGreaterThan(initialScale))

    harness.controller.dispose()
    const detachedScale = harness.controller.scale
    harness.element.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -200, ctrlKey: true, cancelable: true
    }))
    await Promise.resolve()
    expect(harness.controller.scale).toBe(detachedScale)
  })

  it('검색·줌·undo/redo 단축키 우선순위와 입력 요소 예외를 유지', async () => {
    const harness = createHarness()
    const input = document.createElement('input')
    const search = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })
    Object.defineProperty(search, 'target', { value: input })
    harness.controller.handleGlobalKeyDown(search)
    expect(harness.onOpenSearch).toHaveBeenCalledOnce()

    const inputUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true })
    Object.defineProperty(inputUndo, 'target', { value: input })
    harness.controller.handleGlobalKeyDown(inputUndo)
    expect(harness.onUndo).not.toHaveBeenCalled()

    harness.controller.handleGlobalKeyDown(new KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, cancelable: true
    }))
    harness.controller.handleGlobalKeyDown(new KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, shiftKey: true, cancelable: true
    }))
    harness.controller.handleGlobalKeyDown(new KeyboardEvent('keydown', {
      key: 'y', ctrlKey: true, cancelable: true
    }))
    expect(harness.onUndo).toHaveBeenCalledOnce()
    expect(harness.onRedo).toHaveBeenCalledTimes(2)

    harness.setReadOnly(true)
    harness.controller.handleGlobalKeyDown(new KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, cancelable: true
    }))
    expect(harness.onUndo).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('검색 기능이 꺼지면 Ctrl/Cmd+F를 가로채지 않고 브라우저 기본 동작에 맡긴다', () => {
    const harness = createHarness()
    harness.setSearchEnabled(false)

    const ctrlFind = new KeyboardEvent('keydown', {
      key: 'f', ctrlKey: true, cancelable: true
    })
    harness.controller.handleGlobalKeyDown(ctrlFind)
    expect(ctrlFind.defaultPrevented).toBe(false)

    const metaFind = new KeyboardEvent('keydown', {
      key: 'F', metaKey: true, cancelable: true
    })
    harness.controller.handleGlobalKeyDown(metaFind)
    expect(metaFind.defaultPrevented).toBe(false)
    expect(harness.onOpenSearch).not.toHaveBeenCalled()
    harness.controller.dispose()
  })
})
