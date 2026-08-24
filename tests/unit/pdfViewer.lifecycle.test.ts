import { afterEach, describe, expect, it } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import PdfViewer from '../../src/components/PdfViewer.svelte'

let instance: Record<string, unknown> | null = null

afterEach(() => {
  if (instance) unmount(instance)
  instance = null
  document.body.innerHTML = ''
})

describe('PdfViewer shell lifecycle', () => {
  it('호스트가 PDF를 전달하기 전에는 이름 있는 toolbar와 빈 문서 상태만 제공한다', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    instance = mount(PdfViewer, {
      target,
      props: { initialPdfUrl: '', isReadOnly: false }
    }) as Record<string, unknown>
    flushSync()

    expect(target.querySelector('[role="toolbar"]')?.getAttribute('aria-label'))
      .toBe('PDF 도구 모음')
    expect(target.querySelector('.empty')?.textContent).toContain('PDF 파일을 로드해주세요')
    expect(target.querySelector('.scroll-viewer')).toBeNull()
  })
})
