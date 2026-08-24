/** PDF 문서 로딩 모듈 (URL/Base64/ArrayBuffer 지원) */
import * as pdfjsLib from 'pdfjs-dist'
import { VerbosityLevel } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { reportError } from '../utils/errorReporter.svelte'

// Worker 설정 - 반드시 문서 로드 전에 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = import.meta.env.BASE_URL + 'pdf.worker.mjs'

// CMap/표준폰트 경로 - CJK(한중일) 폰트 렌더링에 필수
const CMAP_URL = import.meta.env.BASE_URL + 'cmaps/'
const STANDARD_FONT_DATA_URL = import.meta.env.BASE_URL + 'standard_fonts/'

/**
 * pdf.js 공통 보안·렌더 옵션
 * - isEvalSupported: false — PDF 내 JS 평가 차단 (악성 PDF 방어)
 * - disableAutoFetch/Stream/Range: true — 우리 입력은 base64·로컬파일·ArrayBuffer 위주로
 *   range/stream이 무관하며, 비활성화로 외부 fetch 표면 축소
 * - cMap·standardFont: 로컬 자산 경로
 */
const PDFJS_COMMON_OPTIONS = {
  cMapUrl: CMAP_URL,
  cMapPacked: true,
  standardFontDataUrl: STANDARD_FONT_DATA_URL,
  verbosity: VerbosityLevel.ERRORS,
  isEvalSupported: false,
  disableAutoFetch: true,
  disableStream: true,
  disableRange: true
} as const

