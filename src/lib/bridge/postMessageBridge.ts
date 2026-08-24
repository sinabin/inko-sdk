/**
 * postMessage Bridge Module
 * iframe 환경에서 부모 호스트와 postMessage 통신
 * - 수신: loadPdfBase64, loadPdfFromUrl, loadUserCanvasData, saveCanvas, exportPdf, clearCurrentCanvas
 * - 송신: viewerReady, pdfLoaded, canvasDataChanged, saveCanvasResponse, exportPdfResponse, closeViewer
 */
import { reportError, reportWarning } from '../utils/errorReporter.svelte'

// ========== 메시지 타입 상수 ==========
const MESSAGE_TYPES = Object.freeze({
  // 부모 → iframe (수신)
  LOAD_PDF_BASE64: 'loadPdfBase64',
  LOAD_PDF_FROM_URL: 'loadPdfFromUrl',
  LOAD_USER_CANVAS_DATA: 'loadUserCanvasData',
  SAVE_CANVAS: 'saveCanvas',
  EXPORT_PDF: 'exportPdf',
  CLEAR_CURRENT_CANVAS: 'clearCurrentCanvas',
  APPLY_CONFIG: 'applyConfig',

  // iframe → 부모 (송신)
  VIEWER_READY: 'viewerReady',
  PDF_LOADED: 'pdfLoaded',
  CANVAS_DATA_CHANGED: 'canvasDataChanged',
  SAVE_CANVAS_RESPONSE: 'saveCanvasResponse',
  EXPORT_PDF_RESPONSE: 'exportPdfResponse',
  CLOSE_VIEWER: 'closeViewer',
  SET_ORIENTATION: 'setOrientation'
})

// ========== Origin 화이트리스트 ==========
// 기본값은 same-origin만 허용. 교차 origin 호스트는 빌드타임 환경변수로 명시
/**
 * viewerReady를 전송할 안전한 target origin 목록.
 * same-origin은 항상 포함하고, cross-origin은 빌드 설정에 명시된 HTTP(S) origin만 포함한다.
 */
export function getViewerReadyTargetOrigins(
  currentOrigin = window.location.origin,
  envRaw = (import.meta.env.VITE_ALLOWED_ORIGINS as string | undefined) || ''
): string[] {
  const candidates = [
    currentOrigin,
    ...envRaw.split(',').map(value => value.trim()).filter(Boolean)
  ]

  const origins = new Set<string>()
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) continue
      origins.add(url.origin)
    } catch {
      // 잘못된 설정값은 신뢰 목록에 포함하지 않는다.
    }
  }
  return [...origins]
}

const VIEWER_READY_TARGET_ORIGINS = getViewerReadyTargetOrigins()
const ALLOWED_ORIGINS = new Set(VIEWER_READY_TARGET_ORIGINS)

/** 초기화 시 확정된 정확한 HTTP(S) origin 목록에 포함되는지 확인 */
function isAllowedOrigin(origin: string, allowedOrigins: ReadonlySet<string>): boolean {
  return allowedOrigins.has(origin)
}

// 첫 유효 메시지 수신 시 확정되는 부모 origin — 이후 송신 targetOrigin 및 origin 일치 검증에 사용
let trustedParentOrigin: string | null = null

// ========== 페이로드 스키마 검증 ==========
// 한도는 PDF 사용 패턴 + 안전 마진 — 초과 시 메모리·네트워크 폭발 방어
const MAX_BASE64_LENGTH = 350_000_000  // ≈ 250MB 원본
const MAX_URL_LENGTH = 8000
const MAX_FILENAME_LENGTH = 1000
const MAX_REQUEST_ID_LENGTH = 128

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
  /** AcroForm annotationStorage를 반영한 PDF 바이너리 내보내기 */
  onExportPdf?: (requestId: string) => void | Promise<void>
  onClearCanvas: () => void
  /** 호스트 커스터마이징 설정 적용 — { theme?, tools?, locale?, messages? } */
  onApplyConfig?: (config: Record<string, unknown>) => void
}

const INBOUND_MESSAGE_TYPES = new Set<string>([
  MESSAGE_TYPES.LOAD_PDF_BASE64,
  MESSAGE_TYPES.LOAD_PDF_FROM_URL,
  MESSAGE_TYPES.LOAD_USER_CANVAS_DATA,
  MESSAGE_TYPES.SAVE_CANVAS,
  MESSAGE_TYPES.EXPORT_PDF,
  MESSAGE_TYPES.CLEAR_CURRENT_CANVAS,
  MESSAGE_TYPES.APPLY_CONFIG
])

