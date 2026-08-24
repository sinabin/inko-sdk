import { beforeEach, describe, expect, it } from 'vitest'
import paper from 'paper'
import { eraserStrokeToOutline, MIN_AREA } from '../../src/lib/utils/pathOutline'

describe('pathOutline', () => {
  let scope: paper.PaperScope

  beforeEach(() => {
    scope = new paper.PaperScope()
    scope.setup(new scope.Size(800, 600))
  })

  it('최소 유효 면적 계약을 공개한다', () => {
    expect(MIN_AREA).toBe(4)
  })

  it('빈 stroke는 position 중심의 원으로 변환한다', () => {
    const eraser = new scope.Path({ insert: false })
    eraser.position = new scope.Point(30, 40)
    const result = eraserStrokeToOutline(eraser, 20, scope) as paper.Path
    expect(result).toBeInstanceOf(scope.Path)
    expect(result.closed).toBe(true)
    expect(result.bounds.width).toBeCloseTo(20, 1)
    expect(result.bounds.height).toBeCloseTo(20, 1)
    expect(result.parent).toBeNull()
  })

  it('단일 점 stroke는 그 점 중심의 원으로 변환한다', () => {
    const eraser = new scope.Path({ segments: [[100, 120]], insert: false })
    const result = eraserStrokeToOutline(eraser, 12, scope) as paper.Path
    expect(result.position.x).toBeCloseTo(100)
    expect(result.position.y).toBeCloseTo(120)
    expect(result.bounds.width).toBeCloseTo(12, 1)
  })

  it('직선은 round cap을 가진 닫힌 윤곽선이 된다', () => {
    const eraser = new scope.Path({ segments: [[20, 50], [220, 50]], insert: false })
    const result = eraserStrokeToOutline(eraser, 20, scope) as paper.Path
    expect(result.closed).toBe(true)
    expect(result.segments.length).toBeGreaterThan(10)
    expect(result.bounds.left).toBeLessThanOrEqual(20)
    expect(result.bounds.right).toBeGreaterThanOrEqual(220)
    expect(result.bounds.height).toBeCloseTo(20, 0)
    expect(Math.abs(result.area)).toBeGreaterThan(3_500)
  })

  it('곡선과 꺾인 stroke도 유한한 윤곽 geometry를 만든다', () => {
    const curved = new scope.Path({
      segments: [
        { point: [10, 20], handleOut: [80, 0] },
        { point: [150, 100], handleIn: [-80, 0], handleOut: [40, 50] },
        { point: [260, 40], handleIn: [-40, 50] }
      ],
      insert: false
    })
    const result = eraserStrokeToOutline(curved, 18, scope) as paper.Path
    expect(result.closed).toBe(true)
    expect(result.segments.length).toBeGreaterThan(20)
    expect(result.segments.every((segment) =>
      Number.isFinite(segment.point.x) && Number.isFinite(segment.point.y))).toBe(true)
    expect(Math.abs(result.area)).toBeGreaterThan(MIN_AREA)
  })

  it('180도 되돌아가는 점에서도 zero tangent를 이전 방향으로 폴백한다', () => {
    const eraser = new scope.Path({
      segments: [[0, 0], [100, 0], [0, 0]],
      insert: false
    })
    const result = eraserStrokeToOutline(eraser, 10, scope) as paper.Path
    expect(result).not.toBeNull()
    expect(result.segments.every((segment) =>
      Number.isFinite(segment.point.x) && Number.isFinite(segment.point.y))).toBe(true)
  })
})
