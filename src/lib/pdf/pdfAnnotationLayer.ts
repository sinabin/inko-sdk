/** PDF.js native annotation·AcroForm DOM 레이어 수명주기 관리 */
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PageViewport } from 'pdfjs-dist'
import type { PdfLinkService } from './pdfLinkService'

type PdfJsViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs')

let viewerModulePromise: Promise<PdfJsViewerModule> | null = null

/**
 * generic viewer bundle은 평가 시 `globalThis.pdfjsLib`을 참조하므로
 * core bundle 평가 후 동적 import로 순서를 보장.
 */
function loadPdfJsViewer(): Promise<PdfJsViewerModule> {
  void pdfjsLib.version
  viewerModulePromise ??= import('pdfjs-dist/web/pdf_viewer.mjs')
  return viewerModulePromise
}

export interface PdfAnnotationLayerOptions {
  pdfDocument: PDFDocumentProxy
  linkService: PdfLinkService
  /** annotation icon 경로. 끝 `/`는 자동 보정. */
  imageResourcesPath?: string
  /** 직접 자식 순서를 유지할 페이지 slot 연결 콜백 */
  onAppend?: (div: HTMLDivElement) => void
}

export interface PdfAnnotationLayerRenderOptions {
  pdfPage: PDFPageProxy
  /** DPR이 포함되지 않은 logical viewport */
  viewport: PageViewport
  /** true이면 기존 annotation은 표시하되 AcroForm HTML 입력은 비활성 */
  readOnly: boolean
  /** page.render에 전달한 것과 동일한 Map */
  annotationCanvasMap?: Map<string, HTMLCanvasElement>
}

function normalizeImageResourcesPath(path?: string): string {
  const value = path?.trim() || `${import.meta.env.BASE_URL}pdfjs-images/`
  return value.endsWith('/') ? value : `${value}/`
}

export function createPdfAnnotationLayer(options: PdfAnnotationLayerOptions) {
  const imageResourcesPath = normalizeImageResourcesPath(options.imageResourcesPath)
  let generation = 0
  let disposed = false
  let builder: InstanceType<PdfJsViewerModule['AnnotationLayerBuilder']> | null = null
  let layerDiv: HTMLDivElement | null = null

  /** 현재 builder·DOM 정리. 느린 render는 generation 검사에서 버려짐. */
  function clearActiveLayer(): void {
    builder?.cancel()
    builder = null
    layerDiv?.remove()
    layerDiv = null
  }

  async function render({
    pdfPage,
    viewport,
    readOnly,
    annotationCanvasMap
  }: PdfAnnotationLayerRenderOptions): Promise<HTMLDivElement | null> {
    if (disposed) return null

    generation += 1
    const renderGeneration = generation
    clearActiveLayer()

    const viewer = await loadPdfJsViewer()
    if (disposed || renderGeneration !== generation) return null

    const nextBuilder = new viewer.AnnotationLayerBuilder({
      pdfPage,
      linkService: options.linkService,
      downloadManager: new viewer.DownloadManager(),
      annotationStorage: options.pdfDocument.annotationStorage,
      imageResourcesPath,
      renderForms: !readOnly,
      enableScripting: false,
      hasJSActionsPromise: options.pdfDocument.hasJSActions(),
      fieldObjectsPromise: options.pdfDocument.getFieldObjects(),
      annotationCanvasMap,
      onAppend: (div: HTMLDivElement) => {
        if (disposed || renderGeneration !== generation) {
          div.remove()
          return
        }
        div.classList.add('inko-annotation-layer')
        div.dataset.readOnly = String(readOnly)
        layerDiv = div
        options.onAppend?.(div)
      }
    })

    builder = nextBuilder
    try {
      await nextBuilder.render({ viewport, intent: 'display' })
    } catch (error) {
      if (disposed || renderGeneration !== generation || builder !== nextBuilder) {
        nextBuilder.cancel()
        nextBuilder.div?.remove()
        return null
      }
      clearActiveLayer()
      throw error
    }

    if (disposed || renderGeneration !== generation || builder !== nextBuilder) {
      nextBuilder.cancel()
      nextBuilder.div?.remove()
      return null
    }
    return layerDiv
  }

  function cancel(): void {
    generation += 1
    clearActiveLayer()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    cancel()
  }

  return {
    render,
    cancel,
    dispose,
    get div() { return layerDiv },
    get hasEditableAnnotations() { return builder?.hasEditableAnnotations() ?? false }
  }
}

export type PdfAnnotationLayer = ReturnType<typeof createPdfAnnotationLayer>
