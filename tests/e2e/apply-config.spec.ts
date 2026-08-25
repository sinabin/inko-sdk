/**
 * applyConfig(테마/도구/i18n) E2E — 2026-05-31 고객 커스터마이징 API 회귀 자산화.
 *
 * 경로: 고객 SDK 실경로 2종
 *  ① viewer.applyConfig(config) 런타임 부분 갱신 — SDK send → postMessageBridge → applyViewerConfig
 *  ② Inko.mount(options) 마운트 옵션 — buildConfig → viewerReady 시 APPLY_CONFIG 선주입
 * 계층별 분담:
 *  - bridge 라우팅 단위: tests/unit/applyConfigBridge.test.ts
 *  - 테마 CSS 변수 매핑 단위: tests/unit/applyTheme.test.ts
 *  - i18n t()/setLocale/setMessages 단위: tests/unit/i18n.test.ts
 *  - 본 파일: 실제 뷰어 DOM 반영 통합 검증 (도구 필터·기능 토글·로케일·테마 토큰)
 */
import { test, expect, type Page, type FrameLocator } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const EXAMPLE_URL = 'sdk/example.html'
const TEST_PDF_PATH = path.resolve('public/samples/inko-demo.pdf')

async function waitForViewerInsideIframe(frame: FrameLocator) {
  await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
  await frame.locator('.scroll-page-container canvas.scroll-page-canvas-pdf').first().waitFor({ timeout: 30_000 })
}

async function applyConfig(page: Page, config: Record<string, unknown>) {
  await page.evaluate((cfg) => {
    ;(window as any).__inkoDemo.viewer.applyConfig(cfg)
  }, config)
}

/** iframe 문서 루트의 inline CSS 변수 값 */
function rootCssVar(frame: FrameLocator, name: string) {
  return frame.locator('html').evaluate((el, varName) => (el as HTMLElement).style.getPropertyValue(varName), name)
}

/** enabled 설정이 필터링하는 편집 툴바 도구 */
function authoringTools(frame: FrameLocator) {
  return frame.locator('.tool-btn[data-tool]')
}

