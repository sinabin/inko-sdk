/**
 * postMessageBridge 단위 테스트 — iframe 메시지 프로토콜
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isInIframe,
  initPostMessageBridge,
  sendPdfLoaded,
  sendCanvasDataChanged,
  sendSaveCanvasResponse,
  sendCloseRequest,
  sendSetOrientation,
  __resetTrustedParentOriginForTesting
} from '../../src/lib/bridge/postMessageBridge'

describe('isInIframe', () => {
  it('window.self === window.top 인 환경(테스트)에서는 false', () => {
    expect(isInIframe()).toBe(false)
  })
})

describe('initPostMessageBridge — 메시지 수신 라우팅', () => {
  let cleanup: () => void
  let cb: any

  beforeEach(() => {
    __resetTrustedParentOriginForTesting()
    cb = {
      onLoadPdfBase64: vi.fn(),
      onLoadPdfFromUrl: vi.fn(),
      onLoadUserCanvasData: vi.fn(),
      onSaveCanvas: vi.fn(),
      onClearCanvas: vi.fn()
    }
    cleanup = initPostMessageBridge(cb)
  })

  afterEach(() => cleanup())

  function dispatch(type: string, data?: any) {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type, data },
      origin: 'http://localhost:8080'
    }))
  }

  it('loadPdfBase64 메시지로 onLoadPdfBase64 호출', () => {
    dispatch('loadPdfBase64', { base64: 'AAAA', fileName: 'a.pdf', readOnly: true })
    expect(cb.onLoadPdfBase64).toHaveBeenCalledWith('AAAA', 'a.pdf', undefined, true)
  })

  it('loadPdfBase64에 fileName 누락 시 기본값 적용', () => {
    dispatch('loadPdfBase64', { base64: 'A' })
    expect(cb.onLoadPdfBase64).toHaveBeenCalledWith('A', 'document.pdf', undefined, undefined)
  })

  it('loadPdfFromUrl 메시지 라우팅', () => {
    dispatch('loadPdfFromUrl', { url: 'http://x/a.pdf', fileName: 'a.pdf' })
    expect(cb.onLoadPdfFromUrl).toHaveBeenCalledWith('http://x/a.pdf', 'a.pdf', undefined, undefined)
  })

  it('loadPdfFromUrl: canvasData 동반 시 콜백에 전달', () => {
    dispatch('loadPdfFromUrl', { url: 'http://x/a.pdf', fileName: 'a.pdf', canvasData: '{"1":"[]"}' })
    expect(cb.onLoadPdfFromUrl).toHaveBeenCalledWith('http://x/a.pdf', 'a.pdf', '{"1":"[]"}', undefined)
  })

  it('saveCanvas / clearCurrentCanvas / loadUserCanvasData 라우팅', () => {
    dispatch('saveCanvas')
    expect(cb.onSaveCanvas).toHaveBeenCalled()
    dispatch('clearCurrentCanvas')
    expect(cb.onClearCanvas).toHaveBeenCalled()
    dispatch('loadUserCanvasData', [{ id: 1 }])
    expect(cb.onLoadUserCanvasData).toHaveBeenCalledWith([{ id: 1 }])
  })

  it('알 수 없는 type은 무시 (예외 없음)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => dispatch('totallyUnknown')).not.toThrow()
    logSpy.mockRestore()
  })

  it('type 누락 시 무시', () => {
    window.dispatchEvent(new MessageEvent('message', { data: {}, origin: 'http://localhost:8080' }))
    expect(cb.onLoadPdfBase64).not.toHaveBeenCalled()
  })

  it('cleanup 후 메시지 수신해도 콜백 호출 안 됨', () => {
    cleanup()
    dispatch('saveCanvas')
    expect(cb.onSaveCanvas).not.toHaveBeenCalled()
  })
})

describe('initPostMessageBridge — origin 보안 검증', () => {
  let cleanup: () => void
  let cb: any

  beforeEach(() => {
    __resetTrustedParentOriginForTesting()
    cb = {
      onLoadPdfBase64: vi.fn(),
      onLoadPdfFromUrl: vi.fn(),
      onLoadUserCanvasData: vi.fn(),
      onSaveCanvas: vi.fn(),
      onClearCanvas: vi.fn()
    }
    cleanup = initPostMessageBridge(cb)
  })

  afterEach(() => cleanup())

  function dispatchFrom(origin: string, type: string, data?: any) {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type, data },
      origin
    }))
  }

  it('화이트리스트 외 origin 메시지는 거부', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    dispatchFrom('https://evil.example.com', 'saveCanvas')
    expect(cb.onSaveCanvas).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('origin 거부'), 'https://evil.example.com')
    warnSpy.mockRestore()
  })

  it('첫 메시지로 신뢰 부모 origin 확정 후 다른 origin 거부', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 첫 메시지: 화이트리스트 origin → 신뢰 origin 확정
    dispatchFrom('http://localhost:8080', 'saveCanvas')
    expect(cb.onSaveCanvas).toHaveBeenCalledTimes(1)

    // 다른 화이트리스트 origin이라도 확정 후에는 거부
    dispatchFrom('http://127.0.0.1:8080', 'saveCanvas')
    expect(cb.onSaveCanvas).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('origin 불일치'),
      'http://localhost:8080',
      expect.anything(),
      'http://127.0.0.1:8080'
    )
    warnSpy.mockRestore()
  })

  it('event.data가 객체 아니면 무시', () => {
    window.dispatchEvent(new MessageEvent('message', { data: 'plain string', origin: 'http://localhost:8080' }))
    window.dispatchEvent(new MessageEvent('message', { data: null, origin: 'http://localhost:8080' }))
    expect(cb.onSaveCanvas).not.toHaveBeenCalled()
  })

  it('type이 문자열 아니면 무시', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 123 },
      origin: 'http://localhost:8080'
    }))
    expect(cb.onSaveCanvas).not.toHaveBeenCalled()
  })

  it('loadUserCanvasData 페이로드가 배열 아니면 빈 배열로 정규화', () => {
    dispatchFrom('http://localhost:8080', 'loadUserCanvasData', { not: 'array' })
    expect(cb.onLoadUserCanvasData).toHaveBeenCalledWith([])
  })
})

describe('initPostMessageBridge — 페이로드 스키마 검증', () => {
  let cleanup: () => void
  let cb: any

  beforeEach(() => {
    __resetTrustedParentOriginForTesting()
    cb = {
      onLoadPdfBase64: vi.fn(),
      onLoadPdfFromUrl: vi.fn(),
      onLoadUserCanvasData: vi.fn(),
      onSaveCanvas: vi.fn(),
      onClearCanvas: vi.fn()
    }
    cleanup = initPostMessageBridge(cb)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function dispatch(type: string, data?: any) {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type, data },
      origin: 'http://localhost:8080'
    }))
  }

  it('loadPdfBase64: base64 누락·빈 문자열·비문자열 거부', () => {
    dispatch('loadPdfBase64', { fileName: 'a.pdf' })
    dispatch('loadPdfBase64', { base64: '', fileName: 'a.pdf' })
    dispatch('loadPdfBase64', { base64: 12345, fileName: 'a.pdf' })
    expect(cb.onLoadPdfBase64).not.toHaveBeenCalled()
  })

  it('loadPdfBase64: readOnly가 boolean 아니면 거부', () => {
    dispatch('loadPdfBase64', { base64: 'AAAA', readOnly: 'yes' })
    expect(cb.onLoadPdfBase64).not.toHaveBeenCalled()
  })

  it('loadPdfFromUrl: javascript: 스킴 거부', () => {
    dispatch('loadPdfFromUrl', { url: 'javascript:alert(1)' })
    expect(cb.onLoadPdfFromUrl).not.toHaveBeenCalled()
  })

  it('loadPdfFromUrl: data: 스킴 거부', () => {
    dispatch('loadPdfFromUrl', { url: 'data:application/pdf;base64,XYZ' })
    expect(cb.onLoadPdfFromUrl).not.toHaveBeenCalled()
  })

  it('loadPdfFromUrl: http(s)·blob:·절대경로 허용', () => {
    dispatch('loadPdfFromUrl', { url: 'https://example.com/a.pdf', fileName: 'a.pdf' })
    dispatch('loadPdfFromUrl', { url: 'blob:http://x/y' })
    dispatch('loadPdfFromUrl', { url: '/local/a.pdf' })
    expect(cb.onLoadPdfFromUrl).toHaveBeenCalledTimes(3)
  })

  it('loadPdfFromUrl: canvasData가 문자열 아니면 거부', () => {
    dispatch('loadPdfFromUrl', { url: 'http://x/a.pdf', canvasData: 12345 })
    expect(cb.onLoadPdfFromUrl).not.toHaveBeenCalled()
  })
})

describe('postMessage 송신 함수들 — 부모 없으면 silent', () => {
  it('window.parent === window 환경에서 모든 send* 함수가 예외 없이 호출됨', () => {
    expect(() => {
      sendPdfLoaded()
      sendCanvasDataChanged('data')
      sendSaveCanvasResponse('data', true, 'ok')
      sendCloseRequest()
      sendSetOrientation('landscape')
    }).not.toThrow()
  })
})
