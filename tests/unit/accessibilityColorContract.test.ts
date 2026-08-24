import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('non-DOM accessibility color contracts', () => {
  it('keeps virtual-page placeholders and loading badges readable', () => {
    const source = readFileSync(resolve('src/components/PdfScrollViewer.svelte'), 'utf8')

    expect(source).toMatch(/\.page-number\s*\{[^}]*color:\s*var\(--color-text-secondary\)/s)
    expect(source).toMatch(/\.preview-indicator\s*\{[^}]*background:\s*rgba\(0, 0, 0, 0\.72\)/s)
  })

  it('keeps custom scrollbar thumbs distinguishable from their tracks', () => {
    for (const file of ['PdfThumbnailList.svelte', 'PdfOutlinePanel.svelte']) {
      const source = readFileSync(resolve('src/components', file), 'utf8')
      expect(source, file).toMatch(
        /::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--color-text-secondary\)/s
      )
    }
  })
})
