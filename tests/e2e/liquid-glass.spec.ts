/** 빠른 스크롤 중 고비용 glass 효과 비활성화 회귀 검증 */
import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { waitForViewerReady, waitForFirstPageRender } from './helpers'

const TEST_PDF = path.resolve('public/samples/inko-demo.pdf')

test.describe('빠른 스크롤 렌더링 보호', () => {
  test.skip(!fs.existsSync(TEST_PDF), 'public/samples/inko-demo.pdf 필요')

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await waitForViewerReady(page)
    await waitForFirstPageRender(page)
  })

  test('투명 toolbar는 blur 없이 유지하고 fast-scrolling에서 action glass blur를 끔', async ({ page }) => {
    const toolbar = page.locator('.toolbar')
    const saveButton = page.locator('.save-btn')

    await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).backdropFilter))
      .toBe('none')
    await expect.poll(() => saveButton.evaluate((el) => getComputedStyle(el).backdropFilter))
      .toMatch(/blur/)

    await page.evaluate(() => document.documentElement.classList.add('fast-scrolling'))

    await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).backdropFilter))
      .toBe('none')
    await expect.poll(() => saveButton.evaluate((el) => getComputedStyle(el).backdropFilter))
      .toBe('none')
  })

  test('scrollMode의 빠른 스크롤 신호가 root 클래스에 연결되고 idle 후 해제됨', async ({ page }) => {
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains('fast-scrolling'))).toBe(false)

    const scrollViewer = page.locator('.scroll-viewer').first()
    await scrollViewer.evaluate(async (element) => {
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
      element.scrollTop = 0
      await sleep(50)
      for (let index = 1; index <= 6; index += 1) {
        element.scrollTop = index * 800
        await sleep(16)
      }
    })

    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains('fast-scrolling')), {
      timeout: 3_000
    }).toBe(true)
    await expect.poll(() => page.locator('.toolbar').evaluate((el) =>
      getComputedStyle(el).backdropFilter)).toBe('none')
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains('fast-scrolling')), {
      timeout: 3_000
    }).toBe(false)
  })
})
