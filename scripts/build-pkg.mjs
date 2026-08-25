/**
 * Build the publishable Inko package from the private source workspace.
 *
 * The root package intentionally stays private and blocks `npm pack`. Only the
 * curated `release/` directory is publishable.
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicPackageBuildEnv } from './release/public-build-policy.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..')
const release = resolve(root, 'release')
const sourcePackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = sourcePackage.version

console.log(`\nBuilding ${sourcePackage.name} v${version}...\n`)
const publicBuildEnv = createPublicPackageBuildEnv(process.env)

rmSync(release, { recursive: true, force: true })
mkdirSync(release, { recursive: true })

console.log('Building the viewer...')
execSync('npm run build', {
  cwd: root,
  stdio: 'inherit',
  env: publicBuildEnv
})

console.log('\nStaging the public package...')
cpSync(resolve(root, 'dist'), resolve(release, 'viewer'), { recursive: true })

mkdirSync(resolve(release, 'sdk'))
cpSync(resolve(root, 'public/sdk/pdfv-sdk.js'), resolve(release, 'sdk/inko-sdk.js'))
cpSync(resolve(root, 'public/sdk/inko-sdk.d.ts'), resolve(release, 'sdk/inko-sdk.d.ts'))

mkdirSync(resolve(release, 'example'))
const example = readFileSync(resolve(root, 'public/sdk/example.html'), 'utf8')
  .replace('/pdfv/sdk/pdfv-sdk.js', '../sdk/inko-sdk.js')
  .replaceAll('/pdfv/index.html', '../viewer/index.html')
  .replaceAll('/pdfv/samples/inko-demo.pdf', '../viewer/samples/inko-demo.pdf')
writeFileSync(resolve(release, 'example/index.html'), example, 'utf8')

for (const file of ['LICENSE', 'NOTICE', 'SECURITY.md']) {
  cpSync(resolve(root, file), resolve(release, file))
}
for (const file of ['README.md', 'README.ko.md']) {
  const packageReadme = readFileSync(resolve(root, file), 'utf8')
    .replaceAll('public/THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md')
  writeFileSync(resolve(release, file), packageReadme, 'utf8')
}
cpSync(
  resolve(root, 'public/THIRD_PARTY_NOTICES.md'),
  resolve(release, 'THIRD_PARTY_NOTICES.md'),
)

const packageDocs = [
  'architecture.md',
  'data-flow.md',
  'factory-function-pattern.md',
  'integration-guide.md',
  'oss/asset-provenance.md',
]
for (const file of packageDocs) {
  const target = resolve(release, 'docs', file)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(resolve(root, 'docs', file), target)
}

const releasePackage = {
  name: sourcePackage.name,
  version,
  description: 'Self-hosted PDF SDK with outline bookmarks, review overlays, editing-state export/restore, and host-managed storage.',
  main: 'sdk/inko-sdk.js',
  types: 'sdk/inko-sdk.d.ts',
  files: [
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
  ],
  keywords: [
    'pdf',
    'sdk',
    'annotation',
    'bookmarks',
    'review',
    'self-hosted',
    'open-source',
  ],
  license: 'Apache-2.0',
  repository: {
    type: 'git',
    url: 'git+https://github.com/sinabin/inko-sdk.git',
  },
  bugs: {
    url: 'https://github.com/sinabin/inko-sdk/issues',
  },
  homepage: 'https://nexth.co.kr/inko',
  publishConfig: {
    access: 'public',
  },
}

writeFileSync(
  resolve(release, 'package.json'),
  `${JSON.stringify(releasePackage, null, 2)}\n`,
  'utf8',
)

// The SDK is staged separately, so remove the source copy from the viewer.
rmSync(resolve(release, 'viewer/sdk'), { recursive: true, force: true })

// Source maps and incidental PDFs never enter the package. The reviewed sample
// remains at viewer/samples/inko-demo.pdf.
const assetsDir = resolve(release, 'viewer/assets')
for (const file of readdirSync(assetsDir)) {
  if (file.endsWith('.map') || file.endsWith('.pdf')) {
    rmSync(resolve(assetsDir, file), { force: true })
  }
}

console.log('\nVerifying the release boundary...')
execSync('node scripts/release/verify-release-package.mjs release', {
  cwd: root,
  stdio: 'inherit',
})

console.log('\nPacking...')
rmSync(resolve(root, `${sourcePackage.name}-${version}.tgz`), { force: true })
execSync(`npm pack --pack-destination "${root}"`, {
  cwd: release,
  stdio: 'inherit',
})

console.log(`\nDone: ${sourcePackage.name}-${version}.tgz`)
console.log(`Install: npm install ${sourcePackage.name}@${version}\n`)
