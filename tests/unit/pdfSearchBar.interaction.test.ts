import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import PdfSearchBar from '../../src/components/PdfSearchBar.svelte'
import type { PdfSearchState } from '../../src/lib/pdf/pdfSearch.svelte'

let instance: Record<string, unknown> | null = null

afterEach(() => {
  if (instance) unmount(instance)
  instance = null
  document.body.innerHTML = ''
})

describe('PdfSearchBar keyboard interaction', () => {
  it('검색 입력·앞뒤 이동·Escape 닫기와 trigger 포커스 복귀를 연결한다', async () => {
    const trigger = document.createElement('button')
    trigger.dataset.testid = 'pdf-search-open'
    document.body.appendChild(trigger)
    trigger.focus()

    const target = document.createElement('div')
    document.body.appendChild(target)
    const onQueryChange = vi.fn()
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    const onClose = vi.fn()
    const state: PdfSearchState = {
      status: 'ready',
      query: 'needle',
      caseSensitive: false,
      matches: [],
      currentIndex: 0,
      currentMatch: null,
      totalMatches: 2,
      wrapped: false,
      indexedPages: 3,
      failedPages: []
    }

    instance = mount(PdfSearchBar, {
      target,
      props: {
        open: true,
        query: 'needle',
        state,
        onQueryChange,
        onPrevious,
        onNext,
        onClose
      }
    }) as Record<string, unknown>
    flushSync()
    await tick()

    const input = target.querySelector<HTMLInputElement>('[data-testid="pdf-search-input"]')!
    expect(document.activeElement).toBe(input)
    expect(target.querySelector('[role="search"]')?.getAttribute('aria-label')).toBe('PDF 검색')
    expect(target.querySelector('output')?.textContent).toBe('1 / 2')

    input.value = 'updated'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    expect(onQueryChange).toHaveBeenCalledWith('updated')
    expect(onNext).toHaveBeenCalledOnce()
    expect(onPrevious).toHaveBeenCalledOnce()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledOnce()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(trigger)
  })
})
