/**
 * 실제 교차 origin 브리지 검증.
 * 부모 호스트는 127.0.0.1, iframe 뷰어는 localhost로 제공해 브라우저 SOP 경계를 통과한다.
 */
import { createServer, type Server } from 'node:http'
import { test, expect } from '@playwright/test'

const VIEWER_PORT = process.env.INKO_E2E_PORT ?? '5199'
const HOST_PORT = Number(process.env.INKO_CROSS_ORIGIN_HOST_PORT ?? '5200')
const UNTRUSTED_HOST_PORT = Number(process.env.INKO_UNTRUSTED_CROSS_ORIGIN_HOST_PORT ?? '5201')
const VIEWER_ORIGIN = `http://localhost:${VIEWER_PORT}`
const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`
const UNTRUSTED_HOST_ORIGIN = `http://127.0.0.1:${UNTRUSTED_HOST_PORT}`

function assertPort(name: string, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name}가 올바르지 않습니다: ${port}`)
  }
}

assertPort('INKO_CROSS_ORIGIN_HOST_PORT', HOST_PORT)
assertPort('INKO_UNTRUSTED_CROSS_ORIGIN_HOST_PORT', UNTRUSTED_HOST_PORT)
if (HOST_PORT === UNTRUSTED_HOST_PORT) {
  throw new Error('허용 host와 비허용 host의 포트는 서로 달라야 합니다')
}

function hostPage(hostOrigin: string, includeSiblingAttacker = false): string {
  const sdkUrl = JSON.stringify(`${VIEWER_ORIGIN}/pdfv/sdk/pdfv-sdk.js`)
  const viewerUrl = JSON.stringify(`${VIEWER_ORIGIN}/pdfv/`)
  const siblingAttacker = includeSiblingAttacker
    ? '<iframe id="sibling-attacker" src="/attacker" hidden></iframe>'
    : ''

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <title>Inko cross-origin bridge probe</title>
    <style>html,body,#viewer{width:100%;height:100%;margin:0}</style>
  </head>
  <body>
    <div id="viewer"></div>
    ${siblingAttacker}
    <script src=${sdkUrl}></script>
    <script>
      window.__bridgeProbe = { ready: 0, viewerMessages: [], errors: [], siblingAttackSent: 0 };
      window.addEventListener('message', function (event) {
        if (event.origin === ${JSON.stringify(VIEWER_ORIGIN)} && event.data && typeof event.data.type === 'string') {
          window.__bridgeProbe.viewerMessages.push({ type: event.data.type, origin: event.origin });
        }
        if (event.origin === ${JSON.stringify(hostOrigin)} && event.data && event.data.type === 'siblingAttackSent') {
          window.__bridgeProbe.siblingAttackSent += 1;
        }
      });
      window.__inkoViewer = window.Inko.mount('#viewer', {
        src: ${viewerUrl},
        onReady: function () { window.__bridgeProbe.ready += 1; },
        onError: function (error) {
          window.__bridgeProbe.errors.push(String(error && error.message ? error.message : error));
        }
      });
      window.__sendSiblingAttack = function (config) {
        var attacker = document.getElementById('sibling-attacker');
        if (!attacker || !attacker.contentWindow) throw new Error('sibling attacker is not ready');
        attacker.contentWindow.postMessage({ type: 'siblingAttack', config: config }, ${JSON.stringify(hostOrigin)});
      };
    </script>
  </body>
</html>`
}

function attackerPage(): string {
  return `<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8"><title>Sibling source probe</title></head>
  <body>
    <script>
      window.addEventListener('message', function (event) {
        if (event.source !== parent || event.origin !== ${JSON.stringify(HOST_ORIGIN)}) return;
        if (!event.data || event.data.type !== 'siblingAttack') return;
        var viewer = parent.document.querySelector('#viewer iframe');
        if (!viewer || !viewer.contentWindow) return;
        viewer.contentWindow.postMessage(
          { type: 'applyConfig', data: event.data.config },
          ${JSON.stringify(VIEWER_ORIGIN)}
        );
        parent.postMessage({ type: 'siblingAttackSent' }, ${JSON.stringify(HOST_ORIGIN)});
      });
    </script>
  </body>
</html>`
}

