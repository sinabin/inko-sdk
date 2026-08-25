import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { AxeResults } from 'axe-core'
import { waitForFirstPageRender } from './helpers'

const FEATURE_PDF = '/pdfv/samples/inko-feature-surface.pdf'
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

function violationSummary(results: AxeResults): string {
  return results.violations.map((violation) => [
    `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}`,
    ...violation.nodes.map((node) => `  ${node.target.join(' > ')} — ${node.failureSummary ?? ''}`)
  ].join('\n')).join('\n\n')
}

async function expectNoViolations(
  builder: AxeBuilder,
  testInfo: TestInfo,
  state: string
): Promise<void> {
  const results = await builder.withTags(WCAG_TAGS).analyze()
  await testInfo.attach(`axe-${state}`, {
    body: JSON.stringify({
      project: testInfo.project.name,
      state,
      url: results.url,
      tags: WCAG_TAGS,
      violations: results.violations,
      incomplete: results.incomplete
    }, null, 2),
    contentType: 'application/json'
  })
  expect(results.violations, violationSummary(results)).toEqual([])
  const seriousIncomplete = results.incomplete.filter((result) =>
    // PDF canvas/text overlays and native select backgrounds prevent axe from computing
    // contrast reliably. Keep those nodes in the attachment for manual visual review.
    result.id !== 'color-contrast'
    && (result.impact === 'critical' || result.impact === 'serious')
  )
  expect(seriousIncomplete, `serious axe incomplete checks:\n${violationSummary({
    ...results,
    violations: seriousIncomplete
  })}`).toEqual([])
}

async function loadFeatureFixture(page: Page) {
  await page.goto('sdk/example.html')
  const frame = page.frameLocator('#viewer iframe')
  await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
  await page.evaluate((url) => {
    ;(window as any).__inkoDemo.viewer.loadPdfUrl(url, 'inko-feature-surface.pdf', '', false)
  }, FEATURE_PDF)
  await expect(frame.locator('[data-page="1"] .annotationLayer')).toBeVisible({ timeout: 30_000 })
  return frame
}

test.describe('production 핵심 접근성 자동 검증', () => {
  test('toolbar·dialog·search·document region이 WCAG AA와 키보드 계약을 지킨다', async ({ page }, testInfo) => {
    await page.goto('/')
    await waitForFirstPageRender(page)

    const toolbar = page.getByRole('toolbar', { name: 'PDF 도구 모음' })
    const documentRegion = page.getByRole('region', { name: 'PDF 문서 보기 영역' })
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'PDF 내용 선택' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'PDF 검색' })).toBeVisible()
    await expect(page.locator('.pdf-native-controls')).toHaveCount(0)
    await expect(documentRegion).toBeVisible()
    await expect(documentRegion).toHaveAttribute('tabindex', '0')
    await expectNoViolations(
      new AxeBuilder({ page })
        .include('[role="toolbar"]')
        .include('.scroll-viewer'),
      testInfo,
      'viewer-shell'
    )

    const pen = toolbar.getByRole('button', { name: '펜', exact: true })
    await pen.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: '펜 설정' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.sheet-close-btn')).toBeFocused()
    await expectNoViolations(
      new AxeBuilder({ page }).include('.tool-sheet'),
      testInfo,
      'tool-dialog'
    )
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(pen).toBeFocused()

    const searchOpen = page.getByTestId('pdf-search-open')
    await searchOpen.focus()
    await page.keyboard.press('Enter')
    const search = page.getByRole('search', { name: 'PDF 검색' })
    const searchInput = page.getByRole('searchbox', { name: '문서에서 찾기' })
    await expect(search).toBeVisible()
    await expect(searchInput).toBeFocused()
    await expectNoViolations(
      new AxeBuilder({ page }).include('.pdf-search-bar'),
      testInfo,
      'search'
    )
    await page.keyboard.press('Escape')
    await expect(search).toBeHidden()
    await expect(searchOpen).toBeFocused()

    await documentRegion.focus()
    await expect(documentRegion).toBeFocused()
  })

  test('AcroForm controls expose stable labels and pass WCAG AA inside the SDK iframe', async ({ page }, testInfo) => {
    const frame = await loadFeatureFixture(page)
    const annotationLayer = frame.locator('[data-page="1"] .annotationLayer')
    const reviewer = annotationLayer.locator('input[name="inko.reviewerName"]')
    const approved = annotationLayer.locator('input[name="inko.approved"]')
    const decision = annotationLayer.locator('select[name="inko.decision"]')

    await expect(reviewer).toHaveAccessibleName('Reviewer name')
    await expect(approved).toHaveAccessibleName('Approved')
    await expect(decision).toHaveAccessibleName('Review decision')
    await reviewer.focus()
    await expect(reviewer).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(approved).toBeFocused()

    await expectNoViolations(
      new AxeBuilder({ page }).include(['#viewer iframe', '[data-page="1"] .annotationLayer']),
      testInfo,
      'acroform'
    )
  })
})
