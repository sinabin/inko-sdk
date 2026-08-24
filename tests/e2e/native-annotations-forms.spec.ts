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

test.describe('native PDF annotations and AcroForm state', () => {
  test('renders native links/notes and preserves shared form storage across remounts', async ({ page }) => {
    const frame = page.frameLocator('#viewer iframe')
    await loadFeatureFixture(page, frame)

    const pageOne = frame.locator('[data-page="1"]')
    const note = pageOne.locator('.annotationLayer section.textAnnotation[data-annotation-id]')
    await expect(note).toHaveCount(1)
    await note.locator('button, img').first().click()
    await expect(pageOne.locator('.annotationLayer .popup')).toContainText('INKO_NATIVE_NOTE_001')

    const external = pageOne.locator('.annotationLayer a[href="https://nexth.co.kr/inko"]')
    await expect(external).toHaveAttribute('target', '_blank')
    await expect(external).toHaveAttribute('rel', /noopener/)
    await expect(external).toHaveAttribute('rel', /noreferrer/)

    const internal = pageOne.locator('.annotationLayer section.linkAnnotation a[href*="#"]')
    await expect(internal).toHaveCount(1)
    await internal.click()
    await expect(frame.locator('[data-page="8"]')).toBeInViewport({ timeout: 30_000 })
    await frame.locator('[data-page="1"]').scrollIntoViewIfNeeded()

    const reviewer = pageOne.locator('.annotationLayer input[name="inko.reviewerName"]')
    const approved = pageOne.locator('.annotationLayer input[name="inko.approved"]')
    const decision = pageOne.locator('.annotationLayer select[name="inko.decision"]')
    await reviewer.fill('INKO-FORM-ROUNDTRIP-001')
    await approved.check()
    await decision.selectOption('Accepted')

    await frame.locator('[data-page="8"]').scrollIntoViewIfNeeded()
    await expect(frame.locator('[data-page="8"] .annotationLayer')).toBeVisible()
    await frame.locator('[data-page="1"]').scrollIntoViewIfNeeded()

    await expect(pageOne.locator('.annotationLayer input[name="inko.reviewerName"]'))
      .toHaveValue('INKO-FORM-ROUNDTRIP-001')
    await expect(pageOne.locator('.annotationLayer input[name="inko.approved"]')).toBeChecked()
    await expect(pageOne.locator('.annotationLayer select[name="inko.decision"]')).toHaveValue('Accepted')
    await expect(pageOne.locator('.annotationLayer')).toHaveCount(1)

    const exportedBytes = await page.evaluate(async () => {
      const bytes = await (window as any).__inkoDemo.viewer.exportPdf()
      return Array.from(new Uint8Array(bytes))
    })
    expect(exportedBytes.slice(0, 5)).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d])

    // SDK가 반환한 독립 바이트를 다시 PDF.js에 열어도 annotationStorage 값이 복원된다.
    await page.evaluate((values) => {
      const blobUrl = URL.createObjectURL(new Blob([Uint8Array.from(values)], { type: 'application/pdf' }))
      ;(window as any).__inkoDemo.viewer.loadPdfUrl(blobUrl, 'inko-exported.pdf', '', false)
    }, exportedBytes)
    await expect(frame.locator('[data-page="1"] .annotationLayer input[name="inko.reviewerName"]'))
      .toHaveValue('INKO-FORM-ROUNDTRIP-001', { timeout: 30_000 })
    await expect(frame.locator('[data-page="1"] .annotationLayer input[name="inko.approved"]')).toBeChecked()
    await expect(frame.locator('[data-page="1"] .annotationLayer select[name="inko.decision"]')).toHaveValue('Accepted')
  })

  test('keeps AcroForm controls non-editable in read-only mode', async ({ page }) => {
    const frame = page.frameLocator('#viewer iframe')
    await page.goto('sdk/example.html')
    await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
    await page.evaluate((url) => {
      ;(window as any).__inkoDemo.viewer.loadPdfUrl(url, 'inko-feature-surface.pdf', '', true)
    }, FEATURE_PDF)
    const annotationLayer = frame.locator('[data-page="1"] .annotationLayer')
    await expect(annotationLayer).toBeVisible({ timeout: 30_000 })
    const editableControls = annotationLayer.locator('input:not([disabled]), textarea:not([disabled]), select:not([disabled])')
    await expect(editableControls).toHaveCount(0)
  })
})
