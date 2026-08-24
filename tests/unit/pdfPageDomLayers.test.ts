import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, unmount } from 'svelte'

const layerMocks = vi.hoisted(() => {
  const calls: string[] = []
  const structBuilder = { id: 'shared-struct-tree-builder' }
  const structDispose = vi.fn()
  const textDispose = vi.fn()
  const annotationDispose = vi.fn()
  const annotationRender = vi.fn()
  const renderInto = vi.fn(async () => {
    calls.push('structure')
    return document.createElement('span')
  })

  return {
    calls,
    structBuilder,
    structDispose,
    textDispose,
    annotationDispose,
    annotationRender,
    renderInto
  }
})

vi.mock('../../src/lib/pdf/pdfTextLayer', () => ({
  createPdfTextLayer: (options: { onAppend?: (div: HTMLDivElement) => void }) => {
    const layer: any = {
      div: null,
      render: vi.fn(async () => {
        layerMocks.calls.push('text')
        layer.div = document.createElement('div')
        options.onAppend?.(layer.div)
        return true
      }),
      dispose: layerMocks.textDispose
    }
    return layer
  }
}))

vi.mock('../../src/lib/pdf/pdfAnnotationLayer', () => ({
  createPdfAnnotationLayer: (options: { onAppend?: (div: HTMLDivElement) => void }) => {
    const layer: any = {
      div: null,
      render: layerMocks.annotationRender.mockImplementation(async (renderOptions: any) => {
        layerMocks.calls.push('annotation')
        layer.div = document.createElement('div')
        layer.div.className = 'inko-annotation-layer'
        options.onAppend?.(layer.div)
        return layer.div
      }),
      dispose: layerMocks.annotationDispose
    }
    return layer
  }
}))

vi.mock('../../src/lib/pdf/pdfStructTreeLayer', () => ({
  createPdfStructTreeLayer: vi.fn(async () => ({
    builder: layerMocks.structBuilder,
    renderInto: layerMocks.renderInto,
    dispose: layerMocks.structDispose
  }))
}))

import PdfPageDomLayers from '../../src/components/PdfPageDomLayers.svelte'

let instance: Record<string, unknown> | null = null

afterEach(() => {
  if (instance) unmount(instance)
  instance = null
  layerMocks.calls.length = 0
  layerMocks.structDispose.mockClear()
  layerMocks.textDispose.mockClear()
  layerMocks.annotationDispose.mockClear()
  layerMocks.annotationRender.mockClear()
  layerMocks.renderInto.mockClear()
  document.body.replaceChildren()
})

describe('PdfPageDomLayers tagged PDF orchestration', () => {
  it('동일한 structure tree builder를 annotation render와 text mapping에 공유한다', async () => {
    const target = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.className = 'scroll-page-canvas-pdf'
    target.append(canvas)
    document.body.append(target)
    const onReady = vi.fn()

    instance = mount(PdfPageDomLayers, {
      target,
      props: {
        pdfDocument: {} as any,
        pdfPage: { pageNumber: 2 } as any,
        viewport: {
          scale: 1,
          userUnit: 1,
          rawDims: { pageWidth: 612, pageHeight: 792 }
        } as any,
        linkService: {} as any,
        onReady
      }
    }) as Record<string, unknown>

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))

    expect(layerMocks.annotationRender).toHaveBeenCalledWith(
      expect.objectContaining({ structTreeLayer: layerMocks.structBuilder })
    )
    expect(layerMocks.renderInto).toHaveBeenCalledWith(canvas)
    expect(layerMocks.calls).toEqual(['text', 'annotation', 'structure'])

    unmount(instance)
    instance = null
    expect(layerMocks.structDispose).toHaveBeenCalledTimes(1)
    expect(layerMocks.textDispose).toHaveBeenCalledTimes(1)
    expect(layerMocks.annotationDispose).toHaveBeenCalledTimes(1)
  })
})
