/** 디바이스 성능 감지 및 최적 설정 자동 결정 (Galaxy Tab S9 FE+ 기준) */

export interface DeviceConfig {
  maxRenderedPages: number // 최대 동시 렌더링 페이지 수
  renderCacheMaxMB: number // 렌더 캐시 메모리 한도 (MB)
  devicePixelRatio: number // PDF 렌더링용 DPR
  canvasPixelRatio: number // Paper.js 캔버스용 DPR
  bufferPages: number // 뷰포트 밖 버퍼 페이지 수
  isHighDensity: boolean // 고해상도 디바이스 여부
  isTouchDevice: boolean // 터치 디바이스 여부
}

/** 현재 디바이스 설정 반환 */
export function getDeviceConfig(): DeviceConfig {
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const dpr = window.devicePixelRatio || 1

  // PDF 렌더링용 DPR (메모리 집약적이므로 1.5 제한)
  const pdfDpr = Math.min(dpr, 1.5)

  // Paper.js 드로잉용 DPR (가벼우므로 2.0까지 허용, 선명도 향상)
  const canvasDpr = Math.min(dpr, 2.0)

  // 고해상도 기기 판별
  const isHighDensity = dpr > 1.5

  return {
    maxRenderedPages: 15,
    renderCacheMaxMB: 200,
    devicePixelRatio: pdfDpr,
    canvasPixelRatio: canvasDpr,
    bufferPages: 3,
    isHighDensity,
    isTouchDevice
  }
}

/** 줌 레벨에 따른 최대 렌더 페이지 수 반환 */
export function getMaxRenderedPages(scale: number): number {
  if (scale < 0.5) return 25
  if (scale < 0.7) return 20
  if (scale < 1.0) return 15
  return 10
}

/** 줌 레벨에 따른 캐시 메모리 한도(MB) 반환 */
export function getCacheMemoryLimit(scale: number): number {
  // 확대 시 메모리 사용량 증가 → 캐시 축소
  if (scale >= 1.5) return 120
  if (scale >= 1.0) return 160
  return 200
}

/** 화면 크기에 따른 버퍼 페이지 수 반환 */
export function getBufferPages(): number {
  const viewportHeight = window.innerHeight

  // 대형 화면(태블릿)은 버퍼 확대
  if (viewportHeight > 1000) return 3
  if (viewportHeight > 600) return 2
  return 1
}

/** 뷰포트 치수 반환 */
export function getViewportDimensions(): { width: number; height: number } {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  }
}

/** 안전 영역 인셋 반환 (노치/펀치홀 대응) */
export function getSafeAreaInsets(): {
  top: number
  right: number
  bottom: number
  left: number
} {
  const computedStyle = getComputedStyle(document.documentElement)

  return {
    top: parseInt(computedStyle.getPropertyValue('--safe-area-inset-top') || '0'),
    right: parseInt(computedStyle.getPropertyValue('--safe-area-inset-right') || '0'),
    bottom: parseInt(computedStyle.getPropertyValue('--safe-area-inset-bottom') || '0'),
    left: parseInt(computedStyle.getPropertyValue('--safe-area-inset-left') || '0')
  }
}

/** 최적 캔버스 렌더링 스케일 산출 */
export function getOptimalRenderScale(baseScale: number): number {
  const config = getDeviceConfig()

  // devicePixelRatio 적용하되 제한
  return baseScale * config.devicePixelRatio
}

/** 메모리 사용률 70% 초과 시 경고 여부 반환 */
export function checkMemoryWarning(): boolean {
  // Performance API의 memory 정보 사용 (Chrome/Edge)
  const performance = window.performance as Performance & {
    memory?: {
      usedJSHeapSize: number
      jsHeapSizeLimit: number
    }
  }

  if (performance.memory) {
    const usedMB = performance.memory.usedJSHeapSize / (1024 * 1024)
    const limitMB = performance.memory.jsHeapSizeLimit / (1024 * 1024)
    const usageRatio = usedMB / limitMB

    return usageRatio > 0.7
  }

  return false
}

/** 디바이스 방향(portrait/landscape) 반환 */
export function getDeviceOrientation(): 'portrait' | 'landscape' {
  if (window.matchMedia('(orientation: portrait)').matches) {
    return 'portrait'
  }
  return 'landscape'
}

/** 디바이스 방향 변경 리스너 등록, cleanup 함수 반환 */
export function onOrientationChange(callback: (orientation: 'portrait' | 'landscape') => void): () => void {
  const mediaQuery = window.matchMedia('(orientation: portrait)')

  const handler = (e: MediaQueryListEvent) => {
    callback(e.matches ? 'portrait' : 'landscape')
  }

  mediaQuery.addEventListener('change', handler)

  return () => {
    mediaQuery.removeEventListener('change', handler)
  }
}
