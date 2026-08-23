/**
 * Selection Box UI Module
 * Svelte 5 runes pattern for selection box visualization
 */
import paper from 'paper'
import { getInputConfig } from '../utils/inputDetection'

export interface SelectionBoxOptions {
  getScope: () => paper.PaperScope | null
  selectionColor?: string
  handleSize?: number
}

export function createSelectionBox(options: SelectionBoxOptions) {
  const {
    getScope,
    selectionColor = '#1890ff'
  } = options

  let selectionGroup: paper.Group | null = null

  /**
   * Draw selection box around items
   */
  function draw(items: paper.Item[]) {
    const scope = getScope()
    if (!scope || items.length === 0) {
      remove()
      return
    }

    scope.activate()

    // 기존 선택 박스 제거
    remove()

    // 바운딩 박스 계산
    let bounds: paper.Rectangle | null = null
    items.forEach(item => {
      if (bounds) {
        bounds = bounds.unite(item.bounds)
      } else {
        bounds = item.bounds.clone()
      }
    })

    if (!bounds) return

    // 동적 패딩 및 대시 패턴 (S Pen vs 손가락)
    const inputConfig = getInputConfig()
    const padding = inputConfig.selectionPadding
    // Type assertion to help TypeScript understand bounds is not null here
    const currentBounds = bounds as paper.Rectangle
    const expandedBounds = currentBounds.expand(padding * 2)

    // 선택 박스 그리기
    const box = new paper.Path.Rectangle({
      rectangle: expandedBounds,
      strokeColor: selectionColor,
      strokeWidth: 1,
      dashArray: inputConfig.dashPattern,
      fillColor: null
    })
    box.data = { isSelectionUI: true }

    // 핸들 그리기
    const handles = createHandles(scope, expandedBounds)

    // 그룹으로 묶기
    selectionGroup = new paper.Group([box, ...handles])
    selectionGroup.data = { isSelectionUI: true }

    // 최상단으로 이동
    selectionGroup.bringToFront()
  }

  /**
   * Create resize handles at corners and edges
   */
  function createHandles(scope: paper.PaperScope, bounds: paper.Rectangle): paper.Item[] {
    const positions = [
      { point: bounds.topLeft, cursor: 'nwse-resize', name: 'topLeft' },
      { point: bounds.topCenter, cursor: 'ns-resize', name: 'topCenter' },
      { point: bounds.topRight, cursor: 'nesw-resize', name: 'topRight' },
      { point: bounds.leftCenter, cursor: 'ew-resize', name: 'leftCenter' },
      { point: bounds.rightCenter, cursor: 'ew-resize', name: 'rightCenter' },
      { point: bounds.bottomLeft, cursor: 'nesw-resize', name: 'bottomLeft' },
      { point: bounds.bottomCenter, cursor: 'ns-resize', name: 'bottomCenter' },
      { point: bounds.bottomRight, cursor: 'nwse-resize', name: 'bottomRight' }
    ]

    return positions.map(({ point, cursor, name }) => {
      // 동적 핸들 크기 (S Pen: 10px, 손가락: 16px)
      const dynamicHandleSize = getInputConfig().handleSize
      const handle = new paper.Path.Rectangle({
        center: point,
        size: [dynamicHandleSize, dynamicHandleSize],
        fillColor: 'white',
        strokeColor: selectionColor,
        strokeWidth: 1
      })
      handle.data = {
        isHandle: true,
        isSelectionUI: true,
        handleName: name,
        cursor
      }
      return handle
    })
  }

  /**
   * Remove selection box
   */
  function remove() {
    if (selectionGroup) {
      selectionGroup.remove()
      selectionGroup = null
    }
  }

  /**
   * Update selection box position
   */
  function update(items: paper.Item[]) {
    draw(items)
  }

  /**
   * Check if a point is on a handle
   */
  function hitTestHandle(point: paper.Point): string | null {
    if (!selectionGroup) return null

    const hitResult = selectionGroup.hitTest(point, {
      fill: true,
      tolerance: getInputConfig().hitTestTolerance
    })

    if (hitResult?.item?.data?.isHandle) {
      return hitResult.item.data.handleName
    }

    return null
  }

  /**
   * Check if selection box is visible
   */
  function isVisible(): boolean {
    return selectionGroup !== null
  }

  return {
    // Methods
    draw,
    remove,
    update,
    hitTestHandle,
    isVisible,

    // Getter for selection group
    get group() { return selectionGroup }
  }
}

// Type for the return value
export type SelectionBox = ReturnType<typeof createSelectionBox>
