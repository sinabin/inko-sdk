/** 도구 모드에 따른 touch-action CSS 동적 전환 관리 */

export type TouchActionMode = 'scroll' | 'edit' | 'none'

export interface TouchActionManager {
  setMode: (mode: TouchActionMode) => void // 터치 액션 모드 설정
  getMode: () => TouchActionMode // 현재 모드 반환
  setElement: (element: HTMLElement | null) => void // 대상 요소 설정
  dispose: () => void // 리소스 정리
}

/** 모드별 touch-action CSS 값 매핑 */
const TOUCH_ACTION_VALUES: Record<TouchActionMode, string> = {
  scroll: 'pan-y pan-x',
  edit: 'none',
  none: 'auto'
}

/** TouchActionManager 인스턴스 생성 */
export function createTouchActionManager(): TouchActionManager {
  let currentMode: TouchActionMode = 'scroll'
  let targetElement: HTMLElement | null = null

  /** 요소에 touch-action 스타일 적용 (!important로 호스트 CSS 우선순위 문제 해결) */
  function applyTouchAction(element: HTMLElement, value: string): void {
    element.style.setProperty('touch-action', value, 'important')

    // 터치 스크롤 호환성을 위한 추가 스타일
    if (value === 'none') {
      element.style.setProperty('-webkit-user-select', 'none', 'important')
      element.style.setProperty('user-select', 'none', 'important')
    } else {
      element.style.removeProperty('-webkit-user-select')
      element.style.removeProperty('user-select')
    }
  }

  /** 터치 액션 모드 설정 */
  function setMode(mode: TouchActionMode): void {
    currentMode = mode

    if (targetElement) {
      const value = TOUCH_ACTION_VALUES[mode]
      applyTouchAction(targetElement, value)
    }
  }

  /** 현재 모드 반환 */
  function getMode(): TouchActionMode {
    return currentMode
  }

  /** 대상 요소 설정 (이전 요소 스타일 정리 후 새 요소에 현재 모드 적용) */
  function setElement(element: HTMLElement | null): void {
    // 이전 요소 정리
    if (targetElement) {
      targetElement.style.removeProperty('touch-action')
      targetElement.style.removeProperty('-webkit-user-select')
      targetElement.style.removeProperty('user-select')
    }

    targetElement = element

    // 새 요소에 현재 모드 적용
    if (element) {
      const value = TOUCH_ACTION_VALUES[currentMode]
      applyTouchAction(element, value)
    }
  }

  /** 리소스 정리 */
  function dispose(): void {
    if (targetElement) {
      targetElement.style.removeProperty('touch-action')
      targetElement.style.removeProperty('-webkit-user-select')
      targetElement.style.removeProperty('user-select')
    }
    targetElement = null
  }

  return {
    setMode,
    getMode,
    setElement,
    dispose
  }
}

/** 전역 TouchActionManager 싱글톤 반환 */
let globalManager: TouchActionManager | null = null

export function getGlobalTouchActionManager(): TouchActionManager {
  if (!globalManager) {
    globalManager = createTouchActionManager()
  }
  return globalManager
}

/** 부모 요소의 자식들에 touch-action 전파 */
export function propagateTouchAction(
  parent: HTMLElement,
  value: string,
  selector?: string
): void {
  const elements = selector
    ? parent.querySelectorAll<HTMLElement>(selector)
    : [parent]

  elements.forEach(el => {
    el.style.setProperty('touch-action', value, 'important')
  })
}

/** 편집용 캔버스 요소에 터치 액션 설정 (Paper.js가 모든 터치 이벤트 수신) */
export function setupCanvasTouchAction(canvas: HTMLCanvasElement): void {
  canvas.style.setProperty('touch-action', 'none', 'important')
  canvas.style.setProperty('-webkit-user-select', 'none', 'important')
  canvas.style.setProperty('user-select', 'none', 'important')

  // pointer 이벤트 활성화
  canvas.style.setProperty('pointer-events', 'auto')
}

/** 스크롤 컨테이너에 터치 액션 설정 (네이티브 스크롤 허용) */
export function setupScrollContainerTouchAction(container: HTMLElement): void {
  container.style.setProperty('touch-action', 'pan-y pan-x', 'important')
  container.style.setProperty('-webkit-overflow-scrolling', 'touch', 'important')
}

/** 도구 모드와 읽기 전용 여부에 따른 터치 액션 모드 결정 */
export function getTouchActionForTool(tool: string, isReadOnly: boolean): TouchActionMode {
  if (isReadOnly) {
    return 'scroll'
  }

  switch (tool) {
    case 'select':
      return 'scroll'
    case 'pen':
    case 'highlighter':
    case 'eraser':
    case 'text':
    case 'rectangle':
    case 'circle':
    case 'line':
      return 'edit'
    default:
      return 'scroll'
  }
}
