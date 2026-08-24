/**
 * postMessageBridge 단위 테스트 — iframe 메시지 프로토콜
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vite.config.ts의 순수 릴리스 가드만 검증하며 jsdom realm에서 esbuild를 로드하지 않음
vi.mock('vite', () => ({
  defineConfig: (config: unknown) => config,
  loadEnv: () => ({})
}))
vi.mock('@sveltejs/vite-plugin-svelte', () => ({ svelte: () => ({}) }))

import { assertPublicReleaseOriginPolicy } from '../../vite.config'
import {
  isInIframe,
  initPostMessageBridge,
  sendPdfLoaded,
  sendCanvasDataChanged,
  sendSaveCanvasResponse,
  sendExportPdfResponse,
  sendCloseRequest,
  sendSetOrientation,
  getViewerReadyTargetOrigins,
  __resetTrustedParentOriginForTesting
} from '../../src/lib/bridge/postMessageBridge'

describe('isInIframe', () => {
  it('window.self === window.top 인 환경(테스트)에서는 false', () => {
    expect(isInIframe()).toBe(false)
  })
})

describe('viewerReady target origin 정책', () => {
  it('production 기본값은 same-origin 하나뿐이다', () => {
    expect(getViewerReadyTargetOrigins('https://viewer.example.com', ''))
      .toEqual(['https://viewer.example.com'])
  })

  it('development도 암묵적인 localhost 예외를 추가하지 않는다', () => {
    expect(getViewerReadyTargetOrigins('http://localhost:5199', ''))
      .toEqual(['http://localhost:5199'])
  })

  it('명시한 cross-origin 호스트도 핸드셰이크 대상으로 포함한다', () => {
    expect(getViewerReadyTargetOrigins(
      'https://viewer.example.com',
      'https://app.example.com, https://review.example.com'
    )).toEqual([
      'https://viewer.example.com',
      'https://app.example.com',
      'https://review.example.com'
    ])
  })

  it('정확한 HTTP(S) origin만 허용하고 trailing slash·중복은 정규화한다', () => {
    expect(getViewerReadyTargetOrigins(
      'https://viewer.example.com',
      [
        'https://app.example.com/path',
        'https://app.example.com?tenant=a',
        'https://app.example.com#fragment',
        'https://user:pw@app.example.com',
        'file:///tmp/viewer',
        '*',
        'null',
        'not-a-url',
        'https://app.example.com/',
        'https://app.example.com'
      ].join(',')
    )).toEqual([
      'https://viewer.example.com',
      'https://app.example.com'
    ])
  })

  it('localhost와 127.0.0.1도 명시한 정확한 포트만 추가한다', () => {
    expect(getViewerReadyTargetOrigins(
      'http://localhost:5199',
      'http://127.0.0.1:5200,http://localhost:5201'
    )).toEqual([
      'http://localhost:5199',
      'http://127.0.0.1:5200',
      'http://localhost:5201'
    ])
  })
})

describe('공개 릴리스 origin 정책', () => {
  it('공개 릴리스 플래그에서 배포 전용 origin이 있으면 빌드를 거부한다', () => {
    expect(() => assertPublicReleaseOriginPolicy('true', 'http://127.0.0.1:8080'))
      .toThrow(/VITE_ALLOWED_ORIGINS to be empty/)
  })

  it('공개 릴리스는 빈 값만 허용하고 비공개 호스트 빌드는 명시 origin을 허용한다', () => {
    expect(() => assertPublicReleaseOriginPolicy('1', '   ')).not.toThrow()
    expect(() => assertPublicReleaseOriginPolicy(undefined, 'http://127.0.0.1:8080')).not.toThrow()
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
      onExportPdf: vi.fn(),
      onClearCanvas: vi.fn()
    }
    cleanup = initPostMessageBridge(cb)
  })

  afterEach(() => cleanup())

  function dispatch(type: string, data?: any) {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type, data },
      origin: window.location.origin
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

  it('exportPdf는 유효한 requestId만 별도 콜백으로 라우팅한다', () => {
    dispatch('exportPdf', { requestId: 'inko-export-1' })
    dispatch('exportPdf', { requestId: '' })
    dispatch('exportPdf', { requestId: 123 })
    expect(cb.onExportPdf).toHaveBeenCalledTimes(1)
    expect(cb.onExportPdf).toHaveBeenCalledWith('inko-export-1')
    expect(cb.onSaveCanvas).not.toHaveBeenCalled()
  })

  it('알 수 없는 type은 무시 (예외 없음)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => dispatch('totallyUnknown')).not.toThrow()
    logSpy.mockRestore()
  })

  it('type 누락 시 무시', () => {
    window.dispatchEvent(new MessageEvent('message', { data: {}, origin: window.location.origin }))
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
      onExportPdf: vi.fn(),
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

  it('localhost:8080은 설정하지 않으면 신뢰하지 않는다', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    dispatchFrom('http://localhost:8080', 'saveCanvas')
    dispatchFrom('http://127.0.0.1:8080', 'saveCanvas')
    expect(cb.onSaveCanvas).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('origin 거부'), 'http://localhost:8080')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('origin 거부'), 'http://127.0.0.1:8080')
    warnSpy.mockRestore()
  })

  it('첫 메시지로 신뢰 부모 origin 확정 후 다른 origin 거부', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 첫 메시지: same-origin → 신뢰 origin 확정
    dispatchFrom(window.location.origin, 'saveCanvas')
    expect(cb.onSaveCanvas).toHaveBeenCalledTimes(1)

    // 확정 후 다른 origin은 거부
    dispatchFrom('https://other.example.com', 'saveCanvas')
    expect(cb.onSaveCanvas).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('origin 거부'),
      'https://other.example.com'
    )
    warnSpy.mockRestore()
  })

  it('A/B가 모두 명시 허용돼도 먼저 유효 요청을 보낸 A만 pinning한다', () => {
    cleanup()
    __resetTrustedParentOriginForTesting()
    const originA = 'https://host-a.example.com'
    const originB = 'https://host-b.example.com'
    cleanup = initPostMessageBridge(cb, new Set(getViewerReadyTargetOrigins(
      window.location.origin,
      `${originA},${originB}`
    )))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    dispatchFrom(originA, 'saveCanvas')
    dispatchFrom(originB, 'saveCanvas')
    dispatchFrom(originA, 'saveCanvas')

    expect(cb.onSaveCanvas).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('origin 불일치'),
      originA,
      expect.anything(),
      originB
    )
    warnSpy.mockRestore()
  })

  it('알 수 없는 요청은 허용 origin을 pinning하지 않는다', () => {
    cleanup()
    __resetTrustedParentOriginForTesting()
    const originA = 'https://host-a.example.com'
    const originB = 'https://host-b.example.com'
    cleanup = initPostMessageBridge(cb, new Set([originA, originB]))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    dispatchFrom(originA, 'unknownCommand')
    dispatchFrom(originB, 'saveCanvas')

    expect(cb.onSaveCanvas).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  it('event.data가 객체 아니면 무시', () => {
    window.dispatchEvent(new MessageEvent('message', { data: 'plain string', origin: window.location.origin }))
    window.dispatchEvent(new MessageEvent('message', { data: null, origin: window.location.origin }))
    expect(cb.onSaveCanvas).not.toHaveBeenCalled()
  })

  it('type이 문자열 아니면 무시', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 123 },
      origin: window.location.origin
    }))
    expect(cb.onSaveCanvas).not.toHaveBeenCalled()
  })

  it('loadUserCanvasData 페이로드가 배열 아니면 빈 배열로 정규화', () => {
    dispatchFrom(window.location.origin, 'loadUserCanvasData', { not: 'array' })
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
      onExportPdf: vi.fn(),
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
      origin: window.location.origin
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
      sendExportPdfResponse('request-1', true, new ArrayBuffer(4))
      sendCloseRequest()
      sendSetOrientation('landscape')
    }).not.toThrow()
  })
})
