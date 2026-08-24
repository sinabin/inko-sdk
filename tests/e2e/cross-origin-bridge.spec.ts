/**
 * 실제 교차 origin 브리지 검증.
 * 부모 호스트는 127.0.0.1, iframe 뷰어는 localhost로 제공해 브라우저 SOP 경계를 통과한다.
 */
import { createServer, type Server } from 'node:http'
import { test, expect } from '@playwright/test'

const VIEWER_PORT = process.env.INKO_E2E_PORT ?? '5199'
const HOST_PORT = Number(process.env.INKO_CROSS_ORIGIN_HOST_PORT ?? '5200')
const VIEWER_ORIGIN = `http://localhost:${VIEWER_PORT}`
const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`

if (!Number.isInteger(HOST_PORT) || HOST_PORT < 1 || HOST_PORT > 65_535) {
  throw new Error(`INKO_CROSS_ORIGIN_HOST_PORT가 올바르지 않습니다: ${HOST_PORT}`)
}

function hostPage(): string {
  const sdkUrl = JSON.stringify(`${VIEWER_ORIGIN}/pdfv/sdk/pdfv-sdk.js`)
  const viewerUrl = JSON.stringify(`${VIEWER_ORIGIN}/pdfv/`)

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <title>Inko cross-origin bridge probe</title>
    <style>html,body,#viewer{width:100%;height:100%;margin:0}</style>
  </head>
  <body>
    <div id="viewer"></div>
    <script src=${sdkUrl}></script>
    <script>
      window.__bridgeProbe = { ready: 0, viewerMessages: [], errors: [] };
      window.addEventListener('message', function (event) {
        if (event.origin === ${JSON.stringify(VIEWER_ORIGIN)} && event.data && typeof event.data.type === 'string') {
          window.__bridgeProbe.viewerMessages.push({ type: event.data.type, origin: event.origin });
        }
      });
      window.__inkoViewer = window.Inko.mount('#viewer', {
        src: ${viewerUrl},
        onReady: function () { window.__bridgeProbe.ready += 1; },
        onError: function (error) {
          window.__bridgeProbe.errors.push(String(error && error.message ? error.message : error));
        }
      });
    </script>
  </body>
</html>`
}

let hostServer: Server

test.beforeAll(async () => {
  hostServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', HOST_ORIGIN)
    if (requestUrl.pathname !== '/') {
      response.writeHead(404).end('Not found')
      return
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    response.end(hostPage())
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    hostServer.once('error', onError)
    hostServer.listen(HOST_PORT, '127.0.0.1', () => {
      hostServer.off('error', onError)
      resolve()
    })
  })
})

test.afterAll(async () => {
  if (!hostServer?.listening) return
  await new Promise<void>((resolve, reject) => {
    hostServer.close(error => error ? reject(error) : resolve())
  })
})

test('명시 허용한 127 host가 localhost viewer와 설정·방향 메시지를 왕복한다', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto(HOST_ORIGIN)

  await expect.poll(() => page.evaluate(() => (window as any).__bridgeProbe?.ready), {
    timeout: 15_000
  }).toBe(1)
  const iframeUrl = await page.locator('#viewer iframe').getAttribute('src')
  expect(new URL(page.url()).origin).toBe(HOST_ORIGIN)
  expect(new URL(iframeUrl!, page.url()).origin).toBe(VIEWER_ORIGIN)
  expect(HOST_ORIGIN).not.toBe(VIEWER_ORIGIN)

  // host → viewer: SDK의 applyConfig가 실제 cross-origin postMessage로 전달되는지 UI로 확인.
  await page.evaluate(() => (window as any).__inkoViewer.applyConfig({ locale: 'en' }))
  const orientationButton = page.frameLocator('#viewer iframe').getByRole('button', { name: 'Landscape view' })
  await expect(orientationButton).toBeVisible({ timeout: 5_000 })

  // viewer → host: pinning된 부모 하나로만 데이터 메시지가 돌아오는지 확인.
  await orientationButton.click()
  await expect.poll(() => page.evaluate(() => (
    (window as any).__bridgeProbe?.viewerMessages.some((message: any) => message.type === 'setOrientation')
  )), { timeout: 5_000 }).toBe(true)

  const probe = await page.evaluate(() => (window as any).__bridgeProbe)
  expect(probe.errors).toEqual([])
  expect(probe.viewerMessages).toContainEqual({ type: 'setOrientation', origin: VIEWER_ORIGIN })
  expect(pageErrors).toEqual([])
})
