/**
 * paperCanvas 줌 라운드트립 회귀 테스트
 *
 * 좌표계 아키텍처 원칙 검증:
 * - 데이터(JSON)는 1.0x baseline project 좌표로만 저장
 * - view.zoom 변경은 시각 스케일만 바꾸며 데이터 좌표를 변경하지 않음
 * - 여러 번 줌 변경 후에도 exportJSON 결과가 동일해야 함
 * - importJSON(json) → exportJSON()은 identity (좌표 보존)
 *
 * canvas_coord_architecture.md "25라운드트립 7회 줌" 검증을 자동화.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import paper from 'paper'
import { createPaperCanvas, type PaperCanvas } from '../../src/lib/canvas/paperCanvas.svelte'

const BASE_W = 612
const BASE_H = 792

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  document.body.appendChild(c)
  return c
}

function addSamplePath(pc: PaperCanvas, segments: Array<[number, number]>) {
  const scope = pc.scope
  if (!scope) throw new Error('scope not ready')
  scope.activate()
  const path = new scope.Path({
    strokeColor: 'black',
    strokeWidth: 2,
    strokeCap: 'round'
  })
  segments.forEach(([x, y]) => path.add(new scope.Point(x, y)))
}

describe('paperCanvas — 줌 좌표계 invariant', () => {
  let pc: PaperCanvas

  beforeEach(() => {
    pc = createPaperCanvas()
    pc.init(makeCanvas(), BASE_W, BASE_H, 1.0)
  })

  it('exportJSON은 view.zoom 값과 무관하게 동일한 결과를 반환', () => {
    addSamplePath(pc, [[100, 100], [200, 150], [300, 200]])
    const baseline = pc.exportJSON()

    // 7회 연속 줌 변경
    const zooms = [1.5, 0.7, 2.0, 1.25, 0.5, 3.0, 1.0]
    for (const z of zooms) {
      pc.setZoom(z)
      const json = pc.exportJSON()
      expect(json, `zoom=${z}에서 exportJSON 결과가 1.0x baseline과 일치해야 함`).toBe(baseline)
    }
  })

  it('importJSON → exportJSON 라운드트립은 identity (1.0x 좌표 보존)', () => {
    addSamplePath(pc, [[50, 50], [150, 250], [400, 600]])
    const original = pc.exportJSON()

    // 줌 != 1 상태에서 importJSON 후 exportJSON도 동일해야 함
    pc.setZoom(2.0)
    pc.importJSON(original)
    const afterRoundTrip = pc.exportJSON()
    expect(afterRoundTrip).toBe(original)

    // 줌 변경 후에도 여전히 동일
    pc.setZoom(0.6)
    expect(pc.exportJSON()).toBe(original)
  })

  it('setZoom은 view.zoom·view.viewSize·canvas.style만 변경, baseDim·아이템 좌표 보존', () => {
    addSamplePath(pc, [[100, 100], [500, 700]])

    const baseline = pc.exportJSON()
    const view = pc.view!
    const canvas = pc.canvas!

    pc.setZoom(2.5)
    expect(view.zoom).toBe(2.5)
    expect(view.viewSize.width).toBe(Math.floor(BASE_W * 2.5))
    expect(view.viewSize.height).toBe(Math.floor(BASE_H * 2.5))
    expect(canvas.style.width).toBe(`${Math.floor(BASE_W * 2.5)}px`)
    expect(pc.baseWidth).toBe(BASE_W)
    expect(pc.baseHeight).toBe(BASE_H)
    expect(pc.exportJSON()).toBe(baseline)

    pc.setZoom(1.0)
    expect(view.zoom).toBe(1.0)
    expect(canvas.style.width).toBe(`${BASE_W}px`)
    expect(pc.exportJSON()).toBe(baseline)
  })

  it('viewToProject은 줌 변경 후에도 동일 view 좌표 → 동일 project 좌표', () => {
    const view = pc.view!
    // 줌=1에서 (100,200)에 클릭하면 project (100,200)
    const p1 = view.viewToProject(new paper.Point(100, 200))
    expect(p1.x).toBeCloseTo(100, 5)
    expect(p1.y).toBeCloseTo(200, 5)

    // 줌=2에서 같은 project 좌표를 얻으려면 view 좌표는 (200,400)
    pc.setZoom(2.0)
    const p2 = pc.view!.viewToProject(new paper.Point(200, 400))
    expect(p2.x).toBeCloseTo(100, 5)
    expect(p2.y).toBeCloseTo(200, 5)

    // 줌=0.5에서 같은 project 좌표를 얻으려면 view 좌표는 (50,100)
    pc.setZoom(0.5)
    const p3 = pc.view!.viewToProject(new paper.Point(50, 100))
    expect(p3.x).toBeCloseTo(100, 5)
    expect(p3.y).toBeCloseTo(200, 5)
  })

  it('25 라운드트립: import → setZoom → export → import 반복해도 좌표 drift 없음', () => {
    addSamplePath(pc, [[10, 20], [200, 300], [550, 700], [400, 100]])
    const baseline = pc.exportJSON()

    let current = baseline
    const zooms = [1.0, 1.5, 2.0, 0.5, 1.25, 0.8, 3.0, 0.7, 2.5, 1.0]

    for (let i = 0; i < 25; i++) {
      const z = zooms[i % zooms.length]
      pc.setZoom(z)
      pc.importJSON(current)
      current = pc.exportJSON()
      expect(current, `라운드트립 ${i + 1}회차(zoom=${z})에서 좌표 drift 발생`).toBe(baseline)
    }
  })

  it('페이지 언로드/재방문 시뮬레이션: dispose → 재생성 → importJSON으로 좌표 보존', () => {
    addSamplePath(pc, [[123, 456], [321, 654]])
    const saved = pc.exportJSON()

    // 페이지가 viewport 밖으로 나가 dispose된 상황 시뮬레이션
    pc.dispose()

    // 재방문: 새 PaperCanvas 인스턴스, 다른 줌으로 init
    const reborn = createPaperCanvas()
    reborn.init(makeCanvas(), BASE_W, BASE_H, 1.8)
    reborn.importJSON(saved)
    expect(reborn.exportJSON()).toBe(saved)

    // 재방문 후 줌을 다시 변경해도 좌표는 그대로
    reborn.setZoom(0.4)
    expect(reborn.exportJSON()).toBe(saved)
    reborn.setZoom(1.0)
    expect(reborn.exportJSON()).toBe(saved)
  })
})
