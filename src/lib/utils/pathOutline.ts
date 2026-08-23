/** 스트로크 Path를 채워진 윤곽선(filled outline)으로 변환하는 유틸리티 (지우개 윤곽선 생성용) */
import paper from 'paper'

/** flatten 정밀도 (작을수록 정밀하지만 느림) */
const DEFAULT_FLATNESS = 1.5
/** 라운드 캡 세미서클 근사 세그먼트 수 */
const CAP_SEGMENTS = 8
/** 최소 유효 면적 (이보다 작으면 잔해로 간주) */
export const MIN_AREA = 4

/** 지우개 경로를 윤곽선으로 변환 (eraserWidth를 별도로 받아 처리) */
export function eraserStrokeToOutline(
  eraserPath: paper.Path,
  eraserWidth: number,
  scope: paper.PaperScope
): paper.Path | paper.CompoundPath | null {
  scope.activate()

  const halfWidth = eraserWidth / 2

  // 단일 점 → Circle
  if (eraserPath.segments.length <= 1) {
    const center = eraserPath.segments.length === 1
      ? eraserPath.segments[0].point
      : eraserPath.position
    return new scope.Path.Circle({
      center,
      radius: halfWidth,
      fillColor: new scope.Color('black'),
      insert: false
    }) as paper.Path
  }

  // 곡선을 직선 세그먼트로 분해
  const flat = eraserPath.clone({ insert: false }) as paper.Path
  flat.flatten(DEFAULT_FLATNESS)

  if (flat.segments.length < 2) {
    flat.remove()
    return null
  }

  const points = flat.segments.map(s => s.point.clone())
  flat.remove()

  // 지우개 경로는 항상 open
  return buildOpenOutline(points, halfWidth, scope)
}

/** Open path의 닫힌 윤곽선 생성 (왼쪽 오프셋 → 끝 캡 → 오른쪽 오프셋 역순 → 시작 캡) */
function buildOpenOutline(
  points: paper.Point[],
  halfWidth: number,
  scope: paper.PaperScope
): paper.Path | null {
  const n = points.length
  if (n < 2) return null

  // 각 점의 법선 벡터 산출 (접선의 90도 회전)
  const normals = computeNormals(points, false)

  // 법선 방향으로 halfWidth만큼 오프셋하여 좌/우 경계선 생성
  const leftPoints: paper.Point[] = []   // +법선 방향 (스트로크 왼쪽)
  const rightPoints: paper.Point[] = []  // -법선 방향 (스트로크 오른쪽)

  for (let i = 0; i < n; i++) {
    const normal = normals[i]
    leftPoints.push(points[i].add(normal.multiply(halfWidth)))
    rightPoints.push(points[i].add(normal.multiply(-halfWidth)))
  }

  // 윤곽선 조립: 왼쪽 → 끝 캡 → 오른쪽(역순) → 시작 캡 → 닫힘
  const outlinePoints: paper.Point[] = []

  outlinePoints.push(...leftPoints)

  // 끝점에서 좌→우를 잇는 반원 캡
  const endCap = buildSemicircle(
    points[n - 1],
    leftPoints[n - 1],
    rightPoints[n - 1],
    halfWidth,
    scope
  )
  outlinePoints.push(...endCap)

  // 오른쪽 오프셋을 역방향으로 추가 (닫힌 윤곽 형성)
  for (let i = n - 1; i >= 0; i--) {
    outlinePoints.push(rightPoints[i])
  }

  // 시작점에서 우→좌를 잇는 반원 캡
  const startCap = buildSemicircle(
    points[0],
    rightPoints[0],
    leftPoints[0],
    halfWidth,
    scope
  )
  outlinePoints.push(...startCap)

  const outline = new scope.Path({
    segments: outlinePoints,
    closed: true,
    insert: false
  })

  return outline
}

/** 반원(라운드 캡) 근사 포인트 생성 (center 기준 startPt→endPt 호) */
function buildSemicircle(
  center: paper.Point,
  startPt: paper.Point,
  endPt: paper.Point,
  _radius: number,
  _scope: paper.PaperScope
): paper.Point[] {
  const points: paper.Point[] = []

  // 각 점에서 center까지의 방향 각도 (라디안)
  const startAngle = Math.atan2(
    startPt.y - center.y,
    startPt.x - center.x
  )
  const endAngle = Math.atan2(
    endPt.y - center.y,
    endPt.x - center.x
  )

  // 각도 차이를 0~2pi 범위로 정규화 후, 1.5pi 초과 시 음의 방향으로 보정 → 반원 보장
  let angleDiff = endAngle - startAngle
  if (angleDiff < 0) angleDiff += Math.PI * 2
  if (angleDiff > Math.PI * 1.5) angleDiff -= Math.PI * 2

  const radius = center.getDistance(startPt)

  for (let i = 1; i < CAP_SEGMENTS; i++) {
    const t = i / CAP_SEGMENTS
    const angle = startAngle + angleDiff * t
    points.push(new paper.Point(
      center.x + Math.cos(angle) * radius,
      center.y + Math.sin(angle) * radius
    ))
  }

  return points
}

/** 각 점에서의 법선 벡터 산출 (인접 접선 평균의 90도 회전) */
function computeNormals(points: paper.Point[], closed: boolean): paper.Point[] {
  const n = points.length
  const normals: paper.Point[] = []

  for (let i = 0; i < n; i++) {
    let prevIdx: number
    let nextIdx: number

    if (closed) {
      prevIdx = (i - 1 + n) % n
      nextIdx = (i + 1) % n
    } else {
      prevIdx = Math.max(0, i - 1)
      nextIdx = Math.min(n - 1, i + 1)
    }

    // 이전/다음 세그먼트 방향
    const prevDir = points[i].subtract(points[prevIdx])
    const nextDir = points[nextIdx].subtract(points[i])

    // 평균 접선 방향
    let tangent: paper.Point

    if (prevIdx === i) {
      tangent = nextDir       // 첫 번째 점
    } else if (nextIdx === i) {
      tangent = prevDir       // 마지막 점
    } else {
      tangent = prevDir.normalize().add(nextDir.normalize())
    }

    const tangentLength = tangent.length
    if (tangentLength < 1e-6) {
      // 방향이 정반대인 경우 이전 세그먼트 방향 사용
      tangent = prevDir
    }

    // 법선 = 접선의 90도 회전
    const normal = tangent.normalize().rotate(90, new paper.Point(0, 0))
    normals.push(normal)
  }

  return normals
}
