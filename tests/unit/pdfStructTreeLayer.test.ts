import { beforeEach, describe, expect, it, vi } from 'vitest'

const viewerMock = vi.hoisted(() => {
  const instances: MockStructTreeLayerBuilder[] = []
  const renderPlans: Array<Promise<HTMLElement | null>> = []

  class MockStructTreeLayerBuilder {
    page: unknown
    rawDims: unknown
    render = vi.fn(async () => await (renderPlans.shift() ?? Promise.resolve(null)))
    updateTextLayer = vi.fn()
    show = vi.fn()

    constructor(page: unknown, rawDims: unknown) {
      this.page = page
      this.rawDims = rawDims
      instances.push(this)
    }
  }

  return { instances, renderPlans, MockStructTreeLayerBuilder }
})

vi.mock('pdfjs-dist', () => ({ version: '5.4.624' }))
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
  StructTreeLayerBuilder: viewerMock.MockStructTreeLayerBuilder
}))

import { createPdfStructTreeLayer } from '../../src/lib/pdf/pdfStructTreeLayer'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  viewerMock.instances.length = 0
  viewerMock.renderPlans.length = 0
  document.body.replaceChildren()
})

describe('tagged PDF structure tree lifecycle', () => {
  it('한 builder를 생성해 text mapping을 갱신하고 PDF canvas에 structure tree를 연결한다', async () => {
    const page = { pageNumber: 4 } as any
    const rawDims = { pageWidth: 612, pageHeight: 792 }
    const viewport = { rawDims } as any
    const tree = document.createElement('span')
    tree.setAttribute('role', 'heading')
    viewerMock.renderPlans.push(Promise.resolve(tree))

    const layer = await createPdfStructTreeLayer(page, viewport)
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    const rendered = await layer.renderInto(canvas)
    const builder = viewerMock.instances[0]

    expect(layer.builder).toBe(builder)
    expect(builder.page).toBe(page)
    expect(builder.rawDims).toBe(rawDims)
    expect(rendered).toBe(tree)
    expect(canvas.firstElementChild).toBe(tree)
    expect(builder.updateTextLayer).toHaveBeenCalledTimes(1)
    expect(builder.show).toHaveBeenCalledTimes(1)

    layer.dispose()
    expect(tree.isConnected).toBe(false)
  })

  it('structure tree가 없는 tagged metadata도 show로 확정하고 text mapping은 건드리지 않는다', async () => {
    viewerMock.renderPlans.push(Promise.resolve(null))
    const layer = await createPdfStructTreeLayer({} as any, { rawDims: {} } as any)
    const builder = viewerMock.instances[0]

    await expect(layer.renderInto(null)).resolves.toBeNull()

    expect(builder.updateTextLayer).not.toHaveBeenCalled()
    expect(builder.show).toHaveBeenCalledTimes(1)
  })

  it('dispose 중 완료된 느린 render 결과를 버리고 접근성 tree를 노출하지 않는다', async () => {
    const gate = deferred<HTMLElement | null>()
    viewerMock.renderPlans.push(gate.promise)
    const layer = await createPdfStructTreeLayer({} as any, { rawDims: {} } as any)
    const builder = viewerMock.instances[0]
    const tree = document.createElement('span')
    const canvas = document.createElement('canvas')

    const rendering = layer.renderInto(canvas)
    layer.dispose()
    gate.resolve(tree)

    await expect(rendering).resolves.toBeNull()
    expect(tree.isConnected).toBe(false)
    expect(canvas.children).toHaveLength(0)
    expect(builder.updateTextLayer).not.toHaveBeenCalled()
    expect(builder.show).not.toHaveBeenCalled()
  })
})
