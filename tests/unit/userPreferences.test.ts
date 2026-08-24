import { afterEach, describe, expect, it, vi } from 'vitest'
import { motionDuration } from '../../src/lib/accessibility/userPreferences'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('motionDuration', () => {
  it('모션 축소를 선호하면 트랜지션을 제거한다', () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    vi.stubGlobal('window', { matchMedia })

    expect(motionDuration(320)).toBe(0)
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  it('모션 축소를 선호하지 않으면 요청 시간을 유지한다', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn(() => ({ matches: false }) as MediaQueryList)
    })

    expect(motionDuration(200)).toBe(200)
  })

  it('브라우저 또는 matchMedia가 없으면 요청 시간을 안전하게 유지한다', () => {
    vi.stubGlobal('window', undefined)
    expect(motionDuration(160)).toBe(160)

    vi.stubGlobal('window', {})
    expect(motionDuration(80)).toBe(80)
  })
})
