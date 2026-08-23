<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { UserCanvasInfo } from '../types'
  import { t } from '../lib/i18n/index.svelte'

  interface Props {
    userCanvasData: UserCanvasInfo[]
    isVisible: boolean
    isReadOnly?: boolean
    /** 편집 캔버스에 로드된 현재 버전의 canvasId */
    currentEditCanvasId?: string
    /** 버전 이력 모드에서는 라디오처럼 정확히 한 항목만 선택. 기본 다중 사용자 레이어 모드는 false */
    isVersionHistoryMode?: boolean
    onToggleVisibility?: (canvasId: string, visible: boolean) => void
    onLoadHistory?: (canvasId: string) => void
    onClose?: () => void
  }

  let {
    userCanvasData = [],
    isVisible = false,
    isReadOnly = false,
    currentEditCanvasId = '',
    isVersionHistoryMode = false,
    onToggleVisibility,
    onLoadHistory,
    onClose
  }: Props = $props()

  /** Safari/WebView 호환 날짜 파싱 (yyyy-MM-dd HH:mm:ss → ISO 형식 변환) */
  function formatDate(dateStr: string | undefined): string {
    if (!dateStr) return '-'

    // yyyy-MM-dd HH:mm:ss → ISO 형식 변환 (공백을 T로 교체)
    let validDateStr = dateStr
    if (dateStr.includes(' ') && !dateStr.includes('T')) {
      validDateStr = dateStr.replace(' ', 'T')
    }

    const date = new Date(validDateStr)
    if (isNaN(date.getTime())) {
      return dateStr  // 파싱 실패 시 원본 반환
    }

    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  /** 카드 전체 클릭 = 보이기/숨기기 토글. 부모(PdfViewer)가 단일 선택 정책 적용 */
  function handleCardToggle(canvasId: string, currentVisible: boolean): void {
    onToggleVisibility?.(canvasId, !currentVisible)
  }

  /** 키보드 a11y — Enter/Space로도 토글 */
  function handleCardKeydown(event: KeyboardEvent, canvasId: string, currentVisible: boolean): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleCardToggle(canvasId, currentVisible)
    }
  }

  /** 이력을 편집 캔버스에 불러오기 — 카드 토글로 전파되지 않도록 stopPropagation */
  function handleLoadHistory(canvasId: string, event: Event): void {
    event.stopPropagation()
    onLoadHistory?.(canvasId)
  }
</script>

