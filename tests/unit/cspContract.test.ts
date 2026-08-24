import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('production CSP contract', () => {
  it('allows only the blob capabilities used by PDF workers, previews, and PDF reload', () => {
    const source = readFileSync(resolve('vite.config.ts'), 'utf8')

    expect(source).toContain('"worker-src \'self\' blob:"')
    expect(source).toContain('"img-src \'self\' blob: data:"')
    expect(source).toContain('"connect-src \'self\' blob:"')
    expect(source).not.toMatch(/connect-src[^"\n]*data:/)
    expect(source).not.toMatch(/connect-src[^"\n]*https?:/)
  })
})
