<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { PdfOutlineNode } from '../types'
  import { flattenVisibleOutline, findActiveOutlineId } from '../lib/pdf/pdfOutline'
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    /** 추출 완료된 목차 트리 — 빈 배열이면 목차 없음 안내 */
    outline: PdfOutlineNode[]
    isVisible: boolean
    /** 추출 진행 중 — 목차 유무를 아직 단정할 수 없는 구간 */
    isLoading?: boolean
    currentPage?: number
    onNavigate?: (page: number) => void
    onClose?: () => void
  }

  let {
    outline = [],
    isVisible = false,
    isLoading = false,
    currentPage = 1,
    onNavigate,
    onClose
  }: Props = $props()

  // 접힌 노드 ID — 기본은 전체 펼침 (목차는 대개 얕고, 접힘이 기본이면 탐색이 한 단계 늘어남)
  let collapsedIds = $state<Set<string>>(new Set())

  // 문서가 바뀌면(=목차 배열 교체) 접힘 상태는 의미를 잃으므로 초기화
  $effect(() => {
    outline
    collapsedIds = new Set()
  })

  const rows = $derived(flattenVisibleOutline(outline, collapsedIds))
  const activeId = $derived(findActiveOutlineId(outline, currentPage))

  /** 제목이 빈 항목도 목록에서 자리를 잃지 않도록 대체 문구 */
  function titleOf(node: PdfOutlineNode): string {
    return node.title || t('bookmark.untitled')
  }

  /** 보조기술 라벨 — 제목과 대상 페이지(또는 이동 불가 사유)를 함께 읽히게 함 */
  function labelOf(node: PdfOutlineNode): string {
    const title = titleOf(node)
    if (node.page === null) return t('bookmark.unresolved', { title })
    return t('bookmark.goToPage', { title, page: t('bookmark.pageLabel', { n: node.page }) })
  }

  function toggleCollapse(id: string): void {
    const next = new Set(collapsedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsedIds = next
  }

  function handleNavigate(node: PdfOutlineNode): void {
    if (node.page === null) return
    onNavigate?.(node.page)
  }
</script>

{#if isVisible}
  <div
    class="outline-panel"
    role="dialog"
    aria-label={t('bookmark.title')}
    transition:fly={{ x: 24, duration: 200, easing: cubicOut }}
  >
    <div class="panel-header">
      <h3>{t('bookmark.title')}</h3>
      <button class="close-btn" onclick={onClose} aria-label={t('bookmark.close')}>&times;</button>
    </div>

    {#if isLoading}
      <div class="panel-state">
        <p>{t('bookmark.loading')}</p>
      </div>
    {:else if rows.length === 0}
      <div class="panel-state">
        <p>{t('bookmark.outlineEmpty')}</p>
      </div>
    {:else}
      <ul class="outline-list">
        {#each rows as node (node.id)}
          {@const collapsed = collapsedIds.has(node.id)}
          <li
            class="outline-row"
            class:is-active={node.id === activeId}
            style:padding-left="calc(var(--space-3) + {node.depth} * var(--space-4))"
          >
            {#if node.children.length > 0}
              <button
                class="twisty"
                onclick={() => toggleCollapse(node.id)}
                aria-expanded={!collapsed}
                aria-label={collapsed
                  ? t('bookmark.expand', { title: titleOf(node) })
                  : t('bookmark.collapse', { title: titleOf(node) })}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  {#if collapsed}
                    <polyline points="9 6 15 12 9 18" />
                  {:else}
                    <polyline points="6 9 12 15 18 9" />
                  {/if}
                </svg>
              </button>
            {:else}
              <span class="twisty-spacer" aria-hidden="true"></span>
            {/if}

            <button
              class="outline-entry"
              disabled={node.page === null}
              onclick={() => handleNavigate(node)}
              title={titleOf(node)}
              aria-label={labelOf(node)}
              aria-current={node.id === activeId ? 'true' : undefined}
            >
              <span class="entry-title">{titleOf(node)}</span>
              <span class="entry-page">{node.page === null ? '—' : node.page}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .outline-panel {
    /* 목차는 탐색 도구라 표지·전면 이미지 같은 어두운 페이지 위에서도 항상 읽혀야 한다.
       공용 glass 토큰은 색을 입히지 않아(투명) 어두운 컨텐츠 위에서 대비가 무너지므로
       이 패널에만 흰 scrim으로 대비 하한을 둔다. 공용 토큰은 다른 패널과 공유되므로 건드리지 않는다. */
    --outline-scrim: rgba(255, 255, 255, 0.82);

    position: fixed;
    top: 80px;
    right: var(--space-5);
    width: 320px;
    max-height: 60vh;
    /* fallback — 솔리드 surface */
    background: var(--color-surface-subtle);
    border: 1px solid var(--color-border-subtle);
    box-shadow: var(--shadow-overlay);
    z-index: var(--z-history-panel);
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Liquid Glass — 이력 패널과 동일한 재질·위계 (우측에 떠 있는 보조 패널) */
  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .outline-panel {
      background:
        linear-gradient(var(--outline-scrim), var(--outline-scrim)),
        var(--glass-bg-strong);
      border-color: var(--glass-border);
      backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
      box-shadow: var(--shadow-glass), var(--glass-gloss);
    }
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--glass-border-subtle, var(--color-border-subtle));
    background: transparent;
    flex-shrink: 0;
  }

  .panel-header h3 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
  }

  .close-btn {
    width: 40px;
    height: 40px;
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-2xl);
    line-height: 1;
    color: var(--color-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color var(--motion-base) var(--ease-out);
  }

  .close-btn:hover { background: rgba(0, 0, 0, 0.06); }
  .close-btn:active { background: rgba(0, 0, 0, 0.10); }

  .panel-state {
    padding: var(--space-6) var(--space-4);
    text-align: center;
    color: var(--color-text-muted);
  }

  .panel-state p { margin: 0; }

  .outline-list {
    list-style: none;
    margin: 0;
    padding: var(--space-2) 0;
    overflow-y: auto;
    flex: 1;
  }

  .outline-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-3);
    border-radius: var(--radius-sm);
  }

  /* 현재 페이지가 속한 항목 — 목록이 길어져도 위치를 잃지 않도록 좌측 인디케이터로 표시 */
  .outline-row.is-active {
    background: var(--color-primary-soft, rgba(24, 144, 255, 0.10));
    box-shadow: inset 2px 0 0 var(--color-primary, #1890ff);
  }

  .twisty {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color var(--motion-base) var(--ease-out);
  }

  .twisty:hover { background: rgba(0, 0, 0, 0.06); }

  .twisty-spacer {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
  }

  .outline-entry {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1);
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-base);
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background-color var(--motion-base) var(--ease-out);
  }

  .outline-entry:hover:not(:disabled) { background: rgba(0, 0, 0, 0.05); }

  /* 대상 해석 실패 항목 — 목록에는 남기되 이동 불가임을 시각적으로 분리 */
  .outline-entry:disabled {
    cursor: default;
    color: var(--color-text-muted);
  }

  .entry-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-page {
    flex-shrink: 0;
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }

  /* 투명도 축소·고대비 선호 시 scrim을 불투명 surface로 승격 (app.css 폴백 규율과 동일) */
  @media (prefers-reduced-transparency: reduce) {
    .outline-panel { --outline-scrim: var(--color-surface); }
  }

  @media (prefers-contrast: high) {
    .outline-panel { --outline-scrim: var(--color-surface); }
  }

  .outline-list::-webkit-scrollbar { width: 8px; }
  .outline-list::-webkit-scrollbar-track { background: var(--color-border-muted); }
  .outline-list::-webkit-scrollbar-thumb {
    background: var(--color-border-divider);
    border-radius: var(--radius-sm);
  }
  .outline-list::-webkit-scrollbar-thumb:hover { background: var(--color-text-subtle); }
</style>
