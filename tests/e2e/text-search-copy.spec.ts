import { test, expect, type FrameLocator } from '@playwright/test'


const FEATURE_PDF = '/pdfv/samples/inko-feature-surface.pdf'

async function loadFeatureFixture(page: import('@playwright/test').Page, frame: FrameLocator) {
  await page.goto('sdk/example.html')
  await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
  await page.evaluate((url) => {
    const demo = (window as any).__inkoDemo
    demo.viewer.loadPdfUrl(url, 'inko-feature-surface.pdf', '', false)
  }, FEATURE_PDF)
  await expect(frame.locator('[data-page="1"] canvas.scroll-page-canvas-pdf')).toBeVisible({ timeout: 30_000 })
}

test.describe('PDF text selection, copy, and document-wide search', () => {
  test('selects/copies text and finds a unique token on an offscreen page', async ({ page, context }) => {
    const frame = page.frameLocator('#viewer iframe')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await loadFeatureFixture(page, frame)

    await frame.locator('[data-tool="contentSelect"]').click()
    const token = frame.getByText('INKO_COPY_TOKEN_001', { exact: true })
    await expect(token).toBeVisible()

    const pdfBox = await frame.locator('[data-page="1"] canvas.scroll-page-canvas-pdf').boundingBox()
    const textBox = await frame.locator('[data-page="1"] .textLayer').boundingBox()
    expect(pdfBox).not.toBeNull()
    expect(textBox).not.toBeNull()
    expect(Math.abs(pdfBox!.width - textBox!.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(pdfBox!.height - textBox!.height)).toBeLessThanOrEqual(1)

    await token.dblclick()
    await expect.poll(() => token.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toContain('INKO_COPY_TOKEN_001')
    await page.keyboard.press('Control+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('INKO_COPY_TOKEN_001')

    await page.keyboard.press('Control+F')
    const searchInput = frame.getByTestId('pdf-search-input')
    await expect(searchInput).toBeFocused()
    await searchInput.fill('INKO_SEARCH_TARGET_008')
    await searchInput.press('Enter')

    await expect(frame.getByTestId('pdf-search-count')).toHaveText('1 / 1')
    await expect(frame.locator('[data-page="8"] .textLayer .highlight.selected')).toHaveCount(1)
    await expect(frame.locator('[data-page="8"]')).toBeInViewport()

    // 가상화로 page 8 DOM이 제거된 뒤 단일 결과 next가 wrap되면 다시 렌더·강조되어야 한다.
    await frame.locator('[data-page="1"]').scrollIntoViewIfNeeded()
    await expect(frame.locator('[data-page="8"] .textLayer')).toHaveCount(0, { timeout: 15_000 })
    await searchInput.press('Enter')
    await expect(frame.locator('[data-page="8"] .textLayer .highlight.selected')).toHaveCount(1, { timeout: 30_000 })
    await expect(frame.locator('[data-page="8"]')).toBeInViewport()

    await searchInput.fill('INKO_TOKEN_THAT_DOES_NOT_EXIST')
    await expect(frame.getByTestId('pdf-search-count')).toHaveText('0 / 0')
  })
})
