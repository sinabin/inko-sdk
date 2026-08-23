/**
 * History Manager
 * Manages undo/redo state per page using snapshot pattern
 */

export interface HistoryManagerOptions {
  maxHistorySize?: number  // 기본 20
  debounceMs?: number      // 기본 300ms
  onHistoryChange?: () => void
}

interface PageHistory {
  undoStack: string[]
  redoStack: string[]
  currentState: string | null
}

export interface HistoryManager {
  // State
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly activePage: number

  // Methods
  setActivePage: (pageNum: number) => void
  pushSnapshot: (pageNum: number, json: string) => void
  /**
   * 페이지의 baseline 상태 등록 — currentState만 설정, undo/redoStack은 보존.
   * 캔버스 init 또는 importJSON 직후 호출. 첫 그리기 후 currentState가 undoStack으로 push되어
   * undo가 활성화되도록 함 (currentState가 null이면 첫 push 시 undoStack이 비어 undo 불가)
   */
  setBaseline: (pageNum: number, json: string) => void
  undo: (pageNum: number) => string | null
  redo: (pageNum: number) => string | null
  canUndoPage: (pageNum: number) => boolean
  canRedoPage: (pageNum: number) => boolean
  clear: (pageNum?: number) => void
  dispose: () => void
}

export function createHistoryManager(options: HistoryManagerOptions = {}): HistoryManager {
  const {
    maxHistorySize = 20,
    debounceMs = 300,
    onHistoryChange
  } = options

  // 페이지별 히스토리 저장소
  let historyByPage = $state<Map<number, PageHistory>>(new Map())

  // 현재 활성 페이지
  let activePage = $state(1)

  // Debounce 타이머 (페이지별)
  const debounceTimers: Map<number, ReturnType<typeof setTimeout>> = new Map()

  // 마지막 스냅샷 (중복 방지용)
  const lastSnapshots: Map<number, string> = new Map()

  // Derived: 현재 페이지의 undo 가능 여부
  const canUndo = $derived(() => {
    const history = historyByPage.get(activePage)
    return history ? history.undoStack.length > 0 : false
  })

  // Derived: 현재 페이지의 redo 가능 여부
  const canRedo = $derived(() => {
    const history = historyByPage.get(activePage)
    return history ? history.redoStack.length > 0 : false
  })

  /**
   * 페이지의 히스토리 가져오기 (없으면 생성)
   */
  function getOrCreateHistory(pageNum: number): PageHistory {
    let history = historyByPage.get(pageNum)
    if (!history) {
      history = {
        undoStack: [],
        redoStack: [],
        currentState: null
      }
      historyByPage.set(pageNum, history)
      // Trigger reactivity
      historyByPage = new Map(historyByPage)
    }
    return history
  }

  /**
   * 활성 페이지 설정
   */
  function setActivePage(pageNum: number): void {
    activePage = pageNum
  }

  /**
   * 페이지의 baseline 상태 등록.
   * currentState만 갱신해 첫 그리기 후 undoStack에 baseline이 push되도록 함.
   * undoStack/redoStack은 보존 — 페이지 재진입 시 history 잃지 않음.
   * 진행 중 debounce 타이머는 baseline 등록과 충돌하므로 취소.
   */
  function setBaseline(pageNum: number, json: string): void {
    // 진행 중인 debounced push 취소 — baseline 직후 stale push 방지
    const existingTimer = debounceTimers.get(pageNum)
    if (existingTimer) {
      clearTimeout(existingTimer)
      debounceTimers.delete(pageNum)
    }

    const history = getOrCreateHistory(pageNum)
    history.currentState = json
    lastSnapshots.set(pageNum, json)
    historyByPage = new Map(historyByPage)
  }

  /**
   * 스냅샷 저장 (debounced)
   */
  function pushSnapshot(pageNum: number, json: string): void {
    // 기존 타이머 취소
    const existingTimer = debounceTimers.get(pageNum)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Debounce 타이머 설정
    const timer = setTimeout(() => {
      pushSnapshotImmediate(pageNum, json)
      debounceTimers.delete(pageNum)
    }, debounceMs)

    debounceTimers.set(pageNum, timer)
  }

  /**
   * 스냅샷 즉시 저장 (내부용)
   */
  function pushSnapshotImmediate(pageNum: number, json: string): void {
    // 중복 스냅샷 방지
    const lastSnapshot = lastSnapshots.get(pageNum)
    if (lastSnapshot === json) {
      return
    }
    lastSnapshots.set(pageNum, json)

    const history = getOrCreateHistory(pageNum)

    // 현재 상태가 있으면 undo 스택에 추가
    if (history.currentState !== null) {
      history.undoStack.push(history.currentState)

      // 히스토리 크기 제한
      while (history.undoStack.length > maxHistorySize) {
        history.undoStack.shift()
      }
    }

    // 현재 상태 업데이트
    history.currentState = json

    // Redo 스택 클리어 (새 작업 후에는 redo 불가)
    history.redoStack = []

    // Trigger reactivity
    historyByPage = new Map(historyByPage)

    onHistoryChange?.()
  }

  /**
   * Undo 실행
   */
  function undo(pageNum: number): string | null {
    const history = historyByPage.get(pageNum)
    if (!history || history.undoStack.length === 0) {
      return null
    }

    // 현재 상태를 redo 스택에 저장
    if (history.currentState !== null) {
      history.redoStack.push(history.currentState)
    }

    // Undo 스택에서 이전 상태 복원
    const previousState = history.undoStack.pop()!
    history.currentState = previousState

    // 마지막 스냅샷 업데이트 (중복 방지)
    lastSnapshots.set(pageNum, previousState)

    // Trigger reactivity
    historyByPage = new Map(historyByPage)

    onHistoryChange?.()

    return previousState
  }

  /**
   * Redo 실행
   */
  function redo(pageNum: number): string | null {
    const history = historyByPage.get(pageNum)
    if (!history || history.redoStack.length === 0) {
      return null
    }

    // 현재 상태를 undo 스택에 저장
    if (history.currentState !== null) {
      history.undoStack.push(history.currentState)
    }

    // Redo 스택에서 다음 상태 복원
    const nextState = history.redoStack.pop()!
    history.currentState = nextState

    // 마지막 스냅샷 업데이트 (중복 방지)
    lastSnapshots.set(pageNum, nextState)

    // Trigger reactivity
    historyByPage = new Map(historyByPage)

    onHistoryChange?.()

    return nextState
  }

  /**
   * 특정 페이지 undo 가능 여부
   */
  function canUndoPage(pageNum: number): boolean {
    const history = historyByPage.get(pageNum)
    return history ? history.undoStack.length > 0 : false
  }

  /**
   * 특정 페이지 redo 가능 여부
   */
  function canRedoPage(pageNum: number): boolean {
    const history = historyByPage.get(pageNum)
    return history ? history.redoStack.length > 0 : false
  }

  /**
   * 히스토리 클리어
   */
  function clear(pageNum?: number): void {
    if (pageNum !== undefined) {
      historyByPage.delete(pageNum)
      lastSnapshots.delete(pageNum)
      const timer = debounceTimers.get(pageNum)
      if (timer) {
        clearTimeout(timer)
        debounceTimers.delete(pageNum)
      }
    } else {
      historyByPage = new Map()
      lastSnapshots.clear()
      debounceTimers.forEach(timer => clearTimeout(timer))
      debounceTimers.clear()
    }

    // Trigger reactivity
    historyByPage = new Map(historyByPage)

    onHistoryChange?.()
  }

  /**
   * 리소스 정리
   */
  function dispose(): void {
    debounceTimers.forEach(timer => clearTimeout(timer))
    debounceTimers.clear()
    lastSnapshots.clear()
    historyByPage = new Map()
  }

  return {
    get canUndo() { return canUndo() },
    get canRedo() { return canRedo() },
    get activePage() { return activePage },

    setActivePage,
    pushSnapshot,
    setBaseline,
    undo,
    redo,
    canUndoPage,
    canRedoPage,
    clear,
    dispose
  }
}
