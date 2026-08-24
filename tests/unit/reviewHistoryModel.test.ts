import { describe, expect, it } from 'vitest'
import {
  continueEditingReview,
  createReviewHistoryState,
  getRenderableReviewEntries,
  isPreviewingReviewHistory,
  normalizeUserCanvasData,
  toggleReviewVisibility
} from '../../src/lib/history/reviewHistoryModel'

const emptyCanvasData = JSON.stringify({})
const publicOverlay = { source: 'public-overlay' } as const
const standaloneHistory = { source: 'standalone-history' } as const

function review(canvasId: string, overrides: Record<string, unknown> = {}) {
  return {
    canvasId,
    userName: `user-${canvasId}`,
    canvasData: emptyCanvasData,
    enabled: false,
    ...overrides
  }
}

describe('reviewHistoryModel — 공개 검토본 정규화', () => {
  it('빈·중복 ID, 비문자열·손상 canvasData를 제외', () => {
    const normalized = normalizeUserCanvasData([
      review('v1'),
      review(' v1 ', { userName: 'duplicate' }),
      review('', { userName: 'empty' }),
      review('bad-type', { canvasData: {} }),
      review('bad-json', { canvasData: '{broken' })
    ])

    expect(normalized.map((entry) => entry.canvasId)).toEqual(['v1'])
  })

  it('사용자·색상·날짜 폴백과 regDt 레거시 alias를 유지', () => {
    const [entry] = normalizeUserCanvasData([
      review('v1', { userName: ' ', userId: 10, color: null, regDt: '2026-08-24' })
    ])

    expect(entry).toMatchObject({
      canvasId: 'v1',
      userName: 'Unknown',
      userId: '',
      color: '',
      registeredAt: '2026-08-24',
      isCurrent: false
    })
  })
})

describe('reviewHistoryModel — 버전 이력 단일 선택', () => {
  it('첫 isCurrent 항목을 편집 기준으로 삼고 enabled 값과 무관하게 하나만 선택', () => {
    const state = createReviewHistoryState([
      review('v2', { isCurrent: true, enabled: false }),
      review('v1', { isCurrent: true, enabled: true })
    ], publicOverlay)

    expect(state.isVersionHistoryMode).toBe(true)
    expect(state.currentEditCanvasId).toBe('v2')
    expect(state.entries.map((entry) => [entry.canvasId, entry.enabled])).toEqual([
      ['v2', true], ['v1', false]
    ])
  })

  it('과거 버전 선택 시 항상 하나만 표시하고 재클릭 해제를 무시', () => {
    const initial = createReviewHistoryState([
      review('v2', { isCurrent: true }),
      review('v1')
    ], publicOverlay)
    const past = toggleReviewVisibility(initial, 'v1', true)
    const unchecked = toggleReviewVisibility(past, 'v1', false)

    expect(past.entries.filter((entry) => entry.enabled).map((entry) => entry.canvasId)).toEqual(['v1'])
    expect(unchecked).toBe(past)
    expect(isPreviewingReviewHistory(past)).toBe(true)
  })

  it('이어서 편집하면 선택한 버전이 현재 기준이 되고 overlay 중복에서 제외', () => {
    const initial = createReviewHistoryState([
      review('v2', { isCurrent: true }),
      review('v1')
    ], publicOverlay)
    const resumed = continueEditingReview(initial, 'v1')

    expect(resumed.currentEditCanvasId).toBe('v1')
    expect(resumed.entries.filter((entry) => entry.enabled).map((entry) => entry.canvasId)).toEqual(['v1'])
    expect(getRenderableReviewEntries(resumed)).toEqual([])
    expect(isPreviewingReviewHistory(resumed)).toBe(false)
  })
})

describe('reviewHistoryModel — 협업 레이어 다중 선택', () => {
  it('isCurrent가 없으면 기존 enabled를 보존하고 항목별로 독립 토글', () => {
    const initial = createReviewHistoryState([
      review('alice', { enabled: true }),
      review('bob', { enabled: false })
    ], publicOverlay)
    const both = toggleReviewVisibility(initial, 'bob', true)

    expect(initial.isVersionHistoryMode).toBe(false)
    expect(initial.currentEditCanvasId).toBe('')
    expect(both.entries.filter((entry) => entry.enabled).map((entry) => entry.canvasId)).toEqual([
      'alice', 'bob'
    ])
    expect(getRenderableReviewEntries(both).map((entry) => entry.canvasId)).toEqual([
      'alice', 'bob'
    ])
  })

  it('협업 모드에서 한 검토본을 이어서 편집해도 다른 활성 레이어는 유지', () => {
    const initial = createReviewHistoryState([
      review('alice', { enabled: true }),
      review('bob', { enabled: true })
    ], publicOverlay)
    const resumed = continueEditingReview(initial, 'bob')

    expect(resumed.currentEditCanvasId).toBe('bob')
    expect(resumed.entries.every((entry) => entry.enabled)).toBe(true)
    expect(getRenderableReviewEntries(resumed).map((entry) => entry.canvasId)).toEqual(['alice'])
  })
})

describe('reviewHistoryModel — standalone localStorage 버전 이력', () => {
  it('isCurrent가 없어도 항목이 있으면 협업이 아닌 단일 선택 버전 모드로 구성', () => {
    const initial = createReviewHistoryState([
      review('v2'),
      review('v1')
    ], standaloneHistory)

    expect(initial.isVersionHistoryMode).toBe(true)
    expect(initial.currentEditCanvasId).toBe('')
    expect(initial.entries.every((entry) => !entry.enabled)).toBe(true)

    const loadedLatest = continueEditingReview(initial, 'v2')
    expect(loadedLatest.currentEditCanvasId).toBe('v2')
    expect(loadedLatest.entries.map((entry) => [entry.canvasId, entry.enabled])).toEqual([
      ['v2', true], ['v1', false]
    ])
  })

  it('저장 이력이 비어 있으면 버전 모드를 활성화하지 않음', () => {
    expect(createReviewHistoryState([], standaloneHistory).isVersionHistoryMode).toBe(false)
  })
})
