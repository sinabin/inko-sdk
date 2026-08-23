/**
 * Pinch Zoom Module
 * Svelte 5 runes pattern for touch pinch zoom gesture
 *
 * 책임: 두 손가락 제스처 추적 + CSS transform 실시간 프리뷰(스케일·이동)
 * 종료 후 실제 스케일 반영·스크롤 보정은 호출측(zoomAnchor 기반)이 담당 —
 * 페이지 gap·padding이 스케일되지 않아 비례식 보정은 누적 오차가 있기 때문
 */

export interface FocalPoint {
  clientX: number      // 터치 위치 (뷰포트 기준)
  clientY: number
  containerX: number   // 컨테이너 내 상대 좌표
  containerY: number
  documentX: number    // 문서 내 절대 좌표 (스크롤 포함)
  documentY: number
}

export interface PinchZoomOptions {
  element?: HTMLElement
  minScale?: number
  maxScale?: number
  onZoomStart?: (focalPoint: FocalPoint) => void
  // 프리뷰 중 스케일 변경 통지 — focalPoint는 현재 손가락 중심
  onZoomChange?: (scale: number, focalPoint: FocalPoint) => void
  // 제스처 종료 — finalFocalPoint는 마지막 손가락 중심 (이동 성분 보정용)
  onZoomEnd?: (finalScale: number, finalFocalPoint: FocalPoint) => void
  getScrollContainer?: () => HTMLElement | null
  getContentElement?: () => HTMLElement | null
}

