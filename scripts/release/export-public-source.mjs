import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(scriptDir, '../..')
const allowlist = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) =>
    readFile(resolve(scriptDir, 'public-source-allowlist.json'), 'utf8')
  )
)

const destinationArg = process.argv[2]
if (!destinationArg) {
  throw new Error('Usage: node scripts/release/export-public-source.mjs <empty-destination>')
}

const destination = resolve(destinationArg)
const relativeDestination = relative(sourceRoot, destination)
if (!relativeDestination || (!relativeDestination.startsWith(`..${sep}`) && relativeDestination !== '..')) {
  throw new Error('Destination must be outside the private source repository')
}

if (existsSync(destination) && readdirSync(destination).length > 0) {
  throw new Error(`Destination must be empty: ${destination}`)
}

const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  cwd: sourceRoot,
  encoding: 'utf8',
})
if (status.trim()) {
  throw new Error('Commit or remove private-repository changes before creating a public export')
}

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: sourceRoot,
  encoding: 'utf8',
}).split('\0').filter(Boolean).map((path) => path.replaceAll('\\', '/'))

const exact = new Set([...allowlist.rootFiles, ...allowlist.additionalFiles])
const prefixes = [...allowlist.prefixes, ...allowlist.additionalPrefixes]
const excluded = new Set(allowlist.excludeFiles)

const selected = tracked.filter((path) => {
  if (excluded.has(path) || allowlist.excludePrefixes.some((prefix) => path.startsWith(prefix))) {
    return false
  }
  return exact.has(path) || prefixes.some((prefix) => path.startsWith(prefix))
})

const missing = [...exact].filter((path) => !tracked.includes(path))
if (missing.length) {
  throw new Error(`Required public files are not tracked:\n${missing.join('\n')}`)
}

for (const path of selected) {
  const source = resolve(sourceRoot, path)
  if (lstatSync(source).isSymbolicLink()) {
    throw new Error(`Symlinks are not accepted in the public export: ${path}`)
  }
  const target = resolve(destination, path)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}

const verification = spawnSync(
  process.execPath,
  [resolve(destination, 'scripts/release/verify-public-tree.mjs'), '--root', destination],
  { cwd: destination, encoding: 'utf8' }
)
if (verification.stdout) process.stdout.write(verification.stdout)
if (verification.stderr) process.stderr.write(verification.stderr)
if (verification.status !== 0) {
  throw new Error('Public export rejected by verify-public-tree.mjs')
}

console.log(`Public source export created: ${destination}`)
console.log(`Files copied: ${selected.length}`)
console.log('No Git repository was initialized and no remote operation was performed.')
