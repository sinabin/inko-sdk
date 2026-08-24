import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ComponentProps } from 'svelte'
import { describe, expect, expectTypeOf, it } from 'vitest'
import PdfToolbar from '../../src/components/PdfToolbar.svelte'

const toolbarGroupFiles = [
  'ToolbarActionGroup.svelte',
  'ToolbarHistoryGroup.svelte',
  'ToolbarNavigationGroup.svelte',
  'ToolbarToolGroup.svelte',
  'ToolbarZoomGroup.svelte'
]

type ToolbarProps = ComponentProps<typeof PdfToolbar>
type RemovedToolbarProps = Extract<
  | 'brushColor'
  | 'brushWidth'
  | 'onColorChange'
  | 'onWidthChange'
  | 'fontSize'
  | 'onFontSizeChange',
  keyof ToolbarProps
>

describe('toolbar shared style 계약', () => {
  it('사용하지 않는 brush/text option props를 PdfToolbar 계약에서 제외한다', () => {
    expectTypeOf<RemovedToolbarProps>().toEqualTypeOf<never>()
  })

  it('모든 그룹이 공용 section/button class를 사용하고 base CSS를 재정의하지 않는다', () => {
    for (const file of toolbarGroupFiles) {
      const source = readFileSync(resolve('src/components/toolbar', file), 'utf8')
      const buttonClasses = source.match(/class="[^"]*\bbtn\b[^"]*"/g) ?? []

      expect(source, file).toContain("import './toolbar-shared.css'")
      expect(source, file).toContain('inko-toolbar-section')
      expect(buttonClasses.length, file).toBeGreaterThan(0)
      expect(buttonClasses.every((classes) => classes.includes('inko-toolbar-button')), file).toBe(true)
      expect(source, file).not.toMatch(/^\s*\.toolbar-section(?:::before)?\s*\{/m)
      expect(source, file).not.toMatch(/^\s*\.btn(?=[:\s{])/m)
    }
  })

  it('공용 stylesheet가 interaction과 orientation 기준선을 한 곳에서 정의한다', () => {
    const stylesheet = readFileSync(
      resolve('src/components/toolbar/toolbar-shared.css'),
      'utf8'
    )

    for (const selector of [
      '.inko-toolbar-section',
      '.inko-toolbar-section--divided::before',
      '.inko-toolbar-button',
      '.inko-toolbar-button:hover:not(:disabled)',
      '.inko-toolbar-button:active:not(:disabled)',
      '.inko-toolbar-button:disabled',
      '.inko-toolbar-button:focus-visible'
    ]) {
      expect(stylesheet).toContain(selector)
    }
    expect(stylesheet).toContain('@media (orientation: portrait)')
    expect(stylesheet).toContain('@media (orientation: landscape)')
  })
})
