/** Playwright E2E 헬퍼 — 뷰어 준비, 포인터 시뮬레이션, 시각 캡처 */
import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/** standalone 개발 뷰어가 마운트될 때까지 대기 */
export async function waitForViewerReady(page: Page) {
  await expect(page.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
}

/** PDF가 첫 페이지를 렌더할 때까지 대기 */
export async function waitForFirstPageRender(page: Page) {
  await page.waitForFunction(
    () => {
      const canvases = document.querySelectorAll('.scroll-page-container canvas.scroll-page-canvas-pdf')
      return canvases.length > 0
    },
    null,
    { timeout: 30_000 }
  )
}

/**
 * 포인터(스타일러스 시뮬레이션 포함) 스트로크 디스패치
 * - target locator의 element 위에서 PointerEvent 디스패치
 * - pointerType: 'pen' | 'touch' | 'mouse', pressure/tilt 지정 가능
 */
export async function dispatchStroke(
  _page: Page,
  target: Locator,
  points: Array<{ x: number; y: number }>,
  options: { pointerType?: 'pen' | 'touch' | 'mouse'; pressure?: number; tiltX?: number; tiltY?: number } = {}
) {
  const { pointerType = 'pen', pressure = 0.5, tiltX = 0, tiltY = 0 } = options

  await target.evaluate(
    (el, { points, pointerType, pressure, tiltX, tiltY }) => {
      const rect = el.getBoundingClientRect()
      // pointermove 시 buttons=1 (눌림 상태) — drawingMode가 e.buttons===0이면 path를 finalize하므로 필수
      const dispatch = (type: string, p: { x: number; y: number }, isLast: boolean) => {
        const ev = new PointerEvent(type, {
          pointerType,
          pressure: isLast ? 0 : pressure,
          tiltX,
          tiltY,
          isPrimary: true,
          button: 0,
          buttons: isLast ? 0 : 1,
          clientX: rect.left + p.x,
          clientY: rect.top + p.y,
          bubbles: true,
          cancelable: true
        })
        el.dispatchEvent(ev)
      }

      if (points.length === 0) return
      dispatch('pointerdown', points[0], false)
      for (let i = 1; i < points.length; i++) dispatch('pointermove', points[i], false)
      dispatch('pointerup', points[points.length - 1], true)
    },
    { points, pointerType, pressure, tiltX, tiltY }
  )
}

/** 시각 검증용 스크린샷 — Claude가 직접 읽을 수 있도록 고정 경로에 저장 */
export async function captureForClaude(page: Page, name: string) {
  const dir = path.resolve('tests/e2e/screenshots')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

/** 도구 모드 변경 — 툴바 버튼 클릭 */
export async function selectTool(page: Page, tool: 'pen' | 'highlighter' | 'eraser' | 'select' | 'text' | 'rectangle' | 'circle' | 'line') {
  const button = page.locator(`[data-tool="${tool}"], button:has-text("${tool}")`).first()
  if (await button.count() > 0) {
    await button.click()
  } else {
    // fallback: 키보드 단축키 또는 selector 변형
    await page.keyboard.press(tool[0])
  }
}
