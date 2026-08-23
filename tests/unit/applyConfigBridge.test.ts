/**
 * postMessageBridge — applyConfig 메시지 라우팅 단위 테스트.
 * (고객 SDK buildConfig → APPLY_CONFIG 송신 → bridge → PdfViewer.applyViewerConfig 경로의 bridge 구간)
 *
 * 기존 postMessageBridge.test.ts의 dispatch 패턴을 따른다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initPostMessageBridge,
  __resetTrustedParentOriginForTesting
} from '../../src/lib/bridge/postMessageBridge'

function makeCallbacks(extra: Record<string, unknown> = {}) {
  return {
    onLoadPdfBase64: vi.fn(),
    onLoadPdfFromUrl: vi.fn(),
    onLoadUserCanvasData: vi.fn(),
    onSaveCanvas: vi.fn(),
    onClearCanvas: vi.fn(),
    ...extra
  } as any
}

function dispatch(type: string, data?: any) {
  window.dispatchEvent(new MessageEvent('message', {
    data: data === undefined ? { type } : { type, data },
    origin: 'http://localhost:8080'
  }))
}

describe('postMessageBridge — applyConfig 라우팅 (고객 커스터마이징 경로)', () => {
  let cleanup: () => void
  let cb: any

  beforeEach(() => {
    __resetTrustedParentOriginForTesting()
    cb = makeCallbacks({ onApplyConfig: vi.fn() })
    cleanup = initPostMessageBridge(cb)
  })

  afterEach(() => cleanup())

  it('applyConfig 객체 페이로드 → onApplyConfig에 그대로 전달 (theme·tools·locale·messages)', () => {
    const config = {
      theme: { primaryColor: '#e8a045', logoUrl: 'https://example.com/logo.svg' },
      tools: { enabled: ['pen'], features: { zoom: false } },
      locale: 'en',
      messages: { 'tool.pen': 'Stylo' }
    }
    dispatch('applyConfig', config)
    expect(cb.onApplyConfig).toHaveBeenCalledTimes(1)
    expect(cb.onApplyConfig).toHaveBeenCalledWith(config)
  })

  it('data 누락 시 빈 객체로 호출 — 현 구현 계약 (applyViewerConfig가 안전 no-op 처리)', () => {
    dispatch('applyConfig')
    expect(cb.onApplyConfig).toHaveBeenCalledWith({})
  })

  it('비객체 페이로드(문자열)는 차단 — 콜백 미호출', () => {
    dispatch('applyConfig', 'primaryColor=#fff')
    expect(cb.onApplyConfig).not.toHaveBeenCalled()
  })

  it('onApplyConfig 콜백 미제공(레거시 호스트)이어도 예외 없음 — 옵셔널 계약', () => {
    cleanup()
    __resetTrustedParentOriginForTesting()
    const legacy = makeCallbacks() // onApplyConfig 없음
    cleanup = initPostMessageBridge(legacy)
    expect(() => dispatch('applyConfig', { locale: 'en' })).not.toThrow()
    expect(legacy.onSaveCanvas).not.toHaveBeenCalled()
  })

  it('다른 메시지 타입은 onApplyConfig를 호출하지 않음 (교차 라우팅 없음)', () => {
    dispatch('saveCanvas')
    dispatch('loadUserCanvasData', [{ canvasId: 'v1' }])
    expect(cb.onApplyConfig).not.toHaveBeenCalled()
    expect(cb.onSaveCanvas).toHaveBeenCalledTimes(1)
    expect(cb.onLoadUserCanvasData).toHaveBeenCalledTimes(1)
  })
})