test.describe('applyConfig 커스터마이징 (SDK 경유)', () => {
  test.skip(!fs.existsSync(TEST_PDF_PATH), 'public/samples/inko-demo.pdf가 없음')

  test('① 런타임 applyConfig — 테마·도구 필터·기능 토글·로케일 일괄 적용 + 부분 갱신', async ({ page }) => {
    await page.goto(EXAMPLE_URL)
    const iframe = page.frameLocator('#viewer iframe')
    await waitForViewerInsideIframe(iframe)

    // 적용 전 기준값 — 전체 도구 노출, 줌 표시, 한국어
    await expect(iframe.locator('[data-tool="pen"]')).toBeVisible()
    expect(await authoringTools(iframe).count()).toBeGreaterThan(1)
    await expect(iframe.locator('[data-tool="contentSelect"]')).toBeVisible()
    await expect(iframe.locator('.zoom-info')).toBeVisible()
    await expect(iframe.locator('[data-tool="pen"]')).toHaveAttribute('title', '펜')

    await applyConfig(page, {
      theme: { primaryColor: '#e8a045' },
      tools: { enabled: ['pen'], features: { zoom: false } },
      locale: 'en'
    })

    // 테마 — primitive 오버라이드로 semantic 토큰까지 리브랜드
    await expect.poll(() => rootCssVar(iframe, '--color-primary')).toBe('#e8a045')
    // 도구 필터 — 편집 툴바와 별도 네이티브 내용 선택 모두 enabled 계약을 따름
    await expect(authoringTools(iframe)).toHaveCount(1)
    await expect(iframe.locator('[data-tool="pen"]')).toBeVisible()
    await expect(iframe.locator('[data-tool="contentSelect"]')).toHaveCount(0)
    // 검색은 독립 feature이므로 계속 노출되고, 열어도 비활성 contentSelect로 전환하지 않음
    await expect(iframe.getByTestId('pdf-search-open')).toBeVisible()
    await iframe.getByTestId('pdf-search-open').click()
    await expect(iframe.getByTestId('pdf-search-input')).toBeFocused()
    await expect(iframe.locator('[data-tool="pen"]')).toHaveClass(/active/)
    await iframe.locator('.pdf-search-bar .close-button').click()
    // 기능 토글 — zoom 컨트롤 숨김 (style:display)
    await expect(iframe.locator('.zoom-info')).toBeHidden()
    // 로케일 — 영문 전환
    await expect(iframe.locator('[data-tool="pen"]')).toHaveAttribute('title', 'Pen')

    // 부분 갱신 — locale만 ko로 되돌려도 직전 도구 구성 유지
    await applyConfig(page, { locale: 'ko' })
    await expect(iframe.locator('[data-tool="pen"]')).toHaveAttribute('title', '펜')
    await expect(authoringTools(iframe)).toHaveCount(1)

    // search=false는 UI뿐 아니라 Ctrl/Cmd+F도 가로채지 않아 브라우저 기본 찾기를 보존
    await applyConfig(page, { tools: { features: { search: false } } })
    await expect(iframe.getByTestId('pdf-search-open')).toHaveCount(0)
    const findPrevented = await iframe.locator('body').evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'f', ctrlKey: true, cancelable: true
      })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(findPrevented).toBe(false)

    // text 도구와 thumbnails 기능 플래그는 실제 본문 UI까지 일치
    await applyConfig(page, {
      tools: { enabled: ['text'], defaultTool: 'text', features: { thumbnails: false } }
    })
    await expect(iframe.locator('[data-tool="text"]')).toBeVisible()
    await expect(authoringTools(iframe)).toHaveCount(1)
    await expect(iframe.locator('[data-tool="contentSelect"]')).toHaveCount(0)
    await expect(iframe.locator('[data-tool="text"]')).toHaveClass(/active/)
    await expect(iframe.locator('.thumbnail-toggle-btn')).toBeHidden()
    await expect(iframe.locator('.thumbnail-sidebar')).toHaveCount(0)
  })

  test('② Inko.mount 옵션 경로 — buildConfig가 viewerReady 시 테마·도구·로케일 선주입', async ({ page }) => {
    await page.goto(EXAMPLE_URL)
    await waitForViewerInsideIframe(page.frameLocator('#viewer iframe'))

    // 같은 호스트 페이지에 두 번째 뷰어를 고객 mount 경로로 장착
    await page.evaluate(() => {
      const div = document.createElement('div')
      div.id = 'second-viewer'
      div.style.height = '500px'
      document.body.appendChild(div)
      const SDK = (window as any).Inko
      ;(window as any).__secondViewer = SDK.mount('#second-viewer', {
        src: '../index.html',
        pdfUrl: '/pdfv/samples/inko-demo.pdf',
        fileName: 'mounted.pdf',
        theme: { primaryColor: '#e8a045' },
        tools: { enabled: ['pen'] },
        locale: 'en'
      })
    })

    const frame2 = page.frameLocator('#second-viewer iframe')
    await waitForViewerInsideIframe(frame2)

    await expect.poll(() => rootCssVar(frame2, '--color-primary')).toBe('#e8a045')
    await expect(authoringTools(frame2)).toHaveCount(1)
    await expect(frame2.locator('[data-tool="contentSelect"]')).toHaveCount(0)
    await expect(frame2.locator('[data-tool="pen"]')).toHaveAttribute('title', 'Pen')
  })

  test('③ 좁은 화면에서 브랜드 로고와 고정 액션이 서로 겹치지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto(EXAMPLE_URL)
    const iframe = page.frameLocator('#viewer iframe')
    await waitForViewerInsideIframe(iframe)

    await applyConfig(page, {
      theme: {
        logoUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="140" height="26"%3E%3Crect width="140" height="26" fill="%230d1b3e"/%3E%3C/svg%3E'
      }
    })
    await expect(iframe.locator('.toolbar-logo')).toBeVisible()

    const layout = await iframe.locator('.toolbar').evaluate((element) => {
      const toolbarRect = element.getBoundingClientRect()
      const scroll = element.querySelector('.toolbar-scroll')!
      const actionsRect = element.querySelector('.toolbar-actions')!.getBoundingClientRect()
      const logo = element.querySelector('.toolbar-logo')!
      return {
        logoInsideScroll: logo.parentElement === scroll,
        scrollWidth: scroll.getBoundingClientRect().width,
        actionsInsideToolbar: actionsRect.left >= toolbarRect.left && actionsRect.right <= toolbarRect.right + 0.5
      }
    })

    expect(layout.logoInsideScroll).toBe(true)
    expect(layout.scrollWidth).toBeGreaterThan(0)
    expect(layout.actionsInsideToolbar).toBe(true)
  })

  test('④ PDF가 없는 SDK 초기 상태에는 검색 트리거와 끊어진 ARIA 참조가 없다', async ({ page }) => {
    await page.goto(EXAMPLE_URL)
    await waitForViewerInsideIframe(page.frameLocator('#viewer iframe'))

    await page.evaluate(() => {
      const div = document.createElement('div')
      div.id = 'empty-viewer'
      div.style.height = '500px'
      document.body.appendChild(div)
      ;(window as any).__emptyViewer = (window as any).Inko.mount('#empty-viewer', {
        src: '../index.html'
      })
    })

    const emptyFrame = page.frameLocator('#empty-viewer iframe')
    await expect(emptyFrame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
    await expect(emptyFrame.getByTestId('pdf-search-open')).toHaveCount(0)
    await expect(emptyFrame.locator('[aria-controls="inko-pdf-search"]')).toHaveCount(0)
  })
})
