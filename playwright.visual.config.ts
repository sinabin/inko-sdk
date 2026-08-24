import { defineConfig, devices } from '@playwright/test'

const VISUAL_PORT = process.env.INKO_VISUAL_PORT ?? '5210'
const VISUAL_ORIGIN = `http://127.0.0.1:${VISUAL_PORT}`

export default defineConfig({
  testDir: './tests/visual',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/visual/report', open: 'never' }]
  ],
  outputDir: 'test-results/visual/results',
  use: {
    baseURL: VISUAL_ORIGIN,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: 'linux-chromium-visual-capture',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1
      }
    }
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${VISUAL_PORT} --strictPort`,
    url: VISUAL_ORIGIN,
    env: {
      INKO_PUBLIC_RELEASE: 'true',
      VITE_ALLOWED_ORIGINS: ''
    },
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
