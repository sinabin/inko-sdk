import { expect, test } from '@playwright/test'
import { waitForViewerReady } from './helpers'

test.describe('toolbar shared stylesheet', () => {
  test('production render에서 공용 class·interaction·orientation 스타일을 적용한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await waitForViewerReady(page)

    const toolbar = page.getByRole('toolbar', { name: 'PDF 도구 모음' })
    const classCoverage = await toolbar.evaluate((element) => ({
      sections: element.querySelectorAll(':scope > .toolbar-section').length,
      sharedSections: element.querySelectorAll(':scope > .inko-toolbar-section').length,
      buttons: element.querySelectorAll('.btn').length,
      sharedButtons: element.querySelectorAll('.inko-toolbar-button').length,
      dividers: element.querySelectorAll(':scope > .inko-toolbar-section--divided').length
    }))
    expect(classCoverage.buttons).toBeGreaterThan(0)
    expect(classCoverage.sections).toBe(5)
    expect(classCoverage.sharedSections).toBe(classCoverage.sections)
    expect(classCoverage.sharedButtons).toBe(classCoverage.buttons)
    expect(classCoverage.dividers).toBe(3)

    const zoomOut = toolbar.getByRole('button', { name: '축소' })
    const landscapeStyle = await zoomOut.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        display: style.display,
        minWidth: style.minWidth,
        minHeight: style.minHeight,
        backgroundColor: style.backgroundColor
      }
    })
    expect(landscapeStyle).toMatchObject({
      display: 'flex',
      minWidth: '36px',
      minHeight: '36px'
    })

    await zoomOut.hover()
    await expect.poll(() => zoomOut.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe(landscapeStyle.backgroundColor)

    await zoomOut.focus()
    const focusStyle = await zoomOut.evaluate((element) => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
    })
    expect(focusStyle).toEqual({ outlineStyle: 'solid', outlineWidth: '3px' })

    const previousPage = toolbar.getByRole('button', { name: '이전 페이지' })
    await expect(previousPage).toBeDisabled()
    await expect.poll(() => previousPage.evaluate((element) => {
      const style = getComputedStyle(element)
      return { opacity: style.opacity, cursor: style.cursor }
    })).toEqual({ opacity: '0.45', cursor: 'not-allowed' })

    const dividerStyle = await toolbar.locator('.inko-toolbar-section--divided').first()
      .evaluate((element) => {
        const style = getComputedStyle(element, '::before')
        return { content: style.content, width: style.width }
      })
    expect(dividerStyle.content).not.toBe('none')
    expect(dividerStyle.width).toBe('1px')

    await page.setViewportSize({ width: 720, height: 960 })
    await expect.poll(() => zoomOut.evaluate((element) => {
      const style = getComputedStyle(element)
      return { minWidth: style.minWidth, minHeight: style.minHeight }
    })).toEqual({ minWidth: '48px', minHeight: '48px' })
  })
})
