import type { UserCanvasInfo } from '../../types'

export interface ReviewHistoryState {
  entries: UserCanvasInfo[]
  currentEditCanvasId: string
  isVersionHistoryMode: boolean
}

export type ReviewHistorySource = 'public-overlay' | 'standalone-history'

export interface CreateReviewHistoryOptions {
  source: ReviewHistorySource
}

/** 공개 overlay 스키마만 수용하고 빈 ID·중복 ID·손상 canvasData를 제외 */
export function normalizeUserCanvasData(data: readonly unknown[]): UserCanvasInfo[] {
  const seen = new Set<string>()
  const result: UserCanvasInfo[] = []

  data.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const candidate = item as Record<string, unknown>
    const canvasId = typeof candidate.canvasId === 'string' ? candidate.canvasId.trim() : ''
    if (!canvasId || seen.has(canvasId) || typeof candidate.canvasData !== 'string') return

    try {
      JSON.parse(candidate.canvasData)
    } catch {
      return
    }

    seen.add(canvasId)
    result.push({
      canvasId,
      userName: typeof candidate.userName === 'string' && candidate.userName.trim()
        ? candidate.userName
        : 'Unknown',
      userId: typeof candidate.userId === 'string' ? candidate.userId : '',
      canvasData: candidate.canvasData,
      enabled: candidate.enabled === true,
      color: typeof candidate.color === 'string' ? candidate.color : '',
      registeredAt: typeof candidate.registeredAt === 'string' && candidate.registeredAt.trim()
        ? candidate.registeredAt
        : typeof candidate.regDt === 'string' && candidate.regDt.trim()
          ? candidate.regDt
          : undefined,
      isCurrent: candidate.isCurrent === true
    })
  })

  return result
}

/** 입력 출처를 명시하여 공개 검토 레이어와 로컬 버전 이력의 모드를 혼동하지 않게 구성 */
export function createReviewHistoryState(
  data: readonly unknown[],
  options: CreateReviewHistoryOptions
): ReviewHistoryState {
  const normalized = normalizeUserCanvasData(data)

  if (options.source === 'standalone-history') {
    // localStorage 이력은 isCurrent를 싣지 않지만 항상 단일 선택 버전 이력이다.
    // 실제 편집 기준은 PDF 준비 후 첫 항목을 load/continue하면서 확정된다.
    return {
      entries: normalized,
      currentEditCanvasId: '',
      isVersionHistoryMode: normalized.length > 0
    }
  }

  const current = normalized.find((item) => item.isCurrent)

  if (!current) {
    return {
      entries: normalized,
      currentEditCanvasId: '',
      isVersionHistoryMode: false
    }
  }

  return {
    entries: normalized.map((item) => ({
      ...item,
      enabled: item.canvasId === current.canvasId
    })),
    currentEditCanvasId: current.canvasId,
    isVersionHistoryMode: true
  }
}

/** 버전 모드는 단일 선택, 협업 모드는 독립 다중 선택을 적용 */
export function toggleReviewVisibility(
  state: ReviewHistoryState,
  canvasId: string,
  visible: boolean
): ReviewHistoryState {
  if (state.isVersionHistoryMode) {
    // 선택된 버전의 재클릭으로 0개 선택이 되지 않도록 유지
    if (!visible) return state
    if (!state.entries.some((entry) => entry.canvasId === canvasId)) return state

    return {
      ...state,
      entries: state.entries.map((entry) => ({
        ...entry,
        enabled: entry.canvasId === canvasId
      }))
    }
  }

  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.canvasId === canvasId ? { ...entry, enabled: visible } : entry
    )
  }
}

/** 선택한 검토본을 편집 기준으로 전환 */
export function continueEditingReview(
  state: ReviewHistoryState,
  canvasId: string
): ReviewHistoryState {
  if (!state.entries.some((entry) => entry.canvasId === canvasId)) return state

  return toggleReviewVisibility(
    { ...state, currentEditCanvasId: canvasId },
    canvasId,
    true
  )
}

/** 현재 편집 중인 검토본을 중복 렌더에서 제외한 overlay 목록 반환 */
export function getRenderableReviewEntries(state: ReviewHistoryState): UserCanvasInfo[] {
  return state.entries.filter((entry) =>
    entry.enabled && entry.canvasId !== state.currentEditCanvasId
  )
}

/** 버전 이력의 과거 시점 미리보기 여부 판정 */
export function isPreviewingReviewHistory(state: ReviewHistoryState): boolean {
  return state.isVersionHistoryMode && state.entries.some((entry) =>
    entry.enabled && entry.canvasId !== state.currentEditCanvasId
  )
}
