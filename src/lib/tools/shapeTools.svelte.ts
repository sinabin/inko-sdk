/**
 * Shape Tools Module
 * 임베드 환경 안정화: Paper.js Tool 대신 직접 PointerEvent 처리
 */
import paper from 'paper'

export interface ShapeToolsOptions {
  getScope: () => paper.PaperScope | null
  getBrush: () => { color: string; width: number }
  onShapeCreated?: (shape: paper.Item) => void
}

export type ShapeType = 'rectangle' | 'circle' | 'line'

export function createShapeTools(options: ShapeToolsOptions) {
  const { getScope, getBrush, onShapeCreated } = options

  let isActive = $state(false)
  let currentShape = $state<ShapeType | null>(null)
  let startPoint: paper.Point | null = null
  let previewShape: paper.Item | null = null

  // Pointer event state
  let canvasElement: HTMLCanvasElement | null = null
  let activePointerId: number | null = null

  // Event handler references
  let handlePointerDown: ((e: PointerEvent) => void) | null = null
  let handlePointerMove: ((e: PointerEvent) => void) | null = null
  let handlePointerUp: ((e: PointerEvent) => void) | null = null

  /**
   * PointerEvent 좌표 → Paper.js project 좌표 변환
   */
  function getProjectPoint(e: PointerEvent): paper.Point {
    const scope = getScope()
    if (!scope?.view || !canvasElement) return new paper.Point(0, 0)

    const rect = canvasElement.getBoundingClientRect()
    const viewPoint = new paper.Point(
      e.clientX - rect.left,
      e.clientY - rect.top
    )
    return scope.view.viewToProject(viewPoint)
  }

  /**
   * Activate shape drawing mode
   */
  function activate(shapeType: ShapeType) {
    const scope = getScope()
    if (!scope) {
      console.warn('[ShapeTools] No Paper.js scope available')
      return
    }

    // Deactivate previous tool
    deactivate()

    scope.activate()
    isActive = true
    currentShape = shapeType

    canvasElement = scope.view?.element as HTMLCanvasElement | null
    if (!canvasElement) return

    handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      const scope = getScope()
      if (!scope) return

      try { canvasElement!.setPointerCapture(e.pointerId) } catch {}
      activePointerId = e.pointerId

      const point = getProjectPoint(e)
      startPoint = point
      removePreview()
    }

    handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return
      if (!startPoint) return

      const scope = getScope()
      if (!scope || !currentShape) return

      const point = getProjectPoint(e)
      removePreview()
      scope.activate()
      previewShape = createShape(scope, currentShape, startPoint, point, true)
    }

    handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return
      if (!startPoint) return

      const scope = getScope()
      if (scope && currentShape) {
        const point = getProjectPoint(e)
        removePreview()
        scope.activate()
        const shape = createShape(scope, currentShape, startPoint, point, false)
        if (shape) {
          onShapeCreated?.(shape)
        }
      }

      startPoint = null
      activePointerId = null

      try { canvasElement!.releasePointerCapture(e.pointerId) } catch {}
    }

    canvasElement.addEventListener('pointerdown', handlePointerDown)
    canvasElement.addEventListener('pointermove', handlePointerMove)
    canvasElement.addEventListener('pointerup', handlePointerUp)
    canvasElement.addEventListener('pointercancel', handlePointerUp)
  }

  /**
   * Create a shape between two points
   */
  function createShape(
    scope: paper.PaperScope,
    shapeType: ShapeType,
    from: paper.Point,
    to: paper.Point,
    isPreview: boolean
  ): paper.Item | null {
    const brush = getBrush()
    const strokeColor = isPreview ? '#666666' : brush.color
    const dashArray = isPreview ? [8, 6] : null

    switch (shapeType) {
      case 'rectangle': {
        const rect = new scope.Path.Rectangle({
          from,
          to,
          strokeColor,
          strokeWidth: brush.width,
          fillColor: null
        })
        if (dashArray) rect.dashArray = dashArray
        if (isPreview) rect.data = { isPreview: true }
        return rect
      }

      case 'circle': {
        const radius = from.getDistance(to)
        const circle = new scope.Path.Circle({
          center: from,
          radius,
          strokeColor,
          strokeWidth: brush.width,
          fillColor: null
        })
        if (dashArray) circle.dashArray = dashArray
        if (isPreview) circle.data = { isPreview: true }
        return circle
      }

      case 'line': {
        const line = new scope.Path.Line({
          from,
          to,
          strokeColor,
          strokeWidth: brush.width
        })
        if (dashArray) line.dashArray = dashArray
        if (isPreview) line.data = { isPreview: true }
        return line
      }

      default:
        return null
    }
  }

  /** 진행 중인 도형 그리기 취소 (멀티터치 제스처 감지 시 호출) */
  function cancelOperation() {
    if (canvasElement && activePointerId !== null) {
      try { canvasElement.releasePointerCapture(activePointerId) } catch {}
    }
    removePreview()
    startPoint = null
    activePointerId = null
  }

  /**
   * Remove preview shape
   */
  function removePreview() {
    if (previewShape) {
      previewShape.remove()
      previewShape = null
    }
  }

  /**
   * Deactivate shape mode
   */
  function deactivate() {
    removePreview()

    if (canvasElement) {
      if (handlePointerDown) canvasElement.removeEventListener('pointerdown', handlePointerDown)
      if (handlePointerMove) canvasElement.removeEventListener('pointermove', handlePointerMove)
      if (handlePointerUp) {
        canvasElement.removeEventListener('pointerup', handlePointerUp)
        canvasElement.removeEventListener('pointercancel', handlePointerUp)
      }
    }

    canvasElement = null
    handlePointerDown = null
    handlePointerMove = null
    handlePointerUp = null
    activePointerId = null
    isActive = false
    currentShape = null
    startPoint = null
  }

  /**
   * Add rectangle at specific position
   */
  function addRectangle(
    x: number,
    y: number,
    width: number,
    height: number,
    fill?: string
  ): paper.Path.Rectangle | null {
    const scope = getScope()
    if (!scope) return null

    scope.activate()
    const brush = getBrush()
    const rect = new scope.Path.Rectangle({
      point: [x, y],
      size: [width, height],
      strokeColor: brush.color,
      strokeWidth: brush.width,
      fillColor: fill || null
    })

    onShapeCreated?.(rect)
    return rect
  }

  /**
   * Add circle at specific position
   */
  function addCircle(
    centerX: number,
    centerY: number,
    radius: number,
    fill?: string
  ): paper.Path.Circle | null {
    const scope = getScope()
    if (!scope) return null

    scope.activate()
    const brush = getBrush()
    const circle = new scope.Path.Circle({
      center: [centerX, centerY],
      radius,
      strokeColor: brush.color,
      strokeWidth: brush.width,
      fillColor: fill || null
    })

    onShapeCreated?.(circle)
    return circle
  }

  /**
   * Add line between two points
   */
  function addLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): paper.Path.Line | null {
    const scope = getScope()
    if (!scope) return null

    scope.activate()
    const brush = getBrush()
    const line = new scope.Path.Line({
      from: [x1, y1],
      to: [x2, y2],
      strokeColor: brush.color,
      strokeWidth: brush.width
    })

    onShapeCreated?.(line)
    return line
  }

  return {
    // State getters
    get isActive() { return isActive },
    get currentShape() { return currentShape },

    // Methods
    activate,
    deactivate,
    cancelOperation,
    addRectangle,
    addCircle,
    addLine
  }
}

// Type for the return value
export type ShapeTools = ReturnType<typeof createShapeTools>
