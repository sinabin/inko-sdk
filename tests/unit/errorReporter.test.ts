/**
 * errorReporter 단위 테스트 — 토스트 큐·자동 dismiss·상세 포맷
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { errorReporter, reportError, reportWarning, reportInfo } from '../../src/lib/utils/errorReporter.svelte'

describe('errorReporter', () => {
  beforeEach(() => {
    errorReporter.__resetForTesting()
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reportError가 큐에 항목을 추가하고 console.error 호출', () => {
    reportError('parse', '읽기 실패', new Error('boom'))
    expect(errorReporter.items).toHaveLength(1)
    expect(errorReporter.items[0]).toMatchObject({
      kind: 'error',
      category: 'parse',
      message: '읽기 실패',
      detail: 'Error: boom'
    })
    expect(console.error).toHaveBeenCalled()
  })

  it('reportWarning는 warning 종류로 추가', () => {
    reportWarning('bridge', '미연결')
    expect(errorReporter.items[0].kind).toBe('warning')
    expect(console.warn).toHaveBeenCalled()
  })

  it('reportInfo는 info 종류로 추가, console 출력 없음', () => {
    reportInfo('저장됨')
    expect(errorReporter.items[0].kind).toBe('info')
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('자동 dismiss 타임아웃 후 큐에서 제거', () => {
    reportError('parse', 'A')
    expect(errorReporter.items).toHaveLength(1)
    vi.advanceTimersByTime(7000)
    expect(errorReporter.items).toHaveLength(0)
  })

  it('수동 dismiss로 즉시 제거', () => {
    reportError('parse', 'A')
    const id = errorReporter.items[0].id
    errorReporter.dismiss(id)
    expect(errorReporter.items).toHaveLength(0)
  })

  it('detail이 문자열·객체·null일 때 적절히 포맷', () => {
    reportError('parse', 'a', 'string detail')
    reportError('parse', 'b', { foo: 'bar' })
    reportError('parse', 'c')
    expect(errorReporter.items[0].detail).toBe('string detail')
    expect(errorReporter.items[1].detail).toBe('{"foo":"bar"}')
    expect(errorReporter.items[2].detail).toBeUndefined()
  })

  it('여러 항목이 큐에 동시 보유 가능', () => {
    reportError('parse', 'A')
    reportWarning('bridge', 'B')
    reportInfo('C')
    expect(errorReporter.items).toHaveLength(3)
    expect(errorReporter.items.map(t => t.kind)).toEqual(['error', 'warning', 'info'])
  })
})
