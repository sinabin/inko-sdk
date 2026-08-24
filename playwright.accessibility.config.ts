import { defineConfig, devices } from '@playwright/test'
import { createE2eConfig } from './playwright.config'

const artifactRoot = process.env.INKO_A11Y_ARTIFACT_ROOT
  ?? 'node_modules/.cache/inko-playwright-accessibility'
const accessibilityBuildOutDir = process.env.INKO_A11Y_BUILD_OUT_DIR
  ?? 'node_modules/.cache/inko-build-accessibility'
const productionConfig = createE2eConfig('production', {
  buildOutDir: accessibilityBuildOutDir
})

/**
 * 핵심 접근성 상태만 production bundle에서 Chromium·Firefox·WebKit으로 교차 검증한다.
 * 전체 PDF 기능 스위트를 세 엔진으로 반복하지 않아 CI 비용을 제한한다.
 */
export default defineConfig({
  ...productionConfig,
  testMatch: /accessibility-core\.spec\.ts/,
  projects: [
    { name: 'chromium-a11y', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-a11y', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-a11y', use: { ...devices['Desktop Safari'] } }
  ],
  reporter: [
    ['list'],
    ['html', { outputFolder: `${artifactRoot}/report`, open: 'never' }]
  ],
  outputDir: `${artifactRoot}/results`
})
