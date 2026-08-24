/** 공개 SDK 경로에서 PointerEvent 입력이 복원 가능한 canvasData로 이어지는지 검증 */
import { test, expect, type FrameLocator, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { dispatchStroke } from './helpers'

const TEST_PDF = path.resolve('public/samples/inko-demo.pdf')
const EXAMPLE_URL = 'sdk/example.html'

type PaperPath = {
  segments?: unknown
  strokeColor?: unknown
  strokeWidth?: number
}

function collectPaths(node: unknown, paths: PaperPath[] = []): PaperPath[] {
  if (Array.isArray(node)) {
    if (node[0] === 'Path' && node[1] && typeof node[1] === 'object') {
      paths.push(node[1] as PaperPath)
    }
    for (const child of node) collectPaths(child, paths)
  } else if (node && typeof node === 'object') {
    for (const child of Object.values(node)) collectPaths(child, paths)
  }
  return paths
}

function pagePaths(canvasData: string, pageNum = 1): PaperPath[] {
  const pages = JSON.parse(canvasData) as Record<string, string>
  const pageState = pages[String(pageNum)]
  if (typeof pageState !== 'string') return []
  return collectPaths(JSON.parse(pageState))
}

function finiteGeometry(path: PaperPath): number[] {
  const values: number[] = []
  const visit = (node: unknown) => {
    if (typeof node === 'number') values.push(node)
    else if (Array.isArray(node)) node.forEach(visit)
    else if (node && typeof node === 'object') Object.values(node).forEach(visit)
  }
  visit(path.segments)
  return values
}

async function waitForViewer(page: Page): Promise<FrameLocator> {
  await page.goto(EXAMPLE_URL)
  const frame = page.frameLocator('#viewer iframe')
  await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
  await frame.locator('.scroll-page-container canvas.scroll-page-canvas-pdf').first()
    .waitFor({ timeout: 30_000 })
  return frame
}

async function getLastCanvasData(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__inkoDemo?.viewer?.getLastCanvasData?.() || '')
}

test.describe('스타일러스·터치 canvasData 계약', () => {
  test.skip(!fs.existsSync(TEST_PDF), 'public/samples/inko-demo.pdf 필요')

  test('pen 압력이 serialized Path 굵기에 반영되고 geometry는 유효함', async ({ page }) => {
    const frame = await waitForViewer(page)
    await frame.locator('[data-tool="pen"]').click()
    const canvas = frame.locator('[data-page="1"] canvas.scroll-page-canvas-paper').first()

    await dispatchStroke(page, canvas, [
      { x: 80, y: 100 }, { x: 140, y: 115 }, { x: 210, y: 145 }
    ], { pointerType: 'pen', pressure: 0.2 })
    await expect.poll(async () => pagePaths(await getLastCanvasData(page)).length).toBe(1)

    await dispatchStroke(page, canvas, [
      { x: 80, y: 260 }, { x: 140, y: 275 }, { x: 210, y: 305 }
    ], { pointerType: 'pen', pressure: 0.8 })
    await expect.poll(async () => pagePaths(await getLastCanvasData(page)).length).toBe(2)

    const paths = pagePaths(await getLastCanvasData(page))
    const lowPressure = paths[0]
    const highPressure = paths[1]
    expect(lowPressure.strokeWidth).toEqual(expect.any(Number))
    expect(highPressure.strokeWidth).toEqual(expect.any(Number))
    expect(Number.isFinite(lowPressure.strokeWidth!)).toBe(true)
    expect(Number.isFinite(highPressure.strokeWidth!)).toBe(true)
    expect(highPressure.strokeWidth!).toBeGreaterThan(lowPressure.strokeWidth!)
    expect(highPressure.strokeColor).toEqual(lowPressure.strokeColor)

    for (const pathState of paths) {
      const geometry = finiteGeometry(pathState)
      expect(geometry.length).toBeGreaterThanOrEqual(4)
      expect(geometry.every(Number.isFinite)).toBe(true)
      expect(new Set(geometry).size).toBeGreaterThan(2)
    }
  })

  test('touch 스트로크도 픽셀 비교 없이 복원 가능한 Path로 반환됨', async ({ page }) => {
    const frame = await waitForViewer(page)
    await frame.locator('[data-tool="pen"]').click()
    const canvas = frame.locator('[data-page="1"] canvas.scroll-page-canvas-paper').first()

    await dispatchStroke(page, canvas, [
      { x: 60, y: 80 }, { x: 120, y: 120 }, { x: 190, y: 170 }
    ], { pointerType: 'touch', pressure: 0.9 })

    await expect.poll(async () => pagePaths(await getLastCanvasData(page)).length).toBe(1)
    const [pathState] = pagePaths(await getLastCanvasData(page))
    const geometry = finiteGeometry(pathState)
    expect(geometry.length).toBeGreaterThanOrEqual(4)
    expect(geometry.every(Number.isFinite)).toBe(true)
  })
})
