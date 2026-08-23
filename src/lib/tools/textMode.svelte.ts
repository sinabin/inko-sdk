/**
 * Text Mode Module
 * 임베드 환경 안정화: Paper.js Tool 대신 직접 PointerEvent 처리
 * 도형 도구와 동일한 pointerdown→pointermove→pointerup 패턴으로 영역 지정
 */
import paper from 'paper'
import { getInputConfig } from '../utils/inputDetection'

export interface TextModeOptions {
  getScope: () => paper.PaperScope | null
  getBrush: () => { color: string }
  getFontSize?: () => number
  getFontFamily?: () => string
  onTextCreated?: (text: paper.PointText) => void
  onTextEdit?: (text: paper.PointText) => void
  onRequestInput?: (existingText?: string) => void
}

export function createTextMode(options: TextModeOptions) {
  const {
    getScope,
    getBrush,
    getFontSize = () => 16,
    getFontFamily = () => 'sans-serif',
    onTextCreated,
    onTextEdit,
    onRequestInput
  } = options

  let isActive = $state(false)
  let pendingPosition: paper.Point | null = null
  let editingText: paper.PointText | null = null

  // 커서 표시 상태
  let cursorIndicator: paper.Path.Line | null = null
  let blinkInterval: ReturnType<typeof setInterval> | null = null

  // 포인터 이벤트 상태
  let canvasElement: HTMLCanvasElement | null = null
  let activePointerId: number | null = null
  let pointerDownPoint: paper.Point | null = null
  let pointerDownType: string = 'mouse'

  // 드래그 영역 프리뷰
  let previewRect: paper.Path.Rectangle | null = null

  // 이벤트 핸들러 참조
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

  /** 진행 중인 텍스트 배치 취소 (멀티터치 제스처 감지 시 호출) */
  function cancelOperation() {
    if (canvasElement && activePointerId !== null) {
      try { canvasElement.releasePointerCapture(activePointerId) } catch {}
    }
    removePreview()
    activePointerId = null
    pointerDownPoint = null
  }

  /** 프리뷰 사각형 제거 */
  function removePreview(): void {
    if (previewRect) {
      previewRect.remove()
      previewRect = null
    }
  }

  /** 깜빡이는 커서 표시 */
  function showCursorIndicator(point: paper.Point): void {
    removeCursorIndicator()

    const scope = getScope()
    if (!scope) return

    scope.activate()

    const cursorFontSize = getFontSize()
    const cursorHeight = cursorFontSize * 1.2
    const from = new paper.Point(point.x, point.y - cursorHeight)
    const to = new paper.Point(point.x, point.y)

    cursorIndicator = new scope.Path.Line(from, to)
    cursorIndicator.strokeColor = new paper.Color('#1890ff')
    cursorIndicator.strokeWidth = 2
    cursorIndicator.data = { isTextCursor: true, isSelectionUI: true }

    let visible = true
    blinkInterval = setInterval(() => {
      if (cursorIndicator) {
        visible = !visible
        cursorIndicator.visible = visible
      }
    }, 530)
  }

  /** 커서 표시 제거 */
  function removeCursorIndicator(): void {
    if (blinkInterval) {
      clearInterval(blinkInterval)
      blinkInterval = null
    }
    if (cursorIndicator) {
      cursorIndicator.remove()
      cursorIndicator = null
    }
  }

  /** 텍스트 모드 활성화 (도형 도구와 동일한 3단계 포인터 이벤트 패턴) */
  function activate() {
    const scope = getScope()
    if (!scope) {
      console.warn('[TextMode] No Paper.js scope available')
      return
    }

    scope.activate()
    isActive = true

    canvasElement = scope.view?.element as HTMLCanvasElement | null
    if (!canvasElement) return

    handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      // 합성 mouse/click 이벤트 차단 — 터치 후 ~300ms synthetic click 방지
      e.preventDefault()

      try { canvasElement!.setPointerCapture(e.pointerId) } catch {}
      activePointerId = e.pointerId
      pointerDownType = e.pointerType
      pointerDownPoint = getProjectPoint(e)
      removePreview()
    }

    handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return
      if (!pointerDownPoint) return

      const scope = getScope()
      if (!scope) return

      const point = getProjectPoint(e)

      // 일정 거리 이상 드래그 시 프리뷰 사각형 표시
      const tapThreshold = pointerDownType === 'mouse' ? 10 : 30
      if (point.getDistance(pointerDownPoint) > tapThreshold) {
        removePreview()
        scope.activate()
        previewRect = new scope.Path.Rectangle({
          from: pointerDownPoint,
          to: point,
          strokeColor: '#1890ff',
          strokeWidth: 1.5,
          fillColor: new paper.Color(24 / 255, 144 / 255, 255 / 255, 0.08),
          dashArray: [6, 4]
        })
        previewRect.data = { isPreview: true, isSelectionUI: true }
      }
    }

    handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return

      const scope = getScope()
      if (!scope || !pointerDownPoint) {
        activePointerId = null
        pointerDownPoint = null
        removePreview()
        try { canvasElement!.releasePointerCapture(e.pointerId) } catch {}
        return
      }

      const point = getProjectPoint(e)
      removePreview()

      // 탭/드래그 판정
      const tapThreshold = pointerDownType === 'mouse' ? 10 : 30
      const dragDist = point.getDistance(pointerDownPoint)

      if (dragDist <= tapThreshold) {
        // --- 탭: 기존 텍스트 편집 또는 새 텍스트 추가 ---
        const inputConfig = getInputConfig()
        const hitResult = scope.project.hitTest(pointerDownPoint, {
          fill: true,
          stroke: true,
          tolerance: inputConfig.hitTestTolerance
        })

        if (hitResult?.item instanceof paper.PointText) {
          editingText = hitResult.item
          pendingPosition = editingText.point
          showCursorIndicator(pendingPosition)
          onRequestInput?.(editingText.content)
        } else {
          pendingPosition = pointerDownPoint
          editingText = null
          showCursorIndicator(pendingPosition)
          onRequestInput?.()
        }
      } else {
        // --- 드래그: 영역의 좌상단에 텍스트 배치 ---
        const minX = Math.min(pointerDownPoint.x, point.x)
        const maxY = Math.max(pointerDownPoint.y, point.y)
        pendingPosition = new paper.Point(minX, maxY)
        editingText = null
        showCursorIndicator(pendingPosition)
        onRequestInput?.()
      }

      activePointerId = null
      pointerDownPoint = null
      try { canvasElement!.releasePointerCapture(e.pointerId) } catch {}
    }

    canvasElement.addEventListener('pointerdown', handlePointerDown)
    canvasElement.addEventListener('pointermove', handlePointerMove)
    canvasElement.addEventListener('pointerup', handlePointerUp)
    canvasElement.addEventListener('pointercancel', handlePointerUp)
  }

  /** 텍스트 모드 비활성화 */
  function deactivate() {
    removeCursorIndicator()
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
    pointerDownPoint = null
    pointerDownType = 'mouse'
    isActive = false
    pendingPosition = null
    editingText = null
  }

  /**
   * Confirm text input
   */
  function confirmText(content: string) {
    removeCursorIndicator()

    const scope = getScope()
    if (!scope || !pendingPosition) return

    scope.activate()

    if (content.trim() === '') {
      // 빈 텍스트는 기존 것 삭제 — 삭제도 사용자 동작이므로 history 기록 (undo로 복원)
      if (editingText) {
        editingText.remove()
        onTextEdit?.(editingText)
      }
      pendingPosition = null
      editingText = null
      return
    }

    if (editingText) {
      // 기존 텍스트 수정
      editingText.content = content
      onTextEdit?.(editingText)
    } else {
      // 새 텍스트 생성
      const brush = getBrush()
      const text = new scope.PointText({
        point: pendingPosition,
        content,
        fillColor: brush.color,
        fontSize: getFontSize(),
        fontFamily: getFontFamily()
      })

      onTextCreated?.(text)
    }

    pendingPosition = null
    editingText = null
  }

  /**
   * Cancel text input
   */
  function cancelText() {
    removeCursorIndicator()
    pendingPosition = null
    editingText = null
  }

  /**
   * Add text at specific position
   */
  function addTextAt(
    x: number,
    y: number,
    content: string,
    options?: {
      fontSize?: number
      fontFamily?: string
      color?: string
    }
  ): paper.PointText | null {
    const scope = getScope()
    if (!scope) return null

    scope.activate()
    const brush = getBrush()

    const text = new scope.PointText({
      point: [x, y],
      content,
      fillColor: options?.color ?? brush.color,
      fontSize: options?.fontSize ?? getFontSize(),
      fontFamily: options?.fontFamily ?? getFontFamily()
    })

    onTextCreated?.(text)
    return text
  }

  return {
    // State getters
    get isActive() { return isActive },
    get isEditing() { return editingText !== null },
    get pendingPosition() { return pendingPosition },

    // Methods
    activate,
    deactivate,
    cancelOperation,
    confirmText,
    cancelText,
    addTextAt
  }
}

// Type for the return value
export type TextMode = ReturnType<typeof createTextMode>
