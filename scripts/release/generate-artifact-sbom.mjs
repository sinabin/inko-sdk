import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '../..')
const tarballArg = process.argv[2]
const outputArg = process.argv[3]

if (!tarballArg || !outputArg || process.argv.length !== 4) {
  throw new Error(
    'Usage: node scripts/release/generate-artifact-sbom.mjs <package.tgz> <sbom.cdx.json>',
  )
}

const tarballPath = resolve(process.cwd(), tarballArg)
const outputPath = resolve(process.cwd(), outputArg)
assert.ok(existsSync(tarballPath), `release archive missing: ${tarballPath}`)

const sourcePackage = readJson(resolve(root, 'package.json'))
const packageLock = readJson(resolve(root, 'package-lock.json'))
const tarballBytes = readFileSync(tarballPath)
const artifactSha256 = createHash('sha256').update(tarballBytes).digest('hex')
const entries = readTarGzip(tarballBytes)

const artifactPackage = readArtifactJson('package/package.json')
assert.equal(artifactPackage.name, sourcePackage.name, 'artifact package name drift')
assert.equal(artifactPackage.version, sourcePackage.version, 'artifact package version drift')
assert.equal(artifactPackage.license, sourcePackage.license, 'artifact package license drift')
assert.equal(packageLock.name, sourcePackage.name, 'package-lock package name drift')
assert.equal(packageLock.version, sourcePackage.version, 'package-lock package version drift')

const sourceNotice = readFileSync(resolve(root, 'public/THIRD_PARTY_NOTICES.md'), 'utf8')
const artifactNotice = readArtifactText('package/THIRD_PARTY_NOTICES.md')
assert.equal(artifactNotice, sourceNotice, 'root artifact notice differs from the source notice')
assert.equal(
  readArtifactText('package/viewer/THIRD_PARTY_NOTICES.md'),
  sourceNotice,
  'viewer artifact notice differs from the source notice',
)
assert.equal(
  readArtifactText('package/NOTICE'),
  readFileSync(resolve(root, 'NOTICE'), 'utf8'),
  'artifact NOTICE differs from the source NOTICE',
)

const artifactRows = parseNoticeTable(sourceNotice, 'inko-artifact-components')
const sourceOnlyRows = parseNoticeTable(sourceNotice, 'inko-source-only-components')
validateStrapsNotice(sourceNotice)
validateViewerRootFile('third_party_licenses/straps-MIT.txt')
const noticeRows = [...artifactRows, ...sourceOnlyRows]
assert.equal(
  new Set(noticeRows.map(({ name, version }) => componentId(name, version))).size,
  noticeRows.length,
  'a component version appears in more than one notice table',
)

const rootDependencies = Object.keys(packageLock.packages?.['']?.dependencies ?? {}).sort()
assert.ok(rootDependencies.length > 0, 'package-lock has no production dependencies to inspect')

const componentDefinitions = new Map()
const sourceComponentIds = new Set()
const productionGraphComponentIds = new Set()
for (const name of dependencyClosure(rootDependencies)) {
  const component = registerLockedComponent(name)
  sourceComponentIds.add(component.id)
  productionGraphComponentIds.add(component.id)
}
assert.ok(
  lockedPackage('svelte').dev,
  'Svelte must remain a locked build dependency when its runtime is compiled into the artifact',
)
const svelteComponent = registerLockedComponent('svelte')
sourceComponentIds.add(svelteComponent.id)

const lockedAcornComponent = registerLockedComponent('acorn')
const vendoredAcornComponent = registerVendoredAcorn()
const strapsComponent = registerStrapsJs()
const viteComponent = registerLockedComponent('vite')
const liberationComponent = registerLiberationFonts()
sourceComponentIds.add(lockedAcornComponent.id)
sourceComponentIds.add(vendoredAcornComponent.id)
sourceComponentIds.add(strapsComponent.id)
sourceComponentIds.add(viteComponent.id)
sourceComponentIds.add(liberationComponent.id)

const directEvidence = new Map()
for (const dependency of rootDependencies) {
  directEvidence.set(dependency, detectDirectDependency(dependency))
}
directEvidence.set('svelte', detectSvelteRuntime())

