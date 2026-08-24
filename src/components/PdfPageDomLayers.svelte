<script lang="ts">
  import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
  import { createPdfTextLayer, type PdfTextLayer } from '../lib/pdf/pdfTextLayer'
  import {
    createPdfAnnotationLayer,
    type PdfAnnotationLayer
  } from '../lib/pdf/pdfAnnotationLayer'
  import type { PdfLinkService } from '../lib/pdf/pdfLinkService'
  import '../lib/pdf/pdfjsLayers.css'

  export interface PdfPageDomLayersReady {
    pageNumber: number
    textLayer: HTMLDivElement | null
    annotationLayer: HTMLDivElement | null
  }

  interface Props {
    pdfDocument: PDFDocumentProxy
    pdfPage: PDFPageProxy
    /** DPR이 포함되지 않은 PDF.js logical viewport */
    viewport: PageViewport
    linkService: PdfLinkService
    /** false가 되면 진행 중 렌더를 취소하고 생성 DOM을 제거 */
    active?: boolean
    /** true면 native annotation은 표시하되 AcroForm HTML 입력은 만들지 않음 */
    readOnly?: boolean
    /** page.render에 전달한 것과 동일한 annotation canvas map */
    annotationCanvasMap?: Map<string, HTMLCanvasElement>
    /** PDF 복사 권한 강제를 TextLayerBuilder에 위임 */
    enableTextPermissions?: boolean
    imageResourcesPath?: string
    onReady?: (result: PdfPageDomLayersReady) => void
    onError?: (error: unknown) => void
  }

  let {
    pdfDocument,
    pdfPage,
    viewport,
    linkService,
    active = true,
    readOnly = false,
    annotationCanvasMap,
    enableTextPermissions = false,
    imageResourcesPath,
    onReady,
    onError
  }: Props = $props()

  let textMarker: HTMLSpanElement | null = $state(null)
  let annotationMarker: HTMLSpanElement | null = $state(null)
  let textLayer: PdfTextLayer | null = null
  let annotationLayer: PdfAnnotationLayer | null = null
  let componentGeneration = 0

  function reportError(error: unknown): void {
    try {
      onError?.(error)
    } catch {
      // 소비자 오류 콜백은 PDF.js 레이어 수명주기와 분리한다.
    }
  }

  function appendBeforeMarker(div: HTMLDivElement, marker: HTMLSpanElement | null): void {
    const parent = marker?.parentElement
    if (!parent || !marker?.isConnected) {
      div.remove()
      return
    }
    parent.insertBefore(div, marker)
  }

  /** pdf_viewer.css가 사용하는 페이지 단위 scale custom properties 설정 */
  function applyScaleProperties(container: HTMLElement, pageViewport: PageViewport): () => void {
    const names = [
      '--scale-factor',
      '--user-unit',
      '--total-scale-factor',
      '--scale-round-x',
      '--scale-round-y'
    ] as const
    const previous = new Map(names.map((name) => [name, container.style.getPropertyValue(name)]))
    container.style.setProperty('--scale-factor', String(pageViewport.scale))
    container.style.setProperty('--user-unit', String(pageViewport.userUnit || 1))
    container.style.setProperty('--total-scale-factor', 'calc(var(--scale-factor) * var(--user-unit))')
    container.style.setProperty('--scale-round-x', '1px')
    container.style.setProperty('--scale-round-y', '1px')

    return () => {
      for (const name of names) {
        const value = previous.get(name)
        if (value) container.style.setProperty(name, value)
        else container.style.removeProperty(name)
      }
    }
  }

  $effect(() => {
    const textAnchor = textMarker
    const annotationAnchor = annotationMarker
    if (!active || !textAnchor || !annotationAnchor) return

    const container = textAnchor.parentElement
    if (!container || container !== annotationAnchor.parentElement) {
      reportError(new Error('PDF DOM layer markers must share one page container'))
      return
    }

    const renderGeneration = ++componentGeneration
    const restoreScale = applyScaleProperties(container, viewport)
    const nextTextLayer = createPdfTextLayer({
      enablePermissions: enableTextPermissions,
      onAppend: (div) => {
        div.classList.add('inko-text-layer')
        appendBeforeMarker(div, textAnchor)
      }
    })
    const nextAnnotationLayer = createPdfAnnotationLayer({
      pdfDocument,
      linkService,
      imageResourcesPath,
      onAppend: (div) => appendBeforeMarker(div, annotationAnchor)
    })
    textLayer = nextTextLayer
    annotationLayer = nextAnnotationLayer

    void Promise.all([
      nextTextLayer.render({ pdfPage, viewport }),
      nextAnnotationLayer.render({
        pdfPage,
        viewport,
        readOnly,
        annotationCanvasMap
      })
    ]).then(([textRendered, annotationDiv]) => {
      if (
        renderGeneration !== componentGeneration ||
        textLayer !== nextTextLayer ||
        annotationLayer !== nextAnnotationLayer
      ) return

      onReady?.({
        pageNumber: pdfPage.pageNumber,
        textLayer: textRendered ? nextTextLayer.div : null,
        annotationLayer: annotationDiv
      })
    }).catch((error) => {
      if (renderGeneration === componentGeneration) reportError(error)
    })

    return () => {
      componentGeneration++
      nextTextLayer.dispose()
      nextAnnotationLayer.dispose()
      if (textLayer === nextTextLayer) textLayer = null
      if (annotationLayer === nextAnnotationLayer) annotationLayer = null
      restoreScale()
    }
  })
</script>

<!--
  두 marker 앞에 PDF.js 생성 div를 삽입한다. 결과 DOM은
  `.textLayer → marker → .annotationLayer → marker`이며, upstream의
  `.textLayer.selecting ~ .annotationLayer` sibling 규칙을 보존한다.
-->
<span bind:this={textMarker} class="pdfjs-layer-marker" data-layer-marker="text" aria-hidden="true"></span>
<span bind:this={annotationMarker} class="pdfjs-layer-marker" data-layer-marker="annotation" aria-hidden="true"></span>

<style>
  .pdfjs-layer-marker {
    display: none;
  }
</style>
