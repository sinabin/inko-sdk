import { expect, test, type Locator, type Page } from '@playwright/test'

const EXAMPLE_URL = 'sdk/example.html'
const FEATURE_PDF = '/pdfv/samples/inko-feature-surface.pdf'
const FORM_VALUE = 'INKO-FLATTEN-FORM-001'
const KOREAN_TEXT = '평탄화 한글 001'

// ReportLab A4 fixture and PDF.js scale=1 viewport dimensions.
const PAGE_SIZE = { width: 595.2755905511812, height: 841.8897637795277 }
const MAGENTA_RECT = { left: 400, top: 600, right: 520, bottom: 680 }
const KOREAN_TEXT_RECT = { left: 370, top: 520, right: 570, bottom: 580 }

function pageJson(children: unknown[]): string {
  return JSON.stringify(['Layer', { applyMatrix: true, children }])
}

const INITIAL_CANVAS_DATA = JSON.stringify({
  1: pageJson([
    ['PointText', {
      point: [380, 550],
      content: KOREAN_TEXT,
      fillColor: [0.05, 0.15, 0.55],
      fontSize: 18,
      fontFamily: 'sans-serif'
    }],
    ['Path', {
      segments: [
        [MAGENTA_RECT.left, MAGENTA_RECT.top],
        [MAGENTA_RECT.right, MAGENTA_RECT.top],
        [MAGENTA_RECT.right, MAGENTA_RECT.bottom],
        [MAGENTA_RECT.left, MAGENTA_RECT.bottom]
      ],
      closed: true,
      strokeColor: [1, 0, 1],
      fillColor: [1, 0, 1],
      strokeWidth: 3,
      strokeCap: 'round',
      strokeJoin: 'round'
    }],
    ['Path', {
      segments: [[380, 720], [420, 700], [470, 735], [525, 710]],
      strokeColor: [0, 0.65, 0.85],
      strokeWidth: 8,
      strokeCap: 'round',
      strokeJoin: 'round'
    }]
  ])
})

function pageItems(canvasData: string, pageNumber = 1): unknown[] {
  const documentState = JSON.parse(canvasData) as Record<string, string>
  const pageState = documentState[String(pageNumber)]
  if (typeof pageState !== 'string') return []
  const root = JSON.parse(pageState)
  return Array.isArray(root) && root[1] && Array.isArray(root[1].children)
    ? root[1].children
    : []
}

function compactItemTypes(items: unknown[]): string[] {
  return items.flatMap((item) => {
    if (!Array.isArray(item) || typeof item[0] !== 'string') return []
    const children = item[1] && Array.isArray(item[1].children) ? item[1].children : []
    return [item[0], ...compactItemTypes(children)]
  })
}

function compactTextContents(items: unknown[]): string[] {
  return items.flatMap((item) => {
    if (!Array.isArray(item) || typeof item[0] !== 'string') return []
    const properties = item[1]
    const own = item[0] === 'PointText' && typeof properties?.content === 'string'
      ? [properties.content]
      : []
    const children = properties && Array.isArray(properties.children) ? properties.children : []
    return [...own, ...compactTextContents(children)]
  })
}

async function loadFixtureWithCanvasData(page: Page): Promise<void> {
  await page.goto(EXAMPLE_URL)
  const frame = page.frameLocator('#viewer iframe')
  await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })

  await page.evaluate(({ pdfUrl, canvasData }) => {
    document.getElementById('log')!.textContent = ''
    ;(window as any).__inkoDemo.viewer.loadPdfUrl(
      pdfUrl,
      'inko-feature-surface.pdf',
      canvasData,
      false
    )
  }, { pdfUrl: FEATURE_PDF, canvasData: INITIAL_CANVAS_DATA })

  await expect(page.locator('#log')).toContainText('pdfLoaded', { timeout: 30_000 })
  await expect(frame.locator('[data-page="1"] canvas.scroll-page-canvas-pdf')).toBeVisible()
  await expect(frame.locator('[data-page="1"] canvas.scroll-page-canvas-paper')).toBeVisible()
}

async function saveCanvasData(page: Page): Promise<string> {
  await page.evaluate(() => {
    document.getElementById('log')!.textContent = ''
    ;(window as any).__inkoDemo.viewer.save()
  })
  await expect(page.locator('#log')).toContainText('saveCanvasResponse', { timeout: 10_000 })
  return page.evaluate(() => (window as any).__inkoDemo.savedState as string)
}

async function countMagentaPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((element, { pageSize, rect }) => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('2d', { willReadFrequently: true })
    if (!context || target.width === 0 || target.height === 0) return 0

    const left = Math.max(0, Math.floor(target.width * rect.left / pageSize.width))
    const top = Math.max(0, Math.floor(target.height * rect.top / pageSize.height))
    const right = Math.min(target.width, Math.ceil(target.width * rect.right / pageSize.width))
    const bottom = Math.min(target.height, Math.ceil(target.height * rect.bottom / pageSize.height))
    const pixels = context.getImageData(left, top, right - left, bottom - top).data
    let matches = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        pixels[offset] > 180 &&
        pixels[offset + 1] < 100 &&
        pixels[offset + 2] > 180 &&
        pixels[offset + 3] > 200
      ) matches += 1
    }
    return matches
  }, { pageSize: PAGE_SIZE, rect: MAGENTA_RECT })
}

