/** PDF.js tagged-PDF structure tree lifecycle shared by text and annotation layers. */
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'

type PdfJsViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs')
export type PdfStructTreeLayerBuilder = InstanceType<PdfJsViewerModule['StructTreeLayerBuilder']>

let viewerModulePromise: Promise<PdfJsViewerModule> | null = null

function loadPdfJsViewer(): Promise<PdfJsViewerModule> {
  void pdfjsLib.version
  viewerModulePromise ??= import('pdfjs-dist/web/pdf_viewer.mjs')
  return viewerModulePromise
}

export async function createPdfStructTreeLayer(
  pdfPage: PDFPageProxy,
  viewport: PageViewport
) {
  const viewer = await loadPdfJsViewer()
  const builder = new viewer.StructTreeLayerBuilder(pdfPage, viewport.rawDims)
  let treeDom: HTMLElement | null = null
  let disposed = false

  async function renderInto(canvas: HTMLCanvasElement | null): Promise<HTMLElement | null> {
    if (disposed) return null
    const nextTree = await builder.render() as unknown as HTMLElement | null
    if (disposed) {
      nextTree?.remove()
      return null
    }

    treeDom?.remove()
    treeDom = nextTree
    if (nextTree) {
      builder.updateTextLayer()
      if (canvas && nextTree.parentNode !== canvas) canvas.append(nextTree)
    }
    builder.show()
    return nextTree
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    treeDom?.remove()
    treeDom = null
  }

  return { builder, renderInto, dispose }
}

export type PdfStructTreeLayer = Awaited<ReturnType<typeof createPdfStructTreeLayer>>
