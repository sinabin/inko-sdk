import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..', '..')
const publicPackageName = 'inko-pdf-sdk'
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const expectPublic = process.argv.includes('--expect-public')
const tarball = resolveTarball(positionalArgs[0])
const consumerRoot = mkdtempSync(join(tmpdir(), 'inko-release-consumer-'))
const fixtureDir = join(consumerRoot, 'fixture')
const requestFailures = []
const browserErrors = []
let expectedAbortedPdfRequests = 0
let browser
let server

function resolveTarball(input) {
  if (input) return isAbsolute(input) ? input : resolve(process.cwd(), input)

  const rootPackage = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  return join(projectRoot, `${publicPackageName}-${rootPackage.version}.tgz`)
}

function runNpm(args, cwd) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], {
        cwd,
        encoding: 'utf8',
        windowsVerbatimArguments: false,
      })
    : spawnSync('npm', args, { cwd, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error([
      `npm ${args[0]} failed with exit code ${result.status}`,
      result.stdout,
      result.stderr,
      result.error?.message,
    ].filter(Boolean).join('\n'))
  }

  return `${result.stdout || ''}${result.stderr || ''}`.trim()
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function containsPainting(canvasData) {
  if (typeof canvasData !== 'string' || canvasData.length === 0) return false
  const pages = JSON.parse(canvasData)

  return Object.values(pages).some((pageJson) => {
    if (typeof pageJson !== 'string' || pageJson === '[]') return false
    try {
      const items = JSON.parse(pageJson)
      return Array.isArray(items) && items.some((item) => {
        if (item === null || typeof item !== 'object') return false
        return Boolean(item.children?.length) || (Array.isArray(item) && item.length > 1)
      })
    } catch {
      return false
    }
  })
}

function mimeType(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.pdf': 'application/pdf',
    '.ttf': 'font/ttf',
    '.pfb': 'application/octet-stream',
    '.bcmap': 'application/octet-stream',
  })[extname(file).toLowerCase()] || 'application/octet-stream'
}

