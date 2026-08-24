import { readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { resolve } from 'node:path'
import { expect, test, type Frame } from '@playwright/test'

interface PerformanceBudgets {
  profile: string
  fixturePages: number
  coldSdkReadyMs: number
  coldViewerReadyMs: number
  coldFirstPageReadyMs: number
  coldAllPreviewsReadyMs: number
  warmFirstPageReadyMs: number
  warmAllPreviewsReadyMs: number
  scrollPasses: number
  scrollDurationMs: number
  minFramesPerPass: number
  minVisualSamplesPerPass: number
  scrollStartTolerancePx: number
  scrollEndTolerancePx: number
  sampledEarlyPageMax: number
  sampledLatePageMin: number
  scrollMedianFpsMin: number
  scrollWorstFpsMin: number
  scrollMedianFrameP95Ms: number
  scrollWorstFrameP95Ms: number
  scrollMedianFrameP99Ms: number
  scrollWorstFrameP99Ms: number
  longTaskMaxMs: number
  longTaskCountPerPass: number
  blankSampleRatio: number
  farPageReadyMs: number
  mainPdfCanvasCount: number
  maxCanvasDimensionPx: number
  maxLivePreviewBlobUrls: number
  maxLivePreviewBlobBytesMiB: number
  maxDomCanvasPixelBytesMiB: number
  jsHeapColdGrowthMiB: number
  jsHeapWarmGrowthMiB: number
  jsHeapSessionGrowthMiB: number
}

interface PreviewMetrics {
  generation: string
  created: number
  revoked: number
  liveCount: number
  createdBytes: number
  revokedBytes: number
  liveBytes: number
  liveCurrentGenerationCount: number
  liveCurrentGenerationBytes: number
}

interface PerformanceFixtureManifest {
  version: string
  pages: number
  bytes: number
  sha256: string
  pageSizeSignatures: string[]
  rotations: number[]
  syntheticImageVariants: number
  workload: string
}

interface HostPhaseMetrics {
  loadStartedAt: number
  firstPageReadyAt: number
  previewsReadyAt: number
  previewMetrics: PreviewMetrics
}

interface HostMetrics {
  hostStartedAt: number
  sdkReadyAt: number
  viewerReadyAt: number
  phase: string
  errors: string[]
  cold: HostPhaseMetrics
  warm: HostPhaseMetrics
}

const budgets = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/perf/budgets.json'), 'utf8')
) as PerformanceBudgets
const fixtureManifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/perf/fixture-manifest.json'), 'utf8')
) as PerformanceFixtureManifest

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? Number.NaN
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function bytesToMiB(bytes: number): number {
  return bytes / (1024 * 1024)
}

async function viewerFrame(page: import('@playwright/test').Page): Promise<Frame> {
  const iframe = await page.locator('#viewer iframe').elementHandle()
  expect(iframe, 'SDK iframe must exist').not.toBeNull()
  const frame = await iframe!.contentFrame()
  expect(frame, 'SDK iframe must have a content frame').not.toBeNull()
  return frame!
}

async function waitForPaintedPdfCanvas(
  frame: Frame,
  pageNumber: number,
  timeout = 10_000
): Promise<void> {
  await frame.waitForFunction(
    (targetPage) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        `[data-page="${targetPage}"] .scroll-page-canvas-pdf`
      )
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return false
      const points = [
        [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
        [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
        [0.1, 0.9], [0.5, 0.9], [0.9, 0.9]
      ]
      return points.some(([xRatio, yRatio]) => {
        const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(canvas.width * xRatio!)))
        const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(canvas.height * yRatio!)))
        return context.getImageData(x, y, 1, 1).data[3]! > 0
      })
    },
    pageNumber,
    { timeout }
  )
}

