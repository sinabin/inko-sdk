/**
 * Page Canvas Manager
 * Manages Paper.js canvas and all drawing tools for a single page
 */
import type { ToolMode } from '../../types'
import { createPaperCanvas, type PaperCanvas } from './paperCanvas.svelte'
import { createDrawingMode, type DrawingMode } from '../tools/drawingMode.svelte'
import { createEraserMode, type EraserMode } from '../tools/eraserMode.svelte'
import { createSelectionMode, type SelectionMode } from '../tools/selectionMode.svelte'
import { createShapeTools, type ShapeTools } from '../tools/shapeTools.svelte'
import { createTextMode, type TextMode } from '../tools/textMode.svelte'
import { createHighlighterMode, type HighlighterMode } from '../tools/highlighterMode.svelte'
import type { HistoryManager } from '../history'
import {
  getPaperCanvasAccessibilityState,
  type PaperCanvasAccessibilityState
} from '../accessibility/paperCanvasKeyboard'

export interface PageCanvasManagerOptions {
  onCanvasChange?: () => void
  onTextInputRequest?: (existingText?: string) => void
  onSelectionChange?: (hasSelection: boolean) => void
  onAccessibilityChange?: (state: PaperCanvasAccessibilityState) => void
  getScrollContainer?: () => HTMLElement | null
  historyManager?: HistoryManager
  pageNum?: number
  isReadOnly?: boolean // 편집 차단 — true면 도구 활성화·clear 무시 (PdfScrollViewer가 캔버스 미생성으로 1차 차단, 본 가드는 defense in depth)
}

export interface PageCanvasManager {
  // Initialization
  init: (canvas: HTMLCanvasElement, baseW: number, baseH: number, zoom: number) => void
  dispose: () => void

  // Canvas operations
  setZoom: (zoom: number) => void // 줌 변경 (데이터 보존, 시각만 변경)
  setBaseDimensions: (baseW: number, baseH: number) => void // 1.0x 논리 크기 변경
  clear: () => void
  exportJSON: () => string
  importJSON: (json: string) => boolean

  // Tool management
  setDrawingMode: (mode: ToolMode) => void
  setBrushColor: (color: string) => void
  setBrushWidth: (width: number) => void
  setBrushPressureSensitivity: (v: number) => void
  setFontSize: (size: number) => void

  // Text operations
  addText: (text: string, x: number, y: number) => void
  confirmText: (text: string) => void
  cancelText: () => void

  // Undo/Redo operations
  undo: () => boolean
  redo: () => boolean
  readonly canUndo: boolean
  readonly canRedo: boolean

  // Selection operations
  deleteSelected: () => void
  readonly hasSelection: boolean
  readonly accessibilityState: PaperCanvasAccessibilityState

  // State access
  readonly paperCanvas: PaperCanvas | null
  readonly isReady: boolean
}

