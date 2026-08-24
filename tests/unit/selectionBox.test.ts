import { beforeEach, describe, expect, it, vi } from 'vitest'
import paper from 'paper'

const input = vi.hoisted(() => ({
  config: { hitTestTolerance: 20, handleSize: 16, selectionPadding: 8, dashPattern: [8, 6] }
}))
vi.mock('../../src/lib/utils/inputDetection', () => ({ getInputConfig: () => input.config }))

import { createSelectionBox } from '../../src/lib/canvas/selectionBox.svelte'

function scopeFixture() {
  const scope = new paper.PaperScope()
  scope.setup(new scope.Size(800, 600))
  return scope
}

beforeEach(() => {
  input.config = { hitTestTolerance: 20, handleSize: 16, selectionPadding: 8, dashPattern: [8, 6] }
})

describe('selectionBox', () => {
  it('scope 부재·빈 선택은 기존 UI를 제거한다', () => {
    const withoutScope = createSelectionBox({ getScope: () => null })
    withoutScope.draw([])
    expect(withoutScope.group).toBeNull()
    expect(withoutScope.hitTestHandle(new paper.Point(0, 0))).toBeNull()
    expect(withoutScope.isVisible()).toBe(false)

    const scope = scopeFixture()
    const box = createSelectionBox({ getScope: () => scope })
    const item = new scope.Path.Rectangle({ point: [10, 10], size: [20, 30] })
    box.draw([item])
    expect(box.isVisible()).toBe(true)
    box.draw([])
    expect(box.isVisible()).toBe(false)
    box.remove()
  })

  it('복수 item bounds를 unite·padding하고 8개 동적 handle을 만든다', () => {
    const scope = scopeFixture()
    input.config = { hitTestTolerance: 5, handleSize: 10, selectionPadding: 4, dashPattern: [4, 4] }
    const first = new scope.Path.Rectangle({ point: [10, 20], size: [30, 40] })
    const second = new scope.Path.Rectangle({ point: [100, 120], size: [20, 30] })
    const box = createSelectionBox({ getScope: () => scope, selectionColor: '#ff0000' })
    box.draw([first, second])
    const group = box.group!
    expect(group.data.isSelectionUI).toBe(true)
    expect(group.children).toHaveLength(9)
    const border = group.children[0] as paper.Path
    expect(border.bounds.left).toBeCloseTo(6)
    expect(border.bounds.top).toBeCloseTo(16)
    expect(border.bounds.right).toBeCloseTo(124)
    expect(border.bounds.bottom).toBeCloseTo(154)
    expect(border.dashArray).toEqual([4, 4])
    expect(border.strokeColor?.toCSS(true)).toBe('#ff0000')
    const handles = group.children.slice(1) as paper.Path[]
    expect(handles.map((handle) => handle.data.handleName)).toEqual([
      'topLeft', 'topCenter', 'topRight', 'leftCenter',
      'rightCenter', 'bottomLeft', 'bottomCenter', 'bottomRight'
    ])
    expect(handles.every((handle) => handle.bounds.width === 10 && handle.data.isSelectionUI)).toBe(true)
  })

  it('handle hitTest는 이름을 반환하고 border/외부는 null이다', () => {
    const scope = scopeFixture()
    const item = new scope.Path.Rectangle({ point: [100, 100], size: [100, 80] })
    const box = createSelectionBox({ getScope: () => scope })
    box.draw([item])
    const handle = box.group!.children.find((child) => child.data?.handleName === 'bottomRight')!
    expect(box.hitTestHandle(handle.position)).toBe('bottomRight')
    expect(box.hitTestHandle(box.group!.children[0].bounds.center)).toBeNull()
    expect(box.hitTestHandle(new scope.Point(700, 500))).toBeNull()
  })

  it('update는 이전 group을 제거하고 새 bounds로 다시 그린다', () => {
    const scope = scopeFixture()
    const item = new scope.Path.Rectangle({ point: [10, 10], size: [20, 20] })
    const box = createSelectionBox({ getScope: () => scope })
    box.draw([item])
    const old = box.group!
    item.position = item.position.add([100, 100])
    box.update([item])
    expect(old.parent).toBeNull()
    expect(box.group).not.toBe(old)
    box.remove()
    expect(box.group).toBeNull()
  })
})
