import { afterEach, describe, expect, it } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import PdfAccessiblePageText from '../../src/components/PdfAccessiblePageText.svelte'
import { setLocale } from '../../src/lib/i18n/index.svelte'
import type { PdfAccessiblePageTextState } from '../../src/lib/accessibility/pdfAccessibleTextIndex'

const mounted: Array<Record<string, unknown>> = []

function render(state: PdfAccessiblePageTextState, nativeTextAvailable = false): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  mounted.push(mount(PdfAccessiblePageText, {
    target,
    props: { pageNumber: state.pageNumber, state, nativeTextAvailable }
  }) as Record<string, unknown>)
  flushSync()
  return target.querySelector<HTMLElement>('.accessible-page-text')!
}

afterEach(() => {
  while (mounted.length > 0) unmount(mounted.pop()!)
  document.body.innerHTML = ''
  setLocale('ko')
})

describe('PdfAccessiblePageText', () => {
  it('offscreen 페이지의 텍스트를 한 개의 읽기 순서 문서로 노출한다', () => {
    const element = render({ pageNumber: 7, status: 'ready', text: '첫 줄\n둘째 줄' })

    expect(element.getAttribute('role')).toBe('document')
    expect(element.getAttribute('aria-label')).toBe('7페이지 텍스트')
    expect(element.getAttribute('aria-hidden')).toBe('false')
    expect(element.getAttribute('data-status')).toBe('ready')
    expect(element.textContent).toContain('첫 줄\n둘째 줄')
  })

  it('실제 textLayer가 준비되면 대체 텍스트를 중복 노출하지 않는다', () => {
    const element = render(
      { pageNumber: 2, status: 'ready', text: '중복되면 안 되는 텍스트' },
      true
    )

    expect(element.getAttribute('aria-hidden')).toBe('true')
  })

  it('이미지 전용·실패·로딩 상태를 로케일에 맞게 설명한다', () => {
    setLocale('en')
    const imageOnly = render({ pageNumber: 3, status: 'image-only', text: '' })
    const failed = render({ pageNumber: 4, status: 'error', text: '' })
    const loading = render({ pageNumber: 5, status: 'loading', text: '' })

    expect(imageOnly.textContent).toContain('may contain only images')
    expect(failed.textContent).toContain('could not be read')
    expect(loading.textContent).toContain('Preparing text for page 5')
  })
})
