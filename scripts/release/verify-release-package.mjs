import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(process.cwd())
const release = resolve(process.argv[2] ?? 'release')

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    assert.equal(entry.isSymbolicLink(), false, `symlink is not allowed: ${path}`)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

assert.ok(existsSync(release), `release directory missing: ${release}`)
const files = walk(release)
const paths = files.map((path) => relative(release, path).replaceAll('\\', '/')).sort()

for (const required of [
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'README.md',
  'README.ko.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/integration-guide.md',
  'docs/oss/asset-provenance.md',
  'example/index.html',
  'package.json',
  'sdk/inko-sdk.d.ts',
  'sdk/inko-sdk.js',
  'viewer/index.html',
  'viewer/samples/inko-demo.pdf',
  'viewer/samples/inko-feature-surface.pdf',
  'viewer/pdfjs-images/manifest.json',
  'viewer/pdfjs-images/LICENSE.pdfjs-dist',
]) {
  assert.ok(paths.includes(required), `release file missing: ${required}`)
}

const allowedRoots = new Set([
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'README.md',
  'README.ko.md',
  'THIRD_PARTY_NOTICES.md',
  'docs',
  'example',
  'package.json',
  'sdk',
  'viewer',
])
for (const path of paths) {
  assert.ok(allowedRoots.has(path.split('/')[0]), `unexpected release path: ${path}`)
  assert.doesNotMatch(path, /(?:^|\/)(?:\.claude|tests?|src|review)(?:\/|$)/)
  assert.doesNotMatch(path, /\.map$/)
  assert.doesNotMatch(path, /androidBridge|(?:^|\/)test\.pdf$|pdf 테스트\.pdf/i)
}
assert.deepEqual(
  paths.filter((path) => path.endsWith('.pdf')),
  [
    'viewer/samples/inko-demo.pdf',
    'viewer/samples/inko-feature-surface.pdf',
  ],
  'unapproved PDF entered the release package',
)

const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const releasePackage = JSON.parse(readFileSync(resolve(release, 'package.json'), 'utf8'))
assert.equal(releasePackage.name, rootPackage.name)
assert.equal(releasePackage.version, rootPackage.version)
assert.equal(releasePackage.license, 'Apache-2.0')
assert.notEqual(releasePackage.private, true)
assert.equal(releasePackage.publishConfig?.access, 'public')
assert.match(releasePackage.description ?? '', /host-managed storage/i)
assert.match(
  JSON.stringify(releasePackage.repository ?? ''),
  /github\.com[/:]sinabin\/inko-sdk(?:\.git)?/i
)
assert.deepEqual(
  new Set(releasePackage.files ?? []),
  new Set([
    'LICENSE',
    'NOTICE',
    'SECURITY.md',
    'README.md',
    'README.ko.md',
    'THIRD_PARTY_NOTICES.md',
    'docs/',
    'viewer/',
    'sdk/',
    'example/',
  ]),
  'npm package files allowlist drift'
)
assert.ok(paths.includes(releasePackage.main), `package main missing: ${releasePackage.main}`)
assert.ok(paths.includes(releasePackage.types), `package types missing: ${releasePackage.types}`)

for (const readmeName of ['README.md', 'README.ko.md']) {
  const readme = readFileSync(resolve(release, readmeName), 'utf8')
  assert.doesNotMatch(readme, /\]\(public\//, `${readmeName} contains a source-only relative link`)
  assert.match(readme, /\]\(docs\/integration-guide\.md\)/)
  assert.match(readme, /\]\(SECURITY\.md\)/)
  assert.match(readme, /\]\(THIRD_PARTY_NOTICES\.md\)/)
}

const sdk = readFileSync(resolve(release, 'sdk/inko-sdk.js'), 'utf8')
assert.match(sdk, new RegExp(`version:\\s*['\"]${rootPackage.version.replaceAll('.', '\\.')}['\"]`))
assert.doesNotMatch(sdk, /__bridgeMock|androidBridge|pdfv_canvas_history:/)

const worker = readFileSync(resolve(release, 'viewer/pdf.worker.mjs'), 'utf8')
assert.match(
  worker,
  /Modified by NextH for Inko in 2026: removed the upstream sourceMappingURL trailer\. No executable code was changed\./,
  'PDF.js worker modification notice missing from the release package',
)

const example = readFileSync(resolve(release, 'example/index.html'), 'utf8')
assert.match(example, /\.\.\/sdk\/inko-sdk\.js/)
assert.match(example, /\.\.\/viewer\/index\.html/)
assert.doesNotMatch(example, /\/pdfv\//)
assert.doesNotMatch(example, /PdfViewer\./)

for (const path of files.filter((path) => /\.(?:html|js|mjs|md|json)$/.test(path))) {
  const text = readFileSync(path, 'utf8')
  assert.doesNotMatch(text, /UNLICENSED|internal release candidate|commercial license/i)
}

console.log(`Release package boundary passed (${paths.length} files)`)
