/**
 * 페이지 언로드/재방문 시 캔버스 보존 E2E 검증
 *
 * 검증 시나리오:
 * 1. SDK 예제로 멀티 페이지 PDF 로드
 * 2. 펜 도구로 1페이지에 스트로크
 * 3. 호스트에 전달된 1페이지 Paper.js 편집 상태 캡처 (baseline)
 * 4. 페이지 8 이상으로 스크롤 → 1페이지가 viewport ±2 범위 밖으로 이탈하여 unload
 * 5. 1페이지로 복귀
 * 6. SDK save로 직렬화한 1페이지 상태 → baseline과 구조적으로 일치해야 함
 *
 * 이는 canvas_coord_architecture.md의 1.0x baseline 데이터 보존 + view.zoom 시각 분리 원칙이
 * 실제 통합 흐름(스크롤·언로드·재렌더·import)에서도 유지됨을 검증한다.
 */
import { test, expect, type FrameLocator, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import {
  dispatchStroke
} from './helpers'

const TEST_PDF = path.resolve('public/samples/inko-demo.pdf')
const EXAMPLE_URL = 'sdk/example.html'

/** SDK 전체 canvasData에서 특정 페이지의 Paper.js 객체 트리를 파싱 */
function getPageCanvasState(canvasData: string, pageNum: number): unknown {
  const pages = JSON.parse(canvasData) as Record<string, string>
  const pageState = pages[String(pageNum)]
  if (typeof pageState !== 'string') return null
  return JSON.parse(pageState)
}

interface PathFact {
  segments: unknown[]
  strokeWidth: unknown
  strokeColor: unknown
}

/** Paper.js 객체 트리에서 실제 Path geometry/style만 재귀 수집 */
function collectPathFacts(node: unknown, facts: PathFact[] = []): PathFact[] {
  if (Array.isArray(node)) {
    if (node[0] === 'Path' && node[1] && typeof node[1] === 'object') {
      const props = node[1] as Record<string, unknown>
      facts.push({
        segments: Array.isArray(props.segments) ? props.segments : [],
        strokeWidth: props.strokeWidth,
        strokeColor: props.strokeColor
      })
    }
    for (const child of node) collectPathFacts(child, facts)
  } else if (node && typeof node === 'object') {
    for (const child of Object.values(node as Record<string, unknown>)) {
      collectPathFacts(child, facts)
    }
  }
  return facts
}

function expectValidPaintPath(pageState: unknown) {
  const paths = collectPathFacts(pageState)
  expect(paths.length, 'baseline에 실제 Path가 있어야 함').toBeGreaterThan(0)
  for (const path of paths) {
    expect(path.segments.length, 'Path는 두 개 이상의 segment를 가져야 함').toBeGreaterThan(1)
    const coordinates = path.segments.flat(Infinity).filter(value => typeof value === 'number') as number[]
    expect(coordinates.length, 'Path segment에 좌표가 있어야 함').toBeGreaterThan(1)
    expect(coordinates.every(Number.isFinite), '모든 Path 좌표는 finite여야 함').toBe(true)
    expect(typeof path.strokeWidth === 'number' && Number.isFinite(path.strokeWidth) && path.strokeWidth > 0,
      'Path strokeWidth가 유효해야 함').toBe(true)
    expect(path.strokeColor, 'Path strokeColor가 있어야 함').toBeTruthy()
  }
}

/** 호스트 SDK가 마지막으로 수신한 전체 canvasData */
async function getLastCanvasData(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__inkoDemo?.viewer?.getLastCanvasData?.() || '')
}

/** save 응답을 기다린 뒤 호스트가 저장한 전체 canvasData 반환 */
async function saveCanvasData(page: Page): Promise<string> {
  await page.evaluate(() => {
    document.getElementById('log')!.textContent = ''
    ;(window as any).__inkoDemo.viewer.save()
  })
  await expect(page.locator('#log')).toContainText('saveCanvasResponse', { timeout: 5_000 })
  return page.evaluate(() => (window as any).__inkoDemo.savedState as string)
}

/** 특정 페이지 컨테이너로 스크롤 (block: 'start' — 컨테이너 상단 정렬) */
async function scrollToPage(frame: FrameLocator, pageNum: number) {
  await frame.locator(`[data-page="${pageNum}"]`).evaluate((target: HTMLElement) => {
    target.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior })
  })
}

/** 페이지 N의 paper 캔버스가 DOM에 존재(렌더 상태)할 때까지 대기 */
async function waitPaperCanvasRendered(frame: FrameLocator, pageNum: number) {
  await expect(frame.locator(`[data-page="${pageNum}"] canvas.scroll-page-canvas-paper`))
    .toHaveCount(1, { timeout: 15_000 })
}

