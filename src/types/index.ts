/**
 * PDF Viewer Svelte - Type Definitions
 */

// ===== Tool Types =====
export type ToolMode = 'select' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'rectangle' | 'circle' | 'line'

// 펜 표준 압력 가중치 — 단일 펜 스타일. drawingMode에서 사용
export const PEN_PRESSURE_GAIN = 1.4

// ===== Canvas Types =====
export interface BrushSettings {
  color: string
  width: number
  opacity: number
  fontSize: number
  fontFamily: string
  /** 필압 감도 0-100 — 50=기본(1.0배), 0=압력 무시, 100=2배 강조 */
  pressureSensitivity?: number
}

export interface CanvasState {
  mode: ToolMode
  brush: BrushSettings
  isDrawing: boolean
}

// ===== PDF Types =====
export interface PdfState {
  document: any | null  // PDFDocumentProxy
  currentPage: number
  totalPages: number
  scale: number
  isLoading: boolean
  fileName: string
}

export interface PageDimensions {
  width: number
  height: number
  originalWidth: number
  originalHeight: number
}

// ===== Canvas Data Types =====
export interface PaperExportData {
  version: string
  children: PaperItem[]
  pageData?: Record<number, any>  // For page-keyed data format
}

export interface PaperItem {
  className: 'Path' | 'Path.Rectangle' | 'Path.Circle' | 'PointText' | 'CompoundPath' | 'Group'
  segments?: PaperSegment[]
  bounds?: PaperBounds
  strokeColor?: PaperColor
  fillColor?: PaperColor
  strokeWidth?: number
  opacity?: number
  content?: string  // for PointText
  fontSize?: number
  fontFamily?: string
  children?: PaperItem[]
}

export interface PaperSegment {
  point: [number, number]
  handleIn?: [number, number]
  handleOut?: [number, number]
}

export interface PaperBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PaperColor {
  type: 'rgb' | 'gray'
  components: number[]
  alpha?: number
}

// ===== User Overlay Types =====
export interface UserCanvasInfo {
  canvasId: string
  userName: string
  userId: string
  canvasData: string  // 페이지별 Paper.js JSON을 담은 JSON 문자열
  enabled: boolean
  color: string
  registeredAt?: string
  /** 이 항목을 현재 편집 기준점으로 표시하면 버전 이력(단일 선택) 모드로 전환 */
  isCurrent?: boolean
}

// ===== Outline (Bookmark) Types =====
/**
 * PDF 파일에 내장된 목차 항목.
 * 파일에서 파생되는 읽기 전용 정보이므로 편집·저장·호스트 왕복 대상이 아니다.
 */
export interface PdfOutlineNode {
  /** 트리 내 안정 식별자 — 경로 기반(예: "0.2.1") */
  id: string
  title: string
  /** 해석에 실패한 대상은 null — UI에서 이동 불가 항목으로 표기 */
  page: number | null
  /** 외부 URL 대상 — 보안상 뷰어가 열지 않고 구조만 표시 */
  external?: boolean
  /** 트리 들여쓰기 깊이 (0 = 최상위) */
  depth: number
  children: PdfOutlineNode[]
}

// ===== Scroll Mode Types =====
export interface PageRenderState {
  pageNum: number
  state: 'idle' | 'queued' | 'rendering' | 'rendered' | 'error'
  scale?: number
  error?: Error
}

export interface VisiblePageRange {
  start: number
  end: number
}

export interface ScrollModeConfig {
  maxConcurrentRenders: number
  bufferPages: number
  fastScrollThreshold: number  // px/ms
  scrollIdleDelay: number      // ms
}

// ===== Gesture Types =====
export interface FocalPoint {
  clientX: number
  clientY: number
  containerX: number
  containerY: number
  documentX: number
  documentY: number
}

export interface ScrollPosition {
  left: number
  top: number
}

// ===== Device Config Types =====
export interface DeviceConfig {
  maxRenderedPages: number
  renderCacheMaxMB: number
  devicePixelRatio: number
  canvasPixelRatio: number
  bufferPages: number
  isHighDensity: boolean
  isTouchDevice: boolean
}

// ===== Viewer Types =====
export type OrientationMode = 'portrait' | 'landscape'