const actualComponentIds = new Set()
const evidenceByComponent = new Map()
for (const [dependency, evidence] of directEvidence) {
  if (evidence.length === 0) continue
  const closure = dependency === 'svelte'
    ? new Set(['svelte'])
    : dependencyClosure([dependency])
  for (const name of closure) {
    const component = registerLockedComponent(name)
    actualComponentIds.add(component.id)
    evidenceByComponent.set(component.id, evidence)
  }
}

const paperEvidence = directEvidence.get('paper') ?? []
if (paperEvidence.length > 0) {
  validateAcornEvidence(paperEvidence, lockedAcornComponent, vendoredAcornComponent)
  validateStrapsEvidence(paperEvidence, strapsComponent)
  for (const component of [lockedAcornComponent, vendoredAcornComponent, strapsComponent]) {
    actualComponentIds.add(component.id)
    evidenceByComponent.set(component.id, paperEvidence)
  }
}

const viteEvidence = detectViteRuntime()
if (viteEvidence.length > 0) {
  actualComponentIds.add(viteComponent.id)
  evidenceByComponent.set(viteComponent.id, viteEvidence)
}

const liberationEvidence = detectLiberationFonts(liberationComponent)
actualComponentIds.add(liberationComponent.id)
evidenceByComponent.set(liberationComponent.id, liberationEvidence)

const sourceOnlyComponentIds = new Set(
  [...sourceComponentIds].filter((id) => !actualComponentIds.has(id)),
)

validateNoticeRows(
  artifactRows,
  new Set([...actualComponentIds].filter((id) => id !== strapsComponent.id)),
  'artifact table',
)
validateNoticeRows(sourceOnlyRows, sourceOnlyComponentIds, 'source-only')

const rootRef = npmPurl(artifactPackage.name, artifactPackage.version)
const components = [...actualComponentIds]
  .map((id) => componentDefinitions.get(id))
  .sort((a, b) => compareText(a.bomRef, b.bomRef))
  .map((component) => cyclonedxComponent(component, evidenceByComponent.get(component.id) ?? []))

const componentRefs = new Map(
  components.map((component) => [componentId(componentPackageName(component), component.version), component['bom-ref']]),
)
const directArtifactDependencies = [
  ...rootDependencies
    .map((name) => registerLockedComponent(name).id)
    .filter((id) => actualComponentIds.has(id)),
  ...(actualComponentIds.has(svelteComponent.id) ? [svelteComponent.id] : []),
  ...(actualComponentIds.has(viteComponent.id) ? [viteComponent.id] : []),
  ...(actualComponentIds.has(liberationComponent.id) ? [liberationComponent.id] : []),
]

const dependencies = [
  {
    ref: rootRef,
    dependsOn: directArtifactDependencies.map((id) => componentRefs.get(id)).sort(),
  },
  ...[...actualComponentIds]
    .sort((a, b) => compareText(componentRefs.get(a), componentRefs.get(b)))
    .map((id) => {
      const component = componentDefinitions.get(id)
      const dependencyIds = component.locked && productionGraphComponentIds.has(id)
        ? Object.keys(component.locked.dependencies ?? {}).map((name) => registerLockedComponent(name).id)
        : []
      if (id === registerLockedComponent('paper').id) {
        dependencyIds.push(
          lockedAcornComponent.id,
          strapsComponent.id,
          vendoredAcornComponent.id,
        )
      }
      return {
        ref: componentRefs.get(id),
        dependsOn: dependencyIds
          .filter((dependencyId) => actualComponentIds.has(dependencyId))
          .map((dependencyId) => componentRefs.get(dependencyId))
          .sort(),
      }
    }),
]

const sbom = {
  $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: deterministicSerialNumber(artifactSha256),
  version: 1,
  metadata: {
    component: {
      type: 'application',
      'bom-ref': rootRef,
      name: artifactPackage.name,
      version: artifactPackage.version,
      hashes: [{ alg: 'SHA-256', content: artifactSha256 }],
      licenses: [cyclonedxLicense(artifactPackage.license)],
      purl: rootRef,
      properties: [
        { name: 'inko:artifact:fileName', value: basename(tarballPath) },
        { name: 'inko:artifact:notice', value: 'package/THIRD_PARTY_NOTICES.md' },
      ],
    },
  },
  components,
  dependencies,
}

