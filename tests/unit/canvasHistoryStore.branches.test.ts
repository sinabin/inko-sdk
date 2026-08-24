import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendHistory, clearHistory, loadHistory } from '../../src/lib/storage/canvasHistoryStore'

const key = (name: string) => `pdfv_canvas_history:${name}`

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('canvasHistoryStore defensive branches', () => {
  it('returns an empty history for a missing key or a valid non-array payload', () => {
    expect(loadHistory('missing.pdf')).toEqual([])
    localStorage.setItem(key('object.pdf'), JSON.stringify({ entries: [] }))
    expect(loadHistory('object.pdf')).toEqual([])
  })

  it('treats a legacy entry without a version as version zero', () => {
    localStorage.setItem(key('legacy.pdf'), JSON.stringify([{
      canvasId: 'legacy', userName: 'Local User', userId: 'local',
      canvasData: '{}', registeredAt: '2020-01-01 00:00:00'
    }]))

    expect(appendHistory('legacy.pdf', '{"1":"new"}').version).toBe(1)
  })

  it('recognizes the legacy DOM quota code even when the exception name differs', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const error = new DOMException('legacy quota', 'UnknownError')
      Object.defineProperty(error, 'code', { configurable: true, value: 22 })
      throw error
    })

    expect(() => appendHistory('quota.pdf', '{}')).toThrow(/storage space|space|\uc800\uc7a5 \uacf5\uac04/i)
  })

  it('does not call storage removal for an empty filename', () => {
    const remove = vi.spyOn(Storage.prototype, 'removeItem')
    clearHistory('')
    expect(remove).not.toHaveBeenCalled()
  })
})