export function createPdfLoader() {
  let document = $state<PDFDocumentProxy | null>(null)
  let totalPages = $state(0)
  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let fileName = $state('')

  // load/unload 호출마다 증가한다. 비동기 결과는 시작 당시 generation과 일치할 때만 상태에 반영한다.
  let generation = 0
  let activeLoadingTask: PDFDocumentLoadingTask | null = null
  let activeDocument: PDFDocumentProxy | null = null

  const hasDocument = $derived(document !== null)

  /** Uint8Array view의 offset/length만 담은 독립 ArrayBuffer 생성 */
  function toExactArrayBuffer(data: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    return copy.buffer
  }

  /**
   * 파일명 안전 디코드 — URL/외부 시스템에서 받은 percent-encoded 문자열을 사람이 읽을 수 있게 복원.
   * - URL의 query string(`?token=xyz`)·hash(`#section`)는 파일명이 아니므로 strip
   * - 이미 디코드된 문자열은 변형되지 않음(영문·한글 직접 문자는 인코딩 대상 아님)
   * - malformed sequence면 원본 반환 (decodeURIComponent throw 방어)
   */
  function decodeFileName(raw: string): string {
    if (!raw) return raw
    // query·hash 분리 — `file.pdf?token=xyz` → `file.pdf`
    let cleaned = raw.split('?')[0].split('#')[0]
    if (!cleaned) cleaned = raw
    // %로 시작하는 escape sequence가 없으면 디코드 불필요
    if (!cleaned.includes('%')) return cleaned
    try {
      return decodeURIComponent(cleaned)
    } catch {
      return cleaned
    }
  }

  /** 취소·폐기 중 오류는 상태를 다시 덮지 않도록 best-effort로 흡수한다. */
  async function disposeResources(
    loadingTask: PDFDocumentLoadingTask | null,
    loadedDocument: PDFDocumentProxy | null
  ): Promise<void> {
    const disposals: Promise<unknown>[] = []
    if (loadingTask) disposals.push(Promise.resolve().then(() => loadingTask.destroy()))
    if (loadedDocument) disposals.push(Promise.resolve().then(() => loadedDocument.destroy()))
    await Promise.allSettled(disposals)
  }

  /**
   * 모든 입력 형식의 공통 로드 경로.
   * - 새 요청은 직전 loadingTask/document를 즉시 소유권에서 분리한 뒤 취소·폐기
   * - superseded 요청의 성공·실패·finally는 현재 상태를 변경하지 않음
   * - stale 요청이 뒤늦게 문서를 반환하면 즉시 폐기
   */
  async function loadDocument(
    createLoadingTask: () => PDFDocumentLoadingTask,
    nextFileName: string
  ): Promise<boolean> {
    const loadGeneration = ++generation
    const previousLoadingTask = activeLoadingTask
    const previousDocument = activeDocument

    activeLoadingTask = null
    activeDocument = null
    document = null
    totalPages = 0
    isLoading = true
    error = null
    fileName = decodeFileName(nextFileName)

    await disposeResources(previousLoadingTask, previousDocument)
    if (generation !== loadGeneration) return false

    let loadingTask: PDFDocumentLoadingTask | null = null

    try {
      loadingTask = createLoadingTask()
      activeLoadingTask = loadingTask

      const loadedDocument = await loadingTask.promise
      if (generation !== loadGeneration || activeLoadingTask !== loadingTask) {
        await disposeResources(null, loadedDocument)
        return false
      }

      activeLoadingTask = null
      activeDocument = loadedDocument
      document = loadedDocument
      totalPages = loadedDocument.numPages
      return true
    } catch (e) {
      if (generation !== loadGeneration || activeLoadingTask !== loadingTask) return false

      activeLoadingTask = null
      error = e instanceof Error ? e.message : 'PDF 로드 실패'
      document = null
      totalPages = 0
      return false
    } finally {
      if (generation === loadGeneration) {
        if (activeLoadingTask === loadingTask) activeLoadingTask = null
        isLoading = false
      }
    }
  }

  /** URL 또는 파일 경로로 PDF 로드 */
  async function loadFromUrl(url: string, name?: string): Promise<boolean> {
    return loadDocument(
      () => pdfjsLib.getDocument({ url, ...PDFJS_COMMON_OPTIONS }),
      name || url.split('/').pop() || 'document.pdf'
    )
  }

  /** Base64 문자열로 PDF 로드 */
  async function loadFromBase64(base64: string, name?: string): Promise<boolean> {
    return loadDocument(() => {
      // Base64 디코딩
      const binaryString = atob(base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      return pdfjsLib.getDocument({ data: bytes, ...PDFJS_COMMON_OPTIONS })
    }, name || 'document.pdf')
  }

  /** ArrayBuffer 또는 Uint8Array로 PDF 로드 */
  async function loadFromArrayBuffer(
    data: ArrayBuffer | Uint8Array,
    name?: string
  ): Promise<boolean> {
    return loadDocument(
      () => pdfjsLib.getDocument({ data, ...PDFJS_COMMON_OPTIONS }),
      name || 'document.pdf'
    )
  }

  /** 특정 페이지 반환 (1-indexed) */
  async function getPage(pageNum: number): Promise<PDFPageProxy | null> {
    const currentDocument = document
    const currentGeneration = generation
    if (!currentDocument) {
      console.warn('[PdfLoader] No document loaded')
      return null
    }
    if (pageNum < 1 || pageNum > totalPages) {
      console.warn(`[PdfLoader] Invalid page number: ${pageNum}`)
      return null
    }

    try {
      const page = await currentDocument.getPage(pageNum)
      return generation === currentGeneration && document === currentDocument ? page : null
    } catch (e) {
      if (generation === currentGeneration && document === currentDocument) {
        reportError('render', `페이지 ${pageNum}을 불러올 수 없습니다`, e)
      }
      return null
    }
  }

  /** PDF 원본 데이터를 ArrayBuffer로 반환 (pdf-lib 처리용) */
  async function getDataAsArrayBuffer(): Promise<ArrayBuffer | null> {
    const currentDocument = document
    const currentGeneration = generation
    if (!currentDocument) return null

    try {
      const data = await currentDocument.getData()
      return generation === currentGeneration && document === currentDocument
        ? toExactArrayBuffer(data)
        : null
    } catch (e) {
      if (generation === currentGeneration && document === currentDocument) {
        reportError('render', 'PDF 원본 데이터 추출에 실패했습니다', e)
      }
      return null
    }
  }

  /**
   * PDF.js annotationStorage(AcroForm 포함)를 실제 PDF 바이트에 반영해 내보낸다.
   * Paper.js canvasData는 별도 상태 계약이며 이 바이너리에 합성하지 않는다.
   */
  async function exportPdf(): Promise<ArrayBuffer | null> {
    const currentDocument = document
    const currentGeneration = generation
    if (!currentDocument) return null

    try {
      const data = await currentDocument.saveDocument()
      return generation === currentGeneration && document === currentDocument
        ? toExactArrayBuffer(data)
        : null
    } catch (e) {
      if (generation === currentGeneration && document === currentDocument) {
        reportError('render', 'PDF 양식 데이터를 내보내지 못했습니다', e)
      }
      return null
    }
  }

  /** 현재 문서 언로드 */
  async function unload() {
    generation += 1
    const loadingTask = activeLoadingTask
    const loadedDocument = activeDocument

    activeLoadingTask = null
    activeDocument = null
    document = null
    totalPages = 0
    isLoading = false
    error = null
    fileName = ''

    await disposeResources(loadingTask, loadedDocument)
  }

  return {
    get document() { return document },
    get totalPages() { return totalPages },
    get isLoading() { return isLoading },
    get error() { return error },
    get fileName() { return fileName },
    get hasDocument() { return hasDocument },

    loadFromUrl,
    loadFromBase64,
    loadFromArrayBuffer,
    getPage,
    getDataAsArrayBuffer,
    exportPdf,
    unload
  }
}

export type PdfLoader = ReturnType<typeof createPdfLoader>
