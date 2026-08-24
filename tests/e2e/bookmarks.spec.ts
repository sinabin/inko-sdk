/** 책갈피(PDF 내장 목차) — 추출·트리 표시·페이지 이동 회귀 검증 */
import { test, expect } from '@playwright/test'
import { waitForViewerReady, waitForFirstPageRender, captureForClaude } from './helpers'

/** 툴바의 책갈피 토글 — 목차가 있는 문서에서만 렌더된다 */
const bookmarkToggle = '.outline-toggle-btn'
const panel = '.outline-panel'
const rows = '.outline-panel .outline-row'

/**
 * 패널의 열림 트랜지션(fly 200ms)이 끝날 때까지 대기.
 * toBeVisible()은 DOM 삽입 직후 통과하므로, 그대로 캡처하면 반투명 중간 프레임이 찍힌다.
 */
async function waitForPanelSettled(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.outline-panel')
    return !!el && getComputedStyle(el).opacity === '1'
  }, null, { timeout: 5_000 })
}

test.describe('책갈피 (PDF 내장 목차)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForViewerReady(page)
    await waitForFirstPageRender(page)
  })

  test('목차가 있는 PDF에서 툴바 버튼이 노출되고 패널이 열린다', async ({ page }) => {
    const toggle = page.locator(bookmarkToggle)
    await expect(toggle).toBeVisible({ timeout: 15_000 })

    // 초기 상태는 닫힘 — 패널이 뷰를 선점하지 않아야 한다
    await expect(page.locator(panel)).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()
    await expect(page.locator(panel)).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await waitForPanelSettled(page)
    await captureForClaude(page, 'bookmarks-panel-open')
  })

  test('최상위·중첩 항목이 계층 그대로 표시된다', async ({ page }) => {
    await page.locator(bookmarkToggle).click()
    await expect(page.locator(panel)).toBeVisible()

    // 샘플 fixture: 최상위 5개 + "Annotation samples" 하위 8개 = 13행 (기본 전체 펼침)
    await expect(page.locator(rows)).toHaveCount(13)

    await expect(page.locator(`${panel} .entry-title`).first()).toHaveText('Cover')
    await expect(page.getByRole('button', { name: /Integration checklist/ })).toBeVisible()

    // 중첩 항목은 부모보다 깊은 들여쓰기를 가진다
    const parentPad = await page.locator(rows).nth(3).evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingLeft)
    )
    const childPad = await page.locator(rows).nth(4).evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingLeft)
    )
    expect(childPad).toBeGreaterThan(parentPad)
  })

  test('항목을 접으면 하위가 감춰지고 다시 펼치면 복원된다', async ({ page }) => {
    await page.locator(bookmarkToggle).click()
    await expect(page.locator(rows)).toHaveCount(13)

    const twisty = page.locator(`${rows} .twisty`).first()
    await expect(twisty).toHaveAttribute('aria-expanded', 'true')

    await twisty.click()
    // 하위 8개가 빠져 최상위 5개만 남는다
    await expect(page.locator(rows)).toHaveCount(5)
    await expect(twisty).toHaveAttribute('aria-expanded', 'false')

    await twisty.click()
    await expect(page.locator(rows)).toHaveCount(13)
  })

  test('목차 항목 클릭 시 해당 페이지로 이동한다', async ({ page }) => {
    await page.locator(bookmarkToggle).click()
    await expect(page.locator(panel)).toBeVisible()

    const pageInput = page.locator('.page-input')
    await expect(pageInput).toHaveValue('1')

    // 12페이지를 가리키는 마지막 최상위 항목
    await page.getByRole('button', { name: /Integration checklist/ }).click()

    await expect(pageInput).toHaveValue('12', { timeout: 15_000 })

    // 페이지 표시뿐 아니라 실제 스크롤이 대상 페이지에 도달했는지 확인 —
    // goToPage(표시)와 scrollToPage(이동)가 분리돼 있어 한쪽만 동작해도 표시는 바뀐다
    await page.waitForFunction(() => {
      const target = document.querySelector('.scroll-page-container[data-page="12"]')
      if (!target) return false
      const rect = target.getBoundingClientRect()
      return rect.top < window.innerHeight && rect.bottom > 0
    }, null, { timeout: 15_000 })

    // 이동 후에도 패널은 열린 채 유지 — 연속 탐색이 가능해야 한다
    await expect(page.locator(panel)).toBeVisible()

    await waitForPanelSettled(page)
    await captureForClaude(page, 'bookmarks-after-navigate')
  })

  test('현재 페이지에 해당하는 항목이 강조된다', async ({ page }) => {
    await page.locator(bookmarkToggle).click()
    await expect(page.locator(panel)).toBeVisible()

    // 1페이지에서는 첫 항목(Cover)이 활성
    await expect(page.locator(`${rows}.is-active .entry-title`)).toHaveText('Cover')

    await page.getByRole('button', { name: /Specification table/ }).click()
    await expect(page.locator('.page-input')).toHaveValue('3', { timeout: 15_000 })
    await expect(page.locator(`${rows}.is-active .entry-title`)).toHaveText('Specification table')
  })

  test('책갈피 패널과 작업 이력 패널은 동시에 열리지 않는다', async ({ page }) => {
    // 작업 이력 버튼은 이력이 있을 때만 노출된다 —
    // standalone(dev·localhost) 모드에서 한 번 저장해 이력을 만든 뒤 검증한다
    await page.locator('.save-btn').click()
    const historyToggle = page.locator('.history-btn')
    await expect(historyToggle).toBeVisible({ timeout: 10_000 })

    await page.locator(bookmarkToggle).click()
    await expect(page.locator(panel)).toBeVisible()

    await historyToggle.click()
    await expect(page.locator('.user-canvas-data-list')).toBeVisible()
    await expect(page.locator(panel)).toHaveCount(0)
  })

  test('닫기 버튼으로 패널을 닫는다', async ({ page }) => {
    const toggle = page.locator(bookmarkToggle)
    await toggle.click()
    await expect(page.locator(panel)).toBeVisible()

    await page.locator(`${panel} .close-btn`).click()
    await expect(page.locator(panel)).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})
