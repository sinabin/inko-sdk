import { describe, expect, it } from 'vitest'
import paper from 'paper'
import {
  getKeyboardEditablePaperItems,
  getPaperAnnotationKind,
  getPaperCanvasAccessibilityState
} from '../../src/lib/accessibility/paperCanvasKeyboard'

function fixture() {
  const scope = new paper.PaperScope()
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 800
  document.body.append(canvas)
  scope.setup(canvas)
  return scope
}

describe('Paper canvas 키보드 접근성 상태', () => {
  it('active layer의 최상위 표시 객체만 세고 selection UI·preview·hidden·locked를 제외한다', () => {
    const scope = fixture()
    const drawing = new scope.Path.Line({ from: [0, 0], to: [20, 20] })
    const text = new scope.PointText({ point: [100, 120], content: '  선택할 텍스트  ' })
    const group = new scope.Group([new scope.Path.Circle({ center: [200, 200], radius: 10 })])
    const ui = new scope.Path.Circle({ center: [10, 10], radius: 2 })
    ui.data = { isSelectionUI: true }
    const preview = new scope.Path.Circle({ center: [20, 20], radius: 2 })
    preview.data = { isPreview: true }
    const hidden = new scope.Path.Circle({ center: [30, 30], radius: 2 })
    hidden.visible = false
    const locked = new scope.Path.Circle({ center: [40, 40], radius: 2 })
    locked.locked = true

    expect(getKeyboardEditablePaperItems(scope)).toEqual([drawing, text, group])
    expect(getPaperCanvasAccessibilityState(scope, text, 3)).toEqual({
      pageNumber: 3,
      annotationCount: 3,
      selectedIndex: 2,
      selectedKind: 'text',
      selectedText: '선택할 텍스트',
      selectedX: Math.round(text.position.x),
      selectedY: Math.round(text.position.y)
    })
  })

  it('scope 또는 유효 선택이 없으면 안정적인 빈/미선택 상태를 반환한다', () => {
    expect(getPaperCanvasAccessibilityState(null, null, 2)).toEqual({
      pageNumber: 2,
      annotationCount: 0,
      selectedIndex: null,
      selectedKind: null,
      selectedText: null,
      selectedX: null,
      selectedY: null
    })

    const scope = fixture()
    const hidden = new scope.Path.Line({ from: [0, 0], to: [1, 1] })
    hidden.visible = false
    expect(getPaperCanvasAccessibilityState(scope, hidden, 2).selectedIndex).toBeNull()
  })

  it('주석 종류와 긴 텍스트 요약을 스크린리더용 상태로 정규화한다', () => {
    const item = (className: string, data: Record<string, unknown> = {}) => ({
      className,
      data
    }) as unknown as paper.Item

    expect(getPaperAnnotationKind(item('PointText'))).toBe('text')
    expect(getPaperAnnotationKind(item('Raster'))).toBe('image')
    expect(getPaperAnnotationKind(item('PlacedSymbol'))).toBe('image')
    expect(getPaperAnnotationKind(item('Group'))).toBe('group')
    expect(getPaperAnnotationKind(item('Layer'))).toBe('group')
    expect(getPaperAnnotationKind(item('Path'))).toBe('drawing')
    expect(getPaperAnnotationKind(item('CompoundPath'))).toBe('drawing')
    expect(getPaperAnnotationKind(item('Shape', { isHighlighter: true }))).toBe('drawing')
    expect(getPaperAnnotationKind(item('Shape'))).toBe('annotation')

    const scope = fixture()
    const content = `  ${'A'.repeat(70)}  `
    const text = new scope.PointText({ point: [50, 60], content })
    const state = getPaperCanvasAccessibilityState(scope, text, 4)
    expect(state.selectedText).toBe(`${'A'.repeat(57)}…`)

    text.content = '   '
    expect(getPaperCanvasAccessibilityState(scope, text, 4).selectedText).toBeNull()
  })
})
