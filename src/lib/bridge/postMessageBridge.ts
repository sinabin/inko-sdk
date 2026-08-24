/**
 * postMessage Bridge Module
 * iframe 환경에서 부모 호스트와 postMessage 통신
 * - 수신: loadPdfBase64, loadPdfFromUrl, loadUserCanvasData, saveCanvas, exportPdf,
 *   exportFlattenedPdf, clearCurrentCanvas
 * - 송신: viewerReady, pdfLoaded, canvasDataChanged, saveCanvasResponse, exportPdfResponse,
 *   exportFlattenedPdfResponse, closeViewer
 */
import { reportError, reportWarning } from '../utils/errorReporter.svelte'
import type { PdfCanvasFlattenReport } from '../pdf/pdfCanvasFlatten'

// ========== 메시지 타입 상수 ==========
const MESSAGE_TYPES = Object.freeze({
  // 부모 → iframe (수신)
  LOAD_PDF_BASE64: 'loadPdfBase64',
  LOAD_PDF_FROM_URL: 'loadPdfFromUrl',
  LOAD_USER_CANVAS_DATA: 'loadUserCanvasData',
  SAVE_CANVAS: 'saveCanvas',
  EXPORT_PDF: 'exportPdf',
  EXPORT_FLATTENED_PDF: 'exportFlattenedPdf',
  CLEAR_CURRENT_CANVAS: 'clearCurrentCanvas',
  APPLY_CONFIG: 'applyConfig',

  // iframe → 부모 (송신)
  VIEWER_READY: 'viewerReady',
  PDF_LOADED: 'pdfLoaded',
  CANVAS_DATA_CHANGED: 'canvasDataChanged',
  SAVE_CANVAS_RESPONSE: 'saveCanvasResponse',
  EXPORT_PDF_RESPONSE: 'exportPdfResponse',
  EXPORT_FLATTENED_PDF_RESPONSE: 'exportFlattenedPdfResponse',
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
const MAX_CANVAS_DATA_LENGTH = 64 * 1024 * 1024
const MAX_OVERLAY_ENTRIES = 256
const MAX_OVERLAY_TOTAL_CANVAS_DATA_LENGTH = 128 * 1024 * 1024
const MAX_CONFIG_DEPTH = 8
const MAX_CONFIG_NODES = 4096
const MAX_CONFIG_KEY_LENGTH = 256
const MAX_CONFIG_STRING_LENGTH = 256 * 1024
const MAX_OVERLAY_METADATA_STRING_LENGTH = 10_000
const OVERLAY_STRING_FIELDS = new Set([
  'canvasId',
  'userName',
  'userId',
  'color',
  'registeredAt',
  'regDt'
])
const OVERLAY_FORWARD_FIELDS = new Set([
  ...OVERLAY_STRING_FIELDS,
  'canvasData',
  'enabled',
  'isCurrent'
])

interface StructuredPayloadLimits {
  maxDepth: number
  maxNodes: number
  maxKeyLength: number
  maxStringLength: number
}

const CONFIG_PAYLOAD_LIMITS: StructuredPayloadLimits = {
  maxDepth: MAX_CONFIG_DEPTH,
  maxNodes: MAX_CONFIG_NODES,
  maxKeyLength: MAX_CONFIG_KEY_LENGTH,
  maxStringLength: MAX_CONFIG_STRING_LENGTH
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === 'string'
}
function isOptionalBoolean(v: unknown): v is boolean | undefined {
  return v === undefined || typeof v === 'boolean'
}
/** 안전 URL만 정규화 — protocol-relative·credentials·위험 스킴 차단 */
function normalizeSafeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_URL_LENGTH) return null
  const value = v.trim()
  if (!value || value !== v) return null

  // 동일 origin 절대경로만 허용. //host와 /\\host는 외부 origin으로 해석될 수 있음.
  if (value.startsWith('/')) {
    if (value.startsWith('//') || value.startsWith('/\\') || value.includes('\\')) return null
    try {
      const resolved = new URL(value, window.location.origin)
      return resolved.origin === window.location.origin ? value : null
    } catch {
      return null
    }
  }

  try {
    const url = new URL(value)
    if (url.protocol === 'blob:') return value
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return value
  } catch {
    return null
  }
}

