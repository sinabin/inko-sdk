import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getToolbarControls,
  normalizeToolbarTabStop,
  toolbarRovingGroup
} from '../../src/lib/accessibility/toolbarRoving'

function createToolbar(): { toolbar: HTMLElement; groups: HTMLElement[]; buttons: HTMLButtonElement[] } {
  const toolbar = document.createElement('div')
  toolbar.setAttribute('role', 'toolbar')
  const groups = [document.createElement('div'), document.createElement('div')]
  const buttons = ['one', 'two', 'three'].map(name => {
    const button = document.createElement('button')
    button.textContent = name
    return button
  })
  groups[0].append(buttons[0], buttons[1])
  groups[1].append(buttons[2])
  toolbar.append(...groups)
  document.body.append(toolbar)
  return { toolbar, groups, buttons }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('toolbar roving tabindex', () => {
  it('활성 제어만 포함하고 Tab 진입점을 하나로 정규화한다', () => {
    const { toolbar, buttons } = createToolbar()
    buttons[1].disabled = true
    buttons[2].style.display = 'none'

    expect(getToolbarControls(toolbar)).toEqual([buttons[0]])
    expect(normalizeToolbarTabStop(toolbar)).toBe(buttons[0])
    expect(buttons[0].tabIndex).toBe(0)
    expect(buttons[1].tabIndex).toBe(-1)
  })

  it('방향키와 Home/End로 그룹 경계를 넘어 포커스를 이동한다', async () => {
    const { groups, buttons } = createToolbar()
    const actions = groups.map(group => toolbarRovingGroup(group))
    await Promise.resolve()

    expect(buttons.map(button => button.tabIndex)).toEqual([0, -1, -1])
    buttons[0].focus()
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement).toBe(buttons[1])
    expect(buttons.map(button => button.tabIndex)).toEqual([-1, 0, -1])

    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(document.activeElement).toBe(buttons[2])

    buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement).toBe(buttons[0])

    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(document.activeElement).toBe(buttons[2])

    buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(document.activeElement).toBe(buttons[0])
    actions.forEach(action => action.destroy())
  })

  it('마우스로 포커스한 제어를 다음 Tab 진입점으로 유지한다', async () => {
    const { groups, buttons } = createToolbar()
    const actions = groups.map(group => toolbarRovingGroup(group))
    await Promise.resolve()

    buttons[2].focus()
    expect(buttons.map(button => button.tabIndex)).toEqual([-1, -1, 0])
    actions.forEach(action => action.destroy())
  })
})