/** 페이지 N의 paper 캔버스가 DOM에서 제거(언로드)될 때까지 대기 */
async function waitPaperCanvasUnloaded(frame: FrameLocator, pageNum: number) {
  await expect(frame.locator(`[data-page="${pageNum}"] canvas.scroll-page-canvas-paper`))
    .toHaveCount(0, { timeout: 15_000 })
}

test.describe('페이지 언로드/재방문 시 캔버스 보존', () => {
  test.skip(!fs.existsSync(TEST_PDF), 'public/samples/inko-demo.pdf 필요')

  test.beforeEach(async ({ page }) => {
    await page.goto(EXAMPLE_URL)
    const frame = page.frameLocator('#viewer iframe')
    await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
    await frame.locator('.scroll-page-container canvas.scroll-page-canvas-pdf').first()
      .waitFor({ timeout: 30_000 })
  })

  test('펜 스트로크 후 멀리 스크롤 → 복귀 시 1페이지 캔버스 데이터 동일', async ({ page }) => {
    const frame = page.frameLocator('#viewer iframe')
    // 1. 펜 도구 활성화
    const penButton = frame.locator('[data-tool="pen"]')
    await expect(penButton).toBeVisible()
    await penButton.click()
    await expect(penButton).toHaveClass(/active/)

    // 2. 1페이지 paper 캔버스에 스트로크 (좌표는 임의 — 데이터 변화 자체가 검증 대상)
    await waitPaperCanvasRendered(frame, 1)
    const page1Canvas = frame.locator('[data-page="1"] canvas.scroll-page-canvas-paper').first()
    await expect(page1Canvas).toBeVisible()
    await dispatchStroke(page, page1Canvas, [
      { x: 80, y: 80 },
      { x: 140, y: 110 },
      { x: 210, y: 160 },
      { x: 280, y: 220 }
    ], { pointerType: 'pen', pressure: 0.6 })

    // 3. onChange로 호스트에 전달된 1페이지 Paper.js 객체 트리를 baseline으로 사용
    await expect.poll(async () => getLastCanvasData(page)).not.toBe('')
    const page1Before = getPageCanvasState(await getLastCanvasData(page), 1)
    expect(page1Before, '스트로크 후 1페이지 편집 객체가 존재해야 함').not.toBeNull()
    expectValidPaintPath(page1Before)

    // 4. 페이지 8로 스크롤 — viewport ±2 페이지 범위 밖으로 1페이지를 밀어냄
    await scrollToPage(frame, 8)
    // 1페이지가 unload될 때까지 대기 (IntersectionObserver + RenderCache 동기화 시간 포함)
    await waitPaperCanvasUnloaded(frame, 1)

    // 5. 1페이지로 복귀
    await scrollToPage(frame, 1)
    await waitPaperCanvasRendered(frame, 1)

    // 6. 1페이지가 다시 렌더된 직후 캔버스 import 완료까지 약간의 시간 확보
    //    (PdfScrollViewer가 manager.init → importJSON → render 순으로 동기 처리하지만,
    //     Paper.js의 자동 redraw 타이밍 때문에 상태 안정화 대기)
    await expect.poll(() => frame.locator('[data-page="1"] canvas.scroll-page-canvas-paper')
      .evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0))
      .toBe(true)

    // 7. 공개 SDK save 경로로 복원 상태를 다시 직렬화
    const page1After = getPageCanvasState(await saveCanvasData(page), 1)

    // 8. JSON 객체 구조·좌표·스타일이 동일해야 함 — 브라우저 픽셀 차이에는 영향받지 않음
    expect(page1After, '복귀 후 1페이지 객체 구조와 geometry가 보존되어야 함').toEqual(page1Before)
  })

  test('스크롤 왕복 3회 후에도 1페이지 데이터 drift 없음', async ({ page }) => {
    const frame = page.frameLocator('#viewer iframe')
    // 펜 도구 + 스트로크
    await frame.locator('[data-tool="pen"]').click()
    await waitPaperCanvasRendered(frame, 1)
    const page1Canvas = frame.locator('[data-page="1"] canvas.scroll-page-canvas-paper').first()
    await dispatchStroke(page, page1Canvas, [
      { x: 50, y: 50 },
      { x: 100, y: 80 },
      { x: 150, y: 120 }
    ], { pointerType: 'pen', pressure: 0.5 })

    await expect.poll(async () => getLastCanvasData(page)).not.toBe('')
    const baseline = getPageCanvasState(await getLastCanvasData(page), 1)
    expect(baseline).not.toBeNull()

    // 스크롤 왕복 3회
    for (let i = 0; i < 3; i++) {
      await scrollToPage(frame, 10 + i) // 매번 다른 멀리 페이지로
      await waitPaperCanvasUnloaded(frame, 1)
      await scrollToPage(frame, 1)
      await waitPaperCanvasRendered(frame, 1)

      const current = getPageCanvasState(await saveCanvasData(page), 1)
      expect(current, `왕복 ${i + 1}회차에서 1페이지 geometry drift 발생`).toEqual(baseline)
    }
  })
})
