import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  instances: [] as any[],
  autoResolve: true,
  nextError: null as unknown
}))

vi.mock('pdfjs-dist', () => ({ version: '5.4.624' }))

vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => {
  class MockTextLayerBuilder {
    div = document.createElement('div')
    cancelCalls = 0
    renderOptions: unknown = null
    release: (() => void) | null = null
    readonly options: any
    readonly renderError: unknown

    constructor(options: any) {
      this.options = options
      this.renderError = harness.nextError
      this.div.className = 'textLayer'
      harness.instances.push(this)
    }

    async render(options: unknown) {
      this.renderOptions = options
      if (!harness.autoResolve) {
        await new Promise<void>((resolve) => {
          this.release = resolve
        })
      }
      if (this.renderError) throw this.renderError
      this.options.onAppend?.(this.div)
    }

    cancel() {
      this.cancelCalls++
    }
  }

  return { TextLayerBuilder: MockTextLayerBuilder }
})

import { createPdfTextLayer } from '../../src/lib/pdf/pdfTextLayer'

const page = { pageNumber: 1 } as any
const viewport = { width: 612, height: 792, scale: 1 } as any

describe('createPdfTextLayer', () => {
  beforeEach(() => {
    harness.instances.length = 0
    harness.autoResolve = true
    harness.nextError = null
  })

  it('core를 먼저 준비한 뒤 TextLayerBuilder로 선택·복사 레이어를 렌더한다', async () => {
    delete (globalThis as any).pdfjsLib
    const container = document.createElement('div')
    const layer = createPdfTextLayer()

    await expect(layer.render({ pdfPage: page, viewport, container })).resolves.toBe(true)

    const builder = harness.instances[0]
    expect((globalThis as any).pdfjsLib.version).toBe('5.4.624')
    expect(builder.options).toMatchObject({ pdfPage: page, enablePermissions: false })
    expect(builder.renderOptions).toEqual({
      viewport,
      textContentParams: { includeMarkedContent: true, disableNormalization: true }
    })
    expect(container.firstElementChild).toBe(builder.div)
    expect(layer.div).toBe(builder.div)
    expect(layer.isRendered).toBe(true)
  })

  it('onAppend가 있으면 고정 슬롯 등 호출부의 배치 방식을 우선한다', async () => {
    const container = document.createElement('div')
    const marker = document.createElement('span')
    container.append(marker)
    const onAppend = vi.fn((div: HTMLDivElement) => marker.before(div))
    const layer = createPdfTextLayer({ onAppend })

    await layer.render({ pdfPage: page, viewport, container })

    expect(onAppend).toHaveBeenCalledOnce()
    expect(container.children[0]).toBe(layer.div)
    expect(container.children[1]).toBe(marker)
  })

  it('사용자 지정 권한·텍스트 옵션을 공개 Builder API로 전달한다', async () => {
    const layer = createPdfTextLayer({ enablePermissions: true })
    const textContentParams = { includeMarkedContent: false, disableNormalization: false }

    await layer.render({ pdfPage: page, viewport, textContentParams })

    expect(harness.instances[0].options.enablePermissions).toBe(true)
    expect(harness.instances[0].renderOptions.textContentParams).toBe(textContentParams)
  })

  it('새 render가 시작되면 이전 지연 완료의 append를 세대 검사로 차단한다', async () => {
    harness.autoResolve = false
    const container = document.createElement('div')
    const layer = createPdfTextLayer()

    const first = layer.render({ pdfPage: page, viewport, container })
    await vi.waitFor(() => expect(harness.instances).toHaveLength(1))
    const firstBuilder = harness.instances[0]

    const secondPage = { pageNumber: 2 } as any
    const second = layer.render({ pdfPage: secondPage, viewport, container })
    await vi.waitFor(() => expect(harness.instances).toHaveLength(2))
    const secondBuilder = harness.instances[1]

    firstBuilder.release()
    await expect(first).resolves.toBe(false)
    expect(container.contains(firstBuilder.div)).toBe(false)

    secondBuilder.release()
    await expect(second).resolves.toBe(true)
    expect(container.firstElementChild).toBe(secondBuilder.div)
    expect(firstBuilder.cancelCalls).toBeGreaterThanOrEqual(1)
  })

  it('cancel은 진행 중 작업과 전역 선택 리스너를 정리하고 늦은 append를 막는다', async () => {
    harness.autoResolve = false
    const container = document.createElement('div')
    const layer = createPdfTextLayer()
    const pending = layer.render({ pdfPage: page, viewport, container })
    await vi.waitFor(() => expect(harness.instances).toHaveLength(1))
    const builder = harness.instances[0]

    layer.cancel()
    builder.release()

    await expect(pending).resolves.toBe(false)
    expect(builder.cancelCalls).toBeGreaterThanOrEqual(1)
    expect(container.childElementCount).toBe(0)
    expect(layer.div).toBeNull()
    expect(layer.isRendered).toBe(false)
  })

  it('dispose 후에는 기존 DOM을 제거하고 추가 render를 영구 거부한다', async () => {
    const container = document.createElement('div')
    const layer = createPdfTextLayer()
    await layer.render({ pdfPage: page, viewport, container })
    const builder = harness.instances[0]

    layer.dispose()

    expect(builder.cancelCalls).toBeGreaterThanOrEqual(1)
    expect(container.childElementCount).toBe(0)
    expect(layer.isDisposed).toBe(true)
    await expect(layer.render({ pdfPage: page, viewport, container })).resolves.toBe(false)
    expect(harness.instances).toHaveLength(1)
  })

  it('PDF.js 취소 예외는 false로 수렴하고 실제 렌더 오류는 호출부에 전달한다', async () => {
    harness.nextError = Object.assign(new Error('cancelled'), { name: 'AbortException' })
    await expect(createPdfTextLayer().render({ pdfPage: page, viewport })).resolves.toBe(false)

    harness.nextError = new Error('broken text stream')
    await expect(createPdfTextLayer().render({ pdfPage: page, viewport }))
      .rejects.toThrow('broken text stream')
  })
})
