/**
 * postMessage Bridge Module
 * iframe 환경에서 부모 호스트와 postMessage 통신
 * - 수신: loadPdfBase64, loadPdfFromUrl, loadUserCanvasData, saveCanvas, clearCurrentCanvas
 * - 송신: viewerReady, pdfLoaded, canvasDataChanged, saveCanvasResponse, closeViewer
 */
import { reportError, reportWarning } from '../utils/errorReporter.svelte'

// ========== 메시지 타입 상수 ==========
const MESSAGE_TYPES = Object.freeze({
  // 부모 → iframe (수신)
  LOAD_PDF_BASE64: 'loadPdfBase64',
  LOAD_PDF_FROM_URL: 'loadPdfFromUrl',
  LOAD_USER_CANVAS_DATA: 'loadUserCanvasData',
  SAVE_CANVAS: 'saveCanvas',
  CLEAR_CURRENT_CANVAS: 'clearCurrentCanvas',
  APPLY_CONFIG: 'applyConfig',

  // iframe → 부모 (송신)
  VIEWER_READY: 'viewerReady',
  PDF_LOADED: 'pdfLoaded',
  CANVAS_DATA_CHANGED: 'canvasDataChanged',
  SAVE_CANVAS_RESPONSE: 'saveCanvasResponse',
  CLOSE_VIEWER: 'closeViewer',
  SET_ORIENTATION: 'setOrientation'
})

// ========== Origin 화이트리스트 ==========
// 기본값: APP LocalWebServer (운영) — 빌드타임 VITE_ALLOWED_ORIGINS 환경변수로 추가 가능
// DEV 모드에서는 vite dev server origin도 자동 허용
const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1:8080',
  'http://localhost:8080'
]

const DEV_ALLOWED_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173'
]

/** 콤마 구분 origin 목록을 set으로 변환 */
function buildAllowedOrigins(): Set<string> {
  const envRaw = (import.meta.env.VITE_ALLOWED_ORIGINS as string | undefined) || ''
  const fromEnv = envRaw.split(',').map(s => s.trim()).filter(Boolean)
  const dev = import.meta.env.MODE === 'development' ? DEV_ALLOWED_ORIGINS : []
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv, ...dev])
}

const ALLOWED_ORIGINS = buildAllowedOrigins()

/** same-origin 또는 화이트리스트 origin 여부 — same-origin은 브라우저가 보장하므로 항상 허용 */
function isAllowedOrigin(origin: string): boolean {
  if (origin === window.location.origin) return true
  return ALLOWED_ORIGINS.has(origin)
}

// 첫 유효 메시지 수신 시 확정되는 부모 origin — 이후 송신 targetOrigin 및 origin 일치 검증에 사용
let trustedParentOrigin: string | null = null

// ========== 페이로드 스키마 검증 ==========
// 한도는 PDF 사용 패턴 + 안전 마진 — 초과 시 메모리·네트워크 폭발 방어
const MAX_BASE64_LENGTH = 350_000_000  // ≈ 250MB 원본
const MAX_URL_LENGTH = 8000
const MAX_FILENAME_LENGTH = 1000

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === 'string'
}
function isOptionalBoolean(v: unknown): v is boolean | undefined {
  return v === undefined || typeof v === 'boolean'
}
/** 안전 URL 스킴만 허용 — javascript:·data:·vbscript: 등 차단 */
function isSafeUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_URL_LENGTH) return false
  const lower = v.trim().toLowerCase()
  return lower.startsWith('http://') ||
         lower.startsWith('https://') ||
         lower.startsWith('blob:') ||
         lower.startsWith('/')
}