test('mixed deterministic 120p cold/warm rendering, scroll and memory budgets', async ({
  page,
  browser
}, testInfo) => {
  expect(fixtureManifest.pages, 'fixture manifest and performance budget page count must match')
    .toBe(budgets.fixturePages)

  await page.addInitScript(() => {
    const liveJpegs = new Map<string, { size: number; generation: string }>()
    const state = {
      previewInstrumentationSupported: false,
      longTaskSupported: false,
      longTaskError: null as string | null,
      generation: 'cold',
      created: 0,
      revoked: 0,
      createdBytes: 0,
      revokedBytes: 0,
      liveBytes: 0,
      longTaskEpoch: 0,
      longTasks: [] as Array<{ startTime: number; duration: number }>,
      previewSnapshot() {
        const currentGenerationEntries = [...liveJpegs.values()].filter((entry) => (
          entry.generation === state.generation
        ))
        return {
          generation: state.generation,
          created: state.created,
          revoked: state.revoked,
          liveCount: liveJpegs.size,
          createdBytes: state.createdBytes,
          revokedBytes: state.revokedBytes,
          liveBytes: state.liveBytes,
          liveCurrentGenerationCount: currentGenerationEntries.length,
          liveCurrentGenerationBytes: currentGenerationEntries.reduce(
            (sum, entry) => sum + entry.size,
            0
          )
        }
      },
      resetPreviewMetrics(generation: string) {
        state.generation = generation
        state.created = 0
        state.revoked = 0
        state.createdBytes = 0
        state.revokedBytes = 0
      },
      resetLongTasks() {
        state.longTasks.length = 0
        state.longTaskEpoch = performance.now()
      },
      longTaskSnapshot() {
        return [...state.longTasks]
      }
    }
    ;(window as any).__inkoPerfMetrics = state

    try {
      const supported = typeof PerformanceObserver !== 'undefined' &&
        PerformanceObserver.supportedEntryTypes?.includes('longtask')
      if (!supported) throw new Error('Long Task API is unavailable')
      state.longTaskEpoch = performance.now()
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= state.longTaskEpoch) {
            state.longTasks.push({ startTime: entry.startTime, duration: entry.duration })
          }
        }
      })
      observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit)
      state.longTaskSupported = true
    } catch (error) {
      state.longTaskError = error instanceof Error ? error.message : String(error)
    }

    try {
      const createObjectUrl = URL.createObjectURL.bind(URL)
      const revokeObjectUrl = URL.revokeObjectURL.bind(URL)
      ;(URL as any).createObjectURL = (value: Blob | MediaSource) => {
        const url = createObjectUrl(value)
        if (value instanceof Blob && value.type === 'image/jpeg') {
          const size = value.size
          state.created++
          state.createdBytes += size
          liveJpegs.set(url, { size, generation: state.generation })
          state.liveBytes += size
        }
        return url
      }
      ;(URL as any).revokeObjectURL = (url: string) => {
        const entry = liveJpegs.get(url)
        if (entry !== undefined) {
          state.revoked++
          state.revokedBytes += entry.size
          state.liveBytes -= entry.size
          liveJpegs.delete(url)
        }
        revokeObjectUrl(url)
      }
      state.previewInstrumentationSupported = true
    } catch {
      state.previewInstrumentationSupported = false
    }
  })

  const browserErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')

  async function jsHeapUsed(): Promise<number> {
    const { metrics } = await cdp.send('Performance.getMetrics')
    const value = metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value
    if (!Number.isFinite(value)) throw new Error('CDP JSHeapUsedSize metric is unavailable')
    return value!
  }

  await cdp.send('HeapProfiler.collectGarbage')
  const heapBeforeNavigation = await jsHeapUsed()

  await page.goto('/perf/host.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => ['cold-complete', 'failed'].includes((window as any).__inkoPerf?.phase),
    null,
    { timeout: budgets.coldAllPreviewsReadyMs + 10_000 }
  )
  const coldGate = await page.evaluate(() => ({
    phase: (window as any).__inkoPerf.phase as string,
    errors: [...(window as any).__inkoPerf.errors] as string[]
  }))
  if (coldGate.phase !== 'cold-complete') {
    throw new Error(`cold performance host failed: ${coldGate.errors.join('; ') || coldGate.phase}`)
  }

  await cdp.send('HeapProfiler.collectGarbage')
  const heapAfterCold = await jsHeapUsed()
  await page.evaluate(() => (window as any).__inkoPerf.continueWarm())
  await page.waitForFunction(
    () => ['complete', 'failed'].includes((window as any).__inkoPerf?.phase),
    null,
    { timeout: budgets.warmAllPreviewsReadyMs + 10_000 }
  )

  const host = await page.evaluate(() => {
    const value = (window as any).__inkoPerf
    return {
      hostStartedAt: value.hostStartedAt,
      sdkReadyAt: value.sdkReadyAt,
      viewerReadyAt: value.viewerReadyAt,
      phase: value.phase,
      errors: [...value.errors],
      cold: { ...value.cold, previewMetrics: { ...value.cold.previewMetrics } },
      warm: { ...value.warm, previewMetrics: { ...value.warm.previewMetrics } }
    } as HostMetrics
  })
  if (host.phase !== 'complete') {
    throw new Error(`performance host failed: ${host.errors.join('; ') || host.phase}`)
  }

  const loadTiming = {
    coldSdkReadyMs: host.sdkReadyAt - host.hostStartedAt,
    coldViewerReadyMs: host.viewerReadyAt - host.hostStartedAt,
    coldFirstPageReadyMs: host.cold.firstPageReadyAt - host.hostStartedAt,
    coldAllPreviewsReadyMs: host.cold.previewsReadyAt - host.hostStartedAt,
    coldDocumentFirstPageReadyMs: host.cold.firstPageReadyAt - host.cold.loadStartedAt,
    coldDocumentAllPreviewsReadyMs: host.cold.previewsReadyAt - host.cold.loadStartedAt,
    warmFirstPageReadyMs: host.warm.firstPageReadyAt - host.warm.loadStartedAt,
    warmAllPreviewsReadyMs: host.warm.previewsReadyAt - host.warm.loadStartedAt
  }

  const frame = await viewerFrame(page)
  const support = await frame.evaluate(() => {
    const metrics = (window as any).__inkoPerfMetrics
    return {
      previewInstrumentationSupported: metrics?.previewInstrumentationSupported === true,
      longTaskSupported: metrics?.longTaskSupported === true,
      longTaskError: metrics?.longTaskError ?? null
    }
  })
  expect(support.previewInstrumentationSupported, 'preview Blob instrumentation is required').toBe(true)
  expect(support.longTaskSupported, support.longTaskError ?? 'Long Task API is required').toBe(true)

  await frame.waitForFunction(
    (expectedPages) => document.querySelectorAll('.scroll-page-container').length === expectedPages,
    budgets.fixturePages
  )
  await waitForPaintedPdfCanvas(frame, 1)

  const previewPaintState = await frame.evaluate((expectedPages) => {
    const previews = Array.from(document.querySelectorAll<HTMLImageElement>('.page-preview'))
    const paintedPreviews = previews.filter((image) => (
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
    ))
    const mainCanvases = Array.from(
      document.querySelectorAll<HTMLCanvasElement>('.scroll-page-canvas-pdf')
    )
    return {
      pageContainers: document.querySelectorAll('.scroll-page-container').length,
      previewImages: previews.length,
      paintedPreviewImages: paintedPreviews.length,
      unpaintedPreviewImages: previews.length - paintedPreviews.length,
      mainPdfCanvasCount: mainCanvases.length,
      visuallyBackedPages: paintedPreviews.length + mainCanvases.length,
      expectedPages
    }
  }, budgets.fixturePages)

  await cdp.send('HeapProfiler.collectGarbage')
  const heapAfterWarm = await jsHeapUsed()

  const farPageReadyMs = await frame.evaluate(async (lastPage) => {
    const scroller = document.querySelector<HTMLElement>('.scroll-viewer')
    if (!scroller) throw new Error('scroll viewer not found')
    scroller.scrollTop = 0
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const start = performance.now()
    scroller.scrollTop = scroller.scrollHeight

    function isPainted(canvas: HTMLCanvasElement | null): boolean {
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return false
      const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width * 0.5)))
      const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height * 0.5)))
      return context.getImageData(x, y, 1, 1).data[3]! > 0
    }

    while (!isPainted(document.querySelector<HTMLCanvasElement>(
      `[data-page="${lastPage}"] .scroll-page-canvas-pdf`
    ))) {
      if (performance.now() - start > 10_000) return 10_001
      await new Promise(requestAnimationFrame)
    }
    return performance.now() - start
  }, budgets.fixturePages)

  const scrollPasses: Array<{
    pass: number
    frameCount: number
    visualSamples: number
    blankSamples: number
    blankSampleRatio: number
    fps: number
    frameP95Ms: number
    frameP99Ms: number
    maxLongTaskMs: number
    longTaskCount: number
    peakDomCanvasPixelBytes: number
    maxCanvasWidth: number
    maxCanvasHeight: number
    startScrollTop: number
    maxScrollTop: number
    endScrollTop: number
    sampledPageMin: number
    sampledPageMax: number
    sampledPageCount: number
  }> = []

  for (let pass = 1; pass <= budgets.scrollPasses; pass++) {
    await frame.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.scroll-viewer')
      if (!scroller) throw new Error('scroll viewer not found')
      scroller.scrollTop = 0
    })
    await waitForPaintedPdfCanvas(frame, 1)
    await frame.waitForTimeout(200)

    const raw = await frame.evaluate(async (duration) => {
      const scroller = document.querySelector<HTMLElement>('.scroll-viewer')
      if (!scroller) throw new Error('scroll viewer not found')
      const metricState = (window as any).__inkoPerfMetrics
      metricState.resetLongTasks()

      const frameTimes: number[] = []
      let previous = performance.now()
      let visualSamples = 0
      let blankSamples = 0
      let peakDomCanvasPixelBytes = 0
      let maxCanvasWidth = 0
      let maxCanvasHeight = 0
      const sampledPages = new Set<number>()
      const start = previous
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const startScrollTop = scroller.scrollTop

      function captureCanvasState(): void {
        const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas'))
        peakDomCanvasPixelBytes = Math.max(
          peakDomCanvasPixelBytes,
          canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0)
        )
        maxCanvasWidth = Math.max(maxCanvasWidth, 0, ...canvases.map((canvas) => canvas.width))
        maxCanvasHeight = Math.max(maxCanvasHeight, 0, ...canvases.map((canvas) => canvas.height))
      }

      function canvasPaintedAtPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): boolean {
        if (canvas.width <= 0 || canvas.height <= 0) return false
        const rect = canvas.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return false
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return false
        const x = Math.max(0, Math.min(
          canvas.width - 1,
          Math.floor(((clientX - rect.left) / rect.width) * canvas.width)
        ))
        const y = Math.max(0, Math.min(
          canvas.height - 1,
          Math.floor(((clientY - rect.top) / rect.height) * canvas.height)
        ))
        return context.getImageData(x, y, 1, 1).data[3]! > 0
      }

      await new Promise<void>((resolveAnimation) => {
        const step = (now: number) => {
          frameTimes.push(now - previous)
          previous = now
          const progress = Math.min(1, (now - start) / duration)
          scroller.scrollTop = maxScroll * progress

          captureCanvasState()
          if (frameTimes.length % 4 === 0) {
            const rect = scroller.getBoundingClientRect()
            const clientX = rect.left + rect.width / 2
            const clientY = rect.top + rect.height / 2
            const elements = document.elementsFromPoint(clientX, clientY)
            const pageAtPoint = elements.find((element) => (
              element.classList.contains('scroll-page-container')
            )) as HTMLElement | undefined
            // 페이지 사이의 margin을 blank로 오인하지 않는다. 실제 페이지 표면을
            // 샘플한 frame만 분모에 넣고, 그 페이지의 backing visual을 검사한다.
            if (pageAtPoint) {
              const sampledPage = Number(pageAtPoint.dataset.page)
              if (Number.isInteger(sampledPage)) sampledPages.add(sampledPage)
              const canvas = pageAtPoint.querySelector<HTMLCanvasElement>(
                '.scroll-page-canvas-pdf'
              )
              const preview = pageAtPoint.querySelector<HTMLImageElement>('.page-preview')

              visualSamples++
              const canvasPainted = canvas
                ? canvasPaintedAtPoint(canvas, clientX, clientY)
                : false
              const previewPainted = !!preview && preview.complete &&
                preview.naturalWidth > 0 && preview.naturalHeight > 0
              if (!canvasPainted && !previewPainted) blankSamples++
            }
          }

          if (progress < 1) requestAnimationFrame(step)
          else resolveAnimation()
        }
        requestAnimationFrame(step)
      })

      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      captureCanvasState()
      return {
        frameTimes: frameTimes.slice(2),
        visualSamples,
        blankSamples,
        peakDomCanvasPixelBytes,
        maxCanvasWidth,
        maxCanvasHeight,
        startScrollTop,
        maxScrollTop: maxScroll,
        endScrollTop: scroller.scrollTop,
        sampledPages: [...sampledPages],
        longTasks: metricState.longTaskSnapshot() as Array<{ startTime: number; duration: number }>
      }
    }, budgets.scrollDurationMs)

    const frameMeanMs = raw.frameTimes.reduce((sum, value) => sum + value, 0) / raw.frameTimes.length
    scrollPasses.push({
      pass,
      frameCount: raw.frameTimes.length,
      visualSamples: raw.visualSamples,
      blankSamples: raw.blankSamples,
      blankSampleRatio: raw.visualSamples > 0 ? raw.blankSamples / raw.visualSamples : Number.NaN,
      fps: 1_000 / frameMeanMs,
      frameP95Ms: percentile(raw.frameTimes, 0.95),
      frameP99Ms: percentile(raw.frameTimes, 0.99),
      maxLongTaskMs: Math.max(0, ...raw.longTasks.map((task) => task.duration)),
      longTaskCount: raw.longTasks.length,
      peakDomCanvasPixelBytes: raw.peakDomCanvasPixelBytes,
      maxCanvasWidth: raw.maxCanvasWidth,
      maxCanvasHeight: raw.maxCanvasHeight,
      startScrollTop: raw.startScrollTop,
      maxScrollTop: raw.maxScrollTop,
      endScrollTop: raw.endScrollTop,
      sampledPageMin: Math.min(...raw.sampledPages),
      sampledPageMax: Math.max(...raw.sampledPages),
      sampledPageCount: raw.sampledPages.length
    })
  }

  await cdp.send('HeapProfiler.collectGarbage')
  const heapAfterScroll = await jsHeapUsed()
  const domState = await frame.evaluate(() => {
    const mainCanvases = Array.from(
      document.querySelectorAll<HTMLCanvasElement>('.scroll-page-canvas-pdf')
    )
    const allCanvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas'))
    const metricState = (window as any).__inkoPerfMetrics
    return {
      pages: document.querySelectorAll('.scroll-page-container').length,
      mainPdfCanvasCount: mainCanvases.length,
      mainPdfCanvasPages: mainCanvases.map((canvas) => Number(
        canvas.closest<HTMLElement>('.scroll-page-container')?.dataset.page ?? Number.NaN
      )),
      maxCanvasWidth: Math.max(0, ...allCanvases.map((canvas) => canvas.width)),
      maxCanvasHeight: Math.max(0, ...allCanvases.map((canvas) => canvas.height)),
      domCanvasPixelBytes: allCanvases.reduce(
        (sum, canvas) => sum + canvas.width * canvas.height * 4,
        0
      ),
      preview: metricState.previewSnapshot() as PreviewMetrics
    }
  })
  const summary = {
    fpsMedian: median(scrollPasses.map((pass) => pass.fps)),
    fpsWorst: Math.min(...scrollPasses.map((pass) => pass.fps)),
    frameP95MedianMs: median(scrollPasses.map((pass) => pass.frameP95Ms)),
    frameP95WorstMs: Math.max(...scrollPasses.map((pass) => pass.frameP95Ms)),
    frameP99MedianMs: median(scrollPasses.map((pass) => pass.frameP99Ms)),
    frameP99WorstMs: Math.max(...scrollPasses.map((pass) => pass.frameP99Ms)),
    longTaskMaxMs: Math.max(...scrollPasses.map((pass) => pass.maxLongTaskMs)),
    longTaskCountWorst: Math.max(...scrollPasses.map((pass) => pass.longTaskCount)),
    blankSampleRatioWorst: Math.max(...scrollPasses.map((pass) => pass.blankSampleRatio)),
    frameCountMin: Math.min(...scrollPasses.map((pass) => pass.frameCount)),
    visualSamplesMin: Math.min(...scrollPasses.map((pass) => pass.visualSamples)),
    peakDomCanvasPixelBytes: Math.max(...scrollPasses.map((pass) => pass.peakDomCanvasPixelBytes)),
    maxCanvasWidth: Math.max(...scrollPasses.map((pass) => pass.maxCanvasWidth)),
    maxCanvasHeight: Math.max(...scrollPasses.map((pass) => pass.maxCanvasHeight))
  }
  const maxObservedDomCanvasPixelBytes = Math.max(
    summary.peakDomCanvasPixelBytes,
    domState.domCanvasPixelBytes
  )
  const maxObservedCanvasWidth = Math.max(summary.maxCanvasWidth, domState.maxCanvasWidth)
  const maxObservedCanvasHeight = Math.max(summary.maxCanvasHeight, domState.maxCanvasHeight)

  const playwrightPackage = JSON.parse(
    readFileSync(resolve(process.cwd(), 'node_modules/@playwright/test/package.json'), 'utf8')
  ) as { version: string }
  const browserEnvironment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    navigatorPlatform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio
  }))
  const hostResourceTimings = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/pdfv/'))
    .map((entry) => ({
      name: new URL(entry.name).pathname,
      initiatorType: (entry as PerformanceResourceTiming).initiatorType,
      startTimeMs: entry.startTime,
      durationMs: entry.duration >= 0 ? entry.duration : null
    })))
  const viewerResourceTimings = await frame.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/pdfv/'))
    .map((entry) => ({
      name: new URL(entry.name).pathname,
      initiatorType: (entry as PerformanceResourceTiming).initiatorType,
      startTimeMs: entry.startTime,
      durationMs: entry.duration >= 0 ? entry.duration : null
    })))
  const resourceEvidence = {
    sdkBundle: hostResourceTimings.some((entry) => entry.name === '/pdfv/sdk/pdfv-sdk.js'),
    iframeDocument: hostResourceTimings.some((entry) => entry.name === '/pdfv/index.html'),
    viewerEntryBundle: viewerResourceTimings.some((entry) => (
      /\/pdfv\/assets\/index-[^/]+\.js$/.test(entry.name)
    )),
    pdfJsBundle: viewerResourceTimings.some((entry) => (
      /\/pdfv\/assets\/pdfjs-[^/]+\.js$/.test(entry.name)
    )),
    workerRequestCount: viewerResourceTimings.filter((entry) => (
      entry.name === '/pdfv/pdf.worker.mjs'
    )).length,
    fixtureRequestCount: viewerResourceTimings.filter((entry) => (
      entry.name === '/pdfv/perf/inko-perf-v2-120p.pdf'
    )).length
  }

  const report = {
    profile: budgets.profile,
    fixture: fixtureManifest,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: cpus().length,
      runnerOS: process.env.RUNNER_OS ?? null,
      runnerArch: process.env.RUNNER_ARCH ?? null,
      imageOS: process.env.ImageOS ?? null,
      imageVersion: process.env.ImageVersion ?? null,
      githubSha: process.env.GITHUB_SHA ?? null,
      playwright: playwrightPackage.version,
      browser: browser.version(),
      project: testInfo.project.name,
      ...browserEnvironment
    },
    loadTiming,
    coldPreview: host.cold.previewMetrics,
    warmPreview: host.warm.previewMetrics,
    previewPaintState,
    farPageReadyMs,
    scrollPasses,
    summary,
    memory: {
      heapBeforeNavigation,
      heapAfterCold,
      heapAfterWarm,
      heapAfterScroll,
      coldGrowthMiB: bytesToMiB(Math.max(0, heapAfterCold - heapBeforeNavigation)),
      warmSteadyGrowthMiB: bytesToMiB(Math.max(0, heapAfterWarm - heapBeforeNavigation)),
      sessionGrowthMiB: bytesToMiB(Math.max(0, heapAfterScroll - heapBeforeNavigation)),
      livePreviewBlobBytesMiB: bytesToMiB(domState.preview.liveBytes),
      domCanvasPixelBytesMiB: bytesToMiB(domState.domCanvasPixelBytes),
      peakDomCanvasPixelBytesMiB: bytesToMiB(maxObservedDomCanvasPixelBytes)
    },
    domState,
    support,
    resourceTimings: {
      host: hostResourceTimings,
      viewer: viewerResourceTimings
    },
    resourceEvidence,
    browserErrors,
    consoleErrors,
    hostErrors: host.errors,
    budgets
  }

  await testInfo.attach('inko-performance-120p.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json'
  })
  console.log(`[Inko performance] ${JSON.stringify(report)}`)

  expect.soft(host.errors).toEqual([])
  expect.soft(browserErrors).toEqual([])
  expect.soft(consoleErrors).toEqual([])
  expect.soft(resourceEvidence.sdkBundle, 'cold SDK bundle request evidence').toBe(true)
  expect.soft(resourceEvidence.iframeDocument, 'cold iframe document request evidence').toBe(true)
  expect.soft(resourceEvidence.viewerEntryBundle, 'cold viewer entry bundle request evidence').toBe(true)
  expect.soft(resourceEvidence.pdfJsBundle, 'cold pdf.js bundle request evidence').toBe(true)
  expect.soft(resourceEvidence.workerRequestCount, 'cold pdf.js worker request evidence')
    .toBeGreaterThanOrEqual(1)
  expect.soft(resourceEvidence.fixtureRequestCount, 'cold and warm fixture request evidence')
    .toBeGreaterThanOrEqual(2)
  expect.soft(loadTiming.coldSdkReadyMs).toBeLessThanOrEqual(budgets.coldSdkReadyMs)
  expect.soft(loadTiming.coldViewerReadyMs).toBeLessThanOrEqual(budgets.coldViewerReadyMs)
  expect.soft(loadTiming.coldFirstPageReadyMs).toBeLessThanOrEqual(budgets.coldFirstPageReadyMs)
  expect.soft(loadTiming.coldAllPreviewsReadyMs).toBeLessThanOrEqual(budgets.coldAllPreviewsReadyMs)
  expect.soft(loadTiming.warmFirstPageReadyMs).toBeLessThanOrEqual(budgets.warmFirstPageReadyMs)
  expect.soft(loadTiming.warmAllPreviewsReadyMs).toBeLessThanOrEqual(budgets.warmAllPreviewsReadyMs)

  for (const [label, preview] of [
    ['cold', host.cold.previewMetrics],
    ['warm', host.warm.previewMetrics]
  ] as const) {
    const expectedRevocations = label === 'cold' ? 0 : budgets.fixturePages
    expect.soft(preview.generation, `${label} preview generation label`).toBe(label)
    expect.soft(preview.created, `${label} preview created count`).toBe(budgets.fixturePages)
    expect.soft(preview.liveCount, `${label} preview live count`).toBe(budgets.fixturePages)
    expect.soft(preview.liveCurrentGenerationCount, `${label} current-generation live count`)
      .toBe(budgets.fixturePages)
    expect.soft(preview.revoked, `${label} preview revocations`).toBe(expectedRevocations)
    expect.soft(preview.liveBytes, `${label} preview bytes`).toBeGreaterThan(0)
    expect.soft(preview.liveCurrentGenerationBytes, `${label} current-generation bytes`)
      .toBe(preview.liveBytes)
    expect.soft(bytesToMiB(preview.liveBytes), `${label} preview byte budget`)
      .toBeLessThanOrEqual(budgets.maxLivePreviewBlobBytesMiB)
  }

  expect.soft(previewPaintState.pageContainers).toBe(budgets.fixturePages)
  expect.soft(previewPaintState.unpaintedPreviewImages).toBe(0)
  expect.soft(previewPaintState.visuallyBackedPages).toBeGreaterThanOrEqual(budgets.fixturePages)
  expect.soft(summary.frameCountMin).toBeGreaterThanOrEqual(budgets.minFramesPerPass)
  expect.soft(summary.visualSamplesMin).toBeGreaterThanOrEqual(budgets.minVisualSamplesPerPass)
  for (const pass of scrollPasses) {
    expect.soft(pass.maxScrollTop, `pass ${pass.pass} must have a scrollable document`)
      .toBeGreaterThan(0)
    expect.soft(pass.startScrollTop, `pass ${pass.pass} must start at the top`)
      .toBeLessThanOrEqual(budgets.scrollStartTolerancePx)
    expect.soft(
      Math.abs(pass.maxScrollTop - pass.endScrollTop),
      `pass ${pass.pass} must reach the bottom`
    ).toBeLessThanOrEqual(budgets.scrollEndTolerancePx)
    expect.soft(pass.sampledPageMin, `pass ${pass.pass} must sample an early page`)
      .toBeLessThanOrEqual(budgets.sampledEarlyPageMax)
    expect.soft(pass.sampledPageMax, `pass ${pass.pass} must sample a late page`)
      .toBeGreaterThanOrEqual(budgets.sampledLatePageMin)
  }
  expect.soft(summary.fpsMedian).toBeGreaterThanOrEqual(budgets.scrollMedianFpsMin)
  expect.soft(summary.fpsWorst).toBeGreaterThanOrEqual(budgets.scrollWorstFpsMin)
  expect.soft(summary.frameP95MedianMs).toBeLessThanOrEqual(budgets.scrollMedianFrameP95Ms)
  expect.soft(summary.frameP95WorstMs).toBeLessThanOrEqual(budgets.scrollWorstFrameP95Ms)
  expect.soft(summary.frameP99MedianMs).toBeLessThanOrEqual(budgets.scrollMedianFrameP99Ms)
  expect.soft(summary.frameP99WorstMs).toBeLessThanOrEqual(budgets.scrollWorstFrameP99Ms)
  expect.soft(summary.longTaskMaxMs).toBeLessThanOrEqual(budgets.longTaskMaxMs)
  expect.soft(summary.longTaskCountWorst).toBeLessThanOrEqual(budgets.longTaskCountPerPass)
  expect.soft(summary.blankSampleRatioWorst).toBeLessThanOrEqual(budgets.blankSampleRatio)
  expect.soft(farPageReadyMs).toBeLessThanOrEqual(budgets.farPageReadyMs)

  expect.soft(domState.pages).toBe(budgets.fixturePages)
  expect.soft(domState.mainPdfCanvasCount).toBeLessThanOrEqual(budgets.mainPdfCanvasCount)
  expect.soft(maxObservedCanvasWidth).toBeLessThanOrEqual(budgets.maxCanvasDimensionPx)
  expect.soft(maxObservedCanvasHeight).toBeLessThanOrEqual(budgets.maxCanvasDimensionPx)
  expect.soft(domState.preview.generation).toBe('warm')
  expect.soft(domState.preview.created).toBe(budgets.fixturePages)
  expect.soft(domState.preview.revoked).toBe(budgets.fixturePages)
  expect.soft(domState.preview.liveCount).toBe(budgets.fixturePages)
  expect.soft(domState.preview.liveCurrentGenerationCount).toBe(budgets.fixturePages)
  expect.soft(domState.preview.liveCount).toBeLessThanOrEqual(budgets.maxLivePreviewBlobUrls)
  expect.soft(bytesToMiB(domState.preview.liveBytes))
    .toBeLessThanOrEqual(budgets.maxLivePreviewBlobBytesMiB)
  expect.soft(bytesToMiB(maxObservedDomCanvasPixelBytes))
    .toBeLessThanOrEqual(budgets.maxDomCanvasPixelBytesMiB)
  expect.soft(bytesToMiB(Math.max(0, heapAfterCold - heapBeforeNavigation)))
    .toBeLessThanOrEqual(budgets.jsHeapColdGrowthMiB)
  expect.soft(bytesToMiB(Math.max(0, heapAfterWarm - heapBeforeNavigation)))
    .toBeLessThanOrEqual(budgets.jsHeapWarmGrowthMiB)
  expect.soft(bytesToMiB(Math.max(0, heapAfterScroll - heapBeforeNavigation)))
    .toBeLessThanOrEqual(budgets.jsHeapSessionGrowthMiB)
})
