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
    const [v2Select, v1Select] = Array.from(el.querySelectorAll('.item-select')) as HTMLButtonElement[]

    // v2 = 편집 중: 최신 상태가 선택됐음을 체크 아이콘으로 명확히 표시
    expect(v2.classList.contains('current')).toBe(true)
    expect(v2.querySelector('.visibility-indicator.visible')).not.toBeNull()
    expect(v2.querySelector('.load-btn')).toBeNull()
    expect(v2Select.getAttribute('role')).toBe('radio')
    expect(v2Select.getAttribute('aria-checked')).toBe('true')
    expect(v2Select.tabIndex).toBe(0)
    expect(v1Select.tabIndex).toBe(-1)
    expect(el.querySelectorAll('.visibility-indicator.visible')).toHaveLength(1)

    // v1 = 과거 버전: 체크박스 + '이어서 편집'
    expect(v1.querySelector('.editing-badge')).toBeNull()
    expect(v1.querySelector('.visibility-indicator')).not.toBeNull()
    expect(v1.querySelector('.load-btn')?.textContent?.trim()).toBe('이어서 편집')
    expect(v1Select.querySelector('.load-btn')).toBeNull()
    expect(v1.querySelector(':scope > .item-actions > .load-btn')).not.toBeNull()

    // 선택된 항목을 다시 눌러도 선택 요청(true)만 전달해 0개 상태를 만들지 않는다.
    v2Select.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('v2', true)

    // 다른 버전 클릭은 단일 선택 전환을 부모에 요청
    v1Select.click()
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
    const [v2Select, v1Select] = Array.from(el.querySelectorAll('.item-select')) as HTMLButtonElement[]

    // 화면에서 숨겨진 현재 버전은 선택 해제되고 v1만 선택 표시
    expect(v2.classList.contains('current')).toBe(false)
    expect(v2.querySelector('.visibility-indicator')).not.toBeNull()
    expect(v1.classList.contains('enabled')).toBe(true)
    expect(v1.querySelector('.visibility-indicator.visible')).not.toBeNull()
    expect(el.querySelectorAll('.visibility-indicator.visible')).toHaveLength(1)

    // 선택된 v1 재클릭도 true 선택만 전달하여 0개 선택을 방지한다.
    v1Select.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('v1', true)

    // 현재 버전 클릭 = 편집본 복귀 토글 동작
    v2Select.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('v2', true)
  })

  it('라디오 구조는 roving tabindex와 방향키·Home·End 이동을 지원한다', () => {
    const onToggleVisibility = vi.fn()
    const el = render({
      userCanvasData: [makeItem('v2', { enabled: true }), makeItem('v1')],
      isVisible: true,
      currentEditCanvasId: 'v2',
      isVersionHistoryMode: true,
      onToggleVisibility
    })

    expect(el.querySelectorAll('[role="radiogroup"]')).toHaveLength(1)
    const radios = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    expect(radios).toHaveLength(2)
    expect(el.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1)
    expect(el.querySelectorAll('[role="radio"][tabindex="0"]')).toHaveLength(1)
    expect(el.querySelectorAll('[role="radio"][tabindex="-1"]')).toHaveLength(1)
    expect(radios[0].querySelector('.load-btn')).toBeNull()
    expect(radios[1].querySelector('.load-btn')).toBeNull()

    radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(onToggleVisibility).toHaveBeenLastCalledWith('v1', true)
    expect(document.activeElement).toBe(radios[1])

    radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(onToggleVisibility).toHaveBeenLastCalledWith('v1', true)
    expect(document.activeElement).toBe(radios[1])

    radios[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(onToggleVisibility).toHaveBeenLastCalledWith('v2', true)
    expect(document.activeElement).toBe(radios[0])

    radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(onToggleVisibility).toHaveBeenLastCalledWith('v1', true)
    expect(document.activeElement).toBe(radios[1])
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
    const [u1Select, u2Select] = Array.from(el.querySelectorAll('.item-select')) as HTMLButtonElement[]
    expect(u1.classList.contains('enabled')).toBe(true)
    expect(el.querySelectorAll('[role="radiogroup"], [role="radio"]')).toHaveLength(0)
    expect(u1Select.getAttribute('aria-pressed')).toBe('true')
    expect(u2Select.getAttribute('aria-pressed')).toBe('false')

    // 협업 레이어는 버전 radio와 달리 개별 OFF가 허용됨
    u1Select.click()
    flushSync()
    expect(onToggleVisibility).toHaveBeenCalledWith('u1', false)

    u2Select.click()
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
