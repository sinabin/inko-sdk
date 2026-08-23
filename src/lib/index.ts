/**
 * PDF Viewer Svelte - Library Exports
 */

// Canvas modules
export { createPaperCanvas, type PaperCanvas } from './canvas/paperCanvas.svelte'
export { createCanvasState, type CanvasState } from './canvas/canvasState.svelte'
export { createSelectionBox, type SelectionBox } from './canvas/selectionBox.svelte'
export { createUserOverlay, type UserOverlay } from './canvas/userOverlay.svelte'

// PDF modules
export { createPdfLoader, type PdfLoader } from './pdf/pdfLoader.svelte'
export { createPdfRenderer, type PdfRenderer } from './pdf/pdfRenderer.svelte'
export { createPageNavigation, type PageNavigation } from './pdf/pageNavigation.svelte'

// Tool modules
export { createBrushSettings, type BrushSettingsManager } from './tools/brushSettings.svelte'
export { createDrawingMode, type DrawingMode } from './tools/drawingMode.svelte'
export { createEraserMode, type EraserMode } from './tools/eraserMode.svelte'
export { createSelectionMode, type SelectionMode } from './tools/selectionMode.svelte'
export { createShapeTools, type ShapeTools, type ShapeType } from './tools/shapeTools.svelte'
export { createTextMode, type TextMode } from './tools/textMode.svelte'
export { createHighlighterMode, type HighlighterMode } from './tools/highlighterMode.svelte'

// Interaction modules
export { createZoomControl, type ZoomControl } from './interaction/zoomControl.svelte'
export { createPinchZoom, type PinchZoom } from './interaction/pinchZoom.svelte'

// Bridge modules
export {
  isInIframe,
  initPostMessageBridge,
  sendPdfLoaded,
  sendCanvasDataChanged,
  sendSaveCanvasResponse,
  sendCloseRequest,
  sendSetOrientation
} from './bridge/postMessageBridge'
export type { PostMessageBridgeCallbacks } from './bridge/postMessageBridge'

// Utility modules
export {
  flattenPdfWithPaperCanvas,
  flattenPdfWithCanvasImage
} from './utils/pdfFlatten'
