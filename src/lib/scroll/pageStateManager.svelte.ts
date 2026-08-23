/**
 * Page State Manager - 페이지 렌더링 상태 머신
 *
 * 상태: idle → queued → rendering → rendered → error
 */

export type PageState = 'idle' | 'queued' | 'rendering' | 'rendered' | 'error'

export interface PageStateInfo {
  state: PageState
  scale?: number
  error?: Error
  timestamp: number
}

// 유효한 상태 전이 정의
export const VALID_TRANSITIONS: Record<PageState, PageState[]> = {
  idle: ['queued'],
  queued: ['rendering', 'rendered', 'idle'],  // rendered: 캐시 히트 시, idle: 취소 시
  rendering: ['rendered', 'error', 'idle'],   // idle로 전이는 언로드 시
  rendered: ['idle'],                         // 언로드 또는 스케일 변경 시
  error: ['idle', 'queued']                   // 재시도 시
}

export interface PageStateManager {
  // State queries
  getState: (pageNum: number) => PageState
  getInfo: (pageNum: number) => PageStateInfo | undefined
  isRendered: (pageNum: number) => boolean
  isRendering: (pageNum: number) => boolean
  isQueued: (pageNum: number) => boolean
  getRenderedScale: (pageNum: number) => number | undefined

  // State transitions
  transition: (pageNum: number, newState: PageState, scale?: number) => boolean
  transitionToError: (pageNum: number, error: Error) => boolean
  resetPage: (pageNum: number) => void
  resetAll: () => void

  // Bulk operations
  getRenderedPages: () => number[]
  getQueuedPages: () => number[]
  getRenderingPages: () => number[]

  // Readonly state
  readonly pageStates: Map<number, PageStateInfo>
}

export function createPageStateManager(): PageStateManager {
  let pageStates = $state<Map<number, PageStateInfo>>(new Map())

  // 상태 가져오기
  function getState(pageNum: number): PageState {
    return pageStates.get(pageNum)?.state ?? 'idle'
  }

  // 상태 정보 가져오기
  function getInfo(pageNum: number): PageStateInfo | undefined {
    return pageStates.get(pageNum)
  }

  // 상태 확인 헬퍼
  function isRendered(pageNum: number): boolean {
    return getState(pageNum) === 'rendered'
  }

  function isRendering(pageNum: number): boolean {
    return getState(pageNum) === 'rendering'
  }

  function isQueued(pageNum: number): boolean {
    return getState(pageNum) === 'queued'
  }

  // 렌더링된 스케일 가져오기
  function getRenderedScale(pageNum: number): number | undefined {
    const info = pageStates.get(pageNum)
    return info?.state === 'rendered' ? info.scale : undefined
  }

  // 상태 전이
  function transition(pageNum: number, newState: PageState, scale?: number): boolean {
    const currentState = getState(pageNum)
    const validNextStates = VALID_TRANSITIONS[currentState]

    if (!validNextStates.includes(newState)) {
      console.warn(`[PageStateManager] Invalid transition: ${currentState} → ${newState} for page ${pageNum}`)
      return false
    }

    const newMap = new Map(pageStates)
    newMap.set(pageNum, {
      state: newState,
      scale,
      timestamp: Date.now()
    })
    pageStates = newMap

    return true
  }

  // 에러 상태로 전이
  function transitionToError(pageNum: number, error: Error): boolean {
    const currentState = getState(pageNum)
    if (currentState !== 'rendering') {
      console.warn(`[PageStateManager] Cannot transition to error from ${currentState}`)
      return false
    }

    const newMap = new Map(pageStates)
    newMap.set(pageNum, {
      state: 'error',
      error,
      timestamp: Date.now()
    })
    pageStates = newMap

    return true
  }

  // 페이지 초기화
  function resetPage(pageNum: number): void {
    const newMap = new Map(pageStates)
    newMap.delete(pageNum)
    pageStates = newMap
  }

  // 전체 초기화
  function resetAll(): void {
    pageStates = new Map()
  }

  // 렌더링된 페이지 목록
  function getRenderedPages(): number[] {
    const result: number[] = []
    pageStates.forEach((info, pageNum) => {
      if (info.state === 'rendered') {
        result.push(pageNum)
      }
    })
    return result.sort((a, b) => a - b)
  }

  // 대기 중인 페이지 목록
  function getQueuedPages(): number[] {
    const result: number[] = []
    pageStates.forEach((info, pageNum) => {
      if (info.state === 'queued') {
        result.push(pageNum)
      }
    })
    return result.sort((a, b) => a - b)
  }

  // 렌더링 중인 페이지 목록
  function getRenderingPages(): number[] {
    const result: number[] = []
    pageStates.forEach((info, pageNum) => {
      if (info.state === 'rendering') {
        result.push(pageNum)
      }
    })
    return result.sort((a, b) => a - b)
  }

  return {
    getState,
    getInfo,
    isRendered,
    isRendering,
    isQueued,
    getRenderedScale,
    transition,
    transitionToError,
    resetPage,
    resetAll,
    getRenderedPages,
    getQueuedPages,
    getRenderingPages,

    get pageStates() { return pageStates }
  }
}
