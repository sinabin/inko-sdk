/**
 * 개발용 standalone 데모의 선택적 localStorage 어댑터 회귀 검증.
 *
 * 이 저장소는 공개 SDK의 영속 저장 계약이 아니다. 실제 도입 환경의 저장·인증·권한·
 * 버전 정책·보존은 호스트 애플리케이션이 구현하고 운영한다.
 */
import { test, expect, type Page } from '@playwright/test'
import { waitForFirstPageRender, dispatchStroke } from './helpers'

async function waitForAutoLoadedViewer(page: Page) {
  await expect(page.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
  await waitForFirstPageRender(page)
}

async function selectPenAndCloseOptions(page: Page) {
  await page.locator('[data-tool="pen"]').first().click()
  const dialog = page.getByRole('dialog', { name: '펜 설정' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

test.describe('standalone 개발 데모 localStorage 버전 이력', () => {
  test('저장 직후 최신 1개 선택·과거 이어서 편집·재로드 최신 복귀', async ({ page }) => {
    await page.goto('/')
    await waitForAutoLoadedViewer(page)
    await selectPenAndCloseOptions(page)

    const canvas = page.locator('.scroll-page-container canvas.scroll-page-canvas-paper').first()
    const saveButton = page.getByRole('button', { name: '저장', exact: true })
    await dispatchStroke(page, canvas, [
      { x: 200, y: 200 }, { x: 300, y: 250 }, { x: 400, y: 260 }
    ])
    await saveButton.click()

    await dispatchStroke(page, canvas, [
      { x: 180, y: 330 }, { x: 280, y: 300 }, { x: 390, y: 340 }
    ])
    await saveButton.click()

    await page.getByRole('button', { name: '작업 이력' }).click()
    const panel = page.getByRole('region', { name: '작업 이력' })
    const versions = panel.getByRole('radio')
    await expect(versions).toHaveCount(2)
    await expect(versions.nth(0)).toBeChecked()
    await expect(versions.nth(0)).toHaveAccessibleName(/현재 편집 중/)
    await expect(versions.nth(1)).not.toBeChecked()
    await expect(panel.getByRole('button', { name: /이어서 편집/ })).toHaveCount(0)

    // 과거 버전을 고르면 단일 선택이 이동하고, 그 선택에서만 이어서 편집할 수 있다.
    await versions.nth(1).click()
    await expect(versions.nth(0)).not.toBeChecked()
    await expect(versions.nth(1)).toBeChecked()
    await expect(versions.nth(1)).not.toHaveAccessibleName(/현재 편집 중/)
    await panel.getByRole('button', { name: /이어서 편집/ }).click()
    await expect(panel).toBeHidden()

    await page.getByRole('button', { name: '작업 이력' }).click()
    await expect(panel.getByRole('radio').nth(1)).toBeChecked()
    await expect(panel.getByRole('radio').nth(1)).toHaveAccessibleName(/현재 편집 중/)
    await expect(panel.getByRole('radio').nth(0)).not.toBeChecked()

    // 재방문 시 개발 어댑터가 가장 최신 저장본을 다시 편집 기준으로 복원한다.
    await page.reload()
    await waitForAutoLoadedViewer(page)
    await page.getByRole('button', { name: '작업 이력' }).click()
    const reloadedPanel = page.getByRole('region', { name: '작업 이력' })
    await expect(reloadedPanel.getByRole('radio')).toHaveCount(2)
    await expect(reloadedPanel.getByRole('radio').nth(0)).toBeChecked()
    await expect(reloadedPanel.getByRole('radio').nth(0)).toHaveAccessibleName(/현재 편집 중/)
    await expect(reloadedPanel.getByRole('radio').nth(1)).not.toBeChecked()
  })
})
