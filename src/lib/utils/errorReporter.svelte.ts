/**
 * 에러 리포터 — 사용자 대면 토스트 큐 + 콘솔 로깅 통합
 *
 * 전역 토스트 큐를 Svelte 5 $state로 보유. ErrorToast.svelte가 구독해 표시.
 * 향후 Phase에서 Bridge 텔레메트리 송신 추가 예정.
 */

export type ErrorCategory =
  | 'parse'    // JSON·Base64 파싱 실패
  | 'render'   // pdf.js·Paper.js 렌더 실패
  | 'storage'  // localStorage quota·접근 실패
  | 'bridge'   // postMessage 미연결·송신 실패
  | 'tool'     // 도구 동작 중 예외
  | 'network'  // 외부 리소스 로드 실패
  | 'unknown'  // window.onerror·unhandledrejection

export type ToastKind = 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  category: ErrorCategory
  message: string
  detail?: string
  createdAt: number
}

const DEFAULT_TIMEOUT_MS = 6000
const WARNING_TIMEOUT_MS = 4000
const INFO_TIMEOUT_MS = 3000

function createReporter() {
  let queue = $state<ToastItem[]>([])
  let nextId = 1

  function dismiss(id: number) {
    const idx = queue.findIndex(t => t.id === id)
    if (idx >= 0) queue.splice(idx, 1)
  }

  function push(item: Omit<ToastItem, 'id' | 'createdAt'>, timeoutMs: number): number {
    const id = nextId++
    queue.push({ id, createdAt: Date.now(), ...item })
    if (timeoutMs > 0 && typeof setTimeout !== 'undefined') {
      setTimeout(() => dismiss(id), timeoutMs)
    }
    return id
  }

  function formatDetail(error: unknown): string | undefined {
    if (error == null) return undefined
    if (error instanceof Error) return `${error.name}: ${error.message}`
    if (typeof error === 'string') return error
    try { return JSON.stringify(error) } catch { return String(error) }
  }

  return {
    get items() { return queue },

    /** 사용자 대면 에러 — 토스트 + console.error 보존 */
    reportError(category: ErrorCategory, userMessage: string, error?: unknown) {
      console.error(`[${category}]`, userMessage, error ?? '')
      return push({ kind: 'error', category, message: userMessage, detail: formatDetail(error) }, DEFAULT_TIMEOUT_MS)
    },

    /** 사용자 대면 경고 — 토스트 + console.warn 보존 */
    reportWarning(category: ErrorCategory, userMessage: string, detail?: unknown) {
      console.warn(`[${category}]`, userMessage, detail ?? '')
      return push({ kind: 'warning', category, message: userMessage, detail: formatDetail(detail) }, WARNING_TIMEOUT_MS)
    },

    /** 정보성 알림 — console 출력 없음 */
    reportInfo(userMessage: string) {
      return push({ kind: 'info', category: 'unknown', message: userMessage }, INFO_TIMEOUT_MS)
    },

    dismiss,

    /** 테스트 전용 — 큐 초기화 */
    __resetForTesting() {
      queue.splice(0, queue.length)
      nextId = 1
    }
  }
}

export const errorReporter = createReporter()

// 단축 함수 export (개별 import 편의)
export const reportError = errorReporter.reportError.bind(errorReporter)
export const reportWarning = errorReporter.reportWarning.bind(errorReporter)
export const reportInfo = errorReporter.reportInfo.bind(errorReporter)
