import { expect, test } from '@playwright/test'
import { openSdkHostWithReviewHistory, waitForViewerReady } from './helpers'

test.describe('접근성 시맨틱·키보드 기준선', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForViewerReady(page)
  })

  test('문서 언어·제목·툴바·썸네일에 명시적인 이름과 상태가 있다', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
    await expect(page).toHaveTitle('Inko PDF SDK')

    const toolbar = page.getByRole('toolbar', { name: 'PDF 도구 모음' })
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '펜', exact: true })).toHaveAttribute('aria-pressed', /true|false/)
    await expect(toolbar.getByRole('button', { name: /썸네일/ })).toHaveAttribute('aria-controls', 'pdf-thumbnail-sidebar')

    const visibleButtons = toolbar.locator('button:visible')
    for (let index = 0; index < await visibleButtons.count(); index += 1) {
      const name = await visibleButtons.nth(index).evaluate(element =>
        element.getAttribute('aria-label') || element.textContent?.trim() || ''
      )
      expect(name, `toolbar button ${index + 1} accessible name`).not.toBe('')
    }

    const thumbnailNav = page.getByRole('navigation', { name: 'PDF 페이지 썸네일' })
    if (!(await thumbnailNav.isVisible())) {
      await toolbar.getByRole('button', { name: '썸네일 표시' }).click()
    }
    await expect(thumbnailNav).toBeVisible({ timeout: 10_000 })
    const currentThumbnail = thumbnailNav.locator('button.thumbnail-container[aria-current="page"]')
    await expect(currentThumbnail).toHaveCount(1)
    await expect(currentThumbnail).toHaveAttribute('aria-label', /페이지/)
  })

  test('도구 옵션 dialog가 초기 포커스·Escape·트리거 포커스 복귀를 지킨다', async ({ page }) => {
    const pen = page.getByRole('button', { name: '펜', exact: true })
    await pen.click()

    const dialog = page.getByRole('dialog', { name: '펜 설정' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.sheet-close-btn')).toBeFocused()
    await expect(dialog.getByRole('group', { name: '색상' })).toBeVisible()
    await expect(dialog.getByRole('group', { name: '굵기' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(pen).toBeFocused()
  })

  test('작업 이력 disclosure가 panel 연결·초기 포커스·Escape 복귀를 지킨다', async ({ page }) => {
    const frame = await openSdkHostWithReviewHistory(page)
    const history = frame.locator('.history-btn')
    await expect(history).toHaveAccessibleName('작업 이력')
    await expect(history).toHaveAttribute('aria-controls', 'user-canvas-history-panel')

    await history.click()
    await expect(history).toHaveAttribute('aria-expanded', 'true')
    const panel = frame.getByRole('region', { name: '작업 이력' })
    await expect(panel).toBeVisible()
    const close = panel.getByRole('button', { name: '작업 이력 닫기' })
    await expect(close).toBeFocused()

    await close.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(history).toBeFocused()
  })
})
