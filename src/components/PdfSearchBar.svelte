<script lang="ts">
  import { tick } from 'svelte'
  import type { PdfSearchState } from '../lib/pdf/pdfSearch.svelte'

  export interface PdfSearchLabels {
    region: string
    input: string
    placeholder: string
    previous: string
    next: string
    close: string
    indexing: string
    noResults: string
  }

  interface Props {
    open?: boolean
    query?: string
    state: PdfSearchState
    labels?: Partial<PdfSearchLabels>
    onQueryChange?: (query: string) => void
    onPrevious?: () => void
    onNext?: () => void
    onClose?: () => void
  }

  const DEFAULT_LABELS: PdfSearchLabels = {
    region: 'PDF 검색',
    input: '문서에서 찾기',
    placeholder: '검색어 입력',
    previous: '이전 검색 결과',
    next: '다음 검색 결과',
    close: '검색 닫기',
    indexing: '문서 검색 준비 중',
    noResults: '검색 결과 없음'
  }

  let {
    open = false,
    query = '',
    state: searchState,
    labels: labelOverrides = {},
    onQueryChange,
    onPrevious,
    onNext,
    onClose
  }: Props = $props()

  let inputElement: HTMLInputElement | null = $state(null)
  let wasOpen = false

  const labels = $derived({ ...DEFAULT_LABELS, ...labelOverrides })
  const currentNumber = $derived(searchState.currentIndex >= 0 ? searchState.currentIndex + 1 : 0)
  const hasMatches = $derived(searchState.totalMatches > 0)
  const isIndexing = $derived(searchState.status === 'indexing')
  const statusText = $derived(
    isIndexing
      ? labels.indexing
      : `${currentNumber} / ${searchState.totalMatches}`
  )

  $effect(() => {
    if (open && !wasOpen) {
      void tick().then(() => {
        inputElement?.focus()
        inputElement?.select()
      })
    }
    wasOpen = open
  })

  function handleInput(event: Event): void {
    onQueryChange?.((event.currentTarget as HTMLInputElement).value)
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (event.shiftKey) onPrevious?.()
    else onNext?.()
  }
</script>

{#if open}
  <form
    class="pdf-search-bar"
    role="search"
    aria-label={labels.region}
    onsubmit={(event) => event.preventDefault()}
  >
    <input
      bind:this={inputElement}
      data-testid="pdf-search-input"
      type="search"
      value={query}
      placeholder={labels.placeholder}
      aria-label={labels.input}
      aria-controls="inko-pdf-search-status"
      autocomplete="off"
      spellcheck="false"
      oninput={handleInput}
      onkeydown={handleKeyDown}
    />

    <output
      id="inko-pdf-search-status"
      data-testid="pdf-search-count"
      class:no-results={searchState.query.length > 0 && !hasMatches && !isIndexing}
      aria-label={searchState.query.length > 0 && !hasMatches && !isIndexing ? labels.noResults : undefined}
      aria-live="polite"
      aria-atomic="true"
    >{statusText}</output>

    <button
      type="button"
      class="result-button"
      disabled={!hasMatches}
      aria-label={labels.previous}
      title={labels.previous}
      onclick={onPrevious}
    ><span aria-hidden="true">&#8593;</span></button>
    <button
      type="button"
      class="result-button"
      disabled={!hasMatches}
      aria-label={labels.next}
      title={labels.next}
      onclick={onNext}
    ><span aria-hidden="true">&#8595;</span></button>
    <button
      type="button"
      class="close-button"
      aria-label={labels.close}
      title={labels.close}
      onclick={onClose}
    ><span aria-hidden="true">&times;</span></button>
  </form>
{/if}

<style>
  .pdf-search-bar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: min(28rem, calc(100vw - 2rem));
    padding: 0.4rem;
    border: 1px solid color-mix(in srgb, var(--color-border, #d7dce5) 86%, transparent);
    border-radius: 0.65rem;
    background: var(--color-surface, #fff);
    box-shadow: 0 0.4rem 1.2rem rgb(13 27 62 / 14%);
  }

  input {
    min-width: 0;
    flex: 1;
    height: 2.75rem;
    padding: 0 0.55rem;
    border: 1px solid var(--color-border, #d7dce5);
    border-radius: 0.4rem;
    color: var(--color-text-primary, #263247);
    background: var(--color-surface, #fff);
    font: inherit;
  }

  input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--color-primary, #e8a045);
    outline-offset: 2px;
  }

  output {
    min-width: 3.8rem;
    padding-inline: 0.3rem;
    color: var(--color-text-secondary, #667085);
    font-size: 0.78rem;
    text-align: center;
    white-space: nowrap;
  }

  output.no-results {
    min-width: 5.8rem;
  }

  button {
    display: inline-grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    border: 0;
    border-radius: 0.4rem;
    color: var(--color-text-primary, #263247);
    background: transparent;
    font: inherit;
    font-size: 1.1rem;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary, #e8a045) 14%, transparent);
  }

  button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .close-button {
    margin-left: 0.1rem;
  }

  @media (max-width: 560px) {
    .pdf-search-bar {
      min-width: calc(100vw - 1rem);
    }

    output {
      min-width: 3.2rem;
    }
  }
</style>
