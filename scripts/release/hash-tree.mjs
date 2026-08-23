import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const target = resolve(process.argv[2] ?? 'dist')

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

for (const path of walk(target).sort()) {
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
  console.log(`${hash}  ${relative(target, path).replaceAll('\\', '/')}`)
}
