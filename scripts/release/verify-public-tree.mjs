import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootFlag = process.argv.indexOf('--root')
const root = rootFlag >= 0 ? resolve(process.argv[rootFlag + 1]) : resolve(scriptDir, '../..')

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return []
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const paths = walk(root).map((path) => relative(root, path).replaceAll('\\', '/'))
const forbiddenPaths = [
  '.claude/',
  'CLAUDE.md',
  'design.md',
  'dist/',
  'release/',
  'review/',
  'scripts/android-test.ps1',
  'src/lib/bridge/androidBridge.ts',
  'src/lib/bridge/androidBridgeMock.ts',
  'playwright.android.config.ts',
  'tests/e2e-android/',
  'tests/e2e/sales-evidence.spec.ts',
  'tests/unit/androidBridge.test.ts',
  'tests/unit/androidBridgeMock.test.ts',
  'docs/inko-integration-guide-customer-v0.1.md',
  'docs/inko-whitelabel-showcase-design-v0.1.md',
  'docs/oss/legal-release-check.md',
]

for (const blocked of forbiddenPaths) {
  assert.equal(
    paths.some((path) => path === blocked || path.startsWith(blocked)),
    false,
    `private-only path leaked into the public tree: ${blocked}`
  )
}
assert.equal(paths.some((path) => path.endsWith('.tgz')), false, 'package archive leaked into source tree')

