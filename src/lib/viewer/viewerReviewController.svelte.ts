import type { UserCanvasInfo } from '../../types'
import { parseCanvasDataRecord } from '../canvas/canvasDataCodec'
import {
  continueEditingReview,
  createReviewHistoryState,
  toggleReviewVisibility,
  type ReviewHistoryState
} from '../history/reviewHistoryModel'
import { appendHistory, loadHistory, toUserCanvasInfoList } from '../storage/canvasHistoryStore'
import type { PdfScrollViewerPort } from './viewerPorts'

export interface ViewerReviewControllerOptions {
  getScrollViewer: () => PdfScrollViewerPort | null
  getTotalPages: () => number
  getFileName: () => string
  getReadOnly: () => boolean
  useLocalStorageHistory: boolean
  loadLocalEntries?: (fileName: string) => readonly unknown[]
  appendLocalEntry?: (fileName: string, canvasData: string) => { canvasId: string }
  onLoadError?: (error: unknown) => void
}

const EMPTY_REVIEW_STATE: ReviewHistoryState = {
  entries: [],
  currentEditCanvasId: '',
  isVersionHistoryMode: false
}

/** 검토 레이어·개발용 로컬 이력·이어서 편집 전이를 단일 상태로 관리 */
export function createViewerReviewController(options: ViewerReviewControllerOptions) {
  let state = $state<ReviewHistoryState>(EMPTY_REVIEW_STATE)
  let panelVisible = $state(false)
  let autoLoadedDocument: unknown = null

  const loadLocalEntries = options.loadLocalEntries ?? ((fileName: string) =>
    toUserCanvasInfoList(loadHistory(fileName)))
  const appendLocalEntry = options.appendLocalEntry ?? ((fileName: string, canvasData: string) =>
    appendHistory(fileName, canvasData))

  function setPublicEntries(data: readonly unknown[]): void {
    state = createReviewHistoryState(data, { source: 'public-overlay' })
  }

  /** standalone 개발 이력만 로드하며 공개 호스트 저장소로 오인하지 않음 */
  function refreshLocalHistory(): void {
    if (!options.useLocalStorageHistory) return
    state = createReviewHistoryState(loadLocalEntries(options.getFileName()), {
      source: 'standalone-history'
    })
  }

  /** 현재 편집 상태 저장 뒤 방금 저장한 버전을 단일 현재 항목으로 표시 */
  function recordLocalSave(canvasData: string): UserCanvasInfo | null {
    if (!options.useLocalStorageHistory) return null
    const saved = appendLocalEntry(options.getFileName(), canvasData)
    refreshLocalHistory()
    state = continueEditingReview(state, saved.canvasId)
    return state.entries.find((entry) => entry.canvasId === saved.canvasId) ?? null
  }

  function toggleVisibility(canvasId: string, visible: boolean): void {
    state = toggleReviewVisibility(state, canvasId, visible)
  }

  /** 선택한 검토본을 엄격히 검증한 뒤 편집 캔버스 전체 상태로 교체 */
  function continueEditing(canvasId: string): boolean {
    if (options.getReadOnly()) return false
    const viewer = options.getScrollViewer()
    const entry = state.entries.find((candidate) => candidate.canvasId === canvasId)
    if (!viewer || !entry) return false

    try {
      const canvasData = parseCanvasDataRecord(entry.canvasData, options.getTotalPages())
      viewer.loadHistoryCanvasData(canvasData)
      state = continueEditingReview(state, canvasId)
      panelVisible = false
      return true
    } catch (error) {
      options.onLoadError?.(error)
      return false
    }
  }

  /** 로컬 버전 이력은 문서별 최초 1회만 최신 항목으로 이어서 편집 */
  function continueLatestLocalHistory(documentIdentity: unknown): boolean {
    if (!documentIdentity) {
      autoLoadedDocument = null
      if (state.currentEditCanvasId) state = { ...state, currentEditCanvasId: '' }
      return false
    }
    if (
      !options.useLocalStorageHistory || !state.isVersionHistoryMode ||
      options.getReadOnly() || state.entries.length === 0 ||
      autoLoadedDocument === documentIdentity || !options.getScrollViewer()
    ) return false

    autoLoadedDocument = documentIdentity
    return continueEditing(state.entries[0]!.canvasId)
  }

  function resetDocumentTracking(): void {
    autoLoadedDocument = null
  }

  function togglePanel(): boolean {
    panelVisible = !panelVisible
    return panelVisible
  }

  function closePanel(): void {
    panelVisible = false
  }

  function dispose(): void {
    state = EMPTY_REVIEW_STATE
    panelVisible = false
    autoLoadedDocument = null
  }

  return {
    get entries() { return state.entries },
    get currentEditCanvasId() { return state.currentEditCanvasId },
    get isVersionHistoryMode() { return state.isVersionHistoryMode },
    get hasEntries() { return state.entries.length > 0 },
    get panelVisible() { return panelVisible },
    setPublicEntries,
    refreshLocalHistory,
    recordLocalSave,
    toggleVisibility,
    continueEditing,
    continueLatestLocalHistory,
    resetDocumentTracking,
    togglePanel,
    closePanel,
    dispose
  }
}

export type ViewerReviewController = ReturnType<typeof createViewerReviewController>
