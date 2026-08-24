import { defineConfig, devices } from '@playwright/test'

const PERF_PORT = process.env.INKO_PERF_PORT ?? '5201'
const PERF_URL = `http://127.0.0.1:${PERF_PORT}/perf/host.html`

export default defineConfig({
  testDir: './tests/perf',
  testMatch: /performance-120p\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/performance/playwright-report.json' }]
  ],
  outputDir: 'test-results/performance',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: PERF_URL,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--enable-precise-memory-info'
      ]
    }
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1
      }
    }
  ],
  webServer: {
    command: `node scripts/perf/serve-performance-build.mjs --build --port ${PERF_PORT}`,
    url: `http://127.0.0.1:${PERF_PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
