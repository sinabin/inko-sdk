import { expect, test, type Page } from '@playwright/test'
import { waitForFirstPageRender } from './helpers'

async function chooseTool(page: Page, tool: string): Promise<void> {
  await page.locator(`[data-tool="${tool}"]`).click()
  const sheet = page.locator('dialog.tool-sheet')
  if (await sheet.isVisible()) {
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  }
}

test.describe('Paper 편집 캔버스 키보드 대체 경로', () => {
  test('중앙 생성·순환 선택·이동·삭제·undo/redo·텍스트 입력을 키보드만으로 수행한다', async ({ page }) => {
    await page.goto('/')
    await waitForFirstPageRender(page)

    const canvas = page.locator('[data-page="1"] canvas.scroll-page-canvas-paper')
    const announcement = page.locator('.canvas-accessibility-announcement')
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveAttribute('tabindex', '0')
    await expect(canvas).toHaveAccessibleName('1페이지 편집 주석')

    // 자유곡선은 경로 자체가 본질적인 제스처라는 예외 경계를 사용자 설명에 명시한다.
    await chooseTool(page, 'pen')
    await expect(page.locator('#paper-canvas-instructions-1')).toContainText('경로 자체가 본질적인 입력')

    await chooseTool(page, 'rectangle')
    await canvas.focus()
    await page.keyboard.press('Enter')
    await expect(canvas).toHaveAttribute('data-annotation-count', '1')
    await expect(announcement).toContainText('편집 주석 1개')
    await page.waitForTimeout(350)

    await chooseTool(page, 'select')
    await canvas.focus()
    await page.keyboard.press('Enter')
    await expect(canvas).toHaveAttribute('data-selected-annotation', '1')
    await expect(announcement).toContainText('1/1 선택됨')
    const beforeMove = await announcement.textContent()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(() => announcement.textContent()).not.toBe(beforeMove)
    await page.waitForTimeout(350)

    // Tab은 도구가 preventDefault하지 않아 브라우저 포커스 순서를 유지한다.
    const tabPrevented = await canvas.evaluate((element) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab', bubbles: true, cancelable: true
      })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(tabPrevented).toBe(false)

    await canvas.focus()
    await page.keyboard.press('Delete')
    await expect(canvas).toHaveAttribute('data-annotation-count', '0')
    await page.waitForTimeout(350)

    const undo = page.getByRole('button', { name: '실행 취소' })
    const redo = page.getByRole('button', { name: '다시 실행' })
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(canvas).toHaveAttribute('data-annotation-count', '1')
    await expect(redo).toBeEnabled()
    await redo.click()
    await expect(canvas).toHaveAttribute('data-annotation-count', '0')

    await chooseTool(page, 'text')
    await canvas.focus()
    await page.keyboard.press('Enter')
    const textDialog = page.getByRole('dialog', { name: '텍스트 입력' })
    await expect(textDialog).toBeVisible()
    await expect(page.getByRole('textbox', { name: '추가할 텍스트' })).toBeFocused()
    await page.getByRole('textbox', { name: '추가할 텍스트' }).fill('키보드로 추가한 텍스트')
    await textDialog.getByRole('button', { name: '확인' }).click()
    await expect(textDialog).toBeHidden()
    await expect(canvas).toHaveAttribute('data-annotation-count', '1')
  })
})
