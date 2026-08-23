/**
 * Production preview의 CSP 위반·런타임 에러 일회성 검증
 * 사용: node scripts/check-csp.mjs (vite preview가 4173으로 떠있어야 함)
 */
import { chromium } from 'playwright'

const url = 'http://127.0.0.1:4173/pdfv/'
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
