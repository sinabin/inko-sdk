/** 고정 Linux Chromium 환경의 사람 검토용 캡처 생성. 미감을 자동 판정하지 않음. */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  dispatchStroke,
  waitForFirstPageRender,
  waitForViewerReady
} from '../e2e/helpers'

const CAPTURE_DIR = resolve('test-results/visual/captures')

async function capture(page: Page, name: string) {
  mkdirSync(CAPTURE_DIR, { recursive: true })
  const file = resolve(CAPTURE_DIR, `${name}.png`)
  await page.screenshot({
    path: file,
    fullPage: false,
    animations: 'disabled',
    caret: 'hide'
  })
  expect(statSync(file).size, `${name}.png가 비어 있지 않아야 함`).toBeGreaterThan(1_000)
}

test.describe('사람 시각 검토용 production 캡처', () => {
  test.beforeEach(async ({ page }) => {
    expect(page.viewportSize()).toEqual({ width: 1280, height: 900 })
    await page.goto('/')
    await waitForViewerReady(page)
    await waitForFirstPageRender(page)
    await page.evaluate(() => document.fonts.ready)
  })

  test('초기 뷰어와 펜·형광펜 결과를 고정 viewport로 캡처', async ({ page }) => {
    await capture(page, '01-viewer-initial')

    const canvas = page.locator('.scroll-page-container canvas.scroll-page-canvas-paper').first()
    await expect(canvas).toBeVisible()

    await page.locator('[data-tool="pen"]').click()
    await dispatchStroke(page, canvas, [
      { x: 200, y: 200 },
      { x: 250, y: 220 },
      { x: 300, y: 250 },
      { x: 350, y: 290 },
      { x: 400, y: 300 }
    ], { pointerType: 'pen', pressure: 0.7 })
    await capture(page, '02-pen-stroke')

    await page.keyboard.press('Escape')
    await expect(page.locator('.tool-sheet')).toBeHidden()
    await page.locator('[data-tool="highlighter"]').click()
    await dispatchStroke(page, canvas, [
      { x: 150, y: 350 },
      { x: 250, y: 350 },
      { x: 350, y: 350 },
      { x: 450, y: 350 }
    ], { pointerType: 'pen', pressure: 0.5 })
    await capture(page, '03-highlighter-stroke')
  })
})
