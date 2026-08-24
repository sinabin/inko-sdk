import { tick } from 'svelte'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ToolMode } from '../../types'
import {
  createZoomControl,
  ZOOM_MAX_SCALE,
  ZOOM_MIN_SCALE
} from '../interaction/zoomControl.svelte'
import { createPinchZoom } from '../interaction/pinchZoom.svelte'
import { applyZoomAnchor, captureZoomAnchor } from '../interaction/zoomAnchor'
import { createTouchActionManager, getTouchActionForTool } from '../utils/touchActionManager'

export interface ViewerInteractionControllerOptions {
  getPdfDocument: () => PDFDocumentProxy | null
  getCurrentTool: () => ToolMode
  getReadOnly: () => boolean
  getCanUndo: () => boolean
  getCanRedo: () => boolean
  onUndo: () => void
  onRedo: () => void
  onOpenSearch: () => void
  /** false이면 브라우저 기본 찾기 단축키를 그대로 통과 */
  getSearchEnabled?: () => boolean
  afterDomUpdate?: () => Promise<void>
  onFitError?: (error: unknown) => void
}

/** Viewer의 줌·제스처·touch-action과 DOM listener 생명주기를 단일 소유 */
export function createViewerInteractionController(options: ViewerInteractionControllerOptions) {
  const afterDomUpdate = options.afterDomUpdate ?? tick
  let scrollElement: HTMLElement | null = null
  let contentElement: HTMLElement | null = null
  let pinchAnchor: ReturnType<typeof captureZoomAnchor> = null
  let wheelTargetScale: number | null = null
  let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  let resizeObserver: ResizeObserver | null = null
  let zoomQueue: Promise<void> = Promise.resolve()
  let fitGeneration = 0
  let disposed = false

  let hasUserZoomed = $state(false)
  let fitWidthScale = $state(1)

  let tapCandidate = false
  let tapStartX = 0
  let tapStartY = 0
  let lastTapTime = 0
  let lastTapX = 0
  let lastTapY = 0

  let pinchZoom!: ReturnType<typeof createPinchZoom>
  const zoomControl = createZoomControl({
    minScale: ZOOM_MIN_SCALE,
    maxScale: ZOOM_MAX_SCALE,
    onZoomChange: (scale) => {
      if (pinchZoom && !pinchZoom.isPinching && pinchZoom.currentScale !== scale) {
        pinchZoom.setScale(scale)
      }
    }
  })

  /** 연속 제스처 스케일을 5% 단위로 제한하여 렌더 캐시 난립 방지 */
  function snapScale(scale: number): number {
    return Math.round(scale * 20) / 20
  }

  pinchZoom = createPinchZoom({
    minScale: ZOOM_MIN_SCALE,
    maxScale: ZOOM_MAX_SCALE,
    getScrollContainer: () => scrollElement,
    getContentElement: () => contentElement,
    onZoomStart: (focalPoint) => {
      pinchAnchor = scrollElement
        ? captureZoomAnchor(scrollElement, focalPoint.clientX, focalPoint.clientY)
        : null
    },
    onZoomEnd: async (finalScale, finalFocalPoint) => {
      hasUserZoomed = true
      const container = scrollElement
      const oldScale = zoomControl.scale
      const anchor = pinchAnchor
      pinchAnchor = null

      zoomControl.setScale(snapScale(finalScale))
      if (!container || !anchor) return

      await afterDomUpdate()
      if (disposed || container !== scrollElement) return
      applyZoomAnchor(
        container,
        { ...anchor, clientX: finalFocalPoint.clientX, clientY: finalFocalPoint.clientY },
        zoomControl.scale / oldScale
      )
    }
  })

  const touchActionManager = createTouchActionManager()

  /** 앵커를 유지하며 줌 요청을 직렬 실행 */
  function zoomAnchoredTo(targetScale: number, clientX?: number, clientY?: number): Promise<void> {
    zoomQueue = zoomQueue
      .catch(() => undefined)
      .then(() => performAnchoredZoom(targetScale, clientX, clientY))
    return zoomQueue
  }

  async function performAnchoredZoom(targetScale: number, clientX?: number, clientY?: number): Promise<void> {
    hasUserZoomed = true
    const container = scrollElement
    const oldScale = zoomControl.scale
    const nextScale = Math.max(zoomControl.minScale, Math.min(zoomControl.maxScale, targetScale))

    if (!container || nextScale === oldScale) {
      zoomControl.setScale(nextScale)
      return
    }

    const anchor = captureZoomAnchor(container, clientX, clientY)
    zoomControl.setScale(nextScale)
    if (!anchor) return

    await afterDomUpdate()
    if (disposed || container !== scrollElement) return
    applyZoomAnchor(container, anchor, nextScale / oldScale)
  }

  /** 첫 페이지 너비와 스크롤 영역의 실제 padding으로 fit-width 계산 */
  async function applyFitWidth(): Promise<void> {
    const generation = ++fitGeneration
    const container = scrollElement
    const document = options.getPdfDocument()
    if (!container || !document || disposed) return

    try {
      const page = await document.getPage(1)
      if (disposed || generation !== fitGeneration || container !== scrollElement || document !== options.getPdfDocument()) {
        return
      }

      const baseWidth = page.getViewport({ scale: 1 }).width
      if (baseWidth <= 0) return

      let padding = 32
      if (contentElement) {
        const style = getComputedStyle(contentElement)
        padding = (Number.parseFloat(style.paddingLeft) || 16) +
          (Number.parseFloat(style.paddingRight) || 16)
      }
      const availableWidth = container.clientWidth - padding
      if (availableWidth <= 0) return

      fitWidthScale = Math.max(
        zoomControl.minScale,
        Math.min(zoomControl.maxScale, availableWidth / baseWidth)
      )
      zoomControl.setScale(fitWidthScale)
    } catch (error) {
      options.onFitError?.(error)
    }
  }

  /** 명시적으로 fit 모드로 복귀하여 이후 resize에도 너비 맞춤 유지 */
  function fitToWidth(): Promise<void> {
    hasUserZoomed = false
    return applyFitWidth()
  }

  function canDoubleTapZoom(): boolean {
    return options.getReadOnly() || options.getCurrentTool() === 'select'
  }

  function toggleDoubleTapZoom(clientX: number, clientY: number): void {
    if (zoomControl.scale > fitWidthScale * 1.25) {
      void zoomAnchoredTo(fitWidthScale, clientX, clientY).then(() => {
        hasUserZoomed = false
      })
    } else {
      void zoomAnchoredTo(fitWidthScale * 2, clientX, clientY)
    }
  }

  function handleWheelZoom(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()

    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY
    const factor = Math.exp(-delta * 0.002)
    const base = wheelTargetScale ?? zoomControl.scale
    wheelTargetScale = Math.max(
      zoomControl.minScale,
      Math.min(zoomControl.maxScale, base * factor)
    )
    void zoomAnchoredTo(snapScale(wheelTargetScale), event.clientX, event.clientY)

    if (wheelIdleTimer) clearTimeout(wheelIdleTimer)
    wheelIdleTimer = setTimeout(() => {
      wheelIdleTimer = null
      wheelTargetScale = null
    }, 300)
  }

  function handleTouchStartForTap(event: TouchEvent): void {
    if (event.touches.length !== 1 || !canDoubleTapZoom()) {
      tapCandidate = false
      return
    }
    tapCandidate = true
    tapStartX = event.touches[0]!.clientX
    tapStartY = event.touches[0]!.clientY
  }

  function handleTouchMoveForTap(event: TouchEvent): void {
    if (!tapCandidate) return
    const touch = event.touches[0]
    if (
      !touch || event.touches.length !== 1 ||
      Math.abs(touch.clientX - tapStartX) > 10 ||
      Math.abs(touch.clientY - tapStartY) > 10
    ) {
      tapCandidate = false
    }
  }

  function handleTouchEndForTap(event: TouchEvent): void {
    if (!tapCandidate || event.touches.length > 0) {
      tapCandidate = false
      return
    }
    tapCandidate = false
    const touch = event.changedTouches[0]
    if (!touch) return

    const now = Date.now()
    const isDoubleTap = now - lastTapTime < 300 &&
      Math.abs(touch.clientX - lastTapX) < 30 &&
      Math.abs(touch.clientY - lastTapY) < 30
    if (isDoubleTap) {
      lastTapTime = 0
      toggleDoubleTapZoom(touch.clientX, touch.clientY)
      return
    }
    lastTapTime = now
    lastTapX = touch.clientX
    lastTapY = touch.clientY
  }

  function handleDoubleClick(event: MouseEvent): void {
    if (canDoubleTapZoom()) toggleDoubleTapZoom(event.clientX, event.clientY)
  }

  function detachElementListeners(): void {
    if (!scrollElement) return
    scrollElement.removeEventListener('wheel', handleWheelZoom)
    scrollElement.removeEventListener('touchstart', handleTouchStartForTap)
    scrollElement.removeEventListener('touchmove', handleTouchMoveForTap)
    scrollElement.removeEventListener('touchend', handleTouchEndForTap)
    scrollElement.removeEventListener('dblclick', handleDoubleClick)
  }

  /** PdfScrollViewer DOM 교체 시 모든 native listener와 observer를 원자적으로 재연결 */
  function setScrollElement(element: HTMLElement | null): void {
    fitGeneration++
    detachElementListeners()
    pinchZoom.detach()
    resizeObserver?.disconnect()
    resizeObserver = null
    if (resizeTimer) {
      clearTimeout(resizeTimer)
      resizeTimer = null
    }

    scrollElement = element
    contentElement = element?.querySelector<HTMLElement>('.scroll-content') ?? null
    touchActionManager.setElement(element)
    if (!element || disposed) return

    pinchZoom.attach(element)
    element.addEventListener('wheel', handleWheelZoom, { passive: false })
    element.addEventListener('touchstart', handleTouchStartForTap, { passive: true })
    element.addEventListener('touchmove', handleTouchMoveForTap, { passive: true })
    element.addEventListener('touchend', handleTouchEndForTap, { passive: true })
    element.addEventListener('dblclick', handleDoubleClick)
    syncInteractionMode()

    hasUserZoomed = false
    void applyFitWidth()
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          resizeTimer = null
          if (!hasUserZoomed) void applyFitWidth()
        }, 150)
      })
      resizeObserver.observe(element)
    }
  }

  /** 도구/readOnly 반응 상태를 touch-action에 반영 */
  function syncInteractionMode(): void {
    touchActionManager.setMode(getTouchActionForTool(options.getCurrentTool(), options.getReadOnly()))
    touchActionManager.setElement(scrollElement)
  }

  /** 전역 단축키에서 검색·줌·undo/redo 우선순위를 유지 */
  function handleGlobalKeyDown(event: KeyboardEvent): void {
    const command = event.ctrlKey || event.metaKey
    if (command && (event.key === 'f' || event.key === 'F')) {
      if (options.getSearchEnabled?.() === false) return
      event.preventDefault()
      options.onOpenSearch()
      return
    }

    const target = event.target as HTMLElement | null
    if (target && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
    )) return
    if (!command) return

    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      void zoomAnchoredTo(zoomControl.scale + zoomControl.step)
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      void zoomAnchoredTo(zoomControl.scale - zoomControl.step)
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      void fitToWidth()
      return
    }
    if (options.getReadOnly()) return

    if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault()
      if (event.shiftKey) {
        if (options.getCanRedo()) options.onRedo()
      } else if (options.getCanUndo()) {
        options.onUndo()
      }
    } else if (event.key === 'y' || event.key === 'Y') {
      event.preventDefault()
      if (options.getCanRedo()) options.onRedo()
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    fitGeneration++
    detachElementListeners()
    pinchZoom.detach()
    touchActionManager.dispose()
    resizeObserver?.disconnect()
    resizeObserver = null
    if (resizeTimer) clearTimeout(resizeTimer)
    if (wheelIdleTimer) clearTimeout(wheelIdleTimer)
    resizeTimer = null
    wheelIdleTimer = null
    scrollElement = null
    contentElement = null
  }

  return {
    get scale() { return zoomControl.scale },
    get minScale() { return zoomControl.minScale },
    get maxScale() { return zoomControl.maxScale },
    get step() { return zoomControl.step },
    get canZoomIn() { return zoomControl.canZoomIn },
    get canZoomOut() { return zoomControl.canZoomOut },
    get scalePercent() { return zoomControl.scalePercent },
    get fitWidthScale() { return fitWidthScale },
    get hasUserZoomed() { return hasUserZoomed },
    setScale: zoomControl.setScale,
    zoomAnchoredTo,
    fitToWidth,
    applyFitWidth,
    setScrollElement,
    syncInteractionMode,
    handleGlobalKeyDown,
    dispose
  }
}

export type ViewerInteractionController = ReturnType<typeof createViewerInteractionController>