function createHostServer(hostOrigin: string, includeSiblingAttacker = false): Server {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', hostOrigin)
    if (includeSiblingAttacker && requestUrl.pathname === '/attacker') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      response.end(attackerPage())
      return
    }

    if (requestUrl.pathname !== '/') {
      response.writeHead(404).end('Not found')
      return
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    response.end(hostPage(hostOrigin, includeSiblingAttacker))
  })
}

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
}

async function close(server: Server | undefined) {
  if (!server?.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}

let hostServer: Server | undefined
let untrustedHostServer: Server | undefined

test.beforeAll(async () => {
  hostServer = createHostServer(HOST_ORIGIN, true)
  untrustedHostServer = createHostServer(UNTRUSTED_HOST_ORIGIN)
  await listen(hostServer, HOST_PORT)
  await listen(untrustedHostServer, UNTRUSTED_HOST_PORT)
})

test.afterAll(async () => {
  await Promise.all([close(hostServer), close(untrustedHostServer)])
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

test('허용 parent와 같은 origin이어도 sibling iframe의 다른 event.source는 거부한다', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto(HOST_ORIGIN)
  await expect.poll(() => page.evaluate(() => (window as any).__bridgeProbe?.ready), {
    timeout: 15_000
  }).toBe(1)
  await page.waitForFunction(() => (
    document.querySelector<HTMLIFrameElement>('#sibling-attacker')?.contentDocument?.readyState === 'complete'
  ))

  const viewer = page.frameLocator('#viewer iframe')
  await page.evaluate(() => (window as any).__inkoViewer.applyConfig({ locale: 'en' }))
  await expect(viewer.getByRole('button', { name: 'Landscape view' })).toBeVisible({ timeout: 5_000 })

  await page.evaluate(() => (window as any).__sendSiblingAttack({ locale: 'ko' }))
  await expect.poll(() => page.evaluate(() => (
    (window as any).__bridgeProbe?.siblingAttackSent
  )), { timeout: 5_000 }).toBe(1)
  await page.waitForTimeout(250)

  await expect(viewer.getByRole('button', { name: 'Landscape view' })).toBeVisible()
  await expect(viewer.getByRole('button', { name: '가로 보기' })).toHaveCount(0)
  const probe = await page.evaluate(() => (window as any).__bridgeProbe)
  expect(probe.errors).toEqual([])
  expect(pageErrors).toEqual([])
})

test('allowlist에 없는 실제 부모 origin의 메시지와 handshake를 거부한다', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto(UNTRUSTED_HOST_ORIGIN)
  const viewerFrame = page.locator('#viewer iframe')
  await viewerFrame.waitFor({ state: 'visible', timeout: 15_000 })
  const viewer = page.frameLocator('#viewer iframe')
  await expect(viewer.locator('.pdf-viewer-container')).toBeVisible({ timeout: 15_000 })

  await page.evaluate((viewerOrigin) => {
    const frame = document.querySelector<HTMLIFrameElement>('#viewer iframe')
    frame?.contentWindow?.postMessage({
      type: 'applyConfig',
      data: { locale: 'en' }
    }, viewerOrigin)
  }, VIEWER_ORIGIN)
  await page.waitForTimeout(500)

  await expect(viewer.getByRole('button', { name: '가로 보기' })).toBeVisible()
  await expect(viewer.getByRole('button', { name: 'Landscape view' })).toHaveCount(0)
  const probe = await page.evaluate(() => (window as any).__bridgeProbe)
  expect(probe.ready).toBe(0)
  expect(probe.viewerMessages).toEqual([])
  expect(probe.errors).toEqual([])
  expect(pageErrors).toEqual([])
})
