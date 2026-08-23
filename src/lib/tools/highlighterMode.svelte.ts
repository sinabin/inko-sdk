/**
 * Highlighter Mode Module
 * 형광펜 도구 — 반투명 자유곡선으로 텍스트 강조
 *
 * drawingMode 기반이지만 형광펜 특성 적용:
 * - 고정 반투명도 (0.3)
 * - blendMode: multiply (겹침 시 자연스러운 색상 혼합)
 * - strokeCap: butt (평평한 끝)
 * - 스타일러스 압력 미적용 (균일한 두께)
 */
import paper from 'paper'

/** 형광펜 고정 반투명도 */
const HIGHLIGHTER_OPACITY = 0.3

export interface HighlighterModeOptions {
  getScope: () => paper.PaperScope | null
  getBrush: () => { color: string; width: number }
  onPathCreated?: (path: paper.Path) => void
  onDrawStart?: () => void
  onDrawEnd?: () => void
}

export function createHighlighterMode(options: HighlighterModeOptions) {
  const { getScope, getBrush, onPathCreated, onDrawStart, onDrawEnd } = options

  let isActive = $state(false)
  let isDrawing = $state(false)
  let currentPath: paper.Path | null = null
  let lastPoint: paper.Point | null = null

  let canvasElement: HTMLCanvasElement | null = null
  let activePointerId: number | null = null

  let handlePointerDown: ((e: PointerEvent) => void) | null = null
  let handlePointerMove: ((e: PointerEvent) => void) | null = null
  let handlePointerUp: ((e: PointerEvent) => void) | null = null

  /** PointerEvent 좌표 → Paper.js project 좌표 변환 */
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

  /** 진행 중인 드로잉 취소 (멀티터치 제스처 감지 시 호출) */
  function cancelOperation() {
    if (canvasElement && activePointerId !== null) {
      try { canvasElement.releasePointerCapture(activePointerId) } catch {}
    }
    if (currentPath) {
      currentPath.remove()
      currentPath = null
    }
    lastPoint = null
    isDrawing = false
    activePointerId = null
  }

  /** 현재 path 마무리 (smooth + 콜백) */
  function finalizePath() {
    if (currentPath) {
      if (currentPath.segments.length > 1) {
        // simplify()는 세그먼트를 재피팅해 위치 드리프트 발생 → smooth()로 핸들만 조정해 원본 점 보존
        currentPath.smooth({ type: 'continuous' })
        onPathCreated?.(currentPath)
      } else {
        currentPath.remove()
      }
    }
    currentPath = null
    lastPoint = null
    isDrawing = false
    onDrawEnd?.()
  }

  /** 형광펜 모드 활성화 */
  function activate() {
    const scope = getScope()
    if (!scope) {
      console.warn('[HighlighterMode] No Paper.js scope available')
      return
    }

    scope.activate()
    isActive = true

    canvasElement = scope.view?.element as HTMLCanvasElement | null
    if (!canvasElement) {
      console.warn('[HighlighterMode] No canvas element available')
      return
    }

    handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      try { canvasElement!.setPointerCapture(e.pointerId) } catch {}
      activePointerId = e.pointerId

      // 미완성 path 먼저 마무리
      if (currentPath) {
        finalizePath()
      }

      const point = getProjectPoint(e)
      const brush = getBrush()

      isDrawing = true
      lastPoint = null
      onDrawStart?.()

      scope.activate()
      currentPath = new scope.Path({
        strokeColor: brush.color,
        strokeWidth: brush.width,
        strokeCap: 'butt',
        strokeJoin: 'round',
        opacity: HIGHLIGHTER_OPACITY,
        blendMode: 'multiply',
        data: { isHighlighter: true }
      })
      currentPath.add(point)
    }

    handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return
      if (!isDrawing || !currentPath) return

      // pointerup 누락 감지
      if (e.buttons === 0) {
        finalizePath()
        activePointerId = null
        return
      }

      const point = getProjectPoint(e)
      const minDist = 3

      if (!lastPoint || point.getDistance(lastPoint) >= minDist) {
        currentPath.add(point)
        lastPoint = point
      }
    }

    handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return

      finalizePath()
      activePointerId = null

      try { canvasElement!.releasePointerCapture(e.pointerId) } catch {}
    }

    canvasElement.addEventListener('pointerdown', handlePointerDown)
    canvasElement.addEventListener('pointermove', handlePointerMove)
    canvasElement.addEventListener('pointerup', handlePointerUp)
    canvasElement.addEventListener('pointercancel', handlePointerUp)
  }

  /** 형광펜 모드 비활성화 */
  function deactivate() {
    if (canvasElement) {
      if (handlePointerDown) canvasElement.removeEventListener('pointerdown', handlePointerDown)
      if (handlePointerMove) canvasElement.removeEventListener('pointermove', handlePointerMove)
      if (handlePointerUp) {
        canvasElement.removeEventListener('pointerup', handlePointerUp)
        canvasElement.removeEventListener('pointercancel', handlePointerUp)
      }
    }

    if (currentPath) {
      currentPath.remove()
      currentPath = null
    }

    canvasElement = null
    handlePointerDown = null
    handlePointerMove = null
    handlePointerUp = null
    activePointerId = null
    isActive = false
    isDrawing = false
    lastPoint = null
  }

  return {
    get isActive() { return isActive },
    get isDrawing() { return isDrawing },
    activate,
    deactivate,
    cancelOperation
  }
}

export type HighlighterMode = ReturnType<typeof createHighlighterMode>
