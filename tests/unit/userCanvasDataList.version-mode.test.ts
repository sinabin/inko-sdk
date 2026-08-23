/**
 * UserCanvasDataList — 버전 이력 모드(isVersionHistoryMode) 단위 테스트.
 *
 * 2026-05-31 신규 기능 회귀 스펙:
 *  - 버전 모드: 현재 편집 버전(currentEditCanvasId)은 선택 표시되고 이어서 편집 버튼이 없음
 *  - 버전 선택은 radio처럼 항상 정확히 하나 — 선택 항목 재클릭으로 0개가 될 수 없음
 *  - 과거 버전 미리보기 중에는 해당 버전만 선택 표시하고, 현재 편집본 클릭으로 복귀
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
  it('현재 버전(v2)은 유일한 선택, 과거 버전(v1)은 이어서 편집 가능', () => {
    const onToggleVisibility = vi.fn()
    const onLoadHistory = vi.fn()
    const el = render({
      userCanvasData: [makeItem('v2', { enabled: true }), makeItem('v1')],
      isVisible: true,
      currentEditCanvasId: 'v2',
      isVersionHistoryMode: true,
      onToggleVisibility,
      onLoadHistory
    })

    const items = Array.from(el.querySelectorAll('.list-item')) as HTMLElement[]
    expect(items.length).toBe(2)
    const [v2, v1] = items

    // v2 = 편집 중: 최신 상태가 선택됐음을 체크 아이콘으로 명확히 표시
    expect(v2.classList.contains('current')).toBe(true)
    expect(v2.querySelector('.visibility-indicator.visible')).not.toBeNull()
    expect(v2.querySelector('.load-btn')).toBeNull()
    expect(v2.getAttribute('role')).toBe('radio')
    expect(v2.getAttribute('aria-checked')).toBe('true')
    expect(el.querySelectorAll('.visibility-indicator.visible')).toHaveLength(1)

    // v1 = 과거 버전: 체크박스 + '이어서 편집'
    expect(v1.querySelector('.editing-badge')).toBeNull()
    expect(v1.querySelector('.visibility-indicator')).not.toBeNull()
    expect(v1.querySelector('.load-btn')?.textContent?.trim()).toBe('이어서 편집')

    // 컴포넌트는 재클릭 의도를 전달하고, 부모의 버전 단일 선택 정책이 false를 무시한다.
    v2.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('v2', false)

    // 다른 버전 클릭은 단일 선택 전환을 부모에 요청
    v1.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('v1', true)

    // '이어서 편집' — 카드 토글로 전파되지 않음 (stopPropagation 계약)
    ;(v1.querySelector('.load-btn') as HTMLElement).click()
    flushSync()
    expect(onLoadHistory).toHaveBeenCalledWith('v1')
    expect(onToggleVisibility).toHaveBeenCalledTimes(2)
  })

  it('과거 버전(v1) 선택 중에는 하나만 체크되고 재클릭으로 선택 해제되지 않음', () => {
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

    // 화면에서 숨겨진 현재 버전은 선택 해제되고 v1만 선택 표시
    expect(v2.classList.contains('current')).toBe(false)
    expect(v2.querySelector('.visibility-indicator')).not.toBeNull()
    expect(v1.classList.contains('enabled')).toBe(true)
    expect(v1.querySelector('.visibility-indicator.visible')).not.toBeNull()
    expect(el.querySelectorAll('.visibility-indicator.visible')).toHaveLength(1)

    // 선택된 v1 재클릭 의도(false)는 부모가 무시하여 0개 선택을 방지한다.
    v1.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('v1', false)

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

    // 협업 레이어는 버전 radio와 달리 개별 OFF가 허용됨
    u1.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('u1', false)

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
