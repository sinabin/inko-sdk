/**
 * SDK Round-Trip 검증
 *
 * 시나리오:
 *  1. example.html 로드 → SDK가 iframe 마운트
 *  2. iframe 내부 viewer가 자체 합성 fixture를 로드
 *  3. 펜 도구 선택 후 paper canvas에 스트로크
 *  4. 호스트 [저장] → onSave → fakeDb.canvasData 채워짐
 *  5. canvasData가 raw JSON이고 페이지에 Path 객체 포함 검증
 *  6. viewer.loadPdfUrl(url, name, canvasData)로 재로드
 *  7. 다시 viewer.save() → 두 번째 canvasData도 Path 포함하는지 검증
 *  → 저장한 그림이 재로드 시 캔버스로 살아 돌아온다는 것을 end-to-end로 보장
 */
import { test, expect, type FrameLocator } from '@playwright/test'
import { dispatchStroke } from './helpers'

const EXAMPLE_URL = 'sdk/example.html'

async function waitForViewerInsideIframe(frame: FrameLocator) {
  await expect(frame.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })
  await frame.locator('.scroll-page-container canvas.scroll-page-canvas-pdf').first().waitFor({ timeout: 30_000 })
}

/** 직렬화된 canvasData에서 페이지별 실제 그리기 객체(Path 등) 존재 여부 */
function pagesWithPaintingFromCanvasData(canvasData: string): string[] {
  const parsed = JSON.parse(canvasData) as Record<string, string>
  return Object.entries(parsed).filter(([_, v]) => {
    if (!v || v === '[]') return false
    try {
      const pageItems = JSON.parse(v)
      // Paper.js export는 [Layer, ...] 형태 — Layer 안에 children 있으면 그림이 있는 것
      return Array.isArray(pageItems) && pageItems.some((item: any) => {
        if (typeof item !== 'object' || item === null) return false
        return !!(item.children?.length) || (Array.isArray(item) && item.length > 1)
      })
    } catch { return false }
  }).map(([k]) => k)
}

