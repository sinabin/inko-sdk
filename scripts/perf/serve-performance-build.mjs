import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { generatePerformanceFixture, verifyFixture } from './generate-fixture.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDir, '../..')
// 다른 검증 작업이 공유 dist를 지우거나 다시 빌드해도 성능 계측 중인 정적 파일은 변하지 않는다.
const distRoot = resolve(repositoryRoot, 'node_modules/.cache/inko-performance-build')
const hostPath = resolve(repositoryRoot, 'tests/perf/host.html')
const fixtureManifestPath = resolve(repositoryRoot, 'tests/perf/fixture-manifest.json')
const portArgument = process.argv.indexOf('--port')
const port = Number(portArgument >= 0 ? process.argv[portArgument + 1] : 5201)

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new TypeError(`Invalid --port: ${port}`)
}

if (process.argv.includes('--build')) {
  const viteCli = resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
  const build = spawnSync(process.execPath, [
    viteCli,
    'build',
    '--outDir',
    distRoot,
    '--emptyOutDir'
  ], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: false
  })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const fixture = await generatePerformanceFixture()
const fixtureVerification = await verifyFixture(fixture, fixtureManifestPath)
if (!fixtureVerification.ok) {
  throw new Error(
    `Performance fixture does not match its manifest: ${JSON.stringify(fixtureVerification)}`
  )
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2']
])

function sendBytes(request, response, bytes, contentType) {
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', contentType)

  if (range) {
    const start = Number(range[1])
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
    if (!Number.isInteger(start) || start < 0 || start > end || start >= bytes.length) {
      response.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` })
      response.end()
      return
    }
    response.writeHead(206, {
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${bytes.length}`
    })
    response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1))
    return
  }

  response.writeHead(200, { 'Content-Length': bytes.length })
  response.end(request.method === 'HEAD' ? undefined : bytes)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

    if (url.pathname === '/health') {
      sendBytes(request, response, Buffer.from('ok'), 'text/plain; charset=utf-8')
      return
    }
    if (url.pathname === '/perf/host.html') {
      sendBytes(request, response, await readFile(hostPath), mimeTypes.get('.html'))
      return
    }
    if (url.pathname === '/pdfv/perf/inko-perf-v2-120p.pdf') {
      sendBytes(request, response, fixture, mimeTypes.get('.pdf'))
      return
    }

    if (url.pathname.startsWith('/pdfv/')) {
      const relativePath = decodeURIComponent(url.pathname.slice('/pdfv/'.length)) || 'index.html'
      const filePath = resolve(distRoot, relativePath)
      if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
        response.writeHead(403).end()
        return
      }
      const bytes = await readFile(filePath)
      sendBytes(request, response, bytes, mimeTypes.get(extname(filePath)) ?? 'application/octet-stream')
      return
    }

    response.writeHead(404).end()
  } catch (error) {
    const status = error && typeof error === 'object' && error.code === 'ENOENT' ? 404 : 500
    response.writeHead(status).end(status === 404 ? 'Not found' : 'Server error')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Inko performance harness: http://127.0.0.1:${port}/perf/host.html`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
