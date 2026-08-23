/** 공개 SDK overlay 계약 — 버전 이력 단일 선택 + 협업 레이어 복수 선택 */
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
  isCurrent?: boolean
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

async function loadEditingBaseline(page: Page, canvasData: string) {
  await page.evaluate((saved) => {
    document.getElementById('log')!.textContent = ''
    ;(window as any).__inkoDemo.viewer.loadPdfUrl(
      '/pdfv/samples/inko-demo.pdf',
      'inko-demo.pdf',
      saved,
      false
    )
  }, canvasData)
  await expect(page.locator('#log')).toContainText('pdfLoaded', { timeout: 15_000 })
}

test.describe('공개 SDK 버전 이력과 복수 검토 레이어', () => {
  test.skip(!fs.existsSync(TEST_PDF_PATH), 'public/samples/inko-demo.pdf가 없음')

  test('isCurrent 버전 모드: 최신 1개 기본 선택 → 단일 토글 → 이어서 편집 후에도 1개', async ({ page }) => {
    await page.goto(EXAMPLE_URL)
    const frame = page.frameLocator('#viewer iframe')
    await waitForViewer(frame)

    const latest = { ...seedItem('v2'), userName: '나 (v2)', isCurrent: true }
    const previous = { ...seedItem('v1'), userName: '나 (v1)' }

    // 운영 데모와 동일하게 최신 canvasData를 편집 캔버스에 복원한 뒤 이력 목록 주입
    await loadEditingBaseline(page, latest.canvasData)
    await sendOverlay(page, [latest, previous])

    const historyButton = frame.locator('[title="작업 이력"]')
    await expect(historyButton).toBeVisible({ timeout: 10_000 })
    await historyButton.click()
    const panel = frame.locator('.user-canvas-data-list')
    const rows = panel.locator('.list-item')
    const checked = panel.locator('.visibility-indicator.visible')
    await expect(rows).toHaveCount(2)

    // 최신 상태가 기본값이며 선택 표시는 정확히 하나
    await expect(checked).toHaveCount(1)
    await expect(rows.nth(0).locator('.visibility-indicator.visible')).toHaveCount(1)
    await expect(rows.nth(0).locator('.load-btn')).toHaveCount(0)

    // 선택된 최신 항목을 다시 눌러도 0개가 되지 않음
    await rows.nth(0).click()
    await expect(checked).toHaveCount(1)

    // 과거 버전 선택은 최신을 자동 해제하여 항상 하나만 남김
    await rows.nth(1).click()
    await expect(checked).toHaveCount(1)
    await expect(rows.nth(1).locator('.visibility-indicator.visible')).toHaveCount(1)

    // 선택된 과거 버전을 다시 눌러도 선택 0개가 되지 않음
    await rows.nth(1).click()
    await expect(checked).toHaveCount(1)

    // 과거 버전에서 이어서 편집 → 패널 재오픈 후에도 그 버전 하나만 선택
    await rows.nth(1).locator('.load-btn').click()
    await expect(panel).toBeHidden()
    await historyButton.click()
    await expect(checked).toHaveCount(1)
    await expect(rows.nth(1).locator('.visibility-indicator.visible')).toHaveCount(1)
    await expect(rows.nth(1).locator('.load-btn')).toHaveCount(0)
  })

  test('isCurrent 없는 협업 모드: canonical 레이어 복수 선택과 독립 토글 유지', async ({ page }) => {
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

    // 협업 레이어는 하나를 꺼도 다른 하나가 유지되고, 다시 켜 복수 선택 가능
    await panel.locator('.list-item').first().click()
    await expect(panel.locator('.list-item.enabled')).toHaveCount(1)
    await expect(panel.locator('.list-item').nth(1)).toHaveClass(/enabled/)
    await panel.locator('.list-item').first().click()
    await expect(panel.locator('.list-item.enabled')).toHaveCount(2)
  })
})
