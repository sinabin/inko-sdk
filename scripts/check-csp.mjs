/**
 * Production preview의 CSP 위반·런타임 에러 일회성 검증
 * 사용: node scripts/check-csp.mjs (vite preview가 4173으로 떠있어야 함)
 *       하위 경로 마운트 검사는 INKO_CSP_URL=http://127.0.0.1:4173/pdfv/ 로 지정
 */
import { chromium } from 'playwright'

// 기본값은 `vite preview`가 실제로 서빙하는 루트 경로.
// 호스트가 /pdfv/ 같은 하위 경로에 마운트한 빌드를 검사할 때만 INKO_CSP_URL로 덮어쓴다.
// (과거 기본값이 /pdfv/로 고정돼 있어, 문서화된 preview 명령으로는 페이지 자체가 404였다.)
const url = process.env.INKO_CSP_URL ?? 'http://127.0.0.1:4173/'
const browser = await chromium.launch()
const page = await browser.newPage()

const errors = []
const cspViolations = []

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => {
  errors.push(`pageerror: ${err.message}`)
})
// CSP violations are reported as console errors with specific text — also via SecurityPolicyViolationEvent
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    // @ts-ignore
    window.__cspViolations = window.__cspViolations || []
    // @ts-ignore
    window.__cspViolations.push({
      directive: e.violatedDirective,
      blockedURI: e.blockedURI,
      sourceFile: e.sourceFile,
      lineNumber: e.lineNumber
    })
  })
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000) // PDF 로드·렌더 대기

const violations = await page.evaluate(() => /** @type {any} */ (window).__cspViolations || [])
cspViolations.push(...violations)

await browser.close()

console.log('=== Production preview CSP/런타임 검증 ===')
console.log(`URL: ${url}`)
console.log(`console.error 수집: ${errors.length}`)
errors.forEach(e => console.log('  -', e))
console.log(`CSP 위반 수집: ${cspViolations.length}`)
cspViolations.forEach(v => console.log('  -', JSON.stringify(v)))

const failed = errors.length > 0 || cspViolations.length > 0
process.exit(failed ? 1 : 0)
