/** localStorage 기반 Canvas 저장 이력 저장소 (dev/standalone 환경 전용) */
/** standalone 개발 환경에서 append-only 저장 흐름을 검증하기 위한 로컬 이력 */

import type { UserCanvasInfo } from '../../types'

const STORAGE_PREFIX = 'pdfv_canvas_history:'

/**
 * localStorage 사용 가능 여부
 * - production 빌드: 비활성화 (실 운영 저장소는 호스트가 구현)
 * - DEV 모드 + standalone(localhost): 활성화 — 개발 편의용
 * 환경 분기는 Vite의 명시적 development mode로 판단해 비표준 NODE_ENV에서도 fail-closed
 */
const STORAGE_ENABLED: boolean =
  import.meta.env.MODE === 'development' || import.meta.env.MODE === 'test'

interface StoredEntry {
  canvasId: string
  userName: string
  userId: string
  canvasData: string // JSON.stringify(Record<pageNum, json>)
  registeredAt: string
  version: number
}

function getStorageKey(fileName: string): string {
  return STORAGE_PREFIX + fileName
}

/** 파일명 기준 저장 이력 전체 조회 (최신 버전 우선) — production은 항상 빈 배열 */
export function loadHistory(fileName: string): StoredEntry[] {
  if (!STORAGE_ENABLED || !fileName) return []
  try {
    const raw = localStorage.getItem(getStorageKey(fileName))
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch (e) {
    console.warn('[canvasHistoryStore] loadHistory failed:', e)
    return []
  }
}

/** 새 버전 추가 — production에서는 호출 금지 (PdfViewer가 useLocalStorageHistory로 분기) */
export function appendHistory(fileName: string, canvasData: string): StoredEntry {
  if (!STORAGE_ENABLED) {
    throw new Error('로컬 저장은 개발 모드에서만 사용 가능합니다')
  }
  const existing = loadHistory(fileName)
  const maxVersion = existing.reduce((m, e) => Math.max(m, e.version || 0), 0)
  const now = new Date()
  const entry: StoredEntry = {
    canvasId: `local-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    userName: 'Local User',
    userId: 'local',
    canvasData,
    registeredAt: formatRegisteredAt(now),
    version: maxVersion + 1
  }
  // 최신을 앞에 두어 표시 순서 유지
  const next = [entry, ...existing]
  try {
    localStorage.setItem(getStorageKey(fileName), JSON.stringify(next))
  } catch (e) {
    // 호출자(handleSave)에서 사용자 토스트로 노출 — 조용히 무시 금지
    const isQuota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)
    throw new Error(isQuota ? '브라우저 저장 공간이 가득 찼습니다' : '로컬 저장 실패', { cause: e })
  }
  return entry
}

/** 특정 파일의 이력 전체 삭제 — production no-op */
export function clearHistory(fileName: string): void {
  if (!STORAGE_ENABLED || !fileName) return
  localStorage.removeItem(getStorageKey(fileName))
}

/** 저장 항목을 UI에서 사용하는 UserCanvasInfo 형태로 변환 */
export function toUserCanvasInfoList(entries: StoredEntry[]): UserCanvasInfo[] {
  return entries.map((e) => ({
    canvasId: e.canvasId,
    userName: `${e.userName} (v${e.version})`,
    userId: e.userId,
    canvasData: e.canvasData,
    enabled: false,
    color: '',
    registeredAt: e.registeredAt
  }))
}

/** Date를 'yyyy-MM-dd HH:mm:ss' 형식 문자열로 포맷 */
function formatRegisteredAt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