test.describe('SDK Round-Trip', () => {
  test('펜 그리기 → 저장 → 재로드 시 캔버스 복원', async ({ page }) => {
    page.on('pageerror', e => console.log('[pageerror]', e.message))

    await page.goto(EXAMPLE_URL)

    const iframe = page.frameLocator('#viewer iframe')
    await waitForViewerInsideIframe(iframe)

    // 2. 펜 도구 선택
    const penButton = iframe.locator('[data-tool="pen"]')
    await expect(penButton).toBeVisible({ timeout: 5_000 })
    await penButton.click()
    await expect(penButton).toHaveClass(/active/, { timeout: 3_000 })

    // 3. 첫 페이지 paper canvas에 스트로크 디스패치
    const paperCanvas = iframe.locator('.scroll-page-container canvas.scroll-page-canvas-paper').first()
    await expect(paperCanvas).toBeVisible({ timeout: 10_000 })
    await dispatchStroke(page, paperCanvas, [
      { x: 100, y: 100 },
      { x: 150, y: 120 },
      { x: 200, y: 150 },
      { x: 250, y: 200 },
    ], { pointerType: 'pen', pressure: 0.6 })

    // path finalize 대기
    await page.waitForTimeout(300)

    // 문서화된 onChange 자동저장 계약 — 저장 버튼 전에도 전체 canvasData가 호스트에 도달
    await expect(page.locator('#log')).toContainText('canvasDataChanged', { timeout: 5_000 })
    const changedCanvasData = await page.evaluate(
      () => (window as any).__inkoDemo.viewer.getLastCanvasData() as string
    )
    expect(
      pagesWithPaintingFromCanvasData(changedCanvasData).length,
      'onChange가 복원 가능한 전체 canvasData를 전달해야 함'
    ).toBeGreaterThan(0)

    // 4. 호스트 [저장] 버튼 클릭 — SDK.save() → iframe sendSaveCanvasResponse → onSave 콜백
    await page.locator('#btn-save').click()

    // onSave가 fakeDb를 채울 때까지 대기
    await page.waitForFunction(() => {
      const demo = (window as any).__inkoDemo
      return demo && typeof demo.savedState === 'string' && demo.savedState.length > 0
    }, null, { timeout: 5_000 })

    const savedCanvasData = await page.evaluate(() => (window as any).__inkoDemo.savedState as string)
    expect(savedCanvasData.length, 'fakeDb에 canvasData 저장됨').toBeGreaterThan(0)

    // 5. canvasData 형식·내용 검증
    const pagesWithPainting = pagesWithPaintingFromCanvasData(savedCanvasData)
    expect(pagesWithPainting.length, '저장된 canvasData에 그림이 있는 페이지가 1개 이상 있어야 함').toBeGreaterThan(0)

    // 6. clear()로 캔버스 비우고 검증 — 정말 비워지는지 + 자동저장 데이터가 실제로 손실되는지
    await page.evaluate(() => {
      const demo = (window as any).__inkoDemo
      demo.viewer.clear()
    })
    await expect.poll(async () => pagesWithPaintingFromCanvasData(await page.evaluate(
      () => (window as any).__inkoDemo.viewer.getLastCanvasData() as string
    )).length).toBe(0)

    await page.evaluate(() => { (window as any).__inkoDemo.viewer.save() })
    await page.waitForTimeout(300)

    const clearedCanvasData = await page.evaluate(() => (window as any).__inkoDemo.savedState as string)
    const pagesAfterClear = clearedCanvasData ? pagesWithPaintingFromCanvasData(clearedCanvasData) : []
    expect(pagesAfterClear.length, 'clear() 후엔 그림이 있는 페이지가 0이어야 함 — clear가 실제로 동작하는지 검증').toBe(0)

    // 7. 페이지 2에도 같은 상태를 둔 저장본으로 재로드 — 복원과 current-page clear 경계 검증
    const twoPageCanvasData = JSON.stringify({
      ...JSON.parse(savedCanvasData),
      '2': JSON.parse(savedCanvasData)['1']
    })
    await page.evaluate((saved) => {
      const demo = (window as any).__inkoDemo
      document.getElementById('log')!.textContent = ''
      demo.viewer.loadPdfUrl('/pdfv/samples/inko-demo.pdf', 'inko-demo.pdf', saved, false)
    }, twoPageCanvasData)

    // onPdfLoaded 자체가 첫 페이지 렌더와 canvasData 복원을 보장
    await expect(page.locator('#log')).toContainText('pdfLoaded', { timeout: 15_000 })

    // 8. 두 번째 save() — 복원된 캔버스를 다시 직렬화해서 검증
    await page.evaluate(() => { (window as any).__inkoDemo.viewer.save() })
    await page.waitForFunction(() => {
      const demo = (window as any).__inkoDemo
      return demo && typeof demo.savedState === 'string' && demo.savedState.length > 0
    }, null, { timeout: 5_000 })

    const restoredCanvasData = await page.evaluate(() => (window as any).__inkoDemo.savedState as string)
    expect(restoredCanvasData.length, '재로드 후 save: canvasData 비어있지 않음').toBeGreaterThan(0)

    const pagesAfterRestore = pagesWithPaintingFromCanvasData(restoredCanvasData)
    expect(pagesAfterRestore.sort(), '재로드 후 두 페이지 상태가 모두 복원').toEqual(['1', '2'])
    // clear 직후 0이었던 페이지가 reload+canvasData로 ≥1로 회복됨 → SDK URL+canvasData 인자가 실제 작동함을 입증

    // 공개 clear()는 현재 페이지(1)만 비우고 다른 페이지 상태는 보존
    await page.evaluate(() => {
      const demo = (window as any).__inkoDemo
      demo.viewer.clear()
      demo.viewer.save()
    })
    await expect.poll(async () => page.evaluate(
      () => (window as any).__inkoDemo.savedState as string
    )).not.toBe(restoredCanvasData)
    const afterCurrentPageClear = await page.evaluate(() => (window as any).__inkoDemo.savedState as string)
    expect(pagesWithPaintingFromCanvasData(afterCurrentPageClear)).toEqual(['2'])

    console.log(
      '[SDK Round-Trip] saved=%d → cleared=%d → restored=%d | pages painting before=%j cleared=%j after=%j',
      savedCanvasData.length, clearedCanvasData.length, restoredCanvasData.length,
      pagesWithPainting, pagesAfterClear, pagesAfterRestore
    )
  })

  test('직렬화 실패도 onSave에 ok=false와 메시지로 응답', async ({ page }) => {
    await page.goto(EXAMPLE_URL)
    const iframe = page.frameLocator('#viewer iframe')
    await waitForViewerInsideIframe(iframe)

    await iframe.locator('html').evaluate(() => {
      const original = JSON.stringify
      JSON.stringify = function (value: any, ...args: any[]) {
        const isCanvasRecord = !!value && typeof value === 'object' && !Array.isArray(value) &&
          Object.keys(value as object).every((key) => /^\d+$/.test(key))
        if (isCanvasRecord) {
          JSON.stringify = original
          throw new Error('forced serialization failure')
        }
        return (original as any)(value, ...args)
      } as typeof JSON.stringify
    })

    await page.evaluate(() => {
      document.getElementById('log')!.textContent = ''
      ;(window as any).__inkoDemo.viewer.save()
    })

    await expect(page.locator('#log')).toContainText('saveCanvasResponse:', { timeout: 5_000 })
    await expect(page.locator('#status')).toHaveText('저장 실패')
  })
})