/** JSON-like payload의 깊이·노드·키·문자열 크기를 순회하며 제한 */
function isBoundedStructuredPayload(
  value: unknown,
  limits: StructuredPayloadLimits = CONFIG_PAYLOAD_LIMITS
): boolean {
  const seen = new WeakSet<object>()
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0

  while (stack.length > 0) {
    const current = stack.pop()!
    nodes++
    if (nodes > limits.maxNodes || current.depth > limits.maxDepth) return false

    if (typeof current.value === 'string') {
      if (current.value.length > limits.maxStringLength) return false
      continue
    }
    if (
      current.value === null ||
      current.value === undefined ||
      typeof current.value === 'number' ||
      typeof current.value === 'boolean'
    ) continue
    if (typeof current.value !== 'object') return false

    const objectValue = current.value as object
    if (seen.has(objectValue)) return false
    seen.add(objectValue)
    let children: unknown[]
    if (Array.isArray(objectValue)) {
      children = objectValue
    } else {
      const prototype = Object.getPrototypeOf(objectValue)
      if (prototype !== Object.prototype && prototype !== null) return false
      const entries = Object.entries(objectValue as Record<string, unknown>)
      if (entries.some(([key]) => key.length > limits.maxKeyLength)) return false
      children = entries.map(([, child]) => child)
    }
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 })
  }
  return true
}

/**
 * 검토본의 공개 필드만 복사해 내부 처리로 전달한다.
 * 호스트 소유 확장 메타데이터는 타입 계약상 어떤 structured-clone 값도 허용하되,
 * 뷰어가 사용하지 않으므로 순회·보관하지 않아 내부 메모리와 렌더 경계에 들이지 않는다.
 */
function sanitizeBoundedOverlayList(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > MAX_OVERLAY_ENTRIES) return null
  let totalCanvasDataLength = 0
  let totalFields = 0
  const sanitized: Record<string, unknown>[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const record = entry as Record<string, unknown>
    const canvasData = record.canvasData
    if (typeof canvasData !== 'string' || canvasData.length > MAX_CANVAS_DATA_LENGTH) return null
    totalCanvasDataLength += canvasData.length
    if (totalCanvasDataLength > MAX_OVERLAY_TOTAL_CANVAS_DATA_LENGTH) return null

    const fields = Object.entries(record)
    totalFields += fields.length
    if (totalFields > MAX_CONFIG_NODES) return null

    const accepted: Record<string, unknown> = { canvasData }
    for (const [key, fieldValue] of fields) {
      if (key.length > MAX_CONFIG_KEY_LENGTH) return null
      if (
        OVERLAY_STRING_FIELDS.has(key)
        && typeof fieldValue === 'string'
        && fieldValue.length > MAX_OVERLAY_METADATA_STRING_LENGTH
      ) return null
      if (OVERLAY_FORWARD_FIELDS.has(key)) accepted[key] = fieldValue
    }
    sanitized.push(accepted)
  }
  return sanitized
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
  /** AcroForm과 지원되는 Paper 편집 유형을 하나의 독립 PDF로 평탄화하고 누락·실패를 보고 */
  onExportFlattenedPdf?: (requestId: string) => void | Promise<void>
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
  MESSAGE_TYPES.EXPORT_FLATTENED_PDF,
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