async function countKoreanTextPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((element, { pageSize, rect }) => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('2d', { willReadFrequently: true })
    if (!context || target.width === 0 || target.height === 0) return 0

    const left = Math.max(0, Math.floor(target.width * rect.left / pageSize.width))
    const top = Math.max(0, Math.floor(target.height * rect.top / pageSize.height))
    const right = Math.min(target.width, Math.ceil(target.width * rect.right / pageSize.width))
    const bottom = Math.min(target.height, Math.ceil(target.height * rect.bottom / pageSize.height))
    const pixels = context.getImageData(left, top, right - left, bottom - top).data
    let matches = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      if (blue - red > 45 && blue - green > 35 && red < 170 && green < 180) matches += 1
    }
    return matches
  }, { pageSize: PAGE_SIZE, rect: KOREAN_TEXT_RECT })
}

test.describe('SDK flattened PDF export', () => {
  test('Paper 편집과 AcroForm 값을 평탄화 PDF와 별도 canvasData로 왕복한다', async ({ page }) => {
    test.setTimeout(120_000)
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await loadFixtureWithCanvasData(page)
    const frame = page.frameLocator('#viewer iframe')
    const pageOne = frame.locator('[data-page="1"]')
    const pdfCanvas = pageOne.locator('canvas.scroll-page-canvas-pdf')

    const reviewer = pageOne.locator('.annotationLayer input[name="inko.reviewerName"]')
    const approved = pageOne.locator('.annotationLayer input[name="inko.approved"]')
    const decision = pageOne.locator('.annotationLayer select[name="inko.decision"]')
    await reviewer.fill(FORM_VALUE)
    await approved.check()
    await decision.selectOption('Accepted')

    const baselineMagentaPixels = await countMagentaPixels(pdfCanvas)
    const baselineKoreanTextPixels = await countKoreanTextPixels(pdfCanvas)
    const savedBeforeExport = await saveCanvasData(page)
    const initialItems = pageItems(savedBeforeExport)
    expect(compactItemTypes(initialItems).filter(type => type === 'Path')).toHaveLength(2)
    expect(compactTextContents(initialItems)).toContain(KOREAN_TEXT)

    const exported = await page.evaluate(async () => {
      const result = await (window as any).__inkoDemo.viewer.exportFlattenedPdf()
      const bytes = new Uint8Array(result.pdfBytes)
      const previousUrl = (window as any).__inkoFlattenedPdfUrl as string | undefined
      if (previousUrl) URL.revokeObjectURL(previousUrl)
      ;(window as any).__inkoFlattenedPdfUrl = URL.createObjectURL(
        new Blob([bytes], { type: 'application/pdf' })
      )
      return {
        isArrayBuffer: result.pdfBytes instanceof ArrayBuffer,
        byteLength: bytes.byteLength,
        header: Array.from(bytes.slice(0, 5)),
        report: result.report
      }
    })

    expect(exported.isArrayBuffer).toBe(true)
    expect(exported.header).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d])
    expect(exported.byteLength).toBeGreaterThan(1_000)
    expect(exported.report.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'TEXT_RASTERIZED',
        pageNumber: 1,
        sourceType: 'PointText'
      })
    ])
    expect(exported.report).toMatchObject({
      totalPdfPages: 8,
      requestedPages: 1,
      flattenedPages: 1,
      sourceItems: 3,
      flattenedItems: 3,
      skippedItems: 0,
      failedItems: 0,
      warnings: 1,
      hasFailures: false,
      rewroteDocument: true,
      issuesTruncated: false,
      omittedIssues: 0
    })
    expect(exported.report.pages).toEqual([{
      pageNumber: 1,
      sourceItems: 3,
      flattenedItems: 3,
      skippedItems: 0,
      failedItems: 0
    }])
    // Binary export must not consume or mutate the host-owned editable state.
    expect(await saveCanvasData(page)).toBe(savedBeforeExport)

    await page.evaluate(() => {
      document.getElementById('log')!.textContent = ''
      ;(window as any).__inkoDemo.viewer.loadPdfUrl(
        (window as any).__inkoFlattenedPdfUrl,
        'inko-flattened.pdf',
        undefined,
        false
      )
    })
    await expect(page.locator('#log')).toContainText('pdfLoaded', { timeout: 30_000 })

    // Reopened through the shipped SDK/PDF.js path: the form remains native and editable.
    await expect(pageOne.locator('.annotationLayer input[name="inko.reviewerName"]'))
      .toHaveValue(FORM_VALUE, { timeout: 30_000 })
    await expect(pageOne.locator('.annotationLayer input[name="inko.approved"]')).toBeChecked()
    await expect(pageOne.locator('.annotationLayer select[name="inko.decision"]')).toHaveValue('Accepted')
    await expect(pageOne.locator('.annotationLayer input[name="inko.reviewerName"]')).toBeEditable()

    // Non-WinAnsi PointText is visual PDF content (transparent PNG), not a selectable text run.
    await expect(pageOne.locator('.textLayer')).not.toContainText(KOREAN_TEXT)
    const flattenedKoreanTextPixels = await countKoreanTextPixels(pdfCanvas)
    expect(flattenedKoreanTextPixels).toBeGreaterThan(baselineKoreanTextPixels + 40)

    // The filled magenta rectangle moved from the separate Paper canvas into PDF.js rendering.
    const flattenedMagentaPixels = await countMagentaPixels(pdfCanvas)
    expect(baselineMagentaPixels).toBeLessThan(10)
    expect(flattenedMagentaPixels).toBeGreaterThan(baselineMagentaPixels + 500)

    // No canvasData was supplied on reopen: editable state is empty while flattened pixels remain.
    const reopenedCanvasData = await saveCanvasData(page)
    expect(pageItems(reopenedCanvasData)).toEqual([])
    expect(pageErrors).toEqual([])

    await page.evaluate(() => {
      const url = (window as any).__inkoFlattenedPdfUrl as string | undefined
      if (url) URL.revokeObjectURL(url)
      delete (window as any).__inkoFlattenedPdfUrl
    })
  })
})
