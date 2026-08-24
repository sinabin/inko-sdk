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

    // 검색이 자동 선택한 contentSelect는 닫을 때 기존 도구로 돌아가야 한다.
    await frame.locator('[data-tool="pen"]').click()
    await page.keyboard.press('Control+F')
    const searchInput = frame.getByTestId('pdf-search-input')
    await expect(searchInput).toBeFocused()
    await expect(frame.locator('[data-tool="contentSelect"]')).toHaveClass(/active/)
    await searchInput.fill('INKO_SEARCH_TARGET_008')
    await searchInput.press('Enter')

    await expect(frame.getByTestId('pdf-search-count')).toHaveText('1 / 1')
    const selectedHighlight = frame.locator('[data-page="8"] .textLayer .highlight.selected')
    await expect(selectedHighlight).toHaveCount(1)
    await expect(frame.locator('[data-page="8"]')).toBeInViewport()
    await expect.poll(async () => selectedHighlight.evaluate((element) => {
      const viewer = document.querySelector<HTMLElement>('.scroll-viewer')!
      const viewerRect = viewer.getBoundingClientRect()
      const highlightRect = element.getBoundingClientRect()
      const expected = Math.max(16, (viewer.clientHeight - highlightRect.height) / 3)
      return Math.abs(highlightRect.top - viewerRect.top - expected)
    })).toBeLessThan(80)

    // 가상화로 page 8 DOM이 제거된 뒤 단일 결과 next가 wrap되면 다시 렌더·강조되어야 한다.
    await frame.locator('[data-page="1"]').scrollIntoViewIfNeeded()
    await expect(frame.locator('[data-page="8"] .textLayer')).toHaveCount(0, { timeout: 15_000 })
    await searchInput.press('Enter')
    await expect(frame.locator('[data-page="8"] .textLayer .highlight.selected')).toHaveCount(1, { timeout: 30_000 })
    await expect(frame.locator('[data-page="8"]')).toBeInViewport()

    await searchInput.fill('INKO_TOKEN_THAT_DOES_NOT_EXIST')
    await expect(frame.getByTestId('pdf-search-count')).toHaveText(/검색 결과 없음|No search results/)

    await searchInput.fill('INKO_SEARCH_TARGET_008')
    await expect(frame.locator('[data-page="8"] .textLayer .highlight.selected')).toHaveCount(1)
    await searchInput.press('Escape')
    await expect(frame.getByTestId('pdf-search-input')).toHaveCount(0)
    await expect(frame.locator('[data-page="8"] [data-inko-search-highlight]')).toHaveCount(0)
    await expect(frame.locator('[data-tool="pen"]')).toHaveClass(/active/)

    // 닫기에서 질의까지 비워 재오픈이 직전 검색을 암묵적으로 재사용하지 않음
    await page.keyboard.press('Control+F')
    await expect(frame.getByTestId('pdf-search-input')).toHaveValue('')
    await expect(frame.getByTestId('pdf-search-count')).toHaveText('0 / 0')
  })
})
