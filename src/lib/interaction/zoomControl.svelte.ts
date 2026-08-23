/**
 * Zoom Control Module
 * Svelte 5 runes pattern for zoom management
 */

// 줌 스케일 한계 — zoomControl·pinchZoom 등 모든 줌 경로의 단일 기준
export const ZOOM_MIN_SCALE = 0.25
export const ZOOM_MAX_SCALE = 5
export const ZOOM_STEP = 0.25

export interface ZoomControlOptions {
  initialScale?: number
  minScale?: number
  maxScale?: number
  step?: number
  onZoomChange?: (scale: number) => void
}

export function createZoomControl(options: ZoomControlOptions = {}) {
  const {
    initialScale = 1,
    minScale = ZOOM_MIN_SCALE,
    maxScale = ZOOM_MAX_SCALE,
    step = ZOOM_STEP,
    onZoomChange
  } = options

  let scale = $state(initialScale)

  const canZoomIn = $derived(scale < maxScale)
  const canZoomOut = $derived(scale > minScale)
  const scalePercent = $derived(Math.round(scale * 100))

  /**
   * Set zoom scale
   */
  function setScale(newScale: number) {
    const clampedScale = Math.max(minScale, Math.min(maxScale, newScale))
    if (clampedScale !== scale) {
      scale = clampedScale
      onZoomChange?.(scale)
    }
  }

  /**
   * Zoom in by step
   */
  function zoomIn() {
    if (canZoomIn) {
      setScale(scale + step)
    }
  }

  /**
   * Zoom out by step
   */
  function zoomOut() {
    if (canZoomOut) {
      setScale(scale - step)
    }
  }

  /**
   * Reset to initial scale
   */
  function resetZoom() {
    setScale(initialScale)
  }

  /**
   * Fit to width (requires container width and content width)
   */
  function fitToWidth(containerWidth: number, contentWidth: number) {
    if (contentWidth > 0) {
      const newScale = containerWidth / contentWidth
      setScale(newScale)
    }
  }

  /**
   * Fit to height (requires container height and content height)
   */
  function fitToHeight(containerHeight: number, contentHeight: number) {
    if (contentHeight > 0) {
      const newScale = containerHeight / contentHeight
      setScale(newScale)
    }
  }

  /**
   * Fit to container (fit both width and height)
   */
  function fitToContainer(
    containerWidth: number,
    containerHeight: number,
    contentWidth: number,
    contentHeight: number
  ) {
    if (contentWidth > 0 && contentHeight > 0) {
      const scaleX = containerWidth / contentWidth
      const scaleY = containerHeight / contentHeight
      setScale(Math.min(scaleX, scaleY))
    }
  }

  /**
   * Set zoom to specific percentage
   */
  function setZoomPercent(percent: number) {
    setScale(percent / 100)
  }

  /**
   * Zoom presets
   */
  const presets = [50, 75, 100, 125, 150, 200, 300, 400, 500]

  return {
    // State getters
    get scale() { return scale },
    get canZoomIn() { return canZoomIn },
    get canZoomOut() { return canZoomOut },
    get scalePercent() { return scalePercent },

    // Constants
    minScale,
    maxScale,
    step,
    presets,

    // Methods
    setScale,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToWidth,
    fitToHeight,
    fitToContainer,
    setZoomPercent
  }
}

// Type for the return value
export type ZoomControl = ReturnType<typeof createZoomControl>
