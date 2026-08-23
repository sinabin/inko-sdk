/** 공개 SDK overlay 계약 — canonical 필드, 복수 레이어 동시 표시, 빈·중복 ID 방어 */
import { test, expect, type Page, type FrameLocator } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const EXAMPLE_URL = 'sdk/example.html'
const TEST_PDF_PATH = path.resolve('public/samples/inko-demo.pdf')

type SeedItem = {
  canvasId: string
  userName: string
  userId: string
  enabled: boolean
  canvasData: string
  color: string
  registeredAt: string
}

function seedItem(id: string, enabled = false): SeedItem {
  return {
    canvasId: id,
    userName: `reviewer-${id}`,
    userId: id,
    enabled,
    canvasData: JSON.stringify({
      '1': JSON.stringify([
        'Layer',
        { children: [['Path', { segments: [[40, 40], [120, 120]], strokeColor: '#E8A045', strokeWidth: 4 }]] }
      ])
    }),
    color: '',
    registeredAt: '2026-08-23T10:00:00+09:00'
  }
}

async function waitForViewer(frame: FrameLocator) {
  await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
  await frame.locator('.scroll-page-container canvas.scroll-page-canvas-pdf').first().waitFor({ timeout: 30_000 })
}

async function sendOverlay(page: Page, items: unknown[]) {
  await page.evaluate((list) => {
    ;(window as any).__inkoDemo.viewer.loadUserCanvasOverlay(list)
  }, items)
}

test.describe('공개 SDK 복수 검토 레이어', () => {
  test.skip(!fs.existsSync(TEST_PDF_PATH), 'public/samples/inko-demo.pdf가 없음')

  test('canonical 레이어 두 개를 동시에 표시하고 빈·중복 canvasId는 제외', async ({ page }) => {
    await page.goto(EXAMPLE_URL)
    const frame = page.frameLocator('#viewer iframe')
    await waitForViewer(frame)

    const first = seedItem('review-a', true)
    const second = seedItem('review-b', true)
    await sendOverlay(page, [first, second, { ...first }, { ...second, canvasId: '' }])

    const historyButton = frame.locator('[title="작업 이력"]')
    await expect(historyButton).toBeVisible({ timeout: 10_000 })
    await historyButton.click()
    const panel = frame.locator('.user-canvas-data-list')
    await expect(panel.locator('.list-item')).toHaveCount(2)
    await expect(panel.locator('.list-item.enabled')).toHaveCount(2)

    await expect.poll(() => frame
      .locator('.scroll-page-container')
      .first()
      .locator('canvas')
      .evaluateAll((nodes) => nodes.filter((node) => {
        const style = getComputedStyle(node)
        return style.zIndex === '20' && style.display !== 'none'
      }).length)
    ).toBe(2)
  })
})
