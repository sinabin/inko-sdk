import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright 설정 — Vite dev 서버를 자동 기동·종료하며 E2E 실행
 *
 * INKO_E2E_PORT: 전용 테스트 포트 오버라이드 (기본 5199).
 * 항상 /pdfv/ base로 독립 dev 서버를 기동하고 Playwright가 종료까지 관리한다.
 */
const E2E_PORT = process.env.INKO_E2E_PORT ?? '5199'
const E2E_BASE = `http://localhost:${E2E_PORT}/pdfv/`
// Vite가 테스트 중 생성되는 trace/report HTML을 감지해 페이지를 reload하지 않도록
// 이미 감시 제외되는 node_modules cache 아래에 Playwright 산출물을 격리한다.
const E2E_ARTIFACT_ROOT = process.env.INKO_E2E_ARTIFACT_ROOT
  ?? 'node_modules/.cache/inko-playwright'
const CROSS_ORIGIN_HOST_PORT = process.env.INKO_CROSS_ORIGIN_HOST_PORT ?? '5200'
const CROSS_ORIGIN_HOST = `http://127.0.0.1:${CROSS_ORIGIN_HOST_PORT}`
const E2E_ALLOWED_ORIGINS = [process.env.VITE_ALLOWED_ORIGINS, CROSS_ORIGIN_HOST]
  .filter((origin): origin is string => Boolean(origin))
  .join(',')

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // PDF 로드·렌더링 비용이 커서 직렬 실행
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${E2E_ARTIFACT_ROOT}/report`, open: 'never' }]
  ],
  outputDir: `${E2E_ARTIFACT_ROOT}/results`,
  use: {
    baseURL: E2E_BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    // --base /pdfv/: 배포 미러(static/pdfv)와 동일한 경로 구조로 dev 서버 기동
    //   → /pdfv/(뷰어)·/pdfv/sdk/example.html·/pdfv/samples/inko-demo.pdf 경로가 소스 기준으로 동작
    command: `npm run dev -- --port ${E2E_PORT} --strictPort --base /pdfv/`,
    url: E2E_BASE,
    // cross-origin-bridge.spec.ts의 127.0.0.1 호스트만 테스트 빌드에 명시 허용.
    // 제품 코드에는 localhost/127.0.0.1 암묵 예외가 없다.
    env: {
      VITE_ALLOWED_ORIGINS: E2E_ALLOWED_ORIGINS
    },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
