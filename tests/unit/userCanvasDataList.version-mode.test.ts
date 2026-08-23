/**
 * UserCanvasDataList — 버전 이력 모드(isVersionHistoryMode) 단위 테스트.
 *
 * 2026-05-31 신규 기능 회귀 스펙:
 *  - 버전 모드: 현재 편집 버전(currentEditCanvasId)은 '편집 중' 배지 + 토글·이어서편집 제거
 *  - 과거 버전 미리보기 중(isPreviewing): 현재 항목 배지 해제 → 체크박스 복귀(클릭 = 편집본 복귀)
 *    (화면에 안 보이는 버전을 '편집 중'으로 표기하던 모순 제거 — CEO 2차 피드백 반영분)
 *  - 협업(다중 사용자 레이어) 모드: isVersionHistoryMode=false면 배지·미리보기 로직 전체 비활성
 *    (standalone 개발 이력과 공개 overlay 목록의 동작 분리)
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import UserCanvasDataList from '../../src/components/UserCanvasDataList.svelte'
import type { UserCanvasInfo } from '../../src/types'

function makeItem(id: string, overrides: Partial<UserCanvasInfo> = {}): UserCanvasInfo {
  return {
    canvasId: id,
    userName: `user-${id}`,
    userId: '',
    canvasData: '{}',
    enabled: false,
    color: '',
    registeredAt: '2026-05-31 10:00:00',
    ...overrides
  } as UserCanvasInfo
}

let target: HTMLElement | null = null
let instance: Record<string, unknown> | null = null

function render(props: Record<string, unknown>): HTMLElement {
  target = document.createElement('div')
  document.body.appendChild(target)
  instance = mount(UserCanvasDataList, { target, props: props as any }) as Record<string, unknown>
  flushSync()
  return target
}

afterEach(() => {
  if (instance) {
    unmount(instance)
    instance = null
  }
  document.body.innerHTML = ''
})

describe('버전 이력 모드 — 현재 편집 버전 표시', () => {
  it('현재 버전(v2)은 편집 중 배지·토글 불가, 과거 버전(v1)은 토글·이어서 편집 가능', () => {
    const onToggleVisibility = vi.fn()
    const onLoadHistory = vi.fn()
    const el = render({
      userCanvasData: [makeItem('v2'), makeItem('v1')],
      isVisible: true,
      currentEditCanvasId: 'v2',
      isVersionHistoryMode: true,
      onToggleVisibility,
      onLoadHistory
    })

    const items = Array.from(el.querySelectorAll('.list-item')) as HTMLElement[]
    expect(items.length).toBe(2)
    const [v2, v1] = items

    // v2 = 편집 중: 배지 표시, 체크박스·버튼 시맨틱·'이어서 편집' 제거
    expect(v2.classList.contains('current')).toBe(true)
    expect(v2.querySelector('.editing-badge')?.textContent).toBe('편집 중')
    expect(v2.querySelector('.visibility-indicator')).toBeNull()
    expect(v2.querySelector('.load-btn')).toBeNull()
    expect(v2.getAttribute('role')).toBeNull()

    // v1 = 과거 버전: 체크박스 + '이어서 편집'
    expect(v1.querySelector('.editing-badge')).toBeNull()
    expect(v1.querySelector('.visibility-indicator')).not.toBeNull()
    expect(v1.querySelector('.load-btn')?.textContent?.trim()).toBe('이어서 편집')

    // 클릭 — 편집 중(v2)은 무시, 과거(v1)는 토글
    v2.click()
    flushSync()
    expect(onToggleVisibility).not.toHaveBeenCalled()
    v1.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('v1', true)

    // '이어서 편집' — 카드 토글로 전파되지 않음 (stopPropagation 계약)
    ;(v1.querySelector('.load-btn') as HTMLElement).click()
    flushSync()
    expect(onLoadHistory).toHaveBeenCalledWith('v1')
    expect(onToggleVisibility).toHaveBeenCalledTimes(1)
  })

  it('과거 버전 미리보기 중(v1 enabled)에는 현재 버전 배지 해제 → 클릭 가능한 체크박스로 복귀', () => {
    const onToggleVisibility = vi.fn()
    const el = render({
      userCanvasData: [makeItem('v2'), makeItem('v1', { enabled: true })],
      isVisible: true,
      currentEditCanvasId: 'v2',
      isVersionHistoryMode: true,
      onToggleVisibility
    })

    const items = Array.from(el.querySelectorAll('.list-item')) as HTMLElement[]
    const [v2, v1] = items

    // 화면에서 숨겨진 현재 버전을 '편집 중'으로 표기하지 않음
    expect(el.querySelectorAll('.editing-badge').length).toBe(0)
    expect(v2.classList.contains('current')).toBe(false)
    expect(v2.querySelector('.visibility-indicator')).not.toBeNull()
    expect(v1.classList.contains('enabled')).toBe(true)

    // 현재 버전 클릭 = 편집본 복귀 토글 동작
    v2.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('v2', true)
  })
})

describe('협업(다중 사용자 레이어) 모드', () => {
  it('isVersionHistoryMode=false면 배지 없음·전 항목 토글 가능', () => {
    const onToggleVisibility = vi.fn()
    const el = render({
      userCanvasData: [makeItem('u1', { enabled: true }), makeItem('u2')],
      isVisible: true,
      isVersionHistoryMode: false,
      onToggleVisibility
    })

    expect(el.querySelectorAll('.editing-badge').length).toBe(0)
    const items = Array.from(el.querySelectorAll('.list-item')) as HTMLElement[]
    const [u1, u2] = items
    expect(u1.classList.contains('enabled')).toBe(true)

    u2.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('u2', true)
  })

  it('방어 게이트 — currentEditCanvasId가 설정돼도 모드 false면 편집 중 표시 안 함', () => {
    const el = render({
      userCanvasData: [makeItem('u1')],
      isVisible: true,
      currentEditCanvasId: 'u1',
      isVersionHistoryMode: false
    })

    expect(el.querySelectorAll('.editing-badge').length).toBe(0)
    expect(el.querySelector('.list-item')!.classList.contains('current')).toBe(false)
  })
})
