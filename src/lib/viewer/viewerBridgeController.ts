import type { OrientationMode } from '../../types'
import type { PdfLoader } from '../pdf/pdfLoader.svelte'
import { parseCanvasDataRecord, serializeCanvasDataMap } from '../canvas/canvasDataCodec'
import {
  flattenPdfCanvasData,
  type PdfCanvasFlattenReport
} from '../pdf/pdfCanvasFlatten'
import { rasterizePdfFlattenText } from '../pdf/pdfFlattenFont'
import {
  initPostMessageBridge,
  isInIframe,
  sendCanvasDataChanged,
  sendCloseRequest,
  sendExportFlattenedPdfResponse,
  sendExportPdfResponse,
  sendPdfLoaded,
  sendSaveCanvasResponse,
  sendSetOrientation,
  type PostMessageBridgeCallbacks
} from '../bridge/postMessageBridge'
import type { PdfScrollViewerPort } from './viewerPorts'

export type ViewerBridgeMode = 'standalone' | 'postMessage'

export interface ViewerBridgeTransport {
  isInIframe(): boolean
  initialize(callbacks: PostMessageBridgeCallbacks): () => void
  sendPdfLoaded(): void
  sendCanvasDataChanged(canvasData: string): void
  sendSaveCanvasResponse(canvasData: string, success: boolean, message?: string): boolean
  sendExportPdfResponse(requestId: string, success: boolean, bytes?: ArrayBuffer, message?: string): boolean
  sendExportFlattenedPdfResponse(
    requestId: string,
    success: boolean,
    bytes?: ArrayBuffer,
    report?: PdfCanvasFlattenReport,
    message?: string
  ): boolean
  sendCloseRequest(): void
  sendSetOrientation(orientation: OrientationMode): void
}

export interface ViewerBridgeControllerOptions {
  pdfLoader: PdfLoader
  getScrollViewer: () => PdfScrollViewerPort | null
  setReadOnly: (readOnly: boolean) => void
  onBeforeDocumentLoad: () => void
  onDocumentLoaded: () => void | Promise<void>
  onReviewData: (data: readonly unknown[]) => void
  onSave: () => void
  onClear: () => void
  onApplyConfig: (config: Record<string, unknown>) => void
  onLoadError: (message: string, error: unknown) => void
  afterDomUpdate: () => Promise<void>
  transport?: ViewerBridgeTransport
}

const DEFAULT_TRANSPORT: ViewerBridgeTransport = {
  isInIframe,
  initialize: initPostMessageBridge,
  sendPdfLoaded,
  sendCanvasDataChanged,
  sendSaveCanvasResponse,
  sendExportPdfResponse,
  sendExportFlattenedPdfResponse,
  sendCloseRequest,
  sendSetOrientation
}