validateGeneratedSbom(sbom, actualComponentIds, rootRef)
writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8')

console.log(
  `Artifact SBOM passed (${components.length} bundled components, `
    + `${sourceOnlyComponentIds.size} source-only components): ${outputPath}`,
)

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function readArtifactText(path) {
  const value = entries.get(path)
  assert.ok(value, `artifact file missing: ${path}`)
  return value.toString('utf8')
}

function readArtifactJson(path) {
  return JSON.parse(readArtifactText(path))
}

function lockedPackage(name) {
  const key = `node_modules/${name}`
  const value = packageLock.packages?.[key]
  assert.ok(value, `locked package missing or not hoisted unambiguously: ${name}`)
  assert.match(value.version ?? '', /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, `invalid locked version: ${name}`)
  assert.ok(value.license, `locked license missing: ${name}`)
  assert.match(value.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, `untrusted resolved URL: ${name}`)
  assert.match(value.integrity ?? '', /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/, `invalid lock integrity: ${name}`)
  return value
}

function registerLockedComponent(name) {
  const locked = lockedPackage(name)
  const id = componentId(name, locked.version)
  if (!componentDefinitions.has(id)) {
    const purl = npmPurl(name, locked.version)
    componentDefinitions.set(id, {
      id,
      name,
      version: locked.version,
      license: normalizeLicense(locked.license),
      type: 'library',
      purl,
      bomRef: purl,
      locked,
      provenance: `package-lock.json#packages/node_modules/${name}`,
    })
  }
  return componentDefinitions.get(id)
}

function registerVendoredAcorn() {
  const paperSource = readFileSync(resolve(root, 'node_modules/paper/dist/paper-full.js'), 'utf8')
  const acornStart = paperSource.indexOf('* Acorn.js')
  assert.ok(acornStart >= 0, 'vendored Acorn provenance marker missing from locked Paper.js distribution')
  const acornSection = paperSource.slice(acornStart)
  const versionMatch = /exports\.version\s*=\s*['"]([^'"]+)['"]/.exec(acornSection)
  assert.ok(versionMatch, 'vendored Acorn version missing from locked Paper.js distribution')

  const name = 'acorn'
  const version = versionMatch[1]
  const id = componentId(name, version)
  const component = {
    id,
    name,
    version,
    license: 'MIT',
    type: 'library',
    purl: npmPurl(name, version),
    bomRef: npmPurl(name, version),
    provenance: `vendored in paper@${lockedPackage('paper').version}`,
  }
  assert.equal(componentDefinitions.has(id), false, `vendored component collides with a locked component: ${id}`)
  componentDefinitions.set(id, component)
  return component
}

function registerStrapsJs() {
  const paper = lockedPackage('paper')
  const paperPackage = readJson(resolve(root, 'node_modules/paper/package.json'))
  assert.equal(paperPackage.version, paper.version, 'locked Paper.js package metadata version drift')
  assert.equal(
    paperPackage.devDependencies?.straps,
    '^3.0.1',
    'Paper.js Straps.js provenance version range drift',
  )

  const name = 'straps'
  const version = '3.0.1'
  const id = componentId(name, version)
  const integrity = parseIntegrity(
    'sha512-vspwaFEQcK0m3R1Cfg3CBGichEpBq5P3xYtVXDlBP37LL9z4jsoRqI1cc0ZLdXiGnLvQvwrIidTac9YMPUE/ng==',
  )
  const purl = npmPurl(name, version)
  const component = {
    id,
    name,
    version,
    license: 'MIT',
    type: 'library',
    purl,
    bomRef: purl,
    provenance: `Straps.js-derived code embedded in paper@${paper.version}; `
      + 'node_modules/paper/package.json#devDependencies.straps',
    distribution: {
      url: 'https://registry.npmjs.org/straps/-/straps-3.0.1.tgz',
      algorithm: integrity.algorithm,
      hex: integrity.hex,
    },
  }
  assert.equal(componentDefinitions.has(id), false, `curated component collides with another component: ${id}`)
  componentDefinitions.set(id, component)
  return component
}

