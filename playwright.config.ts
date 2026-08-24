import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright 설정 — /pdfv/ 경로의 기능 E2E.
 *
 * 기본 설정은 빠른 개발 피드백을 위해 Vite dev 서버를 사용한다.
 * playwright.production.config.ts는 같은 스펙을 production build/preview에 재사용한다.
 * INKO_E2E_PORT: 전용 테스트 포트 오버라이드 (기본 5199).
 */
const E2E_PORT = process.env.INKO_E2E_PORT ?? '5199'
const E2E_BASE = `http://localhost:${E2E_PORT}/pdfv/`
// Vite가 테스트 중 생성되는 trace/report HTML을 감지해 페이지를 reload하지 않도록
// 이미 감시 제외되는 node_modules cache 아래에 Playwright 산출물을 격리한다.
const CROSS_ORIGIN_HOST_PORT = process.env.INKO_CROSS_ORIGIN_HOST_PORT ?? '5200'
const CROSS_ORIGIN_HOST = `http://127.0.0.1:${CROSS_ORIGIN_HOST_PORT}`
const E2E_ALLOWED_ORIGINS = [process.env.VITE_ALLOWED_ORIGINS, CROSS_ORIGIN_HOST]
  .filter((origin): origin is string => Boolean(origin))
  .join(',')

interface E2eConfigOptions {
  buildOutDir?: string
}

export function createE2eConfig(
  target: 'development' | 'production' = 'development',
  options: E2eConfigOptions = {}
) {
  const isProduction = target === 'production'
  // Vite가 테스트 중 생성되는 trace/report HTML을 감지해 페이지를 reload하지 않도록
  // 이미 감시 제외되는 node_modules cache 아래에 산출물을 격리한다.
  const artifactRoot = process.env.INKO_E2E_ARTIFACT_ROOT
    ?? `node_modules/.cache/inko-playwright-${target}`
  const buildOutDir = options.buildOutDir
    ?? process.env.INKO_E2E_BUILD_OUT_DIR
    ?? 'node_modules/.cache/inko-build-production'
  const serverCommand = isProduction
    ? `node scripts/check-oss-boundary.mjs && npx vite build --outDir ${buildOutDir} && npm run preview -- --outDir ${buildOutDir} --host localhost --port ${E2E_PORT} --strictPort --base /pdfv/`
    : `npm run dev -- --port ${E2E_PORT} --strictPort --base /pdfv/`

  return defineConfig({
    testDir: './tests/e2e',
    testMatch: /.*\.spec\.ts/,
    // standalone localStorage adapter는 소스 개발 데모에서만 존재하며 공개 SDK 계약이 아니다.
    testIgnore: isProduction ? /.*\.dev\.spec\.ts/ : undefined,
    fullyParallel: false, // PDF 로드·렌더링 비용이 커서 직렬 실행
    forbidOnly: !!process.env.CI,
    failOnFlakyTests: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [
      ['list'],
      ['html', { outputFolder: `${artifactRoot}/report`, open: 'never' }]
    ],
    outputDir: `${artifactRoot}/results`,
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
        name: `chromium-${target}`,
        use: { ...devices['Desktop Chrome'] }
      }
    ],
    webServer: {
      // --base /pdfv/: 배포 미러(static/pdfv)와 동일한 경로 구조로 기동
      // → /pdfv/(뷰어)·/pdfv/sdk/example.html·/pdfv/samples/inko-demo.pdf 경로를 검증한다.
      command: serverCommand,
      url: E2E_BASE,
      // cross-origin-bridge.spec.ts의 127.0.0.1 호스트만 테스트 빌드에 명시 허용.
      // 제품 코드에는 localhost/127.0.0.1 암묵 예외가 없다.
      env: {
        INKO_PUBLIC_RELEASE: 'false',
        ...(isProduction ? { VITE_STANDALONE_DEMO: 'true' } : {}),
        VITE_ALLOWED_ORIGINS: E2E_ALLOWED_ORIGINS
      },
      reuseExistingServer: false,
      timeout: isProduction ? 120_000 : 60_000,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  })
}

export default createE2eConfig()
