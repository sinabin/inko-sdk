import { beforeEach, describe, expect, it, vi } from 'vitest'

const viewerMock = vi.hoisted(() => {
  const instances: MockBuilder[] = []
  const renderPlans: Array<Promise<void>> = []
  let beforeAppend: (() => void) | null = null

  class MockDownloadManager {}
  class MockBuilder {
    div: HTMLDivElement | null = null
    options: any
    cancel = vi.fn()
    hasEditableAnnotations = vi.fn(() => true)
    constructor(options: any) {
      this.options = options
      instances.push(this)
    }
    async render() {
      this.div = document.createElement('div')
      beforeAppend?.()
      this.options.onAppend(this.div)
      await (renderPlans.shift() ?? Promise.resolve())
    }
  }

  return {
    instances,
    renderPlans,
    get beforeAppend() { return beforeAppend },
    set beforeAppend(value: (() => void) | null) { beforeAppend = value },
    MockDownloadManager,
    MockBuilder
  }
})

vi.mock('pdfjs-dist', () => ({ version: '5.4.624' }))
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
  AnnotationLayerBuilder: viewerMock.MockBuilder,
  DownloadManager: viewerMock.MockDownloadManager
}))

import { createPdfAnnotationLayer } from '../../src/lib/pdf/pdfAnnotationLayer'

const pdfDocument = {
  annotationStorage: {},
  hasJSActions: vi.fn(async () => false),
  getFieldObjects: vi.fn(async () => null)
} as any
const renderOptions = {
  pdfPage: {} as any,
  viewport: { width: 100, height: 200 } as any,
  readOnly: false
}

beforeEach(() => {
  viewerMock.instances.length = 0
  viewerMock.renderPlans.length = 0
  viewerMock.beforeAppend = null
})

describe('annotation layer stale and failure branches', () => {
  it('reports editable annotations only while an active builder exists', async () => {
    const layer = createPdfAnnotationLayer({
      pdfDocument,
      linkService: {} as any,
      imageResourcesPath: '   '
    })
    expect(layer.hasEditableAnnotations).toBe(false)

    await layer.render(renderOptions)
    expect(layer.hasEditableAnnotations).toBe(true)

    layer.cancel()
    expect(layer.hasEditableAnnotations).toBe(false)
  })

  it('drops a render cancelled before the viewer module is ready', async () => {
    const layer = createPdfAnnotationLayer({ pdfDocument, linkService: {} as any })

    const rendering = layer.render(renderOptions)
    layer.cancel()

    await expect(rendering).resolves.toBeNull()
    expect(viewerMock.instances).toHaveLength(0)
  })

  it('removes a DOM layer appended after its generation became stale', async () => {
    const appended = vi.fn()
    const layer = createPdfAnnotationLayer({
      pdfDocument,
      linkService: {} as any,
      onAppend: appended
    })
    viewerMock.beforeAppend = () => layer.cancel()

    await expect(layer.render(renderOptions)).resolves.toBeNull()

    expect(appended).not.toHaveBeenCalled()
    expect(viewerMock.instances[0].div?.isConnected).toBe(false)
    expect(viewerMock.instances[0].cancel).toHaveBeenCalled()
  })

  it('clears the active layer and propagates a current render failure', async () => {
    const failure = new Error('annotation render failed')
    viewerMock.renderPlans.push(Promise.reject(failure))
    const layer = createPdfAnnotationLayer({ pdfDocument, linkService: {} as any })

    await expect(layer.render(renderOptions)).rejects.toBe(failure)

    expect(viewerMock.instances[0].cancel).toHaveBeenCalled()
    expect(layer.div).toBeNull()
  })
})
