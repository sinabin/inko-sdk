const TOOLBAR_CONTROL_SELECTOR = [
  'button:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])'
].join(',')

function isAvailableControl(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden]')) return false
  if (element.getAttribute('aria-hidden') === 'true') return false
  if (element.closest('[aria-hidden="true"]')) return false
  if (element.style.display === 'none' || element.style.visibility === 'hidden') return false

  if (typeof getComputedStyle === 'function') {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

/** 현재 툴바에서 키보드로 이동할 수 있는 제어 목록 반환 */
export function getToolbarControls(toolbar: HTMLElement): HTMLElement[] {
  return Array.from(toolbar.querySelectorAll<HTMLElement>(TOOLBAR_CONTROL_SELECTOR))
    .filter(isAvailableControl)
}

/** 툴바의 Tab 진입점을 하나로 정규화 */
export function normalizeToolbarTabStop(toolbar: HTMLElement): HTMLElement | null {
  const allControls = Array.from(toolbar.querySelectorAll<HTMLElement>(
    'button, [role="button"]'
  ))
  const controls = getToolbarControls(toolbar)
  if (controls.length === 0) return null

  const active = controls.find(control => control.tabIndex === 0) ?? controls[0]
  for (const control of allControls) control.tabIndex = control === active ? 0 : -1
  return active
}

function moveFocus(event: KeyboardEvent, toolbar: HTMLElement): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return

  const controls = getToolbarControls(toolbar)
  const target = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>(TOOLBAR_CONTROL_SELECTOR)
    : null
  if (!target || !controls.includes(target)) return

  const currentIndex = controls.indexOf(target)
  let nextIndex: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % controls.length
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + controls.length) % controls.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = controls.length - 1
  }

  if (nextIndex === null) return
  event.preventDefault()
  event.stopPropagation()
  for (const control of controls) control.tabIndex = -1
  controls[nextIndex].tabIndex = 0
  controls[nextIndex].focus()
}

/** 분리된 툴바 그룹을 하나의 roving-tabindex 툴바로 연결하는 Svelte action */
export function toolbarRovingGroup(node: HTMLElement): { destroy(): void } {
  const toolbar = node.closest<HTMLElement>('[role="toolbar"]')
  if (!toolbar) return { destroy() {} }

  const handleKeydown = (event: KeyboardEvent) => moveFocus(event, toolbar)
  const handleFocusIn = (event: FocusEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !getToolbarControls(toolbar).includes(target)) return
    for (const control of getToolbarControls(toolbar)) control.tabIndex = control === target ? 0 : -1
  }
  const normalize = () => normalizeToolbarTabStop(toolbar)

  node.addEventListener('keydown', handleKeydown)
  node.addEventListener('focusin', handleFocusIn)
  const observer = new MutationObserver(normalize)
  observer.observe(toolbar, {
    attributes: true,
    attributeFilter: ['disabled', 'hidden', 'style', 'aria-hidden'],
    childList: true,
    subtree: true
  })
  queueMicrotask(normalize)

  return {
    destroy() {
      observer.disconnect()
      node.removeEventListener('keydown', handleKeydown)
      node.removeEventListener('focusin', handleFocusIn)
      queueMicrotask(normalize)
    }
  }
}