// ========== 부모로 메시지 송신 ==========
/**
 * 부모창으로 메시지 송신
 * @param message 송신 페이로드
 */
function sendToParent(message: object, transfer?: Transferable[]): boolean {
  if (!window.parent || window.parent === window) return false

  // 신뢰 origin이 확정되기 전에는 데이터가 포함된 메시지를 보내지 않는다.
  if (!trustedParentOrigin) {
    reportWarning('bridge', '부모 창과 아직 연결되지 않아 요청을 보낼 수 없습니다', `type=${(message as any).type}`)
    return false
  }

  try {
    if (transfer && transfer.length > 0) {
      window.parent.postMessage(message, trustedParentOrigin, transfer)
    } else {
      window.parent.postMessage(message, trustedParentOrigin)
    }
    return true
  } catch (e) {
    reportError('bridge', '부모 창으로 메시지 전송 실패', e)
    return false
  }
}

/**
 * 뷰어 준비 완료 알림.
 * 민감 데이터가 없는 handshake만 same-origin과 명시 allowlist 각각에 전송한다.
 * 부모가 첫 유효 요청을 보내면 그 origin으로 pinning되고 이후 데이터 송신은 그곳으로만 향한다.
 */
export function sendViewerReady() {
  if (!window.parent || window.parent === window) return
  for (const targetOrigin of VIEWER_READY_TARGET_ORIGINS) {
    try {
      window.parent.postMessage({ type: MESSAGE_TYPES.VIEWER_READY }, targetOrigin)
    } catch (e) {
      reportError('bridge', '부모 창으로 준비 메시지 전송 실패', e)
    }
  }
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

/**
 * PDF 바이너리 응답. canvasData와 혼합하지 않으며 성공 시 정확한 ArrayBuffer 하나만 transferable로 전달한다.
 */
export function sendExportPdfResponse(
  requestId: string,
  success: boolean,
  pdfBytes?: ArrayBuffer,
  message?: string
): boolean {
  if (!requestId || requestId.length > MAX_REQUEST_ID_LENGTH) return false
  if (success && !(pdfBytes instanceof ArrayBuffer)) return false

  const response = {
    type: MESSAGE_TYPES.EXPORT_PDF_RESPONSE,
    requestId,
    success,
    ...(success ? { pdfBytes } : {}),
    message: message || ''
  }
  return sendToParent(response, success && pdfBytes ? [pdfBytes] : undefined)
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
export function initPostMessageBridge(
  callbacks: PostMessageBridgeCallbacks,
  allowedOrigins: ReadonlySet<string> = ALLOWED_ORIGINS
): () => void {
  function handleMessage(event: MessageEvent) {
    // 1. 페이로드 기본 검증 — 객체이고 type 문자열 보유
    if (!event.data || typeof event.data !== 'object') return
    const { type, data } = event.data as { type?: unknown; data?: unknown }
    if (typeof type !== 'string') return

    // 2. source 검증 — 부모 frame이 아닌 출처(다른 iframe·worker 등) 차단
    //    테스트(jsdom)는 source가 null이므로 허용
    if (event.source && event.source !== window.parent) return

    // 3. origin 화이트리스트 검증
    if (!isAllowedOrigin(event.origin, allowedOrigins)) {
      console.warn('[PostMessageBridge] origin 거부:', event.origin)
      return
    }

    // 4. 알려진 요청만 pinning 후보로 사용 — 알 수 없는 메시지의 연결 선점 방지
    if (!INBOUND_MESSAGE_TYPES.has(type)) {
      console.log('[PostMessageBridge] Unknown message type:', type)
      return
    }

    // 5. 신뢰 부모 origin 확정 — 첫 유효 요청 origin을 이후 송신 target으로 고정
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

      case MESSAGE_TYPES.EXPORT_PDF: {
        const { requestId } = payload
        if (
          typeof requestId !== 'string' ||
          requestId.length === 0 ||
          requestId.length > MAX_REQUEST_ID_LENGTH
        ) {
          reportWarning('parse', 'PDF 내보내기 requestId 형식이 잘못되었습니다')
          return
        }
        void callbacks.onExportPdf?.(requestId)
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
        // INBOUND_MESSAGE_TYPES 검증 후에는 도달하지 않음
        break
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
