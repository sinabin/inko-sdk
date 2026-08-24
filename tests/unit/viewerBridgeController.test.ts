import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfLoader } from '../../src/lib/pdf/pdfLoader.svelte'
import type {
  FlattenPdfCanvasInput,
  PdfCanvasFlattenReport
} from '../../src/lib/pdf/pdfCanvasFlatten'
import type { PostMessageBridgeCallbacks } from '../../src/lib/bridge/postMessageBridge'
import type { PdfScrollViewerPort } from '../../src/lib/viewer/viewerPorts'
import {
  createViewerBridgeController,
  type ViewerBridgeTransport
} from '../../src/lib/viewer/viewerBridgeController'

const dependencyMocks = vi.hoisted(() => ({
  flattenPdfCanvasData: vi.fn(),
  rasterizePdfFlattenText: vi.fn()
}))

vi.mock('../../src/lib/pdf/pdfCanvasFlatten', () => ({
  flattenPdfCanvasData: dependencyMocks.flattenPdfCanvasData
}))

vi.mock('../../src/lib/pdf/pdfFlattenFont', () => ({
  rasterizePdfFlattenText: dependencyMocks.rasterizePdfFlattenText
}))

const pageJson = JSON.stringify(['Layer', { children: [] }])

const flattenReport: PdfCanvasFlattenReport = {
  totalPdfPages: 2,
  requestedPages: 1,
  flattenedPages: 1,
  sourceItems: 1,
  flattenedItems: 1,
  skippedItems: 0,
  failedItems: 0,
  warnings: 0,
  hasFailures: false,
  rewroteDocument: true,
  pages: [{
    pageNumber: 1,
    sourceItems: 1,
    flattenedItems: 1,
    skippedItems: 0,
    failedItems: 0
  }],
  issuesTruncated: false,
  omittedIssues: 0,
  issues: []
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createHarness(inIframe = true) {
  let document: object | null = null
  let callbacks: PostMessageBridgeCallbacks | null = null
  const viewport = {
    width: 612,
    height: 792,
    convertToPdfPoint: vi.fn((x: number, y: number) => [x, 792 - y])
  }
  const getViewport = vi.fn(() => viewport)
  const getPage = vi.fn(async () => ({ getViewport }))
  const loadedDocument = { getPage }
  const loadFromUrl = vi.fn(async () => {
    document = loadedDocument
    return true
  })
  const loadFromBase64 = vi.fn(async () => {
    document = loadedDocument
    return true
  })
  const exportPdf = vi.fn<() => Promise<ArrayBuffer | null>>(
    async () => new Uint8Array([37, 80, 68, 70]).buffer
  )
  const pdfLoader = {
    get document() { return document },
    get totalPages() { return document ? 2 : 0 },
    get fileName() { return 'fixture.pdf' },
    loadFromUrl,
    loadFromBase64,
    exportPdf
  } as unknown as PdfLoader

  const loadHistoryCanvasData = vi.fn()
  const waitUntilFirstPageReady = vi.fn(async () => undefined)
  const getAllCanvasData = vi.fn(() => new Map<number, string>())
  const viewer = {
    loadHistoryCanvasData,
    waitUntilFirstPageReady,
    getAllCanvasData
  } as unknown as PdfScrollViewerPort
  let activeViewer: PdfScrollViewerPort | null = viewer
  const cleanup = vi.fn()
  const transport: ViewerBridgeTransport = {
    isInIframe: () => inIframe,
    initialize: vi.fn((value) => {
      callbacks = value
      return cleanup
    }),
    sendPdfLoaded: vi.fn(),
    sendCanvasDataChanged: vi.fn(),
    sendSaveCanvasResponse: vi.fn(() => true),
    sendExportPdfResponse: vi.fn(() => true),
    sendExportFlattenedPdfResponse: vi.fn(() => true),
    sendCloseRequest: vi.fn(),
    sendSetOrientation: vi.fn()
  }
  const setReadOnly = vi.fn()
  const onBeforeDocumentLoad = vi.fn()
  const onDocumentLoaded = vi.fn()
  const onReviewData = vi.fn()
  const onSave = vi.fn()
  const onClear = vi.fn()
  const onApplyConfig = vi.fn()
  const onLoadError = vi.fn()
  const controller = createViewerBridgeController({
    pdfLoader,
    getScrollViewer: () => activeViewer,
    setReadOnly,
    onBeforeDocumentLoad,
    onDocumentLoaded,
    onReviewData,
    onSave,
    onClear,
    onApplyConfig,
    onLoadError,
    afterDomUpdate: async () => undefined,
    transport
  })

  return {
    controller,
    get callbacks() { return callbacks },
    transport,
    cleanup,
    setReadOnly,
    loadFromUrl,
    loadFromBase64,
    exportPdf,
    loadHistoryCanvasData,
    waitUntilFirstPageReady,
    getAllCanvasData,
    getPage,
    getViewport,
    viewport,
    onReviewData,
    onLoadError,
    setViewer(value: PdfScrollViewerPort | null) { activeViewer = value },
    setDocument(value: object | null) { document = value }
  }
}

beforeEach(() => {
  dependencyMocks.flattenPdfCanvasData.mockReset()
  dependencyMocks.rasterizePdfFlattenText.mockReset()
})

describe('viewerBridgeController', () => {
  it('iframe callback에서 문서 준비→canvasData 복원→첫 페이지 완료→pdfLoaded 순서를 유지', async () => {
    const harness = createHarness()
    expect(harness.controller.initialize()).toBe('postMessage')
    expect(harness.callbacks).not.toBeNull()

    await Promise.resolve(harness.callbacks!.onLoadPdfFromUrl(
      '/fixture.pdf',
      'fixture.pdf',
      JSON.stringify({ 1: pageJson }),
      false
    ))

    expect(harness.setReadOnly).toHaveBeenCalledWith(false)
    expect(harness.loadFromUrl).toHaveBeenCalledWith('/fixture.pdf', 'fixture.pdf')
    expect(harness.loadHistoryCanvasData).toHaveBeenCalledWith({ 1: pageJson })
    expect(harness.waitUntilFirstPageReady).toHaveBeenCalledOnce()
    expect(harness.transport.sendPdfLoaded).toHaveBeenCalledOnce()
  })

  it('검토본·저장·clear·config callback과 송신 wrapper를 동일 bridge 인스턴스로 라우팅', () => {
    const harness = createHarness()
    harness.controller.initialize()
    const reviews = [{ canvasId: 'v1' }]
    harness.callbacks!.onLoadUserCanvasData(reviews)
    harness.callbacks!.onSaveCanvas()
    harness.callbacks!.onClearCanvas()
    harness.callbacks!.onApplyConfig?.({ locale: 'en' })
    harness.controller.notifyCanvasChanged('{}')
    expect(harness.controller.respondSave('{}', true)).toBe(true)
    harness.controller.requestClose()
    harness.controller.requestOrientation('landscape')

    expect(harness.onReviewData).toHaveBeenCalledWith(reviews)
    expect(harness.transport.sendCanvasDataChanged).toHaveBeenCalledWith('{}')
    expect(harness.transport.sendSaveCanvasResponse).toHaveBeenCalledWith('{}', true, undefined)
    expect(harness.transport.sendCloseRequest).toHaveBeenCalledOnce()
    expect(harness.transport.sendSetOrientation).toHaveBeenCalledWith('landscape')
  })

  it('손상 복원 데이터는 완료 신호를 보내지 않고 dispose 시 listener를 한 번 정리', async () => {
    const harness = createHarness()
    harness.controller.initialize()
    await Promise.resolve(harness.callbacks!.onLoadPdfBase64('base64', 'fixture.pdf', '{broken', false))
    expect(harness.onLoadError).toHaveBeenCalledOnce()
    expect(harness.transport.sendPdfLoaded).not.toHaveBeenCalled()

    harness.controller.dispose()
    harness.controller.dispose()
    expect(harness.cleanup).toHaveBeenCalledOnce()
  })

  it('PDF export 응답은 ArrayBuffer만 별도 메시지로 반환', async () => {
    const harness = createHarness()
    harness.controller.initialize()
    await Promise.resolve(harness.callbacks!.onLoadPdfFromUrl('/fixture.pdf', 'fixture.pdf'))
    await Promise.resolve(harness.callbacks!.onExportPdf?.('request-1'))
    expect(harness.transport.sendExportPdfResponse).toHaveBeenCalledWith(
      'request-1',
      true,
      expect.any(ArrayBuffer)
    )
  })

  it('평탄화 export는 문서 또는 viewer가 없으면 명시적 실패를 반환', async () => {
    const withoutDocument = createHarness()
    withoutDocument.controller.initialize()

    await Promise.resolve(withoutDocument.callbacks!.onExportFlattenedPdf?.('missing-document'))

    expect(withoutDocument.transport.sendExportFlattenedPdfResponse).toHaveBeenCalledWith(
      'missing-document',
      false,
      undefined,
      undefined,
      '내보낼 PDF 문서가 없습니다'
    )
    expect(withoutDocument.exportPdf).not.toHaveBeenCalled()

    const withoutViewer = createHarness()
    withoutViewer.controller.initialize()
    await withoutViewer.controller.loadPdfFromUrl('/fixture.pdf', 'fixture.pdf')
    withoutViewer.setViewer(null)

    await Promise.resolve(withoutViewer.callbacks!.onExportFlattenedPdf?.('missing-viewer'))

    expect(withoutViewer.transport.sendExportFlattenedPdfResponse).toHaveBeenCalledWith(
      'missing-viewer',
      false,
      undefined,
      undefined,
      '내보낼 PDF 문서가 없습니다'
    )
  })

  it('평탄화 export는 전체 canvasData·Unicode rasterizer·PDF viewport를 전달하고 exact buffer/report를 응답', async () => {
    const harness = createHarness()
    const rasterizedText = {
      pngBytes: new Uint8Array([10, 20, 30]),
      width: 30,
      height: 12,
      baselineX: 1,
      baselineY: 9
    }
    const backing = new Uint8Array([99, 1, 2, 88])
    harness.getAllCanvasData.mockReturnValue(new Map([[1, pageJson]]))
    dependencyMocks.rasterizePdfFlattenText.mockResolvedValue(rasterizedText)
    dependencyMocks.flattenPdfCanvasData.mockImplementation(
      async (input: FlattenPdfCanvasInput) => {
        expect(await input.viewportProvider!(1)).toBe(harness.viewport)
        expect(await input.textRasterizer!({
          content: '한글',
          fontSize: 12,
          leading: 14.4,
          justification: 'left',
          color: 'rgb(0 0 0)'
        })).toBe(rasterizedText)
        return { bytes: backing.subarray(1, 3), report: flattenReport }
      }
    )
    harness.controller.initialize()
    await harness.controller.loadPdfFromUrl('/fixture.pdf', 'fixture.pdf')

    await Promise.resolve(harness.callbacks!.onExportFlattenedPdf?.('flatten-success'))

    expect(dependencyMocks.rasterizePdfFlattenText).toHaveBeenCalledOnce()
    expect(dependencyMocks.flattenPdfCanvasData).toHaveBeenCalledWith(expect.objectContaining({
      pdfBytes: expect.any(ArrayBuffer),
      canvasData: JSON.stringify({ 1: pageJson }),
      textRasterizer: expect.any(Function),
      viewportProvider: expect.any(Function)
    }))
    expect(harness.getPage).toHaveBeenCalledWith(1)
    expect(harness.getViewport).toHaveBeenCalledWith({ scale: 1 })

    const response = vi.mocked(harness.transport.sendExportFlattenedPdfResponse).mock.calls[0]
    expect(response[0]).toBe('flatten-success')
    expect(response[1]).toBe(true)
    expect(Array.from(new Uint8Array(response[2]!))).toEqual([1, 2])
    expect(response[2]!.byteLength).toBe(2)
    expect(response[3]).toBe(flattenReport)
    expect(response[4]).toBeUndefined()
  })

  it('canvasData가 없으면 text rasterizer 없이 평탄화하고 엔진 오류는 구조화 실패로 반환', async () => {
    const harness = createHarness()
    dependencyMocks.flattenPdfCanvasData.mockRejectedValue(new Error('flatten failed'))
    harness.controller.initialize()
    await harness.controller.loadPdfFromUrl('/fixture.pdf', 'fixture.pdf')

    await Promise.resolve(harness.callbacks!.onExportFlattenedPdf?.('flatten-error'))

    expect(dependencyMocks.rasterizePdfFlattenText).not.toHaveBeenCalled()
    expect(dependencyMocks.flattenPdfCanvasData).toHaveBeenCalledWith(expect.objectContaining({
      canvasData: '{}'
    }))
    expect(dependencyMocks.flattenPdfCanvasData).not.toHaveBeenCalledWith(expect.objectContaining({
      textRasterizer: expect.any(Function)
    }))
    expect(harness.onLoadError).toHaveBeenCalledWith(
      'PDF 편집 레이어를 평탄화하지 못했습니다',
      expect.objectContaining({ message: 'flatten failed' })
    )
    expect(harness.transport.sendExportFlattenedPdfResponse).toHaveBeenCalledWith(
      'flatten-error',
      false,
      undefined,
      undefined,
      '평탄화 PDF 내보내기에 실패했습니다'
    )
  })

  it('PDF bytes가 없거나 export 중 load generation이 바뀌면 평탄화를 시작하지 않고 취소', async () => {
    const noBytes = createHarness()
    noBytes.controller.initialize()
    await noBytes.controller.loadPdfFromUrl('/fixture.pdf', 'fixture.pdf')
    noBytes.exportPdf.mockResolvedValueOnce(null)

    await Promise.resolve(noBytes.callbacks!.onExportFlattenedPdf?.('no-bytes'))

    expect(noBytes.transport.sendExportFlattenedPdfResponse).toHaveBeenCalledWith(
      'no-bytes',
      false,
      undefined,
      undefined,
      '내보낼 PDF 문서가 없습니다'
    )

    const stale = createHarness()
    const exportGate = deferred<ArrayBuffer | null>()
    stale.exportPdf.mockReturnValueOnce(exportGate.promise)
    stale.controller.initialize()
    await stale.controller.loadPdfFromUrl('/fixture.pdf', 'fixture.pdf')
    const exportPromise = Promise.resolve(stale.callbacks!.onExportFlattenedPdf?.('stale-bytes'))
    await vi.waitFor(() => expect(stale.exportPdf).toHaveBeenCalledOnce())
    await stale.controller.loadPdfFromUrl('/replacement.pdf', 'replacement.pdf')
    exportGate.resolve(new Uint8Array([37, 80, 68, 70]).buffer)
    await exportPromise

    expect(stale.transport.sendExportFlattenedPdfResponse).toHaveBeenCalledWith(
      'stale-bytes',
      false,
      undefined,
      undefined,
      'PDF 문서가 변경되어 내보내기를 취소했습니다'
    )
    expect(dependencyMocks.flattenPdfCanvasData).not.toHaveBeenCalled()
  })

  it('flatten 완료 뒤 generation이 바뀌면 stale 결과를 전송하지 않음', async () => {
    const staleResult = createHarness()
    const flattenGate = deferred<{ bytes: Uint8Array; report: PdfCanvasFlattenReport }>()
    dependencyMocks.flattenPdfCanvasData.mockReturnValueOnce(flattenGate.promise)
    staleResult.controller.initialize()
    await staleResult.controller.loadPdfFromUrl('/fixture.pdf', 'fixture.pdf')
    const resultExport = Promise.resolve(staleResult.callbacks!.onExportFlattenedPdf?.('stale-result'))
    await vi.waitFor(() => expect(dependencyMocks.flattenPdfCanvasData).toHaveBeenCalledOnce())
    await staleResult.controller.loadPdfFromUrl('/replacement.pdf', 'replacement.pdf')
    flattenGate.resolve({ bytes: new Uint8Array([1]), report: flattenReport })
    await resultExport

    expect(staleResult.transport.sendExportFlattenedPdfResponse).toHaveBeenCalledWith(
      'stale-result',
      false,
      undefined,
      undefined,
      'PDF 문서가 변경되어 내보내기를 취소했습니다'
    )
  })
})
