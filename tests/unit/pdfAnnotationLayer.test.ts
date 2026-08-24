import { beforeEach, describe, expect, it, vi } from 'vitest'

const viewerMock = vi.hoisted(() => {
  const instances: MockAnnotationLayerBuilder[] = []
  const renderPlans: Array<Promise<void>> = []

  class MockDownloadManager {}

  class MockAnnotationLayerBuilder {
    div: HTMLDivElement | null = null
    cancelled = false
    options: any
    cancel = vi.fn(() => { this.cancelled = true })
    hasEditableAnnotations = vi.fn(() => true)

    constructor(options: any) {
      this.options = options
      instances.push(this)
    }

    async render(options: any) {
      this.div = document.createElement('div')
      this.div.className = 'annotationLayer'
      this.options.onAppend?.(this.div)
      await (renderPlans.shift() ?? Promise.resolve())
      return options
    }
  }

  return { instances, renderPlans, MockDownloadManager, MockAnnotationLayerBuilder }
})

vi.mock('pdfjs-dist', () => ({ version: '5.4.624' }))
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
  AnnotationLayerBuilder: viewerMock.MockAnnotationLayerBuilder,
  DownloadManager: viewerMock.MockDownloadManager
}))

import { createPdfAnnotationLayer } from '../../src/lib/pdf/pdfAnnotationLayer'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

function deferred() {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createDocument() {
  const annotationStorage = { marker: 'shared-storage' }
  return {
    annotationStorage,
    hasJSActions: vi.fn(async () => true),
    getFieldObjects: vi.fn(async () => ({ field: [] }))
  } as unknown as PDFDocumentProxy
}

const pdfPage = {} as PDFPageProxy
const viewport = { width: 600, height: 800 } as any

describe('createPdfAnnotationLayer', () => {
  beforeEach(() => {
    viewerMock.instances.length = 0
    viewerMock.renderPlans.length = 0
    document.body.replaceChildren()
  })

  it('문서의 shared annotationStorage와 annotationCanvasMap을 builder에 그대로 전달한다', async () => {
    const pdfDocument = createDocument()
    const host = document.createElement('div')
    const annotationCanvasMap = new Map<string, HTMLCanvasElement>()
    const linkService = {} as any
    const layer = createPdfAnnotationLayer({
      pdfDocument,
      linkService,
      imageResourcesPath: '/assets/pdfjs-images',
      onAppend: (div) => host.append(div)
    })

    const div = await layer.render({ pdfPage, viewport, readOnly: false, annotationCanvasMap })
    const instance = viewerMock.instances[0]

    expect(instance.options.annotationStorage).toBe(pdfDocument.annotationStorage)
    expect(instance.options.annotationCanvasMap).toBe(annotationCanvasMap)
    expect(instance.options.linkService).toBe(linkService)
    expect(instance.options.imageResourcesPath).toBe('/assets/pdfjs-images/')
    expect(instance.options.renderForms).toBe(true)
    expect(instance.options.enableScripting).toBe(false)
    await expect(instance.options.hasJSActionsPromise).resolves.toBe(true)
    await expect(instance.options.fieldObjectsPromise).resolves.toEqual({ field: [] })
    expect(div).toBe(host.firstElementChild)
    expect(div?.classList.contains('annotationLayer')).toBe(true)
    expect(div?.classList.contains('inko-annotation-layer')).toBe(true)
    expect(div?.dataset.readOnly).toBe('false')
  })

  it('readOnly에서 renderForms를 끄고 스크립트는 항상 비활성한다', async () => {
    const layer = createPdfAnnotationLayer({
      pdfDocument: createDocument(),
      linkService: {} as any
    })

    await layer.render({ pdfPage, viewport, readOnly: true })

    expect(viewerMock.instances[0].options.renderForms).toBe(false)
    expect(viewerMock.instances[0].options.enableScripting).toBe(false)
    expect(layer.div?.dataset.readOnly).toBe('true')
  })

  it('두 번째 render가 시작되면 느린 이전 builder를 cancel하고 결과를 버린다', async () => {
    const firstGate = deferred()
    viewerMock.renderPlans.push(firstGate.promise, Promise.resolve())
    const host = document.createElement('div')
    const layer = createPdfAnnotationLayer({
      pdfDocument: createDocument(),
      linkService: {} as any,
      onAppend: (div) => host.append(div)
    })

    const firstRender = layer.render({ pdfPage, viewport, readOnly: false })
    await vi.waitFor(() => expect(viewerMock.instances).toHaveLength(1))
    const firstBuilder = viewerMock.instances[0]
    const secondRender = layer.render({ pdfPage, viewport, readOnly: true })
    const secondDiv = await secondRender

    expect(firstBuilder.cancel).toHaveBeenCalledTimes(1)
    expect(host.children).toHaveLength(1)
    expect(host.firstElementChild).toBe(secondDiv)

    firstGate.resolve()
    await expect(firstRender).resolves.toBeNull()
    expect(layer.div).toBe(secondDiv)
  })

  it('cancel은 builder와 DOM을 즉시 정리하고 다음 render는 허용한다', async () => {
    const host = document.createElement('div')
    const layer = createPdfAnnotationLayer({
      pdfDocument: createDocument(),
      linkService: {} as any,
      onAppend: (div) => host.append(div)
    })

    await layer.render({ pdfPage, viewport, readOnly: false })
    const firstBuilder = viewerMock.instances[0]
    layer.cancel()

    expect(firstBuilder.cancel).toHaveBeenCalledTimes(1)
    expect(layer.div).toBeNull()
    expect(host.children).toHaveLength(0)

    await expect(layer.render({ pdfPage, viewport, readOnly: false })).resolves.toBeInstanceOf(HTMLDivElement)
  })

  it('dispose는 멱등이며 이후 render를 새로 시작하지 않는다', async () => {
    const layer = createPdfAnnotationLayer({
      pdfDocument: createDocument(),
      linkService: {} as any
    })
    await layer.render({ pdfPage, viewport, readOnly: false })
    const builder = viewerMock.instances[0]

    layer.dispose()
    layer.dispose()

    expect(builder.cancel).toHaveBeenCalledTimes(1)
    await expect(layer.render({ pdfPage, viewport, readOnly: false })).resolves.toBeNull()
    expect(viewerMock.instances).toHaveLength(1)
  })
})