function registerLiberationFonts() {
  const name = 'Liberation Fonts'
  const version = '2.1.5'
  const id = componentId(name, version)
  const component = {
    id,
    name,
    version,
    license: 'OFL-1.1',
    type: 'file',
    bomRef: 'urn:inko:component:liberation-fonts@2.1.5',
    provenance: 'docs/oss/asset-provenance.md#liberation-sans',
    distribution: {
      url: 'https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz',
      algorithm: 'SHA-256',
      hex: '7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0',
    },
    files: {
      'LiberationSans-Regular.ttf': '76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
      'LiberationSans-Bold.ttf': '788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173',
      'LiberationSans-Italic.ttf': 'e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0',
      'LiberationSans-BoldItalic.ttf': '698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee',
    },
  }
  assert.equal(componentDefinitions.has(id), false, `curated component collides with another component: ${id}`)
  componentDefinitions.set(id, component)
  return component
}

function dependencyClosure(roots) {
  const found = new Set()
  const pending = [...roots]
  while (pending.length > 0) {
    const name = pending.shift()
    if (found.has(name)) continue
    found.add(name)
    pending.push(...Object.keys(lockedPackage(name).dependencies ?? {}).sort())
  }
  return found
}

function validateAcornEvidence(paths, lockedAcorn, vendoredAcorn) {
  const text = paths.map((path) => entries.get(path).toString('utf8')).join('\n')
  assert.match(text, /Since Acorn 8\.0\.0/, 'modern Acorn runtime marker missing from Paper.js chunk')
  assert.ok(
    text.includes(lockedAcorn.version),
    `locked Acorn version missing from Paper.js chunk: ${lockedAcorn.version}`,
  )
  assert.ok(
    text.includes(vendoredAcorn.version),
    `vendored Acorn version missing from Paper.js chunk: ${vendoredAcorn.version}`,
  )
}

function validateStrapsEvidence(paths, component) {
  const paperSource = readFileSync(resolve(root, 'node_modules/paper/dist/paper-full.js'), 'utf8')
  assert.match(
    paperSource,
    /Straps\.js - Class inheritance library with support for bean-style accessors/,
    'Straps.js attribution marker missing from locked Paper.js distribution',
  )

  const artifactText = paths.map((path) => entries.get(path).toString('utf8')).join('\n')
  assert.ok(
    artifactText.includes('statics|enumerable|beans|preserve'),
    `Straps.js-derived inheritance marker missing from Paper.js chunk: ${component.id}`,
  )
}

function detectDirectDependency(name) {
  const rules = {
    paper: { chunk: /^package\/viewer\/assets\/paper(?:-[^/]+)?\.js$/ },
    'pdf-lib': { chunk: /^package\/viewer\/assets\/pdf-lib(?:-[^/]+)?\.js$/ },
    'pdfjs-dist': {
      chunk: /^package\/viewer\/assets\/pdfjs(?:-[^/]+)?\.js$/,
      required: ['package/viewer/pdf.worker.mjs'],
    },
  }
  const rule = rules[name]
  assert.ok(rule, `no artifact evidence rule exists for production dependency: ${name}`)

  const matchingChunks = [...entries]
    .filter(([path, bytes]) => rule.chunk.test(path) && hasExecutableContent(bytes))
    .map(([path]) => path)
    .sort()
  const requiredPaths = rule.required ?? []
  const presentRequired = requiredPaths.filter((path) => entries.has(path))

  if (matchingChunks.length === 0) {
    assert.equal(
      presentRequired.length,
      0,
      `${name} artifact is partial: supporting files exist without a non-empty runtime chunk`,
    )
    return []
  }
  for (const path of requiredPaths) {
    assert.ok(entries.has(path), `${name} supporting artifact missing: ${path}`)
  }
  return [...matchingChunks, ...requiredPaths].sort()
}

function detectSvelteRuntime() {
  return [...entries]
    .filter(([path, bytes]) => (
      /^package\/viewer\/assets\/[^/]+\.js$/.test(path)
      && bytes.includes(Buffer.from('https://svelte.dev/e/'))
    ))
    .map(([path]) => path)
    .sort()
}

