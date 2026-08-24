import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdkSource = readFileSync(resolve(process.cwd(), 'public/sdk/pdfv-sdk.js'), 'utf8')

function loadSdk(): any {
  delete (window as any).Inko
  window.eval(sdkSource)
  return (window as any).Inko
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  delete (window as any).Inko
})

beforeEach(() => {
  document.body.innerHTML = '<div id="viewer"></div>'
})

describe('공개 iframe SDK 수명주기', () => {
  it('message listener를 iframe navigation/append보다 먼저 등록해 즉시 viewerReady도 받는다', () => {
    const sdk = loadSdk()
    const order: string[] = []
    const onReady = vi.fn()
    const container = document.querySelector('#viewer') as HTMLElement

    const originalAddEventListener = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListener, options?: unknown) => {
      if (type === 'message') order.push('listener')
      originalAddEventListener(type as keyof WindowEventMap, listener as EventListener, options as boolean | AddEventListenerOptions)
    }) as typeof window.addEventListener)

    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options)
      if (tagName.toLowerCase() === 'iframe') {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')
        Object.defineProperty(element, 'src', {
          configurable: true,
          get() {
            return descriptor?.get?.call(this) ?? ''
          },
          set(value: string) {
            order.push('navigation')
            descriptor?.set?.call(this, value)
          }
        })
      }
      return element
    }) as typeof document.createElement)

    const originalAppendChild = container.appendChild.bind(container)
    vi.spyOn(container, 'appendChild').mockImplementation(((node: Node) => {
      order.push('append')
      const appended = originalAppendChild(node)
      const iframe = node as HTMLIFrameElement
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'viewerReady' },
        origin: window.location.origin,
        source: iframe.contentWindow
      }))
      return appended
    }) as typeof container.appendChild)

    const viewer = sdk.mount('#viewer', {
      src: '/viewer/index.html',
      onReady
    })

    expect(sdk.version).toBe('1.2.0')
    expect(order).toEqual(['listener', 'navigation', 'append'])
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(viewer.isReady()).toBe(true)
    viewer.destroy()
  })

  it('destroy 후 iframe과 message listener를 정리한다', () => {
    const sdk = loadSdk()
    const onPdfLoaded = vi.fn()
    const viewer = sdk.mount('#viewer', {
      src: '/viewer/index.html',
      onPdfLoaded
    })
    const iframeWindow = viewer.iframe.contentWindow

    viewer.destroy()
    expect(document.querySelector('#viewer iframe')).toBeNull()

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'pdfLoaded' },
      origin: window.location.origin,
      source: iframeWindow
    }))
    expect(onPdfLoaded).not.toHaveBeenCalled()
  })

  it('exportPdf requestId 응답을 독립 ArrayBuffer Promise로 연결한다', async () => {
    const sdk = loadSdk()
    const viewer = sdk.mount('#viewer', { src: '/viewer/index.html' })
    const iframeWindow = viewer.iframe.contentWindow as Window
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'viewerReady' },
      origin: window.location.origin,
      source: iframeWindow
    }))

    const postSpy = vi.spyOn(iframeWindow, 'postMessage')
    const exported = viewer.exportPdf()
    const request = postSpy.mock.calls
      .map(([message]) => message as any)
      .find((message) => message?.type === 'exportPdf')
    expect(request?.data?.requestId).toMatch(/^inko-export-/)

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'exportPdfResponse',
        requestId: request.data.requestId,
        success: true,
        pdfBytes: bytes
      },
      origin: window.location.origin,
      source: iframeWindow
    }))

    await expect(exported).resolves.toBe(bytes)
    viewer.destroy()
  })

  it('exportFlattenedPdf 응답은 bytes와 bounded 완전성 report를 함께 반환한다', async () => {
    const sdk = loadSdk()
    const viewer = sdk.mount('#viewer', { src: '/viewer/index.html' })
    const iframeWindow = viewer.iframe.contentWindow as Window
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'viewerReady' },
      origin: window.location.origin,
      source: iframeWindow
    }))

    const postSpy = vi.spyOn(iframeWindow, 'postMessage')
    const exported = viewer.exportFlattenedPdf()
    const request = postSpy.mock.calls
      .map(([message]) => message as any)
      .find((message) => message?.type === 'exportFlattenedPdf')
    expect(request?.data?.requestId).toMatch(/^inko-export-/)

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer
    const report = {
      totalPdfPages: 1,
      requestedPages: 1,
      flattenedPages: 1,
      sourceItems: 1,
      flattenedItems: 1,
      skippedItems: 0,
      failedItems: 0,
      warnings: 0,
      omittedIssues: 0,
      hasFailures: false,
      rewroteDocument: true,
      issuesTruncated: false,
      pages: [],
      issues: []
    }
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'exportFlattenedPdfResponse',
        requestId: request.data.requestId,
        success: true,
        pdfBytes: bytes,
        report
      },
      origin: window.location.origin,
      source: iframeWindow
    }))

    await expect(exported).resolves.toEqual({ pdfBytes: bytes, report })
    viewer.destroy()
  })

  it('destroy가 미결 exportPdf를 명시적으로 reject한다', async () => {
    const sdk = loadSdk()
    const viewer = sdk.mount('#viewer', { src: '/viewer/index.html' })
    const iframeWindow = viewer.iframe.contentWindow as Window
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'viewerReady' },
      origin: window.location.origin,
      source: iframeWindow
    }))

    const exported = viewer.exportPdf()
    viewer.destroy()
    await expect(exported).rejects.toThrow(/destroyed before PDF export completed/)
  })
})