export function createPinchZoom(options: PinchZoomOptions = {}) {
  const {
    minScale = 0.5,
    maxScale = 5,
    onZoomStart,
    onZoomChange,
    onZoomEnd,
    getScrollContainer,
    getContentElement
  } = options

  let targetElement: HTMLElement | null = null
  let isEnabled = $state(true)
  let isPinching = $state(false)
  let currentScale = $state(1)
  let centerX = $state(0)
  let centerY = $state(0)

  // Touch state
  let initialDistance = 0
  let initialScale = 1

  // Focal point state
  let initialFocalPoint: FocalPoint | null = null
  let lastFocalPoint: FocalPoint | null = null

  /**
   * Calculate distance between two touch points
   */
  function getDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX
    const dy = touch2.clientY - touch1.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  /**
   * Calculate focal point with document coordinates
   * 핀치 중심점 계산 - 문서 내 절대 좌표 포함
   */
  function getFocalPoint(touches: TouchList): FocalPoint {
    const container = getScrollContainer?.()
    const containerRect = container?.getBoundingClientRect()

    // Viewport-based touch center
    const clientX = (touches[0]!.clientX + touches[1]!.clientX) / 2
    const clientY = (touches[0]!.clientY + touches[1]!.clientY) / 2

    // Container-relative coordinates
    const containerX = containerRect ? clientX - containerRect.left : clientX
    const containerY = containerRect ? clientY - containerRect.top : clientY

    // Absolute document coordinates (scroll + container offset)
    const scrollLeft = container?.scrollLeft || 0
    const scrollTop = container?.scrollTop || 0
    const documentX = scrollLeft + containerX
    const documentY = scrollTop + containerY

    return {
      clientX,
      clientY,
      containerX,
      containerY,
      documentX,
      documentY
    }
  }

  /**
   * 핀치 중 CSS transform으로 실시간 프리뷰 (GPU 가속)
   * 실제 PDF 재렌더링 없이 transformOrigin을 핀치 시작 중심점(문서 좌표)에 두고
   * scale + 손가락 이동량 translate를 적용 — 두 손가락 팬·핀치 동시 지원.
   * 제스처 종료 시 제거 후 실제 스케일 반영
   */
  function applyTransformPreview(scaleRatio: number, focal: FocalPoint): void {
    const contentEl = getContentElement?.()
    if (!contentEl || !initialFocalPoint) return

    const { documentX, documentY } = initialFocalPoint
    const translateX = focal.clientX - initialFocalPoint.clientX
    const translateY = focal.clientY - initialFocalPoint.clientY

    contentEl.style.transition = 'none'
    contentEl.style.transformOrigin = `${documentX}px ${documentY}px`
    contentEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleRatio})`
  }

  /** 프리뷰 transform 제거 — 스크롤 보정은 호출측 onZoomEnd에서 수행 */
  function clearTransformPreview(): void {
    const contentEl = getContentElement?.()
    if (contentEl) {
      contentEl.style.transition = ''
      contentEl.style.transformOrigin = ''
      contentEl.style.transform = ''
    }
  }

  /**
   * Handle touch start
   */
  function handleTouchStart(event: TouchEvent) {
    if (!isEnabled || event.touches.length !== 2) return

    isPinching = true
    initialDistance = getDistance(event.touches[0], event.touches[1])
    initialScale = currentScale
    initialFocalPoint = getFocalPoint(event.touches)
    lastFocalPoint = initialFocalPoint

    centerX = initialFocalPoint.clientX
    centerY = initialFocalPoint.clientY

    onZoomStart?.(initialFocalPoint)
  }

  /**
   * Handle touch move
   */
  function handleTouchMove(event: TouchEvent) {
    if (!isPinching || event.touches.length !== 2) return

    const newDistance = getDistance(event.touches[0], event.touches[1])
    const scaleRatio = newDistance / initialDistance
    let newScale = initialScale * scaleRatio

    // Clamp scale
    newScale = Math.max(minScale, Math.min(maxScale, newScale))

    // Update current focal point
    const currentFocalPoint = getFocalPoint(event.touches)
    lastFocalPoint = currentFocalPoint
    centerX = currentFocalPoint.clientX
    centerY = currentFocalPoint.clientY

    // Apply CSS transform preview (scale + translate)
    const previewScaleRatio = newScale / initialScale
    applyTransformPreview(previewScaleRatio, currentFocalPoint)

    currentScale = newScale
    onZoomChange?.(newScale, currentFocalPoint)

    // Prevent default to stop scrolling during pinch
    event.preventDefault()
  }

  /**
   * Handle touch end
   */
  function handleTouchEnd(event: TouchEvent) {
    if (!isPinching) return

    if (event.touches.length < 2) {
      clearTransformPreview()
      isPinching = false

      if (lastFocalPoint) {
        onZoomEnd?.(currentScale, lastFocalPoint)
      }

      // Reset focal point state
      initialFocalPoint = null
      lastFocalPoint = null
    }
  }

  /**
   * Attach to element
   */
  function attach(element: HTMLElement) {
    detach() // Remove any existing listeners

    targetElement = element

    element.addEventListener('touchstart', handleTouchStart, { passive: false })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchEnd, { passive: true })
  }

  /**
   * Detach from element
   */
  function detach() {
    if (targetElement) {
      targetElement.removeEventListener('touchstart', handleTouchStart)
      targetElement.removeEventListener('touchmove', handleTouchMove)
      targetElement.removeEventListener('touchend', handleTouchEnd)
      targetElement.removeEventListener('touchcancel', handleTouchEnd)
      targetElement = null
    }
  }

  /**
   * Set scale externally
   */
  function setScale(scale: number) {
    currentScale = Math.max(minScale, Math.min(maxScale, scale))
  }

  /**
   * Enable/disable pinch zoom
   */
  function setEnabled(enabled: boolean) {
    isEnabled = enabled
    if (!enabled) {
      isPinching = false
    }
  }

  /**
   * Reset to initial scale
   */
  function reset() {
    currentScale = 1
    isPinching = false
    initialDistance = 0
    initialScale = 1
    initialFocalPoint = null
    lastFocalPoint = null
  }

  return {
    // State getters
    get isEnabled() { return isEnabled },
    get isPinching() { return isPinching },
    get currentScale() { return currentScale },
    get centerX() { return centerX },
    get centerY() { return centerY },

    // Methods
    attach,
    detach,
    setScale,
    setEnabled,
    reset
  }
}

// Type for the return value
export type PinchZoom = ReturnType<typeof createPinchZoom>