function detectViteRuntime() {
  return [...entries]
    .filter(([path, bytes]) => {
      if (!/^package\/viewer\/assets\/[^/]+\.js$/.test(path)) return false
      const text = bytes.toString('utf8')
      return text.includes('relList')
        && text.includes('modulepreload')
        && text.includes('MutationObserver')
    })
    .map(([path]) => path)
    .sort()
}

function detectLiberationFonts(component) {
  const evidence = []
  for (const [name, expectedHash] of Object.entries(component.files)) {
    const sourcePath = resolve(root, 'public/standard_fonts', name)
    const artifactPath = `package/viewer/standard_fonts/${name}`
    assert.ok(existsSync(sourcePath), `Liberation Fonts source asset missing: ${name}`)
    const artifactBytes = entries.get(artifactPath)
    assert.ok(artifactBytes, `Liberation Fonts artifact asset missing: ${artifactPath}`)
    assert.equal(sha256(readFileSync(sourcePath)), expectedHash, `Liberation Fonts source hash drift: ${name}`)
    assert.equal(sha256(artifactBytes), expectedHash, `Liberation Fonts artifact hash drift: ${name}`)
    evidence.push(artifactPath)
  }

  const provenance = readFileSync(resolve(root, 'docs/oss/asset-provenance.md'), 'utf8')
  assert.match(provenance, /official 2\.1\.5 TTF release/, 'Liberation Fonts provenance version drift')
  assert.match(
    provenance.toLowerCase(),
    new RegExp(component.distribution.hex),
    'Liberation Fonts provenance archive hash drift',
  )
  return evidence.sort()
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function hasExecutableContent(bytes) {
  const text = bytes.toString('utf8').trim()
  return text.length > 0 && !/^(?:export\s*\{\s*\}\s*;?)?$/.test(text)
}

function parseNoticeTable(markdown, marker) {
  const start = `<!-- ${marker}:start -->`
  const end = `<!-- ${marker}:end -->`
  const startIndex = markdown.indexOf(start)
  const endIndex = markdown.indexOf(end)
  assert.ok(startIndex >= 0, `notice marker missing: ${start}`)
  assert.ok(endIndex > startIndex, `notice marker missing or misplaced: ${end}`)

  const rows = markdown.slice(startIndex + start.length, endIndex)
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))

  assert.ok(rows.length >= 2, `notice table is empty: ${marker}`)
  assert.deepEqual(
    rows.shift(),
    ['Component', 'Version', 'License', 'Viewer-root license path'],
    `notice table header drift: ${marker}`,
  )

  return rows.map((cells) => {
    assert.equal(cells.length, 4, `notice row must contain four cells: ${cells.join(' | ')}`)
    const [name, version, license, viewerLicensePath] = cells.map(stripCode)
    return { name, version, license, viewerLicensePath }
  })
}

function validateStrapsNotice(markdown) {
  assert.match(
    markdown,
    /Straps\.js-derived\s+\n?code;/,
    'Straps.js-derived code acknowledgement missing from third-party notice',
  )
  assert.match(
    markdown,
    /`third_party_licenses\/straps-MIT\.txt`/,
    'Straps.js license path missing from third-party notice',
  )
}

function stripCode(value) {
  return value.startsWith('`') && value.endsWith('`') ? value.slice(1, -1) : value
}

function validateNoticeRows(rows, expectedIds, label) {
  const actualIds = new Set(rows.map(({ name, version }) => componentId(name, version)))
  assert.deepEqual(
    [...actualIds].sort(),
    [...expectedIds].sort(),
    `${label} notice component set differs from artifact evidence`,
  )

  for (const row of rows) {
    const id = componentId(row.name, row.version)
    const component = componentDefinitions.get(id)
    assert.ok(component, `notice component is not supported by artifact detection: ${id}`)
    assert.equal(
      normalizeLicense(row.license),
      component.license,
      `notice license differs from trusted provenance: ${id}`,
    )

    const sourceLicensePath = `public/${normalizeRelativePath(row.viewerLicensePath)}`
    const sourceLicense = safeResolve(root, sourceLicensePath)
    assert.ok(existsSync(sourceLicense), `source license copy missing: ${sourceLicensePath}`)
    assert.ok(
      entries.has(`package/viewer/${normalizeRelativePath(row.viewerLicensePath)}`),
      `artifact license copy missing: viewer/${row.viewerLicensePath}`,
    )
  }
}

