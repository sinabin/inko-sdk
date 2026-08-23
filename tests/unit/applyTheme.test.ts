/**
 * applyTheme 단위 테스트 — 고객 커스터마이징 API(applyConfig의 theme 경로).
 *
 * 계약: primitive 토큰(--blue/green/purple)을 덮어 semantic 토큰이 자동 파생되고,
 *       var()를 거치지 않는 하드코딩 semantic 토큰(--color-primary 등)은 직접 덮는다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { applyTheme } from '../../src/lib/config/applyTheme'

const rootStyle = () => document.documentElement.style

describe('applyTheme — 테마/화이트라벨 CSS 변수 주입', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('primaryColor → primitive(--blue-*)와 semantic(--color-primary*) 동시 오버라이드', () => {
    applyTheme({ primaryColor: '#e8a045' })
    for (const v of ['--blue-500', '--blue-600', '--blue-700', '--color-primary', '--color-primary-hover', '--color-primary-strong']) {
      expect(rootStyle().getPropertyValue(v), v).toBe('#e8a045')
    }
  })

  it('saveColor / historyColor → 각 채널 토큰만 오버라이드', () => {
    applyTheme({ saveColor: '#0d1b3e', historyColor: '#06c4d8' })
    expect(rootStyle().getPropertyValue('--green-500')).toBe('#0d1b3e')
    expect(rootStyle().getPropertyValue('--color-action-save')).toBe('#0d1b3e')
    expect(rootStyle().getPropertyValue('--purple-500')).toBe('#06c4d8')
    expect(rootStyle().getPropertyValue('--color-history')).toBe('#06c4d8')
  })

  it('cssVars 이스케이프 해치 — "--" 접두 자동 보정 포함 임의 토큰 직접 오버라이드', () => {
    applyTheme({ cssVars: { '--radius-md': '12px', 'color-surface': '#fafafa' } })
    expect(rootStyle().getPropertyValue('--radius-md')).toBe('12px')
    expect(rootStyle().getPropertyValue('--color-surface')).toBe('#fafafa')
  })

  it('부분 지정 — 지정하지 않은 채널 토큰은 건드리지 않음', () => {
    applyTheme({ primaryColor: '#111111' })
    expect(rootStyle().getPropertyValue('--color-action-save')).toBe('')
    expect(rootStyle().getPropertyValue('--color-history')).toBe('')
  })

  it('빈 문자열 값은 무시 — 토큰 미설정', () => {
    applyTheme({ primaryColor: '', cssVars: { '--radius-md': '' } })
    expect(rootStyle().getPropertyValue('--color-primary')).toBe('')
    expect(rootStyle().getPropertyValue('--radius-md')).toBe('')
  })

  it('null/undefined/비객체 입력은 no-op (예외 없음)', () => {
    expect(() => applyTheme(undefined)).not.toThrow()
    expect(() => applyTheme(null)).not.toThrow()
    expect(() => applyTheme('red' as unknown as Parameters<typeof applyTheme>[0])).not.toThrow()
    expect(rootStyle().getPropertyValue('--color-primary')).toBe('')
  })
})
