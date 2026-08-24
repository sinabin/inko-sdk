import { describe, expect, it } from 'vitest'
import type { ViewerConfigPolicyState } from '../../src/lib/config/viewerConfigPolicy'
import {
  applyViewerConfigPolicy,
  normalizeEnabledTools,
  planViewerConfigUpdate
} from '../../src/lib/config/viewerConfigPolicy'

function initialState(overrides: Partial<ViewerConfigPolicyState> = {}): ViewerConfigPolicyState {
  return {
    currentTool: 'select',
    enabledTools: null,
    features: {},
    logoUrl: '',
    brushColor: '#000000',
    brushWidth: 2,
    ...overrides
  }
}

describe('viewerConfigPolicy — enabled 도구 정규화', () => {
  it('shape alias를 사각형·원·선으로 확장하고 입력 순서로 중복 제거', () => {
    expect(normalizeEnabledTools(['pen', 'shape', 'rectangle', 'pen', 'unknown'])).toEqual([
      'pen', 'rectangle', 'circle', 'line'
    ])
  })

  it('배열이 아니면 미지정(null), 빈 배열은 도구 0개로 구분', () => {
    expect(normalizeEnabledTools(undefined)).toBeNull()
    expect(normalizeEnabledTools('pen')).toBeNull()
    expect(normalizeEnabledTools([])).toEqual([])
  })
})

describe('viewerConfigPolicy — applyConfig 부분 갱신', () => {
  it('미지정 필드는 기존 상태를 유지', () => {
    const current = initialState({
      currentTool: 'pen',
      enabledTools: ['pen', 'text'],
      features: { thumbnails: false },
      logoUrl: '/brand.svg',
      brushColor: '#123456',
      brushWidth: 8
    })

    expect(applyViewerConfigPolicy(current, { locale: 'en' })).toEqual(current)
    expect(applyViewerConfigPolicy(current, { tools: { defaultColor: '#abcdef' } })).toEqual({
      ...current,
      brushColor: '#abcdef'
    })
  })

  it('새 enabled에 현재 도구가 없으면 첫 도구로 이동하고 허용된 defaultTool을 우선', () => {
    const current = initialState({ currentTool: 'eraser' })

    expect(applyViewerConfigPolicy(current, {
      tools: { enabled: ['pen', 'text'] }
    }).currentTool).toBe('pen')

    expect(applyViewerConfigPolicy(current, {
      tools: { enabled: ['pen', 'text'], defaultTool: 'text' }
    }).currentTool).toBe('text')
  })

  it('비활성 defaultTool은 무시하고 새 enabled의 첫 도구로 fallback', () => {
    const next = applyViewerConfigPolicy(initialState({ currentTool: 'eraser' }), {
      tools: { enabled: ['pen'], defaultTool: 'text' }
    })

    expect(next.currentTool).toBe('pen')
    expect(next.enabledTools).toEqual(['pen'])
  })

  it('현재 계약에서 defaultTool shape는 직접 도구가 아니므로 무시', () => {
    const next = applyViewerConfigPolicy(initialState({ currentTool: 'select' }), {
      tools: { defaultTool: 'shape' }
    })
    expect(next.currentTool).toBe('select')
  })

  it('features가 오면 현재 맵을 교체하고 미지정 키는 기본 노출 계약으로 복귀', () => {
    const next = applyViewerConfigPolicy(initialState({
      features: { thumbnails: false, zoom: false }
    }), {
      tools: { features: { save: false } }
    })

    expect(next.features).toEqual({ save: false })
  })

  it('기능 비활성화에 필요한 썸네일 닫기·목차 초기화 효과를 상태와 분리', () => {
    const result = planViewerConfigUpdate(initialState(), {
      tools: { features: { thumbnails: false, bookmarks: false } }
    }, { hasPdfDocument: true })

    expect(result.state.features).toEqual({ thumbnails: false, bookmarks: false })
    expect(result.effects).toEqual({
      hideThumbnails: true,
      outlineAction: 'reset'
    })
  })

  it('비활성 책갈피를 다시 켤 때 로드된 문서가 있을 때만 목차 새로고침을 계획', () => {
    const current = initialState({ features: { bookmarks: false } })
    const config = { tools: { features: { bookmarks: true } } }

    expect(planViewerConfigUpdate(current, config, { hasPdfDocument: true }).effects.outlineAction)
      .toBe('refresh')
    expect(planViewerConfigUpdate(current, config, { hasPdfDocument: false }).effects.outlineAction)
      .toBe('none')
  })

  it('features가 없는 부분 설정은 패널 부수효과를 만들지 않음', () => {
    expect(planViewerConfigUpdate(initialState(), {
      tools: { defaultColor: '#abcdef' }
    }, { hasPdfDocument: true }).effects).toEqual({
      hideThumbnails: false,
      outlineAction: 'none'
    })
  })

  it('로고·색상·굵기를 갱신하고 굵기는 brushSettings와 동일하게 1~50으로 제한', () => {
    const next = applyViewerConfigPolicy(initialState(), {
      theme: { logoUrl: '/next.svg' },
      tools: { defaultColor: '#e8a045', defaultWidth: 100 }
    })

    expect(next.logoUrl).toBe('/next.svg')
    expect(next.brushColor).toBe('#e8a045')
    expect(next.brushWidth).toBe(50)
  })

  it('설정이 객체가 아니면 원본 상태를 그대로 반환', () => {
    const current = initialState()
    expect(applyViewerConfigPolicy(current, null)).toBe(current)
    expect(applyViewerConfigPolicy(current, 'tools=pen')).toBe(current)
  })
})
