/**
 * 줌 인터랙션 회귀 spec — fit-width 초기 스케일, 버튼 줌 뷰포트 앵커링,
 * Ctrl+휠 줌, 더블클릭 줌 토글 검증.
 */
import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { waitForViewerReady, waitForFirstPageRender } from './helpers'

const TEST_PDF = path.resolve('public/samples/inko-demo.pdf')

/** 툴바 줌 % 표시값 읽기 */
async function readScalePercent(page: Page): Promise<number> {
  const text = await page.locator('.zoom-info').first().textContent()
  return parseInt((text ?? '100').replace('%', ''), 10)
}

/** 뷰포트 중앙이 가리키는 페이지 번호와 페이지 내 상대 좌표(0~1) 측정 */
async function measureViewportCenterAnchor(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.scroll-viewer') as HTMLElement
    const rect = container.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const pages = Array.from(document.querySelectorAll<HTMLElement>('.scroll-page-container'))
    const target = pages.find(el => {
      const r = el.getBoundingClientRect()
      return cy >= r.top && cy <= r.bottom
    })
    if (!target) return null
    const r = target.getBoundingClientRect()
    return {
      pageNum: target.dataset.page,
      fx: (cx - r.left) / r.width,
      fy: (cy - r.top) / r.height
    }
  })
}

test.describe('줌 인터랙션 — fit-width·앵커링·휠·더블클릭', () => {
  test.skip(!fs.existsSync(TEST_PDF), 'public/samples/inko-demo.pdf 필요')

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await waitForViewerReady(page)
    await waitForFirstPageRender(page)
  })

  test('초기 로드 시 fit-width — 페이지 너비가 컨테이너 가용 너비에 맞음', async ({ page }) => {
    const { pageWidth, availableWidth } = await page.evaluate(() => {
      const container = document.querySelector('.scroll-viewer') as HTMLElement
      const content = container.querySelector('.scroll-content') as HTMLElement
      const cs = getComputedStyle(content)
      const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const pageEl = container.querySelector('.scroll-page-container') as HTMLElement
      return {
        pageWidth: pageEl.getBoundingClientRect().width,
        availableWidth: container.clientWidth - padding
      }
    })
    // fit-width: 페이지가 가용 너비를 채움 (스케일 반올림 오차 허용)
    expect(Math.abs(pageWidth - availableWidth)).toBeLessThan(8)

    const percent = await readScalePercent(page)
    expect(percent).not.toBe(100) // 612pt 페이지 ≠ 1280px 컨테이너 → fit 스케일 적용됨
  })

  test('줌 버튼 — 뷰포트 중앙 콘텐츠가 줌 전후 유지 (앵커링)', async ({ page }) => {
    // 문서 중간으로 스크롤해 앵커링 오차가 드러나는 조건 구성
    await page.evaluate(() => {
      const container = document.querySelector('.scroll-viewer') as HTMLElement
      container.scrollTop = container.scrollHeight * 0.3
    })
    await page.waitForTimeout(400) // 스크롤 후 가시성·렌더 안정화

    const before = await measureViewportCenterAnchor(page)
    expect(before).not.toBeNull()

    await page.getByRole('button', { name: '확대' }).click()
    await page.waitForTimeout(300)

    const after = await measureViewportCenterAnchor(page)
    expect(after).not.toBeNull()

    // 같은 페이지의 같은 상대 지점이 뷰포트 중앙에 남아야 함
    expect(after!.pageNum).toBe(before!.pageNum)
    expect(Math.abs(after!.fx - before!.fx)).toBeLessThan(0.03)
    expect(Math.abs(after!.fy - before!.fy)).toBeLessThan(0.03)
  })

  test('Ctrl+휠 — 커서 앵커 줌 동작·일반 휠은 스크롤 유지', async ({ page }) => {
    const scaleBefore = await readScalePercent(page)

    // Ctrl+휠 업 (줌인) — 뷰어 중앙에서
    const box = await page.locator('.scroll-viewer').boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -240)
    await page.keyboard.up('Control')
    await page.waitForTimeout(300)

    const scaleAfter = await readScalePercent(page)
    expect(scaleAfter).toBeGreaterThan(scaleBefore)

    // 일반 휠은 줌이 아니라 스크롤
    const scrollBefore = await page.evaluate(() =>
      (document.querySelector('.scroll-viewer') as HTMLElement).scrollTop)
    await page.mouse.wheel(0, 240)
    await page.waitForTimeout(200)
    const scrollAfter = await page.evaluate(() =>
      (document.querySelector('.scroll-viewer') as HTMLElement).scrollTop)
    expect(scrollAfter).toBeGreaterThan(scrollBefore)
    expect(await readScalePercent(page)).toBe(scaleAfter)
  })

  test('더블클릭 줌 — 확대 토글 후 재더블클릭 시 fit 복귀', async ({ page }) => {
    const fitScale = await readScalePercent(page)

    const box = await page.locator('.scroll-page-container').first().boundingBox()
    await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + 100)
    await page.waitForTimeout(300)

    const zoomedScale = await readScalePercent(page)
    expect(zoomedScale).toBeGreaterThan(fitScale * 1.5) // 2×fit 목표 (clamp 여유)

    await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + 100)
    await page.waitForTimeout(300)

    const restoredScale = await readScalePercent(page)
    expect(Math.abs(restoredScale - fitScale)).toBeLessThanOrEqual(1) // 반올림 오차 허용
  })
})