function validateViewerRootFile(viewerPath) {
  const normalized = normalizeRelativePath(viewerPath)
  assert.ok(existsSync(safeResolve(root, `public/${normalized}`)), `source viewer file missing: ${normalized}`)
  assert.ok(entries.has(`package/viewer/${normalized}`), `artifact viewer file missing: ${normalized}`)
}

function safeResolve(base, path) {
  const normalized = normalizeRelativePath(path)
  const absolute = resolve(base, normalized)
  const rel = relative(base, absolute)
  assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`), `path escapes source root: ${path}`)
  return absolute
}

function normalizeRelativePath(path) {
  const normalized = path.replaceAll('\\', '/')
  assert.doesNotMatch(normalized, /^(?:\/|[A-Za-z]:|\.\.?(?:\/|$))/, `path must be repository-relative: ${path}`)
  assert.doesNotMatch(normalized, /(?:^|\/)\.\.(?:\/|$)/, `path traversal is not allowed: ${path}`)
  return normalized
}

function normalizeLicense(license) {
  return String(license).trim().replace(/^\((.*)\)$/, '$1').replace(/\s+/g, ' ')
}

function componentId(name, version) {
  return `${name}@${version}`
}

function cyclonedxComponent(component, evidence) {
  const scoped = splitPackageName(component.name)
  return {
    type: component.type,
    'bom-ref': component.bomRef,
    ...(scoped.group ? { group: scoped.group } : {}),
    name: scoped.name,
    version: component.version,
    scope: 'required',
    licenses: [cyclonedxLicense(component.license)],
    ...(component.purl ? { purl: component.purl } : {}),
    ...(component.locked
      ? { externalReferences: [lockedDistributionReference(component.locked)] }
      : component.distribution
        ? { externalReferences: [curatedDistributionReference(component.distribution)] }
        : {}),
    properties: [
      { name: 'inko:artifact:evidence', value: evidence.join(',') },
      { name: 'inko:source:provenance', value: component.provenance },
    ],
  }
}

function curatedDistributionReference(distribution) {
  return {
    type: 'distribution',
    url: distribution.url,
    hashes: [{ alg: distribution.algorithm, content: distribution.hex }],
  }
}

function lockedDistributionReference(locked) {
  const integrity = parseIntegrity(locked.integrity)
  return {
    type: 'distribution',
    url: locked.resolved,
    hashes: [{ alg: integrity.algorithm, content: integrity.hex }],
  }
}

function componentPackageName(component) {
  return component.group ? `${component.group}/${component.name}` : component.name
}

function splitPackageName(name) {
  if (!name.startsWith('@')) return { name }
  const slash = name.indexOf('/')
  assert.ok(slash > 1 && slash < name.length - 1, `invalid scoped npm package name: ${name}`)
  return { group: name.slice(0, slash), name: name.slice(slash + 1) }
}

function npmPurl(name, version) {
  const scoped = splitPackageName(name)
  const namespace = scoped.group ? `${encodeURIComponent(scoped.group)}/` : ''
  return `pkg:npm/${namespace}${encodeURIComponent(scoped.name)}@${encodeURIComponent(version)}`
}

function parseIntegrity(integrity) {
  const match = /^(sha(?:256|384|512))-([A-Za-z0-9+/]+={0,2})$/.exec(integrity)
  assert.ok(match, `unsupported package-lock integrity: ${integrity}`)
  return {
    algorithm: match[1].toUpperCase().replace('SHA', 'SHA-'),
    hex: Buffer.from(match[2], 'base64').toString('hex'),
  }
}

function cyclonedxLicense(license) {
  return /\b(?:AND|OR|WITH)\b|[()]/.test(license)
    ? { expression: license }
    : { license: { id: license } }
}

function deterministicSerialNumber(sha256) {
  const bytes = Buffer.from(sha256.slice(0, 32), 'hex')
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function validateGeneratedSbom(sbom, expectedIds, expectedRootRef) {
  assert.equal(sbom.bomFormat, 'CycloneDX')
  assert.equal(sbom.specVersion, '1.6')
  assert.equal(sbom.metadata.component['bom-ref'], expectedRootRef)
  assert.deepEqual(
    sbom.components
      .map((component) => componentId(componentPackageName(component), component.version))
      .sort(),
    [...expectedIds].sort(),
    'generated SBOM component set differs from artifact evidence',
  )

  const componentRefs = new Set(sbom.components.map((component) => component['bom-ref']))
  const dependencyRefs = new Set([expectedRootRef, ...componentRefs])
  assert.equal(componentRefs.size, sbom.components.length, 'duplicate SBOM component reference')
  assert.equal(sbom.dependencies.length, dependencyRefs.size, 'SBOM dependency graph is incomplete')
  for (const dependency of sbom.dependencies) {
    assert.ok(dependencyRefs.has(dependency.ref), `unknown dependency graph ref: ${dependency.ref}`)
    for (const target of dependency.dependsOn) {
      assert.ok(componentRefs.has(target), `unknown dependency target: ${target}`)
    }
  }
}

function readTarGzip(compressed) {
  const archive = gunzipSync(compressed)
  const files = new Map()
  let offset = 0
  let globalPax = {}
  let nextPax = {}
  let longName = ''

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    validateTarChecksum(header)

    const size = parseTarNumber(header.subarray(124, 136), 'size')
    const type = String.fromCharCode(header[156] || 48)
    const name = readTarString(header.subarray(0, 100))
    const prefix = readTarString(header.subarray(345, 500))
    const headerPath = prefix ? `${prefix}/${name}` : name
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    assert.ok(dataEnd <= archive.length, `truncated tar entry: ${headerPath}`)
    const data = archive.subarray(dataStart, dataEnd)
    offset = dataStart + Math.ceil(size / 512) * 512

    if (type === 'x' || type === 'g') {
      const values = parsePax(data)
      if (type === 'g') globalPax = { ...globalPax, ...values }
      else nextPax = values
      continue
    }
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0.*$/s, '').trimEnd()
      continue
    }

    const path = normalizeTarPath(nextPax.path || globalPax.path || longName || headerPath)
    nextPax = {}
    longName = ''

    assert.notEqual(type, '1', `hard link is not allowed in release archive: ${path}`)
    assert.notEqual(type, '2', `symlink is not allowed in release archive: ${path}`)
    if (type !== '0' && type !== '\0') continue
    assert.equal(files.has(path), false, `duplicate release archive path: ${path}`)
    files.set(path, Buffer.from(data))
  }

  assert.ok(files.size > 0, 'release archive contains no files')
  return files
}

function validateTarChecksum(header) {
  const expected = parseTarNumber(header.subarray(148, 156), 'checksum')
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index]
  }
  assert.equal(actual, expected, 'release archive tar checksum mismatch')
}

function parseTarNumber(bytes, field) {
  assert.equal(bytes[0] & 0x80, 0, `base-256 tar ${field} is not supported`)
  const value = readTarString(bytes).trim()
  if (!value) return 0
  assert.match(value, /^[0-7]+$/, `invalid tar ${field}: ${value}`)
  return Number.parseInt(value, 8)
}

function readTarString(bytes) {
  const zero = bytes.indexOf(0)
  return bytes.subarray(0, zero >= 0 ? zero : bytes.length).toString('utf8')
}

function parsePax(bytes) {
  const text = bytes.toString('utf8')
  const values = {}
  let offset = 0
  while (offset < text.length) {
    const space = text.indexOf(' ', offset)
    assert.ok(space > offset, 'invalid PAX record length')
    const length = Number.parseInt(text.slice(offset, space), 10)
    assert.ok(Number.isSafeInteger(length) && length > 0, 'invalid PAX record size')
    const record = text.slice(space + 1, offset + length - 1)
    const equals = record.indexOf('=')
    assert.ok(equals > 0, 'invalid PAX record')
    values[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  assert.equal(offset, text.length, 'PAX record boundary mismatch')
  return values
}

function normalizeTarPath(path) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  assert.doesNotMatch(normalized, /^(?:\/|[A-Za-z]:)/, `absolute archive path is not allowed: ${path}`)
  assert.doesNotMatch(normalized, /(?:^|\/)\.\.(?:\/|$)/, `archive path traversal is not allowed: ${path}`)
  return normalized
}
