/** Smoke 테스트 — standalone 개발 뷰어 부팅·기본 UI 노출 */
import { test, expect } from '@playwright/test'
import { waitForViewerReady, captureForClaude } from './helpers'

test.describe('Smoke', () => {
  test('뷰어 부팅 및 샘플 PDF 렌더', async ({ page }) => {
    await page.goto('/')
    await waitForViewerReady(page)
    await expect(page.locator('.scroll-page-container canvas.scroll-page-canvas-pdf').first()).toBeVisible({ timeout: 30_000 })

    await captureForClaude(page, 'smoke-initial')
  })

  test('툴바 가시성', async ({ page }) => {
    await page.goto('/')
    await waitForViewerReady(page)
    // 툴바 컨테이너 존재 확인 (selector가 컴포넌트 구현에 따라 다를 수 있음 — 유연하게)
    const toolbar = page.locator('.pdf-toolbar, [class*="toolbar"]').first()
    await expect(toolbar).toBeVisible({ timeout: 10_000 })
    await captureForClaude(page, 'smoke-toolbar')
  })
})
