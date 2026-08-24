import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function assertMirrorsLockedPackage(publicDir, packageDir) {
  const publicFiles = walk(publicDir)
    .map((path) => relative(publicDir, path).replaceAll('\\', '/'))
    .sort()
  const packageFiles = walk(packageDir)
    .map((path) => relative(packageDir, path).replaceAll('\\', '/'))
    .sort()
  assert.deepEqual(publicFiles, packageFiles, `${relative(root, publicDir)} file list drift`)
  for (const name of publicFiles) {
    assert.equal(
      sha256(resolve(publicDir, name)),
      sha256(resolve(packageDir, name)),
      `${relative(root, publicDir)}/${name} differs from locked dependency`
    )
  }
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
assert.equal(packageJson.name, 'inko-pdf-sdk', 'public package name drift')
assert.equal(packageJson.private, true, 'private root package required')
assert.equal(packageJson.license, 'Apache-2.0', 'root package license must match LICENSE')
assert.match(packageJson.scripts?.prepack ?? '', /block-root-package\.mjs/)

for (const path of ['Pdf_test/pdf 테스트.pdf', 'public/test.pdf']) {
  assert.equal(existsSync(resolve(root, path)), false, `rights-unknown fixture must be absent: ${path}`)
}

const app = readFileSync(resolve(root, 'src/App.svelte'), 'utf8')
assert.match(app, /samples\/inko-demo\.pdf/)
assert.doesNotMatch(app, /pdf 테스트\.pdf|public\/test\.pdf/)
assert.ok(existsSync(resolve(root, 'public/samples/inko-demo.pdf')), 'source-owned PDF fixture required')
assert.ok(
  existsSync(resolve(root, 'scripts/generate-oss-sample-pdf.py')),
  'fixture generator must ship with the source'
)
assert.equal(
  sha256(resolve(root, 'public/samples/inko-demo.pdf')),
  '48A506F0EDFC6BDA6B72A8B70052B17B02A97AEA4ECAD1C94A08A2A569324326',
  'synthetic PDF fixture changed without provenance review'
)

const liberationHashes = {
  'LiberationSans-Regular.ttf': '76D04C18EA243F426B7DE1F3AD208E927008F961DC5945E5AAD352D0DFDE8EE8',
  'LiberationSans-Bold.ttf': '788ABEE4C806D660E8AEE46689DD8540CD4BB98DA03DCC9D171CE3EFD99A9173',
  'LiberationSans-Italic.ttf': 'E5BAE5C4CDE31F22142753855F4F8FB86DA6FF39955ED3C0A11248B0D16948B0',
  'LiberationSans-BoldItalic.ttf': '698DA70FC191CC5F33AD4D6D3FE830FE4624B898EA2E3169955928B7C491F1EE',
}
for (const [name, expected] of Object.entries(liberationHashes)) {
  assert.equal(
    sha256(resolve(root, 'public/standard_fonts', name)),
    expected,
    `${name} must remain the reviewed Liberation Fonts 2.1.5 binary`
  )
}
assert.equal(
  sha256(resolve(root, 'public/standard_fonts/LICENSE_LIBERATION')),
  '93FED46019C38BBE566B479D22148E2E8A1E85ADA614ACCB0211C37B2C61C19B',
  'Liberation OFL notice changed'
)

const publicStandardFonts = resolve(root, 'public/standard_fonts')
const packageStandardFonts = resolve(root, 'node_modules/pdfjs-dist/standard_fonts')
for (const name of readdirSync(publicStandardFonts).filter((name) => /^Foxit|^LICENSE_FOXIT$/.test(name))) {
  assert.equal(
    sha256(resolve(publicStandardFonts, name)),
    sha256(resolve(packageStandardFonts, name)),
    `${name} differs from locked pdfjs-dist`
  )
}

assertMirrorsLockedPackage(
  resolve(root, 'public/cmaps'),
  resolve(root, 'node_modules/pdfjs-dist/cmaps')
)

const normalizeWorker = (text) => text
  .replaceAll('\r\n', '\n')
  .replace(/^\/\/# sourceMappingURL=pdf\.worker\.mjs\.map\s*$/m, '')
  .trimEnd()
assert.equal(
  normalizeWorker(readFileSync(resolve(root, 'public/pdf.worker.mjs'), 'utf8')),
  normalizeWorker(readFileSync(resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.mjs'), 'utf8')),
  'pdf.worker.mjs differs from locked pdfjs-dist beyond the removed source map comment'
)
assert.ok(existsSync(resolve(root, 'public/THIRD_PARTY_NOTICES.md')), 'third-party notice required')

const packageBuilder = readFileSync(resolve(root, 'scripts/build-pkg.mjs'), 'utf8')
assert.doesNotMatch(packageBuilder, /Commercial license|Contact .* for licensing/i)

const publicBoundaryFiles = [
  'public/sdk/pdfv-sdk.js',
  'public/sdk/inko-sdk.d.ts',
  'docs/integration-guide.md',
  'docs/architecture.md',
  'docs/data-flow.md',
  'docs/factory-function-pattern.md',
]
const forbiddenPublicTerms = /Android|window\.conn|PdfViewerPOP|odcId|odcName|USER_NM|USER_ID|REG_DT|CANVAS_ID|SmartOn|SVN|commercial license|internal release candidate|UNLICENSED|5분/iu
for (const name of publicBoundaryFiles) {
  const text = readFileSync(resolve(root, name), 'utf8')
  assert.doesNotMatch(text, forbiddenPublicTerms, `host-specific or pre-release wording leaked into ${name}`)
}

const sdkSource = readFileSync(resolve(root, 'public/sdk/pdfv-sdk.js'), 'utf8')
assert.match(sdkSource, /root\.Inko\s*=\s*factory\(\)/)
assert.doesNotMatch(sdkSource, /root\.PdfViewer|\[PdfViewer SDK\]/)

const sdkTypes = readFileSync(resolve(root, 'public/sdk/inko-sdk.d.ts'), 'utf8')
assert.match(sdkTypes, /Inko:\s*InkoStatic/)
assert.doesNotMatch(sdkTypes, /PdfViewer:\s*InkoStatic/)

const sourceExample = readFileSync(resolve(root, 'public/sdk/example.html'), 'utf8')
assert.match(sourceExample, /\/pdfv\/sdk\/pdfv-sdk\.js/)
assert.match(sourceExample, /\/pdfv\/index\.html/)
assert.match(sourceExample, /\/pdfv\/samples\/inko-demo\.pdf/)
assert.doesNotMatch(sourceExample, /PdfViewer\./)

const distDir = resolve(root, 'dist')
if (existsSync(distDir)) {
  const files = walk(distDir)
  const names = files.map((path) => relative(distDir, path).replaceAll('\\', '/'))
  assert.equal(names.some((name) => name.endsWith('.map')), false, 'source maps must not ship')
  assert.equal(
    names.some((name) => /androidBridgeMock|(^|\/)test\.pdf$|pdf 테스트\.pdf/i.test(name)),
    false,
    'mock or rights-unknown PDF leaked into dist'
  )
  assert.ok(names.includes('samples/inko-demo.pdf'), 'synthetic fixture missing from dist')

  const executableFiles = files
    .filter((path) => /\.(?:html|js|mjs)$/.test(path))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
  const executableText = executableFiles.map(({ text }) => text).join('\n')
  assert.doesNotMatch(executableText, /__bridgeMock|pdfv_canvas_history:/)
  // 호스트 전용 식별자 — 철자가 충분히 특이해 대소문자 무시로 넓게 잡는다.
  assert.doesNotMatch(
    executableText,
    /window\.conn|PdfViewerPOP|odcId|odcName|USER_NM|USER_ID|REG_DT|CANVAS_ID|SmartOn/iu,
    'host-specific compatibility code leaked into dist',
  )
  // SVN은 세 글자라 대소문자를 무시하면 Vite 콘텐츠 해시(예: index-BY4svn44.js)에
  // 우연히 걸린다. 호스트 코드가 쓰는 형태인 대문자 단어로만 검사한다.
  assert.doesNotMatch(
    executableText,
    /SVN/u,
    'host-specific compatibility code leaked into dist',
  )
  for (const { path, text } of executableFiles) {
    assert.doesNotMatch(
      text.slice(-512),
      /\/\/[#@]\s*sourceMappingURL=/,
      `source map trailer must not ship: ${relative(distDir, path)}`
    )
  }
}

console.log('OSS boundary check passed')