/** iframe bridge callback과 PDF load/restore 완료 순서를 단일 generation으로 직렬화 */
export function createViewerBridgeController(options: ViewerBridgeControllerOptions) {
  const transport = options.transport ?? DEFAULT_TRANSPORT
  let mode: ViewerBridgeMode = 'standalone'
  let cleanupBridge: (() => void) | null = null
  let loadGeneration = 0
  let disposed = false

  async function loadDocument(load: () => Promise<boolean>): Promise<{ success: boolean; generation: number }> {
    const generation = ++loadGeneration
    options.onBeforeDocumentLoad()

    const success = await load()
    if (disposed || generation !== loadGeneration || !success || !options.pdfLoader.document) {
      return { success: false, generation }
    }

    await options.onDocumentLoaded()
    return {
      success: !disposed && generation === loadGeneration && !!options.pdfLoader.document,
      generation
    }
  }

  async function loadPdfFromUrl(url: string, fileName?: string): Promise<boolean> {
    const result = await loadDocument(() => options.pdfLoader.loadFromUrl(url, fileName))
    return result.success
  }

  async function loadPdfFromBase64(base64: string, fileName?: string): Promise<boolean> {
    const result = await loadDocument(() => options.pdfLoader.loadFromBase64(base64, fileName))
    return result.success
  }

  /** 복원 상태 주입과 첫 페이지 렌더가 모두 끝난 경우에만 pdfLoaded 송신 */
  async function completeHostLoad(generation: number, canvasData?: string): Promise<void> {
    if (disposed || generation !== loadGeneration) return

    try {
      const restoredData = canvasData
        ? parseCanvasDataRecord(canvasData, options.pdfLoader.totalPages)
        : {}
      await options.afterDomUpdate()
      if (disposed || generation !== loadGeneration) return

      const viewer = options.getScrollViewer()
      if (!viewer) throw new Error('PDF viewer did not mount')
      viewer.loadHistoryCanvasData(restoredData)
      await viewer.waitUntilFirstPageReady()
      if (!disposed && generation === loadGeneration) transport.sendPdfLoaded()
    } catch (error) {
      options.onLoadError('PDF 편집 상태를 복원할 수 없습니다', error)
    }
  }

  async function loadHostUrl(
    url: string,
    fileName: string,
    canvasData?: string,
    readOnly?: boolean
  ): Promise<void> {
    options.setReadOnly(readOnly ?? true)
    const result = await loadDocument(() => options.pdfLoader.loadFromUrl(url, fileName))
    if (result.success) await completeHostLoad(result.generation, canvasData)
  }

  async function loadHostBase64(
    base64: string,
    fileName: string,
    canvasData?: string,
    readOnly?: boolean
  ): Promise<void> {
    options.setReadOnly(readOnly ?? false)
    const result = await loadDocument(() => options.pdfLoader.loadFromBase64(base64, fileName))
    if (result.success) await completeHostLoad(result.generation, canvasData)
  }

  async function exportPdf(requestId: string): Promise<void> {
    const exportGeneration = loadGeneration
    const exportDocument = options.pdfLoader.document
    if (!exportDocument) {
      transport.sendExportPdfResponse(requestId, false, undefined, '내보낼 PDF 문서가 없습니다')
      return
    }
    try {
      const bytes = await options.pdfLoader.exportPdf()
      if (disposed || exportGeneration !== loadGeneration || options.pdfLoader.document !== exportDocument) {
        transport.sendExportPdfResponse(requestId, false, undefined, 'PDF 문서가 변경되어 내보내기를 취소했습니다')
        return
      }
      if (!bytes) {
        transport.sendExportPdfResponse(requestId, false, undefined, '내보낼 PDF 문서가 없습니다')
        return
      }
      transport.sendExportPdfResponse(requestId, true, bytes)
    } catch (error) {
      options.onLoadError('PDF 양식 데이터를 내보내지 못했습니다', error)
      transport.sendExportPdfResponse(requestId, false, undefined, 'PDF 내보내기에 실패했습니다')
    }
  }

  function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
  }

  async function exportFlattenedPdf(requestId: string): Promise<void> {
    const exportGeneration = loadGeneration
    const exportDocument = options.pdfLoader.document
    const viewer = options.getScrollViewer()
    if (!exportDocument || !viewer) {
      transport.sendExportFlattenedPdfResponse(
        requestId,
        false,
        undefined,
        undefined,
        '내보낼 PDF 문서가 없습니다'
      )
      return
    }

    try {
      // live PaperScope까지 포함한 문서 정본을 먼저 스냅샷으로 고정한다.
      const canvasMap = viewer.getAllCanvasData()
      const canvasData = serializeCanvasDataMap(canvasMap, options.pdfLoader.totalPages)
      const pdfBytes = await options.pdfLoader.exportPdf()
      if (
        !pdfBytes ||
        disposed ||
        exportGeneration !== loadGeneration ||
        options.pdfLoader.document !== exportDocument
      ) {
        transport.sendExportFlattenedPdfResponse(
          requestId,
          false,
          undefined,
          undefined,
          pdfBytes ? 'PDF 문서가 변경되어 내보내기를 취소했습니다' : '내보낼 PDF 문서가 없습니다'
        )
        return
      }

      const result = await flattenPdfCanvasData({
        pdfBytes,
        canvasData,
        ...(canvasMap.size > 0 && {
          textRasterizer: async (input) => {
            if (
              disposed ||
              exportGeneration !== loadGeneration ||
              options.pdfLoader.document !== exportDocument
            ) {
              throw new Error('PDF document changed during flattened export')
            }
            const rasterized = await rasterizePdfFlattenText(input)
            if (
              disposed ||
              exportGeneration !== loadGeneration ||
              options.pdfLoader.document !== exportDocument
            ) {
              throw new Error('PDF document changed during flattened export')
            }
            return rasterized
          }
        }),
        viewportProvider: async (pageNumber) => {
          if (
            disposed ||
            exportGeneration !== loadGeneration ||
            options.pdfLoader.document !== exportDocument
          ) {
            throw new Error('PDF document changed during flattened export')
          }
          const page = await exportDocument.getPage(pageNumber)
          return page.getViewport({ scale: 1 })
        }
      })

      if (disposed || exportGeneration !== loadGeneration || options.pdfLoader.document !== exportDocument) {
        transport.sendExportFlattenedPdfResponse(
          requestId,
          false,
          undefined,
          undefined,
          'PDF 문서가 변경되어 내보내기를 취소했습니다'
        )
        return
      }
      transport.sendExportFlattenedPdfResponse(
        requestId,
        true,
        toExactArrayBuffer(result.bytes),
        result.report
      )
    } catch (error) {
      options.onLoadError('PDF 편집 레이어를 평탄화하지 못했습니다', error)
      transport.sendExportFlattenedPdfResponse(
        requestId,
        false,
        undefined,
        undefined,
        '평탄화 PDF 내보내기에 실패했습니다'
      )
    }
  }

  function createCallbacks(): PostMessageBridgeCallbacks {
    return {
      onLoadPdfBase64: loadHostBase64,
      onLoadPdfFromUrl: loadHostUrl,
      onLoadUserCanvasData: (data) => options.onReviewData(data),
      onSaveCanvas: options.onSave,
      onExportPdf: exportPdf,
      onExportFlattenedPdf: exportFlattenedPdf,
      onClearCanvas: options.onClear,
      onApplyConfig: options.onApplyConfig
    }
  }

  function initialize(): ViewerBridgeMode {
    if (disposed || cleanupBridge) return mode
    if (transport.isInIframe()) {
      mode = 'postMessage'
      cleanupBridge = transport.initialize(createCallbacks())
    } else {
      mode = 'standalone'
    }
    return mode
  }

  function notifyCanvasChanged(canvasData: string): void {
    if (mode === 'postMessage') transport.sendCanvasDataChanged(canvasData)
  }

  function respondSave(canvasData: string, success: boolean, message?: string): boolean {
    return mode === 'postMessage' && transport.sendSaveCanvasResponse(canvasData, success, message)
  }

  function requestClose(): void {
    if (mode === 'postMessage') transport.sendCloseRequest()
  }

  function requestOrientation(orientation: OrientationMode): void {
    if (mode === 'postMessage') transport.sendSetOrientation(orientation)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    loadGeneration++
    cleanupBridge?.()
    cleanupBridge = null
  }

  return {
    get mode() { return mode },
    get isPostMessage() { return mode === 'postMessage' },
    initialize,
    loadPdfFromUrl,
    loadPdfFromBase64,
    notifyCanvasChanged,
    respondSave,
    requestClose,
    requestOrientation,
    dispose
  }
}

export type ViewerBridgeController = ReturnType<typeof createViewerBridgeController>
