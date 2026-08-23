/**
 * i18n 단위 테스트 — 고객 커스터마이징 API(applyConfig의 locale/messages 경로) 코어.
 *
 * 주의: lib/i18n은 모듈 레벨 $state(locale·overrides)이고 리셋 API가 없다(운영 코드에 불필요).
 *       override 변이 테스트는 파일 마지막 describe에 배치해 순서 의존을 명시적으로 관리한다.
 */
import { describe, it, expect } from 'vitest'
import { t, setLocale, setMessages, currentLocale } from '../../src/lib/i18n/index.svelte'

describe('i18n — 기본 동작 (ko 기본 로케일)', () => {
  it('기본 로케일은 ko — t()가 한국어 문구 반환', () => {
    expect(currentLocale()).toBe('ko')
    expect(t('tool.pen')).toBe('펜')
    expect(t('toolbar.save')).toBe('저장')
  })

  it('미등록 키는 키 원문 반환 (UI가 빈 문자열로 깨지지 않음)', () => {
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('{name} 자리표시자 치환', () => {
    expect(t('history.hideUser', { name: '김팀장' })).toBe('김팀장 숨기기')
  })
})

describe('i18n — 로케일 전환 (applyConfig locale 경로)', () => {
  it('setLocale(en) → 내장 영어 카탈로그 반환', () => {
    setLocale('en')
    expect(currentLocale()).toBe('en')
    expect(t('tool.pen')).toBe('Pen')
    expect(t('toolbar.save')).toBe('Save')
  })

  it('내장에 없는 로케일은 ko 사전으로 폴백', () => {
    setLocale('fr')
    expect(t('tool.pen')).toBe('펜')
  })

  it('빈 문자열·null·undefined 로케일은 무시 — 현재 로케일 유지', () => {
    setLocale('en')
    setLocale('')
    setLocale(null)
    setLocale(undefined)
    expect(currentLocale()).toBe('en')
    setLocale('ko') // 이후 describe를 위해 기본값 복원
  })
})

describe('i18n — 고객 메시지 오버라이드 (applyConfig messages 경로 · 파일 마지막 배치)', () => {
  it('override가 내장 사전보다 우선 — 로케일과 무관하게 최우선', () => {
    setMessages({ 'tool.pen': 'Stylo' })
    expect(t('tool.pen')).toBe('Stylo') // ko 상태
    setLocale('en')
    expect(t('tool.pen')).toBe('Stylo') // en으로 바꿔도 override 우선
  })

  it('override는 키별 병합 — 지정하지 않은 키는 영향 없음', () => {
    expect(t('tool.eraser')).toBe('Eraser') // 현재 en
  })

  it('비객체 setMessages는 무시 (기존 override 보존)', () => {
    setMessages(null)
    setMessages(undefined)
    expect(t('tool.pen')).toBe('Stylo')
  })

  it('override·내장 어디에도 없는 키는 키 원문 폴백 유지', () => {
    expect(t('zz.totally.unknown')).toBe('zz.totally.unknown')
  })
})