function startStaticServer(root) {
  return new Promise((resolvePromise, reject) => {
    const instance = createServer((request, response) => {
      try {
        const url = new URL(request.url || '/', 'http://127.0.0.1')
        const requested = url.pathname === '/' ? 'fixture/index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '')
        const file = resolve(root, requested)
        const rel = relative(root, file)

        if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || !existsSync(file) || !statSync(file).isFile()) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('Not found')
          return
        }

        response.writeHead(200, {
          'Content-Type': mimeType(file),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        response.end(readFileSync(file))
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(String(error))
      }
    })

    instance.once('error', reject)
    instance.listen(0, '127.0.0.1', () => {
      const address = instance.address()
      assert(address && typeof address === 'object')
      resolvePromise({ instance, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}

function fixtureHtml() {
  const packageRoot = `/node_modules/${publicPackageName}`
  const viewer = `${packageRoot}/viewer/index.html`
  const pdf = `${packageRoot}/viewer/samples/inko-demo.pdf`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Installed Inko release probe</title>
  <style>html,body,#viewer{width:100%;height:100%;margin:0}iframe{display:block}</style>
</head>
<body>
  <div id="viewer"></div>
  <script src="${packageRoot}/sdk/inko-sdk.js"></script>
  <script>
    window.__releaseProbe = { ready: false, pdfLoaded: 0, changed: '', saves: [], errors: [] };
    window.__releaseProbe.viewer = window.Inko.mount('#viewer', {
      src: '${viewer}',
      pdfUrl: '${pdf}',
      fileName: 'inko-demo.pdf',
      readOnly: false,
      onReady: function () { window.__releaseProbe.ready = true; },
      onPdfLoaded: function () { window.__releaseProbe.pdfLoaded += 1; },
      onChange: function (canvasData) { window.__releaseProbe.changed = canvasData; },
      onSave: function (canvasData, ok, message) {
        window.__releaseProbe.saves.push({ canvasData: canvasData, ok: ok, message: message });
      },
      onError: function (error) {
        window.__releaseProbe.errors.push(String(error && error.message ? error.message : error));
      }
    });
  </script>
</body>
</html>`
}

async function drawStroke(frame) {
  const pen = frame.locator('[data-tool="pen"]')
  await pen.waitFor({ state: 'visible', timeout: 15_000 })
  await pen.click()

  const canvas = frame.locator('.scroll-page-container canvas.scroll-page-canvas-paper').first()
  await canvas.waitFor({ state: 'visible', timeout: 30_000 })
  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const points = [[100, 100], [150, 120], [200, 150], [250, 200]]
    const dispatch = (type, [x, y], last) => element.dispatchEvent(new PointerEvent(type, {
      pointerType: 'pen',
      pressure: last ? 0 : 0.6,
      isPrimary: true,
      button: 0,
      buttons: last ? 0 : 1,
      clientX: rect.left + x,
      clientY: rect.top + y,
      bubbles: true,
      cancelable: true,
    }))

    dispatch('pointerdown', points[0], false)
    for (const point of points.slice(1)) dispatch('pointermove', point, false)
    dispatch('pointerup', points.at(-1), true)
  })
}

async function saveCanvas(page) {
  const previousCount = await page.evaluate(() => window.__releaseProbe.saves.length)
  await page.evaluate(() => window.__releaseProbe.viewer.save())
  await page.waitForFunction((count) => window.__releaseProbe.saves.length > count, previousCount, { timeout: 10_000 })
  return page.evaluate(() => window.__releaseProbe.saves.at(-1))
}

async function verifyBrowserRoundTrip(installedRoot) {
  mkdirSync(fixtureDir, { recursive: true })
  writeFileSync(join(fixtureDir, 'index.html'), fixtureHtml(), 'utf8')

  const started = await startStaticServer(consumerRoot)
  server = started.instance
  const origin = started.origin
  const pdfUrl = `${origin}/node_modules/${publicPackageName}/viewer/samples/inko-demo.pdf`

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText
    // pdf.js cancels an in-flight full-file request when clear/reload replaces the loading task.
    // Both required loads still have their own observed HTTP 200 response gates below.
    if (request.url() === pdfUrl && errorText === 'net::ERR_ABORTED') {
      expectedAbortedPdfRequests += 1
      return
    }
    requestFailures.push(`${request.method()} ${request.url()}: ${errorText}`)
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })

  const pdfResponse = page.waitForResponse(
    (response) => response.url() === pdfUrl && response.status() === 200,
    { timeout: 30_000 },
  )
  await page.goto(`${origin}/fixture/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__releaseProbe?.ready === true, null, { timeout: 15_000 })
  await pdfResponse
  await page.waitForFunction(() => window.__releaseProbe?.pdfLoaded > 0, null, { timeout: 30_000 })

  const iframe = page.locator('#viewer iframe')
  await iframe.waitFor({ state: 'visible', timeout: 15_000 })
  const frame = page.frameLocator('#viewer iframe')
  await frame.locator('.scroll-page-container canvas.scroll-page-canvas-pdf').first().waitFor({ state: 'visible', timeout: 30_000 })

  const productionState = await iframe.evaluate((element) => {
    const child = element.contentWindow
    const androidBridgeGlobals = [
      'loadPdf',
      'loadPdfBase64',
      'getCanvasData',
      'loadUserCanvasData',
      'clearCanvas',
      'setOrientation',
      'conn',
    ].filter((name) => child && typeof child[name] !== 'undefined')
    return {
      bridgeMockPresent: Boolean(child && '__bridgeMock' in child),
      androidBridgeGlobals,
      localStorageKeys: child ? Object.keys(child.localStorage) : [],
    }
  })
  assert.equal(productionState.bridgeMockPresent, false, 'production viewer exposed the development bridge mock')
  assert.deepEqual(
    productionState.androidBridgeGlobals,
    [],
    `public v1 exposed Android bridge globals: ${productionState.androidBridgeGlobals.join(', ')}`,
  )

  await drawStroke(frame)
  await page.waitForFunction(() => window.__releaseProbe.changed.length > 0, null, { timeout: 10_000 })
  const changed = await page.evaluate(() => window.__releaseProbe.changed)
  assert(containsPainting(changed), 'onChange did not return restorable painted canvasData')

  const saved = await saveCanvas(page)
  assert.equal(saved.ok, true, `save failed: ${saved.message}`)
  assert(containsPainting(saved.canvasData), 'saved canvasData did not contain the stroke')

  await page.evaluate(() => window.__releaseProbe.viewer.clear())
  await page.waitForTimeout(500)
  const cleared = await saveCanvas(page)
  assert.equal(cleared.ok, true, `save after clear failed: ${cleared.message}`)
  assert.equal(containsPainting(cleared.canvasData), false, 'clear did not remove editable page state')

  const loadedCount = await page.evaluate(() => window.__releaseProbe.pdfLoaded)
  const reloadResponse = page.waitForResponse(
    (response) => response.url() === pdfUrl && response.status() === 200,
    { timeout: 30_000 },
  )
  await page.evaluate(({ pdfUrlPath, canvasData }) => {
    window.__releaseProbe.viewer.loadPdfUrl(pdfUrlPath, 'inko-demo.pdf', canvasData, false)
  }, {
    pdfUrlPath: `/node_modules/${publicPackageName}/viewer/samples/inko-demo.pdf`,
    canvasData: saved.canvasData,
  })
  await reloadResponse
  await page.waitForFunction((count) => window.__releaseProbe.pdfLoaded > count, loadedCount, { timeout: 30_000 })
  await page.waitForTimeout(1_500)

  const restored = await saveCanvas(page)
  assert.equal(restored.ok, true, `save after restore failed: ${restored.message}`)
  assert(containsPainting(restored.canvasData), 'restored canvasData did not contain the saved stroke')

  const callbackErrors = await page.evaluate(() => window.__releaseProbe.errors)
  assert.deepEqual(callbackErrors, [], `SDK callbacks reported errors: ${callbackErrors.join('; ')}`)
  assert.deepEqual(requestFailures, [], `HTTP request failures: ${requestFailures.join('; ')}`)
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('; ')}`)

  return {
    origin,
    sdkUrl: `${origin}/node_modules/${publicPackageName}/sdk/inko-sdk.js`,
    viewerUrl: `${origin}/node_modules/${publicPackageName}/viewer/index.html`,
    pdfUrl,
    changedBytes: changed.length,
    savedBytes: saved.canvasData.length,
    clearedBytes: cleared.canvasData.length,
    restoredBytes: restored.canvasData.length,
    expectedAbortedPdfRequests,
    productionState,
    installedRoot,
  }
}

async function main() {
  assert(existsSync(tarball), `tarball not found: ${tarball}`)

  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'inko-release-consumer-probe',
    version: '1.0.0',
    private: true,
  }, null, 2), 'utf8')

  const installOutput = runNpm(['install', '--no-audit', '--no-fund', tarball], consumerRoot)
  const installedRoot = join(consumerRoot, 'node_modules', publicPackageName)
  const installedPackagePath = join(installedRoot, 'package.json')
  assert(existsSync(installedPackagePath), `npm install exited successfully but ${publicPackageName} was not installed`)

  const metadata = JSON.parse(readFileSync(installedPackagePath, 'utf8'))
  for (const required of [
    'sdk/inko-sdk.js',
    'sdk/inko-sdk.d.ts',
    'viewer/index.html',
    'viewer/samples/inko-demo.pdf',
    'viewer/THIRD_PARTY_NOTICES.md',
    'README.md',
  ]) {
    assert(existsSync(join(installedRoot, required)), `installed package is missing ${required}`)
  }

  const projectLicensePresent = existsSync(join(installedRoot, 'LICENSE')) || existsSync(join(installedRoot, 'LICENSE.txt'))
  if (expectPublic) {
    assert.equal(metadata.name, publicPackageName, `public gate failed: package name is not ${publicPackageName}`)
    assert.notEqual(metadata.private, true, 'public gate failed: installed package still has private:true')
    assert.equal(metadata.license, 'Apache-2.0', 'public gate failed: package license is not Apache-2.0')
    assert.equal(projectLicensePresent, true, 'public gate failed: package root LICENSE is missing')
  }

  const roundTrip = await verifyBrowserRoundTrip(installedRoot)
  const result = {
    ok: true,
    tarball,
    tarballSha256: sha256(tarball),
    install: {
      command: 'npm install --no-audit --no-fund <tarball>',
      output: installOutput,
      packageName: metadata.name,
      version: metadata.version,
      private: metadata.private === true,
      license: metadata.license || null,
      projectLicensePresent,
    },
    publicMetadataGateRequested: expectPublic,
    browserRoundTrip: roundTrip,
  }
  console.log(JSON.stringify(result, null, 2))
}

try {
  await main()
} finally {
  if (browser) await browser.close()
  if (server) await new Promise((resolvePromise) => server.close(resolvePromise))
  if (process.env.KEEP_INKO_RELEASE_TEMP === '1') {
    console.error(`Temporary consumer project preserved at: ${consumerRoot}`)
  } else {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}