if (existsSync(resolve(root, '.git'))) {
  const historyObjects = execFileSync('git', ['rev-list', '--objects', '--all'], {
    cwd: root,
    encoding: 'utf8',
  })
  for (const pattern of [
    /(?:^|\s)\.claude\//m,
    /(?:^|\s)CLAUDE\.md$/m,
    /Pdf_test\//i,
    /public\/test\.pdf/i,
    /inko-integration-guide-customer/i,
    /inko-whitelabel-showcase-design/i,
  ]) {
    assert.doesNotMatch(historyObjects, pattern, `private-only object exists in Git history: ${pattern}`)
  }

  const authorEmails = execFileSync('git', ['log', '--all', '--format=%ae'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.doesNotMatch(
    authorEmails,
    /sinabinvr94@gmail\.com/i,
    'personal author email exists in public Git history'
  )
}

for (const required of [
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.gitleaks.toml',
  'LICENSE',
  'NOTICE',
  'README.md',
  'README.ko.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'TRADEMARKS.md',
  'package.json',
  'package-lock.json',
  'playwright.perf.config.ts',
  'public/THIRD_PARTY_NOTICES.md',
  'public/sdk/pdfv-sdk.js',
  'public/sdk/inko-sdk.d.ts',
  'public/samples/inko-demo.pdf',
  'public/samples/inko-feature-surface.pdf',
  'public/pdfjs-images/manifest.json',
  'public/pdfjs-images/LICENSE.pdfjs-dist',
  'docs/performance.md',
  'scripts/fixtures/generate-pdf-feature-surface.py',
  'scripts/perf/generate-fixture.d.mts',
  'scripts/perf/generate-fixture.mjs',
  'scripts/perf/serve-performance-build.mjs',
  'scripts/release/export-public-source.mjs',
  'scripts/release/generate-artifact-sbom.mjs',
  'scripts/release/verify-public-tree.mjs',
  'scripts/release/verify-release-package.mjs',
  'tests/release/verify-installed-tarball.mjs',
  'tests/perf/budgets.json',
  'tests/perf/fixture-manifest.json',
  'tests/perf/host.html',
  'tests/perf/performance-120p.spec.ts',
]) {
  assert.ok(paths.includes(required), `required public file missing: ${required}`)
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
assert.equal(packageJson.name, 'inko-pdf-sdk', 'canonical npm package name required')
assert.equal(packageJson.license, 'Apache-2.0', 'Apache-2.0 package metadata required')
assert.equal(packageJson.private, true, 'source workspace must block direct npm publication')
assert.match(
  packageJson.scripts?.prepack ?? '',
  /block-root-package\.mjs/,
  'source workspace prepack guard required'
)
assert.doesNotMatch(JSON.stringify(packageJson.scripts ?? {}), /android:/i)
assert.equal(
  packageJson.scripts?.['test:e2e'],
  'playwright test',
  'public functional E2E must be discovered from tests/e2e instead of a filename allowlist'
)
assert.equal(
  packageJson.scripts?.['test:perf'],
  'playwright test --config playwright.perf.config.ts',
  'public 120-page performance regression command required'
)
assert.match(
  JSON.stringify(packageJson.repository ?? ''),
  /github\.com[/:]sinabin\/inko-sdk(?:\.git)?/i,
  'canonical public repository metadata required'
)
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
assert.equal(packageLock.name, packageJson.name, 'package-lock root name drift')
assert.equal(packageLock.version, packageJson.version, 'package-lock root version drift')
assert.equal(packageLock.packages?.['']?.license, 'Apache-2.0', 'package-lock license drift')
assert.equal(
  packageJson.devDependencies?.['@vitest/coverage-v8'],
  packageLock.packages?.['node_modules/@vitest/coverage-v8']?.version,
  'coverage provider must be locked to the installed version'
)

const functionalE2eSpecs = paths.filter((path) => /^tests\/e2e\/.*\.spec\.ts$/.test(path))
assert.ok(functionalE2eSpecs.length > 0, 'public functional E2E specs missing')
assert.deepEqual(
  functionalE2eSpecs.filter((path) => /(?:manual|visual|sales|evidence|local-history)/i.test(path)),
  [],
  'manual, visual, sales, evidence, or dev-history specs must not enter public functional E2E'
)

const scannerPath = 'scripts/release/verify-public-tree.mjs'
const skippedPrefixes = [
  'public/cmaps/',
  'public/pdfjs-images/',
  'public/standard_fonts/',
  'public/third_party_licenses/',
]
const skippedFiles = new Set([
  scannerPath,
  'public/pdf.worker.mjs',
  'scripts/check-oss-boundary.mjs',
  'scripts/release/public-source-allowlist.json',
  'scripts/release/verify-release-package.mjs',
  'tests/release/verify-installed-tarball.mjs',
])
const sensitivePatterns = [
  ['private workspace path', /(?:business_workspace|workspace_root)/i],
  ['legacy host name', /smarton/i],
  ['legacy host package', /com\.smarton/i],
  ['private deployment system', /\bSVN\b/i],
  ['internal commercial term', /commercial license/i],
  ['unapproved license state', /UNLICENSED/],
  ['internal release wording', /internal release candidate/i],
  ['legacy parent wrapper', /PdfViewerPOP/],
  ['private Android bridge reference', /(?:androidBridge|PdfViewerActivity|window\.conn\b|window\.loadPdf(?:Base64)?\b)/],
  ['legacy user field', /\b(?:odcId|odcName|USER_NM|USER_ID|REG_DT|CANVAS_ID|ATCH_FILE_NO|CANVAS_JSON)\b/],
  ['unsupported speed claim', /5분(?:\s*안에)?\s*(?:통합|임베드)/],
]

const findings = []
for (const path of paths) {
  if (skippedFiles.has(path) || skippedPrefixes.some((prefix) => path.startsWith(prefix))) continue
  const absolute = resolve(root, path)
  if (statSync(absolute).size > 1_000_000) continue
  const bytes = readFileSync(absolute)
  if (bytes.includes(0)) continue
  const text = bytes.toString('utf8')
  for (const [label, pattern] of sensitivePatterns) {
    if (pattern.test(text)) findings.push(`${path}: ${label}`)
  }
}
assert.deepEqual(findings, [], `private or legacy content found:\n${findings.join('\n')}`)

console.log(`Public source boundary passed (${paths.length} files)`)
