/**
 * canvasHistoryStore 단위 테스트 — append/load round-trip · 버전 관리 · 에러 전파
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadHistory, appendHistory, clearHistory, toUserCanvasInfoList } from '../../src/lib/storage/canvasHistoryStore'

describe('canvasHistoryStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('빈 파일명은 빈 배열 반환', () => {
    expect(loadHistory('')).toEqual([])
  })

  it('append → load round-trip', () => {
    const entry = appendHistory('a.pdf', '{"1":"data"}')
    expect(entry.version).toBe(1)
    expect(entry.canvasData).toBe('{"1":"data"}')

    const loaded = loadHistory('a.pdf')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].canvasId).toBe(entry.canvasId)
    expect(loaded[0].canvasData).toBe('{"1":"data"}')
  })

  it('여러 버전 누적 — 최신이 앞에', () => {
    appendHistory('a.pdf', 'v1')
    appendHistory('a.pdf', 'v2')
    const entry3 = appendHistory('a.pdf', 'v3')

    expect(entry3.version).toBe(3)
    const loaded = loadHistory('a.pdf')
    expect(loaded.map(e => e.canvasData)).toEqual(['v3', 'v2', 'v1'])
    expect(loaded.map(e => e.version)).toEqual([3, 2, 1])
  })

  it('파일별로 이력이 격리됨', () => {
    appendHistory('a.pdf', 'A')
    appendHistory('b.pdf', 'B')
    expect(loadHistory('a.pdf')[0].canvasData).toBe('A')
    expect(loadHistory('b.pdf')[0].canvasData).toBe('B')
  })

  it('공개 overlay canonical 필드로 변환', () => {
    const entry = appendHistory('a.pdf', '{}')
    const [item] = toUserCanvasInfoList([entry])
    expect(item).toMatchObject({
      canvasId: entry.canvasId,
      userId: 'local',
      canvasData: '{}',
      enabled: false
    })
    expect(item.registeredAt).toBe(entry.registeredAt)
    expect(Object.keys(item).sort()).toEqual([
      'canvasData', 'canvasId', 'color', 'enabled', 'registeredAt', 'userId', 'userName'
    ])
  })

  it('clearHistory가 특정 파일만 삭제', () => {
    appendHistory('a.pdf', 'A')
    appendHistory('b.pdf', 'B')
    clearHistory('a.pdf')
    expect(loadHistory('a.pdf')).toEqual([])
    expect(loadHistory('b.pdf')).toHaveLength(1)
  })

  it('손상된 JSON은 빈 배열로 폴백', () => {
    localStorage.setItem('pdfv_canvas_history:bad.pdf', '{not json')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(loadHistory('bad.pdf')).toEqual([])
    warnSpy.mockRestore()
  })

  it('quota 초과 시 명시적 에러를 throw — silent failure 차단', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new DOMException('quota', 'QuotaExceededError')
      throw err
    })
    expect(() => appendHistory('q.pdf', 'data')).toThrowError(/저장 공간/)
    setItemSpy.mockRestore()
  })

  it('일반 setItem 실패 시도 throw (quota 아닌 경우)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('write failed')
    })
    expect(() => appendHistory('e.pdf', 'data')).toThrowError(/로컬 저장 실패/)
    setItemSpy.mockRestore()
  })
})
