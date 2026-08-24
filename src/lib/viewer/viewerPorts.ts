import type { CanvasDataRecord } from '../canvas/canvasDataCodec'
import type { PdfSearchMatch } from '../pdf/pdfSearch.svelte'

/** 명시적인 자원 해제 계약 */
export interface DisposablePort {
  dispose(): void
}

/** 문서 편집 상태 저장소가 페이지별 Paper manager에 요구하는 최소 계약 */
export interface PageCanvasPort extends DisposablePort {
  exportJSON(): string
  importJSON(json: string): boolean
  clear(): void
}

export type LiveCanvasDisconnectReason = 'export' | 'import' | 'clear'
export type LiveCanvasDisconnectListener = (
  pageNumber: number,
  manager: PageCanvasPort,
  reason: LiveCanvasDisconnectReason
) => void

/** 페이지별 사용자 overlay registry가 소유하는 최소 계약 */
export interface UserOverlayPort extends DisposablePort {}

/** pdf.js viewport 중 페이지 치수 계산에 필요한 최소 계약 */
export interface PdfPageViewportPort {
  readonly width: number
  readonly height: number
}

/** pdf.js page proxy 중 1.0x viewport 조회에 필요한 최소 계약 */
export interface PdfDimensionPagePort {
  getViewport(options: { scale: number }): PdfPageViewportPort
}

/** pdf.js document proxy 중 페이지 치수 조회에 필요한 최소 계약 */
export interface PdfDimensionDocumentPort {
  getPage(pageNumber: number): Promise<PdfDimensionPagePort>
}

/** PdfViewer가 스크롤 뷰어에 의존하는 기존 imperative 계약 */
export interface PdfScrollViewerPort {
  ensurePageRendered(pageNumber: number): Promise<void>
  getCanvasData(pageNumber: number): string | null
  getAllCanvasData(): Map<number, string>
  setCanvasData(pageNumber: number, pageJson: string): void
  clearCanvas(pageNumber?: number): void
  waitUntilFirstPageReady(): Promise<void>
  loadHistoryCanvasData(pageDataRecord: CanvasDataRecord): void
  addTextToCurrentPage(text: string, x: number, y: number): void
  confirmTextOnCurrentPage(text: string): void
  cancelTextOnCurrentPage(): void
  deleteSelected(): void
  getCurrentPage(): number
  undo(): boolean
  redo(): boolean
  getCanUndo(): boolean
  getCanRedo(): boolean
  scrollToPage(pageNumber: number, behavior?: ScrollBehavior): void
  focusPage(pageNumber: number, options?: FocusOptions): boolean
  scrollToSearchMatch(match: PdfSearchMatch, behavior?: ScrollBehavior): Promise<boolean>
  getScrollContainer(): HTMLElement | null
}

/** 페이지 manager registry와 문서 편집 상태 저장소 사이의 내부 계약 */
export interface DocumentCanvasStorePort extends DisposablePort {
  readonly isDisposed: boolean
  get(pageNumber: number): string | null
  getCommittedSnapshot(pageNumber: number): string | null
  getAll(): Map<number, string>
  serialize(): string
  set(pageNumber: number, pageJson: string): void
  replace(data: CanvasDataRecord | ReadonlyMap<number, string>): void
  clear(pageNumber: number): void
  clearAll(): void
  commitLiveSnapshot(pageNumber: number, manager: PageCanvasPort): boolean
  attachLivePage(pageNumber: number, manager: PageCanvasPort): boolean
  detachLivePage(pageNumber: number, manager?: PageCanvasPort): void
  subscribeLiveDisconnect(listener: LiveCanvasDisconnectListener): () => void
}
