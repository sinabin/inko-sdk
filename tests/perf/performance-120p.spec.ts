import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Frame } from '@playwright/test'

interface PerformanceBudgets {
  profile: string
  fixturePages: number
  firstPageReadyMs: number
  allPreviewsReadyMs: number
  scrollFrameP95Ms: number
  scrollFrameP99Ms: number
  longTaskMaxMs: number
  longTaskCount: number
  blankSampleRatio: number
  farPageReadyMs: number
  mainPdfCanvasCount: number
  maxCanvasDimensionPx: number
  maxLivePreviewBlobUrls: number
  jsHeapGrowthMiB: number
}

const budgets = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/perf/budgets.json'), 'utf8')
) as PerformanceBudgets

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0
}

async function viewerFrame(page: import('@playwright/test').Page): Promise<Frame> {
  const iframe = await page.locator('#viewer iframe').elementHandle()
  expect(iframe, 'SDK iframe must exist').not.toBeNull()
  const frame = await iframe!.contentFrame()
  expect(frame, 'SDK iframe must have a content frame').not.toBeNull()
  return frame!
}

test('deterministic 120p rendering/scroll/memory budget', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const state = {
      longTasks: [] as Array<{ startTime: number; duration: number }>,
      jpegCreated: [] as string[],
      revoked: [] as string[]
    }
    ;(window as any).__inkoPerfMetrics = state

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.longTasks.push({ startTime: entry.startTime, duration: entry.duration })
          }
        })
        observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit)
      } catch {
        // Long Task API가 없는 브라우저는 배열 0건으로 기록한다.
      }
    }

    const createObjectUrl = URL.createObjectURL.bind(URL)
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL)
    ;(URL as any).createObjectURL = (value: Blob | MediaSource) => {
      const url = createObjectUrl(value)
      if (value instanceof Blob && value.type === 'image/jpeg') state.jpegCreated.push(url)
      return url
    }
    ;(URL as any).revokeObjectURL = (url: string) => {
      state.revoked.push(url)
      revokeObjectUrl(url)
    }
  })

  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.goto('/perf/host.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as any).__inkoPerf?.pdfLoadedAt != null, null, {
    timeout: budgets.firstPageReadyMs
  })

  const hostTiming = await page.evaluate(() => {
    const value = (window as any).__inkoPerf
    return {
      firstPageReadyMs: value.pdfLoadedAt - value.loadStartedAt,
      loadStartedEpochMs: value.loadStartedEpochMs as number,
      hostErrors: [...value.errors] as string[]
    }
  })
  const frame = await viewerFrame(page)

  await frame.waitForFunction(
    (expectedPages) => document.querySelectorAll('.scroll-page-container').length === expectedPages,
    budgets.fixturePages
  )
  await frame.waitForFunction(
    (expectedPages) => (window as any).__inkoPerfMetrics.jpegCreated.length >= expectedPages,
    budgets.fixturePages,
    { timeout: budgets.allPreviewsReadyMs }
  )
  const allPreviewsReadyMs = Date.now() - hostTiming.loadStartedEpochMs

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')

  async function jsHeapUsed(): Promise<number> {
    const { metrics } = await cdp.send('Performance.getMetrics')
    return metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0
  }

  const heapBefore = await jsHeapUsed()
  const scroll = await frame.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('.scroll-viewer')
    if (!scroller) throw new Error('scroll viewer not found')
    const metricState = (window as any).__inkoPerfMetrics
    metricState.longTasks.length = 0

    const frameTimes: number[] = []
    let previous = performance.now()
    let samples = 0
    let blanks = 0
    const duration = 3_500
    const start = previous
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)

    await new Promise<void>((resolveAnimation) => {
      const step = (now: number) => {
        frameTimes.push(now - previous)
        previous = now
        const progress = Math.min(1, (now - start) / duration)
        scroller.scrollTop = maxScroll * progress

        if (frameTimes.length % 4 === 0) {
          const rect = scroller.getBoundingClientRect()
          const elements = document.elementsFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          )
          const page = elements.find((element) => element.classList.contains('scroll-page-container'))
          if (page) {
            samples++
            if (!page.querySelector('.scroll-page-canvas-pdf, .page-preview')) blanks++
          }
        }

        if (progress < 1) requestAnimationFrame(step)
        else resolveAnimation()
      }
      requestAnimationFrame(step)
    })

    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    return {
      frameTimes: frameTimes.slice(2),
      blankSampleRatio: samples > 0 ? blanks / samples : 0,
      blankSamples: blanks,
      samples,
      longTasks: [...metricState.longTasks] as Array<{ startTime: number; duration: number }>
    }
  })

  await frame.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.scroll-viewer')!
    scroller.scrollTop = 0
  })
  await frame.waitForFunction(() => !!document.querySelector('[data-page="1"] .scroll-page-canvas-pdf'))
  await frame.waitForTimeout(250)

  const farPageReadyMs = await frame.evaluate(async (lastPage) => {
    const scroller = document.querySelector<HTMLElement>('.scroll-viewer')!
    const start = performance.now()
    scroller.scrollTop = scroller.scrollHeight
    while (!document.querySelector(`[data-page="${lastPage}"] .scroll-page-canvas-pdf`)) {
      if (performance.now() - start > 10_000) return 10_001
      await new Promise(requestAnimationFrame)
    }
    return performance.now() - start
  }, budgets.fixturePages)
  await frame.waitForTimeout(350)

  for (let cycle = 0; cycle < 2; cycle++) {
    await frame.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.scroll-viewer')!
      scroller.scrollTop = 0
    })
    await frame.waitForTimeout(350)
    await frame.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.scroll-viewer')!
      scroller.scrollTop = scroller.scrollHeight
    })
    await frame.waitForTimeout(350)
  }

  await cdp.send('HeapProfiler.collectGarbage')
  const heapAfter = await jsHeapUsed()
  const domState = await frame.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.scroll-page-canvas-pdf')]
    const metricState = (window as any).__inkoPerfMetrics
    const liveUrls = new Set<string>(metricState.jpegCreated)
    for (const url of metricState.revoked) liveUrls.delete(url)
    return {
      pages: document.querySelectorAll('.scroll-page-container').length,
      mainPdfCanvasCount: canvases.length,
      maxCanvasWidth: Math.max(0, ...canvases.map((canvas) => canvas.width)),
      maxCanvasHeight: Math.max(0, ...canvases.map((canvas) => canvas.height)),
      jpegCreated: metricState.jpegCreated.length as number,
      jpegRevoked: metricState.revoked.length as number,
      livePreviewBlobUrls: liveUrls.size
    }
  })

  const frameP95Ms = percentile(scroll.frameTimes, 0.95)
  const frameP99Ms = percentile(scroll.frameTimes, 0.99)
  const frameMeanMs = scroll.frameTimes.reduce((sum, value) => sum + value, 0) /
    Math.max(1, scroll.frameTimes.length)
  const maxLongTaskMs = Math.max(0, ...scroll.longTasks.map((task) => task.duration))
  const heapGrowthMiB = Math.max(0, heapAfter - heapBefore) / (1024 * 1024)
  const report = {
    profile: budgets.profile,
    hostTiming,
    allPreviewsReadyMs,
    scroll: {
      fps: 1_000 / frameMeanMs,
      frameP95Ms,
      frameP99Ms,
      maxLongTaskMs,
      longTaskCount: scroll.longTasks.length,
      blankSampleRatio: scroll.blankSampleRatio,
      samples: scroll.samples
    },
    farPageReadyMs,
    memory: { heapBefore, heapAfter, heapGrowthMiB },
    domState,
    browserErrors,
    budgets
  }

  await testInfo.attach('inko-performance-120p.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json'
  })
  console.log(`[Inko performance] ${JSON.stringify(report)}`)

  expect.soft(hostTiming.hostErrors).toEqual([])
  expect.soft(browserErrors).toEqual([])
  expect.soft(hostTiming.firstPageReadyMs).toBeLessThanOrEqual(budgets.firstPageReadyMs)
  expect.soft(allPreviewsReadyMs).toBeLessThanOrEqual(budgets.allPreviewsReadyMs)
  expect.soft(domState.pages).toBe(budgets.fixturePages)
  expect.soft(domState.jpegCreated).toBeGreaterThanOrEqual(budgets.fixturePages)
  expect.soft(domState.livePreviewBlobUrls).toBeLessThanOrEqual(budgets.maxLivePreviewBlobUrls)
  expect.soft(frameP95Ms).toBeLessThanOrEqual(budgets.scrollFrameP95Ms)
  expect.soft(frameP99Ms).toBeLessThanOrEqual(budgets.scrollFrameP99Ms)
  expect.soft(maxLongTaskMs).toBeLessThanOrEqual(budgets.longTaskMaxMs)
  expect.soft(scroll.longTasks.length).toBeLessThanOrEqual(budgets.longTaskCount)
  expect.soft(scroll.blankSampleRatio).toBeLessThanOrEqual(budgets.blankSampleRatio)
  expect.soft(farPageReadyMs).toBeLessThanOrEqual(budgets.farPageReadyMs)
  expect.soft(domState.mainPdfCanvasCount).toBeLessThanOrEqual(budgets.mainPdfCanvasCount)
  expect.soft(domState.maxCanvasWidth).toBeLessThanOrEqual(budgets.maxCanvasDimensionPx)
  expect.soft(domState.maxCanvasHeight).toBeLessThanOrEqual(budgets.maxCanvasDimensionPx)
  expect.soft(heapGrowthMiB).toBeLessThanOrEqual(budgets.jsHeapGrowthMiB)
})