export function createPageCanvasManager(options: PageCanvasManagerOptions = {}): PageCanvasManager {
  const {
    onCanvasChange,
    onTextInputRequest,
    onSelectionChange,
    onAccessibilityChange,
    getScrollContainer,
    historyManager,
    pageNum = 1,
    isReadOnly = false
  } = options

  let paperCanvas: PaperCanvas | null = null
  let drawingMode: DrawingMode | null = null
  let eraserMode: EraserMode | null = null
  let selectionMode: SelectionMode | null = null
  let shapeTools: ShapeTools | null = null
  let textMode: TextMode | null = null
  let highlighterMode: HighlighterMode | null = null

  let currentTool: ToolMode = 'select'
  let brushColor = '#000000'
  let brushWidth = 2
  let brushPressureSensitivity = 50
  let fontSize = 16

  // Multi-touch guard: 핀치 줌 등 멀티터치 제스처 중 도구 입력 차단
  let gestureBlocked = false
  let gestureBlockTimer: ReturnType<typeof setTimeout> | null = null
  let guardCanvasRef: HTMLCanvasElement | null = null
  let guardTouchStartHandler: ((e: TouchEvent) => void) | null = null
  let guardTouchEndHandler: ((e: TouchEvent) => void) | null = null
  let guardPointerDownHandler: ((e: PointerEvent) => void) | null = null

  // Brush getter for tools — pressureSensitivity는 펜 도구만 사용
  const getBrush = () => ({
    color: brushColor,
    width: brushWidth,
    pressureSensitivity: brushPressureSensitivity
  })

  function getAccessibilityState(): PaperCanvasAccessibilityState {
    return getPaperCanvasAccessibilityState(
      paperCanvas?.scope ?? null,
      selectionMode?.selectedItem ?? null,
      pageNum
    )
  }

  function emitAccessibilityState(): void {
    onAccessibilityChange?.(getAccessibilityState())
  }

  /**
   * Handle canvas change with history
   */
  function handleCanvasChange(): void {
    // Push snapshot to history
    if (historyManager && paperCanvas) {
      // selection box/cursor 같은 UI-only 객체는 history에도 저장하지 않는다.
      const json = exportJSON()
      historyManager.pushSnapshot(pageNum, json)
    }
    // Notify external callback
    onCanvasChange?.()
    emitAccessibilityState()
  }

  /**
   * 활성 도구의 진행 중인 작업 취소 (멀티터치 감지 시 호출)
   */
  function cancelActiveToolOperation(): void {
    switch (currentTool) {
      case 'pen':
        drawingMode?.cancelOperation()
        break
      case 'highlighter':
        highlighterMode?.cancelOperation()
        break
      case 'eraser':
        eraserMode?.cancelOperation()
        break
      case 'select':
        selectionMode?.cancelOperation()
        break
      case 'rectangle':
      case 'circle':
      case 'line':
        shapeTools?.cancelOperation()
        break
      case 'text':
        textMode?.cancelOperation()
        break
    }
  }

  /**
   * 멀티터치 가드 등록 — 도구 핸들러보다 먼저 등록하여 capture phase에서 차단
   * 1. touchstart에서 2+ 터치 감지 시 진행 중인 작업 취소 + gestureBlocked 활성화
   * 2. capture phase pointerdown에서 gestureBlocked 상태이면 stopImmediatePropagation
   * 3. touchend에서 터치 해제 후 300ms 쿨다운 뒤 gestureBlocked 해제
   */
  function setupMultiTouchGuard(canvas: HTMLCanvasElement): void {
    guardCanvasRef = canvas

    guardTouchStartHandler = (e: TouchEvent) => {
      if (e.touches.length >= 2 && !gestureBlocked) {
        gestureBlocked = true
        if (gestureBlockTimer) {
          clearTimeout(gestureBlockTimer)
          gestureBlockTimer = null
        }
        cancelActiveToolOperation()
      }
    }

    guardTouchEndHandler = (e: TouchEvent) => {
      if (gestureBlocked && e.touches.length < 2) {
        // 300ms 쿨다운: 핀치 직후 손가락 떼면서 실수로 드로잉 시작 방지
        if (gestureBlockTimer) clearTimeout(gestureBlockTimer)
        gestureBlockTimer = setTimeout(() => {
          gestureBlocked = false
          gestureBlockTimer = null
        }, 300)
      }
    }

    // Capture phase: 멀티터치/쿨다운 중 pointerdown 이벤트가 도구 핸들러에 도달 차단
    guardPointerDownHandler = (e: PointerEvent) => {
      if (gestureBlocked) {
        e.stopImmediatePropagation()
      }
    }

    canvas.addEventListener('touchstart', guardTouchStartHandler, { passive: true })
    canvas.addEventListener('touchend', guardTouchEndHandler, { passive: true })
    canvas.addEventListener('touchcancel', guardTouchEndHandler, { passive: true })
    canvas.addEventListener('pointerdown', guardPointerDownHandler, true) // capture phase
  }

  /** 멀티터치 가드 해제 */
  function disposeMultiTouchGuard(): void {
    if (guardCanvasRef) {
      if (guardTouchStartHandler) guardCanvasRef.removeEventListener('touchstart', guardTouchStartHandler)
      if (guardTouchEndHandler) {
        guardCanvasRef.removeEventListener('touchend', guardTouchEndHandler)
        guardCanvasRef.removeEventListener('touchcancel', guardTouchEndHandler)
      }
      if (guardPointerDownHandler) guardCanvasRef.removeEventListener('pointerdown', guardPointerDownHandler, true)
    }
    if (gestureBlockTimer) {
      clearTimeout(gestureBlockTimer)
      gestureBlockTimer = null
    }
    gestureBlocked = false
    guardCanvasRef = null
    guardTouchStartHandler = null
    guardTouchEndHandler = null
    guardPointerDownHandler = null
  }

  /**
   * Initialize canvas and tools — 1.0x baseline 크기 + 현재 zoom 으로 캔버스 셋업
   */
  function init(canvas: HTMLCanvasElement, baseW: number, baseH: number, zoom: number): void {
    // Create Paper.js canvas
    paperCanvas = createPaperCanvas()
    paperCanvas.init(canvas, baseW, baseH, zoom)

    // 멀티터치 가드를 도구 핸들러보다 먼저 등록 (capture phase 우선순위 확보)
    setupMultiTouchGuard(canvas)

    const getScope = () => paperCanvas?.scope ?? null

    // Initialize tools
    drawingMode = createDrawingMode({
      getScope,
      getBrush,
      onPathCreated: handleCanvasChange
    })

    eraserMode = createEraserMode({
      getScope,
      onEraseComplete: handleCanvasChange
    })

    selectionMode = createSelectionMode({
      getScope,
      getScrollContainer,
      onSelectionChange: (hasSelection) => {
        onSelectionChange?.(hasSelection)
        emitAccessibilityState()
      },
      onItemModified: handleCanvasChange,
      onItemDeleted: handleCanvasChange
    })

    shapeTools = createShapeTools({
      getScope,
      getBrush,
      onShapeCreated: handleCanvasChange
    })

    textMode = createTextMode({
      getScope,
      getBrush,
      getFontSize: () => fontSize,
      onTextCreated: handleCanvasChange,
      onTextEdit: handleCanvasChange,
      onRequestInput: (existingText) => {
        onTextInputRequest?.(existingText)
      }
    })

    highlighterMode = createHighlighterMode({
      getScope,
      getBrush,
      onPathCreated: handleCanvasChange
    })

    // history baseline 등록 — 빈 캔버스 상태를 currentState로 잡아 첫 그리기 후 undo 가능
    if (historyManager && paperCanvas) {
      historyManager.setBaseline(pageNum, paperCanvas.exportJSON())
    }

    // Activate default tool
    activateTool(currentTool)
    emitAccessibilityState()
  }

  /**
   * Dispose all resources
   */
  function dispose(): void {
    disposeMultiTouchGuard()

    drawingMode?.deactivate()
    eraserMode?.deactivate()
    selectionMode?.deactivate()
    shapeTools?.deactivate()
    textMode?.deactivate()
    highlighterMode?.deactivate()
    paperCanvas?.dispose()

    drawingMode = null
    eraserMode = null
    selectionMode = null
    shapeTools = null
    textMode = null
    highlighterMode = null
    paperCanvas = null
  }

  /**
   * Activate appropriate tool
   */
  function activateTool(tool: ToolMode): void {
    // Deactivate all tools first
    drawingMode?.deactivate()
    eraserMode?.deactivate()
    selectionMode?.deactivate()
    shapeTools?.deactivate()
    textMode?.deactivate()
    highlighterMode?.deactivate()

    // Activate selected tool
    switch (tool) {
      case 'pen':
        drawingMode?.activate()
        break
      case 'highlighter':
        highlighterMode?.activate()
        break
      case 'eraser':
        eraserMode?.activate()
        break
      case 'select':
        selectionMode?.activate()
        break
      case 'rectangle':
        shapeTools?.activate('rectangle')
        break
      case 'circle':
        shapeTools?.activate('circle')
        break
      case 'line':
        shapeTools?.activate('line')
        break
      case 'text':
        textMode?.activate()
        break
    }
  }

  /**
   * Set drawing mode
   * readOnly: 편집 도구는 차단, 'select'(읽기성 — 선택만 가능)는 허용
   */
  function setDrawingMode(mode: ToolMode): void {
    if (isReadOnly && mode !== 'select') {
      currentTool = 'select'
      return
    }
    currentTool = mode
    if (paperCanvas?.isReady) {
      activateTool(mode)
      emitAccessibilityState()
    }
  }

  /**
   * Set brush color
   */
  function setBrushColor(color: string): void {
    brushColor = color
  }

  /**
   * Set brush width
   */
  function setBrushWidth(width: number): void {
    brushWidth = width
  }

  /** 필압 감도 0-100 — drawingMode pressureGain에 곱해질 비율 */
  function setBrushPressureSensitivity(v: number): void {
    brushPressureSensitivity = v
  }

  /**
   * Set font size
   */
  function setFontSize(size: number): void {
    fontSize = size
  }

  /** 줌 변경 — 데이터 보존, view.zoom·viewSize만 갱신 */
  function setZoom(zoom: number): void {
    paperCanvas?.setZoom(zoom)
  }

  /** 1.0x 논리 크기 변경 (PDF 페이지 크기가 바뀌는 경우만 호출) */
  function setBaseDimensions(baseW: number, baseH: number): void {
    paperCanvas?.setBaseDimensions(baseW, baseH)
  }

  /**
   * Clear canvas — readOnly 모드에서는 차단
   */
  function clear(): void {
    if (isReadOnly) return
    selectionMode?.clearSelection()
    paperCanvas?.clear()
    handleCanvasChange()
  }

  /**
   * Export canvas to JSON (filters out UI-only items like cursor indicators)
   */
  function exportJSON(): string {
    if (!paperCanvas) return '[]'

    const scope = paperCanvas.scope
    if (!scope?.project) return paperCanvas.exportJSON()

    // Remove UI items before export, restore after
    const uiItems: paper.Item[] = []
    scope.project.activeLayer.children.forEach((item: paper.Item) => {
      if (item.data?.isSelectionUI) {
        uiItems.push(item)
      }
    })

    // Temporarily remove UI items
    uiItems.forEach(item => item.remove())

    const json = paperCanvas.exportJSON()

    // Restore UI items
    uiItems.forEach(item => scope.project.activeLayer.addChild(item))

    return json
  }

  /**
   * Import JSON to canvas — 데이터 로드 후 history baseline 갱신.
   * 외부에서 강제 로드된 상태를 currentState로 잡아 이후 첫 그리기 시 이 상태로 undo 가능
   */
  function importJSON(json: string): boolean {
    if (paperCanvas && json) {
      try {
        selectionMode?.clearSelection()
        paperCanvas.importJSON(json)
        // baseline 갱신 — undo 시 이 데이터 상태로 돌아감
        historyManager?.setBaseline(pageNum, json)
        emitAccessibilityState()
        return true
      } catch (e) {
        console.warn('[PageCanvasManager] Failed to import JSON:', e)
        return false
      }
    }
    return false
  }

  /**
   * Add text at position
   */
  function addText(text: string, x: number, y: number): void {
    textMode?.addTextAt(x, y, text)
  }

  /**
   * Confirm text input
   */
  function confirmText(text: string): void {
    textMode?.confirmText(text)
  }

  /**
   * Cancel text input
   */
  function cancelText(): void {
    textMode?.cancelText()
  }

  /** 선택된 아이템 삭제 */
  function deleteSelected(): void {
    selectionMode?.deleteSelected()
  }

  /**
   * Undo last action
   */
  function undo(): boolean {
    if (!historyManager || !paperCanvas) return false

    const json = historyManager.undo(pageNum)
    if (json !== null) {
      selectionMode?.clearSelection()
      paperCanvas.importJSON(json)
      onCanvasChange?.()
      emitAccessibilityState()
      return true
    }
    return false
  }

  /**
   * Redo last undone action
   */
  function redo(): boolean {
    if (!historyManager || !paperCanvas) return false

    const json = historyManager.redo(pageNum)
    if (json !== null) {
      selectionMode?.clearSelection()
      paperCanvas.importJSON(json)
      onCanvasChange?.()
      emitAccessibilityState()
      return true
    }
    return false
  }

  return {
    init,
    dispose,
    setZoom,
    setBaseDimensions,
    clear,
    exportJSON,
    importJSON,
    setDrawingMode,
    setBrushColor,
    setBrushWidth,
    setBrushPressureSensitivity,
    setFontSize,
    addText,
    confirmText,
    cancelText,
    deleteSelected,
    undo,
    redo,

    get hasSelection() { return selectionMode?.hasSelection ?? false },
    get accessibilityState() { return getAccessibilityState() },
    get paperCanvas() { return paperCanvas },
    get isReady() { return paperCanvas?.isReady ?? false },
    get canUndo() { return historyManager?.canUndoPage(pageNum) ?? false },
    get canRedo() { return historyManager?.canRedoPage(pageNum) ?? false }
  }
}
