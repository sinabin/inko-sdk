/** 펜 도구 모듈 — PointerEvent 직접 처리, Paper.js는 Path 생성/렌더링만 담당 (임베드 환경 pointerup 누락 방지) */
import paper from 'paper'
import { isStylusInput, getStylusPressure } from '../utils/inputDetection'
import { PEN_PRESSURE_GAIN } from '../../types'

export interface DrawingModeOptions {
  getScope: () => paper.PaperScope | null // Paper.js 스코프 반환
  getBrush: () => {
    color: string
    width: number
    opacity?: number
    pressureSensitivity?: number // 0-100, pressureGain ratio (50=기본)
  }
  onPathCreated?: (path: paper.Path) => void // Path 생성 완료 콜백
  onDrawStart?: () => void // 드로잉 시작 콜백
  onDrawEnd?: () => void // 드로잉 종료 콜백
}

export function createDrawingMode(options: DrawingModeOptions) {
  const { getScope, getBrush, onPathCreated, onDrawStart, onDrawEnd } = options

  let isActive = $state(false)
  let isDrawing = $state(false)
  let currentPath: paper.Path | null = null
  let lastPoint: paper.Point | null = null

  // Pointer 이벤트 상태
  let canvasElement: HTMLCanvasElement | null = null
  let activePointerId: number | null = null
  let currentPressure = 0

  // 이벤트 핸들러 참조 (removeEventListener용)
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
    currentPressure = 0
  }

  /** 현재 path 마무리 (smooth + 콜백) */
  function finalizePath() {
    if (currentPath) {
      if (currentPath.segments.length > 1) {
        // simplify()는 세그먼트를 재피팅해 위치 드리프트 발생 → smooth()로 핸들만 조정해 원본 점 보존
        currentPath.smooth({ type: 'continuous' })
        onPathCreated?.(currentPath)
      } else {
        // 점 하나짜리 path는 무효하므로 제거
        currentPath.remove()
      }
    }
    currentPath = null
    lastPoint = null
    isDrawing = false
    onDrawEnd?.()
  }

  /** 펜 모드 활성화 (PointerEvent 직접 처리) */
  function activate() {
    const scope = getScope()
    if (!scope) {
      console.warn('[DrawingMode] No Paper.js scope available')
      return
    }

    scope.activate()
    isActive = true

    canvasElement = scope.view?.element as HTMLCanvasElement | null
    if (!canvasElement) {
      console.warn('[DrawingMode] No canvas element available')
      return
    }

    handlePointerDown = (e: PointerEvent) => {
      // primary pointer만 처리
      if (!e.isPrimary) return
      // 마우스 좌클릭만 처리
      if (e.pointerType === 'mouse' && e.button !== 0) return

      // Pointer capture: pointerup 전달 보장
      try { canvasElement!.setPointerCapture(e.pointerId) } catch {}
      activePointerId = e.pointerId

      // 미완성 스트로크 먼저 마무리
      if (currentPath) {
        finalizePath()
      }

      const point = getProjectPoint(e)
      const brush = getBrush()

      currentPressure = getStylusPressure(e) ?? 0
      isDrawing = true
      lastPoint = null
      onDrawStart?.()

      scope.activate()
      currentPath = new scope.Path({
        strokeColor: brush.color,
        strokeWidth: brush.width,
        strokeCap: 'round',
        strokeJoin: 'round',
        opacity: brush.opacity ?? 1
      })
      currentPath.add(point)
    }

    handlePointerMove = (e: PointerEvent) => {
      // 활성 pointer만 처리
      if (e.pointerId !== activePointerId) return
      if (!isDrawing || !currentPath) return

      // pointerup 누락 감지: 버튼 미눌림 시 path 마무리
      if (e.buttons === 0) {
        finalizePath()
        activePointerId = null
        return
      }

      // S Pen 압력 값 업데이트
      const pressure = getStylusPressure(e)
      if (pressure !== null) currentPressure = pressure

      const point = getProjectPoint(e)
      const minDist = isStylusInput() ? 1 : 3

      if (!lastPoint || point.getDistance(lastPoint) >= minDist) {
        // S Pen 압력 기반 strokeWidth — 단일 펜 표준 pressureGain × 사용자 감도(50=1.0)
        if (isStylusInput() && currentPressure > 0) {
          const brush = getBrush()
          // pressureSensitivity 0=무시, 50=1.0(기본), 100=2.0(강조)
          const sensRatio = (brush.pressureSensitivity ?? 50) / 50
          const effectiveGain = PEN_PRESSURE_GAIN * sensRatio
          if (effectiveGain > 0) {
            const pressureWidth = brush.width * (0.3 + currentPressure * effectiveGain)
            currentPath.strokeWidth = pressureWidth
          }
        }
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

  /** 펜 모드 비활성화 */
  function deactivate() {
    // 이벤트 리스너 정리
    if (canvasElement) {
      if (handlePointerDown) canvasElement.removeEventListener('pointerdown', handlePointerDown)
      if (handlePointerMove) canvasElement.removeEventListener('pointermove', handlePointerMove)
      if (handlePointerUp) {
        canvasElement.removeEventListener('pointerup', handlePointerUp)
        canvasElement.removeEventListener('pointercancel', handlePointerUp)
      }
    }

    // 미완성 path 정리
    if (currentPath) {
      currentPath.remove()
      currentPath = null
    }

    canvasElement = null
    handlePointerDown = null
    handlePointerMove = null
    handlePointerUp = null
    activePointerId = null
    currentPressure = 0
    isActive = false
    isDrawing = false
    lastPoint = null
  }

  /** 펜 모드 토글 */
  function toggle() {
    if (isActive) {
      deactivate()
    } else {
      activate()
    }
  }

  return {
    get isActive() { return isActive },
    get isDrawing() { return isDrawing },

    activate,
    deactivate,
    toggle,
    cancelOperation
  }
}

export type DrawingMode = ReturnType<typeof createDrawingMode>