/** Paper 편집 레이어 평탄화 결과와 항목별 완전성 보고서를 transferable로 전달한다. */
export function sendExportFlattenedPdfResponse(
  requestId: string,
  success: boolean,
  pdfBytes?: ArrayBuffer,
  report?: PdfCanvasFlattenReport,
  message?: string
): boolean {
  if (!requestId || requestId.length > MAX_REQUEST_ID_LENGTH) return false
  if (success && (!(pdfBytes instanceof ArrayBuffer) || !report)) return false

  const response = {
    type: MESSAGE_TYPES.EXPORT_FLATTENED_PDF_RESPONSE,
    requestId,
    success,
    ...(success ? { pdfBytes, report } : {}),
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
  allowedOrigins: ReadonlySet<string> = ALLOWED_ORIGINS,
  expectedSource: MessageEventSource | null = window.parent
): () => void {
  function handleMessage(event: MessageEvent) {
    // 1. 페이로드 기본 검증 — 객체이고 type 문자열 보유
    if (!event.data || typeof event.data !== 'object') return
    const { type, data } = event.data as { type?: unknown; data?: unknown }
    if (typeof type !== 'string') return

    // 2. source 검증 — null 포함 정확한 부모 WindowProxy 외 출처 차단
    //    jsdom 단위 테스트는 expectedSource=null을 명시해 동일 계약을 검증한다.
    if (event.source !== expectedSource) return

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

    // 5. 이미 확정된 origin과 다르면 스키마 검사 전에 거부. 최초 pinning은
    //    아래 case별 전체 스키마 검증을 통과한 직후에만 수행한다.
    if (trustedParentOrigin && trustedParentOrigin !== event.origin) {
      console.warn('[PostMessageBridge] origin 불일치 거부 — 확정:', trustedParentOrigin, '수신:', event.origin)
      return
    }

    const payload = (data ?? {}) as any
    const acceptOrigin = (): boolean => {
      if (trustedParentOrigin && trustedParentOrigin !== event.origin) return false
      if (!trustedParentOrigin) {
        trustedParentOrigin = event.origin
        console.log('[PostMessageBridge] trusted parent origin:', trustedParentOrigin)
      }
      return true
    }

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
        if (
          !isOptionalString(canvasData) ||
          (typeof canvasData === 'string' && canvasData.length > MAX_CANVAS_DATA_LENGTH) ||
          !isOptionalBoolean(readOnly)
        ) {
          reportWarning('parse', 'PDF 로드 옵션 형식이 잘못되었습니다')
          return
        }
        if (!acceptOrigin()) return
        callbacks.onLoadPdfBase64(base64, (typeof fileName === 'string' && fileName.length <= MAX_FILENAME_LENGTH) ? fileName : 'document.pdf', canvasData, readOnly)
        break
      }

      case MESSAGE_TYPES.LOAD_PDF_FROM_URL: {
        const { url, fileName, canvasData, readOnly } = payload
        const safeUrl = normalizeSafeUrl(url)
        if (!safeUrl) {
          reportWarning('parse', 'PDF URL 형식이 잘못되었거나 허용되지 않은 스킴입니다')
          return
        }
        if (
          !isOptionalString(fileName) ||
          !isOptionalString(canvasData) ||
          (typeof canvasData === 'string' && canvasData.length > MAX_CANVAS_DATA_LENGTH) ||
          !isOptionalBoolean(readOnly)
        ) {
          reportWarning('parse', 'PDF 로드 옵션 형식이 잘못되었습니다')
          return
        }
        if (!acceptOrigin()) return
        callbacks.onLoadPdfFromUrl(safeUrl, (typeof fileName === 'string' && fileName.length <= MAX_FILENAME_LENGTH) ? fileName : 'document.pdf', canvasData, readOnly)
        break
      }

      case MESSAGE_TYPES.LOAD_USER_CANVAS_DATA: {
        const overlayList = sanitizeBoundedOverlayList(data)
        if (!overlayList) {
          reportWarning('parse', '검토본 목록 형식 또는 크기가 허용 범위를 벗어났습니다')
          return
        }
        if (!acceptOrigin()) return
        callbacks.onLoadUserCanvasData(overlayList)
        break
      }

      case MESSAGE_TYPES.SAVE_CANVAS: {
        if (!acceptOrigin()) return
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
        if (!acceptOrigin()) return
        void callbacks.onExportPdf?.(requestId)
        break
      }

      case MESSAGE_TYPES.EXPORT_FLATTENED_PDF: {
        const { requestId } = payload
        if (
          typeof requestId !== 'string' ||
          requestId.length === 0 ||
          requestId.length > MAX_REQUEST_ID_LENGTH
        ) {
          reportWarning('parse', '평탄화 PDF 내보내기 requestId 형식이 잘못되었습니다')
          return
        }
        if (!acceptOrigin()) return
        void callbacks.onExportFlattenedPdf?.(requestId)
        break
      }

      case MESSAGE_TYPES.CLEAR_CURRENT_CANVAS: {
        if (!acceptOrigin()) return
        callbacks.onClearCanvas()
        break
      }

      case MESSAGE_TYPES.APPLY_CONFIG: {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isBoundedStructuredPayload(payload)) {
          reportWarning('parse', '뷰어 설정 형식 또는 크기가 허용 범위를 벗어났습니다')
          return
        }
        if (!acceptOrigin()) return
        callbacks.onApplyConfig?.(payload as Record<string, unknown>)
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
