/**
 * Eraser Mode Module — Centerline Split 기반 부분 지우개
 * 임베드 환경 안정화: Paper.js Tool 대신 직접 PointerEvent 처리
 *
 * 지우개 경로를 채워진 윤곽선으로 변환 후,
 * 대상 Path의 중심선(centerline)과 교차점을 찾아 분할하고
 * 지우개 영역 내부 조각만 제거. 원본 스트로크 스타일 보존.
 */
import paper from 'paper'
import { eraserStrokeToOutline, MIN_AREA } from '../utils/pathOutline'

export interface EraserModeOptions {
  getScope: () => paper.PaperScope | null
  eraserWidth?: number
  onEraseComplete?: () => void
}

/** 최소 면적 미만 조각 제거 */
const MIN_FRAGMENT_AREA = MIN_AREA

export function createEraserMode(options: EraserModeOptions) {
  const {
    getScope,
    eraserWidth: initialWidth = 20,
    onEraseComplete
  } = options

  let isActive = $state(false)
  let isErasing = $state(false)
  let eraserWidth = $state(initialWidth)
  let eraserPath: paper.Path | null = null

  // Pointer event state
  let canvasElement: HTMLCanvasElement | null = null
  let activePointerId: number | null = null

  // Event handler references
  let handlePointerDown: ((e: PointerEvent) => void) | null = null
  let handlePointerMove: ((e: PointerEvent) => void) | null = null
  let handlePointerUp: ((e: PointerEvent) => void) | null = null

  // ═══════════════════════════════════════════════════════════
  // Centerline Split 지우개 핵심 알고리즘
  // ═══════════════════════════════════════════════════════════

  /**
   * Centerline Split 기반 부분 지우기 — pointerup 시 일괄 실행
   * 1. 지우개 이동 경로를 eraserWidth 두께의 filled outline으로 변환
   * 2. 대상 Path의 중심선과 지우개 윤곽선의 교차점 탐색
   * 3. 교차점에서 Path를 split하여 조각 생성
   * 4. 지우개 영역 내부 조각 삭제, 외부 조각은 원본 스타일 보존
   */
  function performCenterlineSplit(): void {
    const scope = getScope()
    if (!scope || !eraserPath || eraserPath.segments.length < 1) return

    scope.activate()

    const eraserOutline = eraserStrokeToOutline(eraserPath, eraserWidth, scope)
    if (!eraserOutline) return

    const eraserBounds = eraserOutline.bounds.clone()

    // 레이어 자식 복사본 순회 (순회 중 아이템 삭제가 안전하도록)
    const items = scope.project.activeLayer.children.slice()

    for (const item of items) {
      // 지우개 경로, 프리뷰, 선택 UI는 건너뛰기
      if (item === eraserPath) continue
      if (item.data?.isSelectionUI || item.data?.isPreview) continue

      // 빠른 바운드 체크
      if (!item.bounds.intersects(eraserBounds)) continue

      // PointText: 위치 근접 시 전체 삭제
      if (item instanceof paper.PointText) {
        if (eraserOutline.contains(item.position)) {
          item.remove()
        }
        continue
      }

      // 레거시 isOutline 아이템: Boolean Subtraction 폴백
      if (item.data?.isOutline) {
        legacySubtract(item as paper.Path | paper.CompoundPath, eraserOutline, scope)
        continue
      }

      // Path: Centerline Split
      if (item instanceof paper.Path) {
        splitPathWithEraser(item, eraserOutline, scope)
        continue
      }

      // CompoundPath: 자식별 Centerline Split
      if (item instanceof paper.CompoundPath) {
        splitCompoundPathWithEraser(item, eraserOutline, scope)
      }
    }

    // 잔해 정리
    cleanupSmallFragments(scope)

    // 지우개 윤곽선 제거
    eraserOutline.remove()
  }

  /**
   * Path를 지우개 영역으로 분할 — 교차점 기반 centerline split
   * 교차점 0개: 전체 포함/미포함 판정
   * 교차점 1개: 의미있는 분할 불가 → 전체 포함 여부로 판정
   * 교차점 2개+: closed/open에 따라 분할 처리
   */
  function splitPathWithEraser(
    targetPath: paper.Path,
    eraserOutline: paper.Path | paper.CompoundPath,
    scope: paper.PaperScope
  ): void {
    scope.activate()

    const intersections = targetPath.getIntersections(eraserOutline as paper.Path)

    if (intersections.length === 0) {
      // 교차점 없음 → 전체 포함 또는 미포함
      if (isPathInsideEraser(targetPath, eraserOutline)) {
        targetPath.remove()
      }
      return
    }

    if (intersections.length === 1) {
      // 교차점 1개 → 접선, 의미있는 분할 불가
      if (isPathInsideEraser(targetPath, eraserOutline)) {
        targetPath.remove()
      }
      return
    }

    // 교차점 2개 이상 → 분할
    if (targetPath.closed) {
      splitClosedPath(targetPath, eraserOutline, intersections, scope)
    } else {
      splitOpenPath(targetPath, eraserOutline, intersections, scope)
    }
  }

  /**
   * 닫힌 Path 분할 — 첫 교차점에서 open으로 변환 후 재분할
   */
  function splitClosedPath(
    path: paper.Path,
    eraserOutline: paper.Path | paper.CompoundPath,
    intersections: paper.CurveLocation[],
    scope: paper.PaperScope
  ): void {
    scope.activate()

    const parentLayer = path.parent
    const insertIndex = path.index

    // 원본 스타일 저장
    const style = capturePathStyle(path)

    // 첫 교차점에서 splitAt → 닫힌 경로를 open으로 변환
    const sorted = intersections.slice().sort((a, b) => a.offset - b.offset)
    const firstLoc = sorted[0]

    // splitAt은 offset 기준으로 자르며, closed path에서는 하나의 open path를 반환
    const splitResult = path.splitAt(firstLoc)

    // splitAt이 원본을 변경하고 나머지를 반환
    // closed path의 splitAt: path가 open으로 변환되고, splitResult는 null 또는 path 자체
    const openPath = splitResult || path
    openPath.closed = false

    // 이제 open path에서 나머지 교차점으로 분할
    const newIntersections = openPath.getIntersections(eraserOutline as paper.Path)

    if (newIntersections.length < 1) {
      // 분할 후 교차점이 사라짐 → 전체 포함 여부로 판정
      if (isPathInsideEraser(openPath, eraserOutline)) {
        openPath.remove()
      }
      return
    }

    // open path 분할
    splitOpenPathInternal(openPath, eraserOutline, newIntersections, scope, style, parentLayer, insertIndex)
  }

  /**
   * 열린 Path 분할 — 교차점을 오프셋 내림차순으로 분할
   */
  function splitOpenPath(
    path: paper.Path,
    eraserOutline: paper.Path | paper.CompoundPath,
    intersections: paper.CurveLocation[],
    scope: paper.PaperScope
  ): void {
    scope.activate()

    const parentLayer = path.parent
    const insertIndex = path.index
    const style = capturePathStyle(path)

    splitOpenPathInternal(path, eraserOutline, intersections, scope, style, parentLayer, insertIndex)
  }

  /**
   * Open path 분할 내부 구현 — 교차점 오프셋 내림차순으로 splitAt 실행
   */
  function splitOpenPathInternal(
    path: paper.Path,
    eraserOutline: paper.Path | paper.CompoundPath,
    intersections: paper.CurveLocation[],
    scope: paper.PaperScope,
    style: PathStyle,
    parentLayer: paper.Item,
    insertIndex: number
  ): void {
    // 오프셋 내림차순 정렬 (뒤에서부터 잘라야 앞쪽 오프셋 불변 보장)
    const sorted = intersections.slice().sort((a, b) => b.offset - a.offset)

    // 중복 교차점 제거 (너무 가까운 교차점은 하나로)
    const filtered: paper.CurveLocation[] = []
    for (const loc of sorted) {
      if (filtered.length === 0 || Math.abs(filtered[filtered.length - 1].offset - loc.offset) > 0.5) {
        filtered.push(loc)
      }
    }

    if (filtered.length === 0) {
      if (isPathInsideEraser(path, eraserOutline)) {
        path.remove()
      }
      return
    }

    // 뒤에서부터 분할하여 조각 수집
    const fragments: paper.Path[] = []

    for (const loc of filtered) {
      const splitResult = path.splitAt(loc)
      if (splitResult && splitResult !== path) {
        fragments.push(splitResult)
      }
    }

    // 남은 원본(앞부분)도 조각에 포함
    fragments.push(path)

    // 각 조각의 중점이 지우개 영역 안이면 삭제, 밖이면 유지
    for (const fragment of fragments) {
      if (fragment.segments.length < 1) {
        fragment.remove()
        continue
      }

      const midpoint = getFragmentMidpoint(fragment)
      if (midpoint && eraserOutline.contains(midpoint)) {
        // 지우개 내부 → 삭제
        fragment.remove()
      } else {
        // 지우개 외부 → 원본 스타일 복원
        applyPathStyle(fragment, style)
        // 원본과 같은 부모에 삽입 (path가 이미 레이어에 있으면 불필요)
        if (fragment.parent !== parentLayer) {
          parentLayer.insertChild(insertIndex, fragment)
        }
      }
    }
  }

  /**
   * CompoundPath를 지우개로 분할 — 자식 Path를 개별 분할
   */
  function splitCompoundPathWithEraser(
    compoundPath: paper.CompoundPath,
    eraserOutline: paper.Path | paper.CompoundPath,
    scope: paper.PaperScope
  ): void {
    scope.activate()

    const parentLayer = compoundPath.parent
    const insertIndex = compoundPath.index
    const style = capturePathStyle(compoundPath)

    // CompoundPath의 자식을 개별 Path로 꺼냄
    const children = compoundPath.children.slice() as paper.Path[]

    for (const child of children) {
      // 자식을 레이어로 이동 (CompoundPath에서 분리)
      const extracted = child.clone({ insert: false }) as paper.Path
      // CompoundPath의 스타일 적용
      applyPathStyle(extracted, style)
      parentLayer.insertChild(insertIndex, extracted)

      // 개별 분할
      splitPathWithEraser(extracted, eraserOutline, scope)
    }

    // 원본 CompoundPath 제거
    compoundPath.remove()
  }

  /**
   * 레거시 isOutline 아이템용 Boolean Subtraction 폴백
   * 기존 저장 데이터의 윤곽선 변환 아이템 호환
   */
  function legacySubtract(
    item: paper.Path | paper.CompoundPath,
    eraserOutline: paper.Path | paper.CompoundPath,
    scope: paper.PaperScope
  ): void {
    scope.activate()

    try {
      const result = item.subtract(eraserOutline, { insert: false }) as paper.Path | paper.CompoundPath

      // 결과가 비어있으면 삭제
      const area = Math.abs((result as paper.Path).area ?? 0)
      if (area < MIN_FRAGMENT_AREA) {
        result.remove()
        item.remove()
        return
      }

      if (result instanceof paper.CompoundPath && result.children.length === 0) {
        result.remove()
        item.remove()
        return
      }

      // 결과물로 교체
      result.fillColor = item.fillColor as paper.Color
      result.strokeColor = null
      result.strokeWidth = 0
      result.opacity = item.opacity
      result.data = { ...item.data, isOutline: true }

      const parent = item.parent
      if (parent) {
        parent.insertChild(item.index, result)
      }
      item.remove()
    } catch {
      // subtract 실패 시 전체 삭제
      item.remove()
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 유틸리티
  // ═══════════════════════════════════════════════════════════

  /** Path 스타일 정보 */
  interface PathStyle {
    strokeColor: paper.Color | null
    strokeWidth: number
    strokeCap: string
    strokeJoin: string
    opacity: number
    dashArray: number[]
    data: Record<string, any> | null
  }

  /** Path의 스타일 정보 캡처 */
  function capturePathStyle(source: paper.Item): PathStyle {
    return {
      strokeColor: source.strokeColor ? source.strokeColor.clone() : null,
      strokeWidth: (source as paper.Path).strokeWidth || 1,
      strokeCap: (source as paper.Path).strokeCap || 'round',
      strokeJoin: (source as paper.Path).strokeJoin || 'round',
      opacity: source.opacity ?? 1,
      dashArray: (source as paper.Path).dashArray ? [...(source as paper.Path).dashArray] : [],
      data: source.data ? { ...source.data } : null
    }
  }

  /** Path에 스타일 적용 */
  function applyPathStyle(target: paper.Path, style: PathStyle): void {
    target.strokeColor = style.strokeColor
    target.strokeWidth = style.strokeWidth
    target.strokeCap = style.strokeCap
    target.strokeJoin = style.strokeJoin
    target.opacity = style.opacity
    if (style.dashArray.length > 0) {
      target.dashArray = style.dashArray
    }
    if (style.data) {
      target.data = { ...style.data }
    }
  }

  /** Path의 중점 좌표 반환 (containment 테스트용) */
  function getFragmentMidpoint(fragment: paper.Path): paper.Point | null {
    if (fragment.length <= 0) {
      return fragment.segments.length > 0 ? fragment.segments[0].point : null
    }
    return fragment.getPointAt(fragment.length / 2)
  }

  /** Path 전체가 지우개 영역 안에 있는지 판정 (중점 + 양 끝점) */
  function isPathInsideEraser(
    path: paper.Path,
    eraserOutline: paper.Path | paper.CompoundPath
  ): boolean {
    // 중점 체크
    const midpoint = getFragmentMidpoint(path)
    if (midpoint && !eraserOutline.contains(midpoint)) return false

    // 시작점 체크
    if (path.segments.length > 0) {
      if (!eraserOutline.contains(path.firstSegment.point)) return false
    }

    // 끝점 체크
    if (path.segments.length > 1) {
      if (!eraserOutline.contains(path.lastSegment.point)) return false
    }

    return true
  }

  /** 최소 길이/면적 미만의 잔해 조각 제거 */
  function cleanupSmallFragments(scope: paper.PaperScope): void {
    const items = scope.project.activeLayer.children.slice()
    for (const item of items) {
      if (item === eraserPath) continue
      if (item.data?.isSelectionUI || item.data?.isPreview) continue

      if (item instanceof paper.Path) {
        if (item.data?.isOutline) {
          // 레거시 isOutline: 면적 기반 정리
          const area = Math.abs(item.area ?? 0)
          if (area < MIN_FRAGMENT_AREA) {
            item.remove()
          }
        } else {
          // 스트로크 Path: 길이 기반 정리
          if (item.segments.length > 0 && item.length < 3) {
            item.remove()
          }
        }
      } else if (item instanceof paper.CompoundPath) {
        const area = Math.abs((item as any).area ?? 0)
        if (area < MIN_FRAGMENT_AREA) {
          item.remove()
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PointerEvent 처리
  // ═══════════════════════════════════════════════════════════

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

  /** 진행 중인 지우기 취소 (멀티터치 제스처 감지 시 호출) */
  function cancelOperation() {
    if (canvasElement && activePointerId !== null) {
      try { canvasElement.releasePointerCapture(activePointerId) } catch {}
    }
    if (eraserPath) {
      eraserPath.remove()
      eraserPath = null
    }
    isErasing = false
    activePointerId = null
  }

  /** 지우기 경로 마무리 */
  function finalizeErase(): void {
    // Centerline Split 실행 (pointerup 시)
    if (eraserPath && eraserPath.segments.length >= 1) {
      performCenterlineSplit()
    }

    // 지우개 경로 제거
    if (eraserPath) {
      eraserPath.remove()
      eraserPath = null
    }

    isErasing = false
    onEraseComplete?.()
  }

  /** Activate eraser mode */
  function activate(): void {
    const scope = getScope()
    if (!scope) {
      console.warn('[EraserMode] No Paper.js scope available')
      return
    }

    scope.activate()
    isActive = true

    canvasElement = scope.view?.element as HTMLCanvasElement | null
    if (!canvasElement) {
      console.warn('[EraserMode] No canvas element available')
      return
    }

    handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      const scope = getScope()
      if (!scope) return

      try { canvasElement!.setPointerCapture(e.pointerId) } catch {}
      activePointerId = e.pointerId

      // 이전 지우개 경로가 남아있으면 먼저 정리
      if (eraserPath) {
        finalizeErase()
      }

      const point = getProjectPoint(e)

      isErasing = true
      scope.activate()
      eraserPath = new scope.Path({
        strokeWidth: 1,
        strokeColor: null
      })
      eraserPath.add(point)
    }

    handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return
      if (!isErasing || !eraserPath) return

      const point = getProjectPoint(e)
      eraserPath.add(point)

    }

    handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return

      finalizeErase()
      activePointerId = null

      try { canvasElement!.releasePointerCapture(e.pointerId) } catch {}
    }

    canvasElement.addEventListener('pointerdown', handlePointerDown)
    canvasElement.addEventListener('pointermove', handlePointerMove)
    canvasElement.addEventListener('pointerup', handlePointerUp)
    canvasElement.addEventListener('pointercancel', handlePointerUp)
  }

  /** Deactivate eraser mode */
  function deactivate(): void {
    if (canvasElement) {
      if (handlePointerDown) canvasElement.removeEventListener('pointerdown', handlePointerDown)
      if (handlePointerMove) canvasElement.removeEventListener('pointermove', handlePointerMove)
      if (handlePointerUp) {
        canvasElement.removeEventListener('pointerup', handlePointerUp)
        canvasElement.removeEventListener('pointercancel', handlePointerUp)
      }
    }

    if (eraserPath) {
      eraserPath.remove()
      eraserPath = null
    }

    canvasElement = null
    handlePointerDown = null
    handlePointerMove = null
    handlePointerUp = null
    activePointerId = null
    isActive = false
    isErasing = false
  }

  /** Toggle eraser mode */
  function toggle(): void {
    if (isActive) {
      deactivate()
    } else {
      activate()
    }
  }

  /** Set eraser width */
  function setEraserWidth(width: number): void {
    eraserWidth = Math.max(5, Math.min(100, width))
  }

  return {
    // State getters
    get isActive() { return isActive },
    get isErasing() { return isErasing },
    get eraserWidth() { return eraserWidth },

    // Methods
    activate,
    deactivate,
    toggle,
    setEraserWidth,
    cancelOperation
  }
}

// Type for the return value
export type EraserMode = ReturnType<typeof createEraserMode>