// ========== iframe 환경 감지 ==========
export function isInIframe(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

// ========== 콜백 인터페이스 ==========
export interface PostMessageBridgeCallbacks {
  onLoadPdfBase64: (base64: string, fileName: string, canvasData?: string, readOnly?: boolean) => void
  onLoadPdfFromUrl: (url: string, fileName: string, canvasData?: string, readOnly?: boolean) => void
  onLoadUserCanvasData: (data: any[]) => void
  onSaveCanvas: () => void
  onClearCanvas: () => void
  /** 호스트 커스터마이징 설정 적용 — { theme?, tools?, locale?, messages? } */
  onApplyConfig?: (config: Record<string, unknown>) => void
}

// ========== 부모로 메시지 송신 ==========
/**
 * 부모창으로 메시지 송신
 * @param message 송신 페이로드
 * @param allowBroadcast true면 trustedParentOrigin 미확정 시 same-origin으로 송신 허용 (handshake 메시지 전용)
 */
function sendToParent(message: object, allowBroadcast = false): boolean {
  if (!window.parent || window.parent === window) return false

  // 신뢰 origin 미확정 + broadcast 비허용이면 데이터 누설 방지를 위해 송신 중단
  let targetOrigin = trustedParentOrigin
  if (!targetOrigin) {
    if (!allowBroadcast) {
      reportWarning('bridge', '부모 창과 아직 연결되지 않아 요청을 보낼 수 없습니다', `type=${(message as any).type}`)
      return false
    }
    // broadcast 허용 메시지(viewerReady)는 same-origin으로만 송신 — 와일드카드 사용 금지
    targetOrigin = window.location.origin
  }

  try {
    window.parent.postMessage(message, targetOrigin)
    return true
  } catch (e) {
    reportError('bridge', '부모 창으로 메시지 전송 실패', e)
    return false
  }
}

/** 뷰어 준비 완료 알림 — 부모 origin이 아직 확정되지 않았으므로 same-origin으로 송신 */
export function sendViewerReady() {
  sendToParent({ type: MESSAGE_TYPES.VIEWER_READY }, true)
}

/** PDF 로드 완료 알림 */
export function sendPdfLoaded() {
  sendToParent({ type: MESSAGE_TYPES.PDF_LOADED })
}

/** Canvas 데이터 변경 알림 */
export function sendCanvasDataChanged(canvasData: string) {
  sendToParent({ type: MESSAGE_TYPES.CANVAS_DATA_CHANGED, canvasData })
}

/** 저장 완료 응답 — 부모 창 송신 성공 여부 반환 */
export function sendSaveCanvasResponse(canvasData: string, success: boolean, message?: string): boolean {
  return sendToParent({
    type: MESSAGE_TYPES.SAVE_CANVAS_RESPONSE,
    canvasData,
    success,
    message: message || ''
  })
}

/** 닫기 요청 */
export function sendCloseRequest() {
  sendToParent({ type: MESSAGE_TYPES.CLOSE_VIEWER })
}

/** 화면 방향 변경 요청 */
export function sendSetOrientation(orientation: 'portrait' | 'landscape') {
  console.log('[PostMessageBridge] sendSetOrientation:', orientation, '| parent exists:', !!(window.parent && window.parent !== window))
  sendToParent({ type: MESSAGE_TYPES.SET_ORIENTATION, orientation })
}

// ========== 브릿지 초기화 ==========
/**
 * postMessage 이벤트 리스너 등록
 * @returns cleanup 함수
 */
export function initPostMessageBridge(callbacks: PostMessageBridgeCallbacks): () => void {
  function handleMessage(event: MessageEvent) {
    // 1. 페이로드 기본 검증 — 객체이고 type 문자열 보유
    if (!event.data || typeof event.data !== 'object') return
    const { type, data } = event.data as { type?: unknown; data?: unknown }
    if (typeof type !== 'string') return

    // 2. source 검증 — 부모 frame이 아닌 출처(다른 iframe·worker 등) 차단
    //    테스트(jsdom)는 source가 null이므로 허용
    if (event.source && event.source !== window.parent) return

    // 3. origin 화이트리스트 검증
    if (!isAllowedOrigin(event.origin)) {
      console.warn('[PostMessageBridge] origin 거부:', event.origin)
      return
    }

    // 4. 신뢰 부모 origin 확정 — 첫 메시지 origin을 이후 송신 target으로 고정
    if (!trustedParentOrigin) {
      trustedParentOrigin = event.origin
      console.log('[PostMessageBridge] trusted parent origin:', trustedParentOrigin)
    } else if (trustedParentOrigin !== event.origin) {
      // 확정 후 다른 origin에서 온 메시지 차단 — 동시 다중 origin 공격 방지
      console.warn('[PostMessageBridge] origin 불일치 거부 — 확정:', trustedParentOrigin, '수신:', event.origin)
      return
    }

    const payload = (data ?? {}) as any

    switch (type) {
      case MESSAGE_TYPES.LOAD_PDF_BASE64: {
        const { base64, fileName, canvasData, readOnly } = payload
        if (typeof base64 !== 'string' || base64.length === 0) {
          reportWarning('parse', 'PDF 데이터(base64)가 비어 있거나 형식이 잘못되었습니다')
          return
        }
        if (base64.length > MAX_BASE64_LENGTH) {
          reportError('parse', 'PDF 크기가 한도를 초과했습니다', `${base64.length} > ${MAX_BASE64_LENGTH}`)
          return
        }
        if (!isOptionalString(fileName) || (typeof fileName === 'string' && fileName.length > MAX_FILENAME_LENGTH)) {
          reportWarning('parse', '파일명 형식이 잘못되어 기본값을 사용합니다')
        }
        if (!isOptionalString(canvasData) || !isOptionalBoolean(readOnly)) {
          reportWarning('parse', 'PDF 로드 옵션 형식이 잘못되었습니다')
          return
        }
        callbacks.onLoadPdfBase64(base64, (typeof fileName === 'string' && fileName.length <= MAX_FILENAME_LENGTH) ? fileName : 'document.pdf', canvasData, readOnly)
        break
      }

      case MESSAGE_TYPES.LOAD_PDF_FROM_URL: {
        const { url, fileName, canvasData, readOnly } = payload
        if (!isSafeUrl(url)) {
          reportWarning('parse', 'PDF URL 형식이 잘못되었거나 허용되지 않은 스킴입니다')
          return
        }
        if (!isOptionalString(fileName) || !isOptionalString(canvasData) || !isOptionalBoolean(readOnly)) {
          reportWarning('parse', 'PDF 로드 옵션 형식이 잘못되었습니다')
          return
        }
        callbacks.onLoadPdfFromUrl(url, (typeof fileName === 'string' && fileName.length <= MAX_FILENAME_LENGTH) ? fileName : 'document.pdf', canvasData, readOnly)
        break
      }

      case MESSAGE_TYPES.LOAD_USER_CANVAS_DATA: {
        // 배열이 아니면 빈 배열로 정규화 (앞 단계에서 반환 — 여기는 fallthrough 없음)
        callbacks.onLoadUserCanvasData(Array.isArray(data) ? data : [])
        break
      }

      case MESSAGE_TYPES.SAVE_CANVAS: {
        callbacks.onSaveCanvas()
        break
      }

      case MESSAGE_TYPES.CLEAR_CURRENT_CANVAS: {
        callbacks.onClearCanvas()
        break
      }

      case MESSAGE_TYPES.APPLY_CONFIG: {
        // config는 신뢰 부모가 보낸 커스터마이징 설정 — 객체만 통과
        if (payload && typeof payload === 'object') {
          callbacks.onApplyConfig?.(payload as Record<string, unknown>)
        }
        break
      }

      default:
        console.log('[PostMessageBridge] Unknown message type:', type)
    }
  }

  window.addEventListener('message', handleMessage)

  // 부모에게 준비 완료 알림
  sendViewerReady()
  console.log('[PostMessageBridge] Bridge initialized')

  // cleanup 함수 반환
  return () => {
    window.removeEventListener('message', handleMessage)
    trustedParentOrigin = null
    console.log('[PostMessageBridge] Bridge cleaned up')
  }
}

// ========== 테스트 전용 ==========
/** 테스트에서 trustedParentOrigin을 리셋 — 운영 코드에서는 사용 금지 */
export function __resetTrustedParentOriginForTesting() {
  trustedParentOrigin = null
}