{#if isVisible}
  <div
    class="user-canvas-data-list"
    transition:fly={{ x: 24, duration: 320, easing: cubicOut, opacity: 0 }}
  >
    <div class="list-header">
      <h3>{t('history.title')}</h3>
      <button class="close-btn" onclick={() => onClose?.()}>
        &times;
      </button>
    </div>

    {#if userCanvasData.length === 0}
      <div class="empty-state">
        <p>{t('history.empty')}</p>
      </div>
    {:else}
      <ul class="list-content" role={isVersionHistoryMode ? 'radiogroup' : undefined}>
        {#each userCanvasData as data (data.canvasId)}
          {@const visible = data.enabled ?? false}
          {@const isCurrent = !!currentEditCanvasId && data.canvasId === currentEditCanvasId}
          {@const showAsCurrent = isVersionHistoryMode && isCurrent && visible}

          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <li
            class="list-item"
            class:enabled={visible && !showAsCurrent}
            class:current={showAsCurrent}
            role={isVersionHistoryMode ? 'radio' : 'button'}
            tabindex="0"
            aria-checked={isVersionHistoryMode ? visible : undefined}
            aria-pressed={isVersionHistoryMode ? undefined : visible}
            aria-label={isVersionHistoryMode ? data.userName : (visible ? t('history.hideUser', { name: data.userName }) : t('history.showUser', { name: data.userName }))}
            onclick={() => handleCardToggle(data.canvasId, visible)}
            onkeydown={(e) => handleCardKeydown(e, data.canvasId, visible)}
          >
            <div class="item-header">
              <span class="visibility-indicator" class:visible aria-hidden="true">
                {#if visible}
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none"/>
                    <polyline points="5 8.4 7.2 10.6 11 6.2" stroke="#fff"/>
                  </svg>
                {:else}
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6">
                    <circle cx="8" cy="8" r="6.5"/>
                  </svg>
                {/if}
              </span>
              <strong class="user-name">
                {data.userName || t('history.unknownUser')}
              </strong>
              {#if data.userId}
                <span class="user-id-chip">{data.userId}</span>
              {/if}
            </div>

            <div class="item-meta">
              <small class="created-date">
                {formatDate(data.registeredAt)}
              </small>
            </div>

            {#if !isReadOnly && !isCurrent}
              <div class="item-actions">
                <button
                  class="load-btn"
                  onclick={(e) => handleLoadHistory(data.canvasId, e)}
                >
                  {t('history.continueEdit')}
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .user-canvas-data-list {
    position: fixed;
    top: 80px;
    right: var(--space-5);
    width: 340px;
    max-height: 500px;
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

  /* Liquid Glass — 우측에 떠 있는 패널, blur는 PDF 컨텐츠를 살짝 비춰 위계 표현 */
  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .user-canvas-data-list {
      background: var(--glass-bg-strong);
      border-color: var(--glass-border);
      backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
      box-shadow: var(--shadow-glass), var(--glass-gloss);
    }
  }

  .list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--glass-border-subtle, var(--color-border-subtle));
    /* glass surface와 통합 — 헤더 자체에 솔리드 배경 두지 않음 */
    background: transparent;
    flex-shrink: 0;
  }

  .list-header h3 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
  }

  .close-btn {
    width: 40px;
    height: 40px;
    border: none;
    /* glass surface와 어울리는 ghost — 호버 시만 입체감 */
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

  .close-btn:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  .close-btn:active {
    background: rgba(0, 0, 0, 0.10);
  }

  .empty-state {
    padding: var(--space-6) var(--space-4);
    text-align: center;
    color: var(--color-text-muted);
  }

  .empty-state p {
    margin: 0;
  }

  .list-content {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }

  .list-item {
    padding: var(--space-3_5) var(--space-5);
    border-bottom: 1px solid var(--color-border-light);
    cursor: pointer;
    transition: background-color var(--motion-base) var(--ease-out);
  }

  .list-item:hover {
    background: var(--color-surface-muted);
  }

  .list-item:last-child {
    border-bottom: none;
  }

  .list-item.enabled {
    background-color: var(--blue-100);
    border-left: 3px solid var(--color-primary-strong);
  }

  .list-item.enabled:hover {
    background-color: var(--blue-100);
  }

  /* 현재 편집 중인 버전 — 선택 체크와 강조면으로 표시 */
  .list-item.current {
    background-color: var(--blue-100);
    border-left: 3px solid var(--color-primary-strong);
    cursor: default;
  }

  .list-item.current:hover {
    background-color: var(--blue-100);
  }

  .item-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }

  /* 체크박스 — SVG 아이콘. 비활성: 회색 outline / 활성: primary 채움 + 흰 체크 */
  .visibility-indicator {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-border-strong);
    flex-shrink: 0;
    transition: color var(--motion-fast) var(--ease-out);
  }

  .visibility-indicator.visible {
    color: var(--color-primary-strong);
  }

  .user-name {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
    flex: 1;
    line-height: var(--line-height-tight);
  }

  /* (local), userId 등 부가 라벨 — chip 스타일로 후퇴 */
  .user-id-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--space-1_5);
    background: var(--color-surface-muted);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: var(--font-weight-regular);
    border-radius: var(--radius-sm);
    line-height: 1.4;
    flex-shrink: 0;
  }

  .item-meta {
    margin-left: 26px;
    margin-bottom: var(--space-2);
  }

  .created-date {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .item-actions {
    margin-left: 26px;
    display: flex;
    gap: var(--space-2);
  }

  /* "이어서 편집" — 1차 액션: filled save */
  .load-btn {
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
    border: 1px solid var(--color-action-save);
    background: var(--color-action-save);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--motion-base) var(--ease-out);
    color: var(--color-text-inverse);
    min-height: 40px;
    box-shadow: var(--shadow-save-action);
  }

  .load-btn:hover {
    background: var(--color-action-save-hover);
    border-color: var(--color-action-save-hover);
    box-shadow: var(--shadow-save-action-hover);
    transform: translateY(-1px);
  }

  .load-btn:active {
    transform: translateY(0);
    box-shadow: var(--shadow-save-action);
  }

  /* 카드 자체가 토글 버튼 — 키보드 포커스 ring */
  .list-item:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
  }

</style>
