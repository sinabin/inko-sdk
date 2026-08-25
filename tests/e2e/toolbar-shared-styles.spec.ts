import { expect, test } from '@playwright/test'
import { waitForViewerReady } from './helpers'

test.describe('toolbar shared stylesheet', () => {
  test('production render에서 공용 class·interaction·orientation 스타일을 적용한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await waitForViewerReady(page)

    const toolbar = page.getByRole('toolbar', { name: 'PDF 도구 모음' })
    const classCoverage = await toolbar.evaluate((element) => ({
      sections: element.querySelectorAll('.toolbar-section').length,
      sharedSections: element.querySelectorAll('.inko-toolbar-section').length,
      buttons: element.querySelectorAll('.btn').length,
      sharedButtons: element.querySelectorAll('.inko-toolbar-button').length,
      dividers: element.querySelectorAll('.inko-toolbar-section--divided').length,
      scrollGroups: element.querySelectorAll(':scope > .toolbar-scroll > .toolbar-section').length,
      actionGroups: element.querySelectorAll(':scope > .toolbar-actions > .toolbar-section').length,
      flexWrap: getComputedStyle(element).flexWrap,
      scrollOverflowX: getComputedStyle(element.querySelector('.toolbar-scroll')!).overflowX
    }))
    expect(classCoverage.buttons).toBeGreaterThan(0)
    expect(classCoverage.sections).toBe(5)
    expect(classCoverage.sharedSections).toBe(classCoverage.sections)
    expect(classCoverage.sharedButtons).toBe(classCoverage.buttons)
    expect(classCoverage.dividers).toBe(4)
    expect(classCoverage.scrollGroups).toBe(4)
    expect(classCoverage.actionGroups).toBe(1)
    expect(classCoverage.flexWrap).toBe('nowrap')
    expect(classCoverage.scrollOverflowX).toBe('auto')
    await expect(page.locator('.pdf-native-controls')).toHaveCount(0)

    await toolbar.getByRole('button', { name: 'PDF 검색' }).click()
    const searchLayout = await page.getByRole('search', { name: 'PDF 검색' }).evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      toolbarBottom: document.querySelector('.toolbar')!.getBoundingClientRect().bottom
    }))
    expect(searchLayout.top).toBeGreaterThanOrEqual(searchLayout.toolbarBottom)
    await page.getByRole('searchbox', { name: '문서에서 찾기' }).press('Escape')

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
      const buttonRect = element.getBoundingClientRect()
      const scrollRect = element.closest('.toolbar-scroll')!.getBoundingClientRect()
      const outlineWidth = Number.parseFloat(style.outlineWidth)
      const outlineOffset = Number.parseFloat(style.outlineOffset)
      const outwardExtent = Math.max(0, outlineWidth + outlineOffset)
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
        ringInsideScrollClip:
          buttonRect.top - outwardExtent >= scrollRect.top - 0.5
          && buttonRect.bottom + outwardExtent <= scrollRect.bottom + 0.5
      }
    })
    expect(focusStyle).toEqual({
      outlineStyle: 'solid',
      outlineWidth: '3px',
      outlineOffset: '-3px',
      ringInsideScrollClip: true
    })

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

    const narrowLayout = await toolbar.evaluate((element) => {
      const toolbarRect = element.getBoundingClientRect()
      const actionsRect = element.querySelector('.toolbar-actions')!.getBoundingClientRect()
      const contentSelectRect = element.querySelector('[data-tool="contentSelect"]')!.getBoundingClientRect()
      return {
        actionsInsideToolbar: actionsRect.top >= toolbarRect.top && actionsRect.bottom <= toolbarRect.bottom,
        contentSelectInsideToolbar: contentSelectRect.top >= toolbarRect.top && contentSelectRect.bottom <= toolbarRect.bottom
      }
    })
    expect(narrowLayout).toEqual({ actionsInsideToolbar: true, contentSelectInsideToolbar: true })

    await page.setViewportSize({ width: 360, height: 800 })
    const contentSelect = toolbar.getByRole('button', { name: 'PDF 내용 선택' })
    await contentSelect.focus()
    const phoneLayout = await toolbar.evaluate((element) => {
      const toolbarRect = element.getBoundingClientRect()
      const scrollRect = element.querySelector('.toolbar-scroll')!.getBoundingClientRect()
      const actionsRect = element.querySelector('.toolbar-actions')!.getBoundingClientRect()
      const contentSelectRect = element.querySelector('[data-tool="contentSelect"]')!.getBoundingClientRect()
      return {
        actionsInsideToolbar:
          actionsRect.top >= toolbarRect.top - 0.5
          && actionsRect.right <= toolbarRect.right + 0.5
          && actionsRect.bottom <= toolbarRect.bottom + 0.5,
        scrollDoesNotOverlapActions: scrollRect.right <= actionsRect.left + 0.5,
        focusedToolVisible:
          contentSelectRect.left >= scrollRect.left - 0.5
          && contentSelectRect.right <= scrollRect.right + 0.5
      }
    })
    expect(phoneLayout).toEqual({
      actionsInsideToolbar: true,
      scrollDoesNotOverlapActions: true,
      focusedToolVisible: true
    })
  })
})
