/**
 * Paper.js canvasData를 PDF 페이지 content stream에 평탄화한다.
 *
 * 입력 PDF는 PDF.js annotationStorage/AcroForm 저장이 끝난 최신 바이트를 전제로 한다.
 * 이 모듈은 DOM에 마운트된 Paper canvas를 참조하지 않고, SDK의 페이지별 compact
 * Paper JSON을 직접 순회하므로 가상 스크롤로 언마운트된 페이지도 동일하게 처리한다.
 */
import {
  BlendMode,
  degrees,
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
  StandardFonts
} from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'

export interface PdfCanvasViewport {
  readonly width: number
  readonly height: number
  convertToPdfPoint(x: number, y: number): number[]
}

export type PdfCanvasViewportProvider = (
  pageNumber: number
) => PdfCanvasViewport | Promise<PdfCanvasViewport>

export type PdfCanvasDataInput = string | Readonly<Record<string, string>>

export interface PdfTextRasterizeInput {
  content: string
  fontSize: number
  leading: number
  justification: 'left' | 'center' | 'right'
  color: string
}

export interface PdfTextRasterizeResult {
  /** 투명 배경 PNG 바이트 */
  pngBytes: ArrayBuffer | Uint8Array
  /** PNG가 표현하는 Paper 좌표계 크기 */
  width: number
  height: number
  /** 첫 줄 PointText baseline anchor의 PNG 내부 좌표 */
  baselineX: number
  baselineY: number
}

export type PdfTextRasterizer = (
  input: PdfTextRasterizeInput
) => PdfTextRasterizeResult | Promise<PdfTextRasterizeResult>

export interface FlattenPdfCanvasInput {
  /** PDF.js saveDocument() 등 최신 저장 결과 바이트 */
  pdfBytes: ArrayBuffer | Uint8Array
  /** SDK save/onChange가 반환하는 page-keyed canvasData */
  canvasData: PdfCanvasDataInput
  /** 테스트 또는 이미 로드한 PDFDocumentProxy 재사용을 위한 선택 주입점 */
  viewportProvider?: PdfCanvasViewportProvider
  /** Helvetica로 표현할 수 없는 Unicode PointText의 시각 평탄화 주입점 */
  textRasterizer?: PdfTextRasterizer
}

export type PdfCanvasFlattenIssueSeverity = 'warning' | 'error'

export type PdfCanvasFlattenIssueCode =
  | 'INVALID_CANVAS_PAGE'
  | 'INVALID_PAGE_JSON'
  | 'PAGE_OUT_OF_RANGE'
  | 'INVALID_ITEM'
  | 'UNSUPPORTED_ITEM'
  | 'UNSUPPORTED_CLIPPING'
  | 'INVALID_GEOMETRY'
  | 'ITEM_HIDDEN'
  | 'SELECTION_UI_SKIPPED'
  | 'UNSUPPORTED_COLOR'
  | 'BLEND_MODE_APPROXIMATED'
  | 'TEXT_STYLE_APPROXIMATED'
  | 'TEXT_RASTERIZED'
  | 'TEXT_ENCODING_FAILED'
  | 'TEXT_RASTERIZATION_FAILED'
  | 'DRAW_FAILED'
  | 'VIEWPORT_FAILED'

export interface PdfCanvasFlattenIssue {
  severity: PdfCanvasFlattenIssueSeverity
  code: PdfCanvasFlattenIssueCode
  pageNumber?: number
  itemPath?: string
  sourceType?: string
  message: string
}

export interface PdfCanvasFlattenPageReport {
  pageNumber: number
  sourceItems: number
  flattenedItems: number
  skippedItems: number
  failedItems: number
}

export interface PdfCanvasFlattenReport {
  totalPdfPages: number
  requestedPages: number
  flattenedPages: number
  sourceItems: number
  flattenedItems: number
  skippedItems: number
  failedItems: number
  warnings: number
  hasFailures: boolean
  /** true면 pdf-lib가 새 PDF 구조를 기록했다. false면 입력 바이트를 그대로 반환했다. */
  rewroteDocument: boolean
  pages: PdfCanvasFlattenPageReport[]
  /** 상세 issue 문자열의 고정 저장 상한을 넘겼는지 여부 */
  issuesTruncated: boolean
  /** 집계에는 반영했지만 issues 배열에는 저장하지 않은 issue 수 */
  omittedIssues: number
  issues: PdfCanvasFlattenIssue[]
}

export interface FlattenPdfCanvasResult {
  bytes: Uint8Array
  report: PdfCanvasFlattenReport
}

interface Point {
  x: number
  y: number
}

interface Matrix {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
}

interface PaperNode {
  type: string
  props: Record<string, unknown>
}

interface PaperSegment {
  point: Point
  handleIn: Point
  handleOut: Point
}

interface ResolvedColor {
  color: ReturnType<typeof rgb>
  alpha: number
  cssColor: string
}

interface RenderState {
  matrix: Matrix
  opacity: number
  visible: boolean
  blendMode?: string
  strokeColor?: unknown
  fillColor?: unknown
  strokeWidth?: unknown
  strokeCap?: unknown
  strokeJoin?: unknown
  dashArray?: unknown
}

interface PageContext {
  pageNumber: number
  page: PDFPage
  viewport: PdfCanvasViewport
  pdfDoc: PDFDocument
  fontState: {
    font?: PDFFont
  }
  textRasterizer?: PdfTextRasterizer
  report: PdfCanvasFlattenReport
  pageReport: PdfCanvasFlattenPageReport
}

interface DefaultViewportHandle {
  getViewport: PdfCanvasViewportProvider
  destroy(): Promise<void>
}

const IDENTITY_MATRIX: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
export const PDF_CANVAS_FLATTEN_ISSUE_LIMIT = 1_000
const EMPTY_STATE: RenderState = {
  matrix: IDENTITY_MATRIX,
  opacity: 1,
  visible: true
}

function copyBytes(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const copy = new Uint8Array(source.byteLength)
  copy.set(source)
  return copy
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function parsePoint(value: unknown): Point | null {
  if (Array.isArray(value)) {
    const x = finiteNumber(value[0])
    const y = finiteNumber(value[1])
    return x === null || y === null ? null : { x, y }
  }
  if (isRecord(value)) {
    const x = finiteNumber(value.x)
    const y = finiteNumber(value.y)
    return x === null || y === null ? null : { x, y }
  }
  return null
}

function parseMatrix(value: unknown): Matrix | null {
  if (!Array.isArray(value) || value.length < 6) return null
  const values = value.slice(0, 6).map(finiteNumber)
  if (values.some((entry) => entry === null)) return null
  return {
    a: values[0]!, b: values[1]!, c: values[2]!,
    d: values[3]!, tx: values[4]!, ty: values[5]!
  }
}

/** parent(local(point)) 순서로 Paper.js affine matrix를 합성한다. */
function composeMatrix(parent: Matrix, local: Matrix): Matrix {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty
  }
}

function transformPoint(matrix: Matrix, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty
  }
}

function toPdfPoint(viewport: PdfCanvasViewport, matrix: Matrix, point: Point): Point {
  const paperPoint = transformPoint(matrix, point)
  const [x, y] = viewport.convertToPdfPoint(paperPoint.x, paperPoint.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError('viewport returned a non-finite PDF point')
  }
  return { x, y }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function mappedUnitScale(viewport: PdfCanvasViewport, matrix: Matrix): number {
  const origin = toPdfPoint(viewport, matrix, { x: 0, y: 0 })
  const xUnit = toPdfPoint(viewport, matrix, { x: 1, y: 0 })
  const yUnit = toPdfPoint(viewport, matrix, { x: 0, y: 1 })
  return Math.sqrt(distance(origin, xUnit) * distance(origin, yUnit))
}

function parsePaperNode(value: unknown): PaperNode | null {
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return {
      type: value[0],
      props: isRecord(value[1]) ? value[1] : {}
    }
  }
  if (isRecord(value) && typeof value.className === 'string') {
    return { type: value.className, props: value }
  }
  if (isRecord(value) && Array.isArray(value.children)) {
    return { type: 'Layer', props: value }
  }
  return null
}

function parseSegment(value: unknown): PaperSegment | null {
  if (isRecord(value)) {
    const point = parsePoint(value.point)
    if (!point) return null
    return {
      point,
      handleIn: parsePoint(value.handleIn) ?? { x: 0, y: 0 },
      handleOut: parsePoint(value.handleOut) ?? { x: 0, y: 0 }
    }
  }

  if (!Array.isArray(value)) return null
  const compactPoint = parsePoint(value)
  if (compactPoint) {
    return { point: compactPoint, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }
  }

  const point = parsePoint(value[0])
  if (!point) return null
  return {
    point,
    handleIn: parsePoint(value[1]) ?? { x: 0, y: 0 },
    handleOut: parsePoint(value[2]) ?? { x: 0, y: 0 }
  }
}

function resolvedColor(red: number, green: number, blue: number, alpha: number): ResolvedColor {
  const channels = [clamp01(red), clamp01(green), clamp01(blue)] as const
  return {
    color: rgb(channels[0], channels[1], channels[2]),
    alpha: clamp01(alpha),
    cssColor: `rgb(${channels.map((channel) => Math.round(channel * 255)).join(' ')})`
  }
}

function parseColor(value: unknown): ResolvedColor | null {
  let components: unknown[] | null = null

  if (Array.isArray(value)) {
    if (typeof value[0] === 'string') {
      if (value[0] !== 'rgb' && value[0] !== 'gray') return null
      components = value.slice(1)
    } else {
      components = value
    }
  } else if (isRecord(value) && Array.isArray(value.components)) {
    components = value.components
    if (typeof value.alpha === 'number') components = [...components, value.alpha]
  } else if (typeof value === 'string') {
    const match = /^#([0-9a-f]{6})$/i.exec(value)
    if (!match) return null
    const hex = match[1]
    return resolvedColor(
      Number.parseInt(hex.slice(0, 2), 16) / 255,
      Number.parseInt(hex.slice(2, 4), 16) / 255,
      Number.parseInt(hex.slice(4, 6), 16) / 255,
      1
    )
  }

  if (!components) return null
  const numbers = components.map(finiteNumber)
  if (numbers.some((entry) => entry === null)) return null

  if (numbers.length === 1 || numbers.length === 2) {
    const gray = clamp01(numbers[0]!)
    return resolvedColor(gray, gray, gray, numbers.length === 2 ? numbers[1]! : 1)
  }
  if (numbers.length === 3 || numbers.length === 4) {
    return resolvedColor(
      numbers[0]!,
      numbers[1]!,
      numbers[2]!,
      numbers.length === 4 ? numbers[3]! : 1
    )
  }
  return null
}

function resolveState(parent: RenderState, props: Record<string, unknown>): RenderState {
  const localMatrix = parseMatrix(props.matrix) ?? IDENTITY_MATRIX
  const ownOpacity = finiteNumber(props.opacity) ?? 1
  return {
    matrix: composeMatrix(parent.matrix, localMatrix),
    opacity: clamp01(parent.opacity * ownOpacity),
    visible: parent.visible && props.visible !== false,
    blendMode: typeof props.blendMode === 'string' ? props.blendMode : parent.blendMode,
    strokeColor: props.strokeColor !== undefined ? props.strokeColor : parent.strokeColor,
    fillColor: props.fillColor !== undefined ? props.fillColor : parent.fillColor,
    strokeWidth: props.strokeWidth !== undefined ? props.strokeWidth : parent.strokeWidth,
    strokeCap: props.strokeCap !== undefined ? props.strokeCap : parent.strokeCap,
    strokeJoin: props.strokeJoin !== undefined ? props.strokeJoin : parent.strokeJoin,
    dashArray: props.dashArray !== undefined ? props.dashArray : parent.dashArray
  }
}

function mapBlendMode(value: string | undefined): BlendMode | undefined {
  if (!value || value === 'normal') return undefined
  const normalized = value.replace(/[-_ ]/g, '').toLowerCase()
  const modes: Record<string, BlendMode> = {
    multiply: BlendMode.Multiply,
    screen: BlendMode.Screen,
    overlay: BlendMode.Overlay,
    darken: BlendMode.Darken,
    lighten: BlendMode.Lighten,
    colordodge: BlendMode.ColorDodge,
    colorburn: BlendMode.ColorBurn,
    hardlight: BlendMode.HardLight,
    softlight: BlendMode.SoftLight,
    difference: BlendMode.Difference,
    exclusion: BlendMode.Exclusion
  }
  return modes[normalized]
}

function mapLineCap(value: unknown): LineCapStyle | undefined {
  switch (value) {
    case 'round': return LineCapStyle.Round
    case 'square': return LineCapStyle.Projecting
    case 'butt': return LineCapStyle.Butt
    default: return undefined
  }
}

function mapLineJoin(value: unknown): LineJoinStyle {
  switch (value) {
    case 'round': return LineJoinStyle.Round
    case 'bevel': return LineJoinStyle.Bevel
    default: return LineJoinStyle.Miter
  }
}

function addIssue(
  context: PageContext,
  issue: Omit<PdfCanvasFlattenIssue, 'pageNumber'>
): void {
  recordIssue(context.report, { ...issue, pageNumber: context.pageNumber })
}

function addGlobalIssue(report: PdfCanvasFlattenReport, issue: PdfCanvasFlattenIssue): void {
  recordIssue(report, issue)
}

function recordIssue(report: PdfCanvasFlattenReport, issue: PdfCanvasFlattenIssue): void {
  if (issue.severity === 'warning') report.warnings += 1
  if (report.issues.length < PDF_CANVAS_FLATTEN_ISSUE_LIMIT) {
    report.issues.push(issue)
    return
  }
  report.omittedIssues += 1
  report.issuesTruncated = true
}

function markSource(context: PageContext): void {
  context.pageReport.sourceItems += 1
  context.report.sourceItems += 1
}

function markFlattened(context: PageContext): void {
  context.pageReport.flattenedItems += 1
  context.report.flattenedItems += 1
}

function markSkipped(
  context: PageContext,
  itemPath: string,
  sourceType: string,
  code: PdfCanvasFlattenIssueCode,
  message: string
): void {
  context.pageReport.skippedItems += 1
  context.report.skippedItems += 1
  addIssue(context, { severity: 'warning', code, itemPath, sourceType, message })
}

function markFailed(
  context: PageContext,
  itemPath: string,
  sourceType: string,
  code: PdfCanvasFlattenIssueCode,
  message: string
): void {
  context.pageReport.failedItems += 1
  context.report.failedItems += 1
  addIssue(context, { severity: 'error', code, itemPath, sourceType, message })
}

function svgPoint(point: Point): string {
  // pdf-lib drawSvgPath()가 내부에서 SVG Y축을 한 번 반전하므로 PDF Y를 미리 음수화한다.
  return `${point.x} ${-point.y}`
}

function buildSvgPath(
  rawSegments: unknown[],
  closed: boolean,
  context: PageContext,
  matrix: Matrix
): string | null {
  const segments = rawSegments.map(parseSegment)
  if (segments.length < 2 || segments.some((segment) => !segment)) return null
  const validSegments = segments as PaperSegment[]

  const map = (point: Point) => toPdfPoint(context.viewport, matrix, point)
  let path = `M ${svgPoint(map(validSegments[0].point))}`

  const appendCurve = (from: PaperSegment, to: PaperSegment): void => {
    const hasHandles = from.handleOut.x !== 0 || from.handleOut.y !== 0 ||
      to.handleIn.x !== 0 || to.handleIn.y !== 0
    if (!hasHandles) {
      path += ` L ${svgPoint(map(to.point))}`
      return
    }
    const control1 = map({
      x: from.point.x + from.handleOut.x,
      y: from.point.y + from.handleOut.y
    })
    const control2 = map({
      x: to.point.x + to.handleIn.x,
      y: to.point.y + to.handleIn.y
    })
    path += ` C ${svgPoint(control1)} ${svgPoint(control2)} ${svgPoint(map(to.point))}`
  }

  for (let index = 1; index < validSegments.length; index += 1) {
    appendCurve(validSegments[index - 1], validSegments[index])
  }
  if (closed) {
    appendCurve(validSegments[validSegments.length - 1], validSegments[0])
    path += ' Z'
  }
  return path
}

async function drawPath(
  node: PaperNode,
  state: RenderState,
  context: PageContext,
  itemPath: string
): Promise<void> {
  markSource(context)
  if (!state.visible || state.opacity === 0) {
    markSkipped(context, itemPath, node.type, 'ITEM_HIDDEN', '숨김 또는 완전 투명한 항목입니다.')
    return
  }

  const segments = node.props.segments
  if (!Array.isArray(segments)) {
    markFailed(context, itemPath, node.type, 'INVALID_GEOMETRY', 'Path segments가 없습니다.')
    return
  }

  let svgPath: string | null
  try {
    svgPath = buildSvgPath(segments, node.props.closed === true, context, state.matrix)
  } catch (error) {
    markFailed(
      context,
      itemPath,
      node.type,
      'INVALID_GEOMETRY',
      error instanceof Error ? error.message : 'Path 좌표 변환에 실패했습니다.'
    )
    return
  }
  if (!svgPath) {
    markFailed(context, itemPath, node.type, 'INVALID_GEOMETRY', 'Path에 유효한 segment가 2개 이상 필요합니다.')
    return
  }

  const stroke = state.strokeColor === null || state.strokeColor === undefined
    ? null
    : parseColor(state.strokeColor)
  const fill = state.fillColor === null || state.fillColor === undefined
    ? null
    : parseColor(state.fillColor)
  if ((state.strokeColor != null && !stroke) || (state.fillColor != null && !fill)) {
    markFailed(context, itemPath, node.type, 'UNSUPPORTED_COLOR', '지원하지 않는 Paper.js 색상 형식입니다.')
    return
  }
  if (!stroke && !fill) {
    markSkipped(context, itemPath, node.type, 'ITEM_HIDDEN', 'strokeColor와 fillColor가 모두 없습니다.')
    return
  }

  let scale: number
  try {
    scale = mappedUnitScale(context.viewport, state.matrix)
  } catch (error) {
    markFailed(
      context,
      itemPath,
      node.type,
      'INVALID_GEOMETRY',
      error instanceof Error ? error.message : 'Path scale 계산에 실패했습니다.'
    )
    return
  }
  if (!Number.isFinite(scale) || scale <= 0) {
    markFailed(context, itemPath, node.type, 'INVALID_GEOMETRY', 'Path 변환 scale이 유효하지 않습니다.')
    return
  }

  const blendMode = mapBlendMode(state.blendMode)
  if (state.blendMode && state.blendMode !== 'normal' && !blendMode) {
    addIssue(context, {
      severity: 'warning',
      code: 'BLEND_MODE_APPROXIMATED',
      itemPath,
      sourceType: node.type,
      message: `${state.blendMode} blend mode를 normal로 평탄화했습니다.`
    })
  }

  const rawStrokeWidth = finiteNumber(state.strokeWidth) ?? 1
  const borderWidth = stroke ? Math.max(0, rawStrokeWidth * scale) : 0
  const dashArray = Array.isArray(state.dashArray)
    ? state.dashArray
        .map(finiteNumber)
        .filter((entry): entry is number => entry !== null && entry >= 0)
        .map((entry) => entry * scale)
    : undefined

  try {
    context.page.pushOperators(pushGraphicsState(), setLineJoin(mapLineJoin(state.strokeJoin)))
    context.page.drawSvgPath(svgPath, {
      x: 0,
      y: 0,
      ...(fill && { color: fill.color, opacity: clamp01(state.opacity * fill.alpha) }),
      ...(stroke && {
        borderColor: stroke.color,
        borderWidth,
        borderOpacity: clamp01(state.opacity * stroke.alpha),
        borderLineCap: mapLineCap(state.strokeCap)
      }),
      ...(dashArray && { borderDashArray: dashArray }),
      ...(blendMode && { blendMode })
    })
    context.page.pushOperators(popGraphicsState())
    markFlattened(context)
  } catch (error) {
    try {
      context.page.pushOperators(popGraphicsState())
    } catch {
      // 원래 draw 오류를 보고한다.
    }
    markFailed(
      context,
      itemPath,
      node.type,
      'DRAW_FAILED',
      error instanceof Error ? error.message : 'PDF path 렌더링에 실패했습니다.'
    )
  }
}

async function getTextFont(context: PageContext): Promise<PDFFont> {
  context.fontState.font ??= await context.pdfDoc.embedFont(StandardFonts.Helvetica)
  return context.fontState.font
}

function normalizeJustification(value: unknown): PdfTextRasterizeInput['justification'] {
  return value === 'center' || value === 'right' ? value : 'left'
}

function isValidRasterizedText(result: PdfTextRasterizeResult): boolean {
  const byteLength = result.pngBytes instanceof Uint8Array
    ? result.pngBytes.byteLength
    : result.pngBytes instanceof ArrayBuffer ? result.pngBytes.byteLength : 0
  return byteLength > 0 &&
    [result.width, result.height, result.baselineX, result.baselineY]
      .every((value) => Number.isFinite(value)) &&
    result.width > 0 && result.height > 0 &&
    result.baselineX >= 0 && result.baselineX <= result.width &&
    result.baselineY >= 0 && result.baselineY <= result.height
}

function addTextStyleWarning(
  node: PaperNode,
  context: PageContext,
  itemPath: string,
  rasterized: boolean
): void {
  const fontFamily = typeof node.props.fontFamily === 'string'
    ? node.props.fontFamily.toLowerCase()
    : ''
  const supportedFamily = rasterized
    ? /(sans-serif|arial|helvetica|pretendard)/.test(fontFamily)
    : /(sans-serif|arial|helvetica)/.test(fontFamily)
  const fontWeight = node.props.fontWeight
  if ((fontFamily && !supportedFamily) ||
      (fontWeight !== undefined && fontWeight !== 'normal' && fontWeight !== 400)) {
    addIssue(context, {
      severity: 'warning',
      code: 'TEXT_STYLE_APPROXIMATED',
      itemPath,
      sourceType: node.type,
      message: `PointText 글꼴/굵기를 ${rasterized ? 'Pretendard regular' : 'Helvetica regular'}로 대체했습니다.`
    })
  }
}

async function drawRasterizedText(
  node: PaperNode,
  state: RenderState,
  context: PageContext,
  itemPath: string,
  content: string,
  fontSize: number,
  leading: number,
  origin: Point,
  xVector: Point,
  yScale: number,
  angle: number,
  fill: ResolvedColor,
  blendMode: BlendMode | undefined,
  encodingError: unknown
): Promise<void> {
  if (!context.textRasterizer) {
    markFailed(
      context,
      itemPath,
      node.type,
      'TEXT_ENCODING_FAILED',
      encodingError instanceof Error
        ? `${encodingError.message}; Unicode textRasterizer가 없습니다.`
        : 'Helvetica로 텍스트를 인코딩할 수 없고 Unicode textRasterizer가 없습니다.'
    )
    return
  }

  let rasterized: PdfTextRasterizeResult
  try {
    rasterized = await context.textRasterizer({
      content,
      fontSize,
      leading,
      justification: normalizeJustification(node.props.justification),
      color: fill.cssColor
    })
    if (!isValidRasterizedText(rasterized)) {
      throw new TypeError('textRasterizer returned invalid PNG geometry')
    }
  } catch (error) {
    markFailed(
      context,
      itemPath,
      node.type,
      'TEXT_RASTERIZATION_FAILED',
      error instanceof Error ? error.message : 'Unicode PointText 래스터화에 실패했습니다.'
    )
    return
  }

  addTextStyleWarning(node, context, itemPath, true)
  const upVector = { x: -xVector.y, y: xVector.x }
  const width = rasterized.width * yScale
  const height = rasterized.height * yScale
  const baselineX = rasterized.baselineX * yScale
  const baselineFromBottom = (rasterized.height - rasterized.baselineY) * yScale
  const x = origin.x - xVector.x * baselineX - upVector.x * baselineFromBottom
  const y = origin.y - xVector.y * baselineX - upVector.y * baselineFromBottom

  try {
    const image = await context.pdfDoc.embedPng(copyBytes(rasterized.pngBytes))
    context.page.drawImage(image, {
      x,
      y,
      width,
      height,
      opacity: clamp01(state.opacity * fill.alpha),
      rotate: degrees(angle),
      ...(blendMode && { blendMode })
    })
    markFlattened(context)
    addIssue(context, {
      severity: 'warning',
      code: 'TEXT_RASTERIZED',
      itemPath,
      sourceType: node.type,
      message: 'Helvetica로 인코딩할 수 없는 PointText를 Pretendard 투명 PNG로 시각 평탄화했습니다.'
    })
  } catch (error) {
    markFailed(
      context,
      itemPath,
      node.type,
      'DRAW_FAILED',
      error instanceof Error ? error.message : 'PDF에 Unicode PointText 이미지를 그리지 못했습니다.'
    )
  }
}

async function drawText(
  node: PaperNode,
  state: RenderState,
  context: PageContext,
  itemPath: string
): Promise<void> {
  markSource(context)
  if (!state.visible || state.opacity === 0) {
    markSkipped(context, itemPath, node.type, 'ITEM_HIDDEN', '숨김 또는 완전 투명한 텍스트입니다.')
    return
  }

  const content = typeof node.props.content === 'string' ? node.props.content : null
  const explicitPoint = parsePoint(node.props.point)
  // Paper.js compact export canonicalizes PointText.position into the item's
  // translation matrix (`applyMatrix:false`) and omits `point`. In that form
  // the text baseline is the local origin; resolveState() has already composed
  // the matrix with every parent transform.
  const point = explicitPoint ?? (parseMatrix(node.props.matrix) ? { x: 0, y: 0 } : null)
  if (!content || !point) {
    markFailed(context, itemPath, node.type, 'INVALID_GEOMETRY', 'PointText content 또는 point가 없습니다.')
    return
  }

  const fill = state.fillColor === null || state.fillColor === undefined
    ? resolvedColor(0, 0, 0, 1)
    : parseColor(state.fillColor)
  if (!fill) {
    markFailed(context, itemPath, node.type, 'UNSUPPORTED_COLOR', '지원하지 않는 PointText 색상 형식입니다.')
    return
  }

  const fontSize = finiteNumber(node.props.fontSize) ?? 12
  const leading = finiteNumber(node.props.leading) ?? fontSize * 1.2
  if (fontSize <= 0 || leading <= 0) {
    markFailed(context, itemPath, node.type, 'INVALID_GEOMETRY', 'PointText fontSize/leading이 유효하지 않습니다.')
    return
  }

  let origin: Point
  let right: Point
  let down: Point
  try {
    origin = toPdfPoint(context.viewport, state.matrix, point)
    right = toPdfPoint(context.viewport, state.matrix, { x: point.x + 1, y: point.y })
    down = toPdfPoint(context.viewport, state.matrix, { x: point.x, y: point.y + 1 })
  } catch (error) {
    markFailed(
      context,
      itemPath,
      node.type,
      'INVALID_GEOMETRY',
      error instanceof Error ? error.message : 'PointText 좌표 변환에 실패했습니다.'
    )
    return
  }

  const xScale = distance(origin, right)
  const yScale = distance(origin, down)
  if (xScale <= 0 || yScale <= 0) {
    markFailed(context, itemPath, node.type, 'INVALID_GEOMETRY', 'PointText 변환 scale이 유효하지 않습니다.')
    return
  }

  const xVector = { x: (right.x - origin.x) / xScale, y: (right.y - origin.y) / xScale }
  const angle = Math.atan2(xVector.y, xVector.x) * 180 / Math.PI
  const drawSize = fontSize * yScale
  const drawLeading = leading * yScale
  const blendMode = mapBlendMode(state.blendMode)
  if (Math.abs(xScale - yScale) > Math.max(xScale, yScale) * 0.001) {
    addIssue(context, {
      severity: 'warning',
      code: 'TEXT_STYLE_APPROXIMATED',
      itemPath,
      sourceType: node.type,
      message: '비균등 PointText scale을 세로 scale 기준으로 평탄화했습니다.'
    })
  }
  if (state.blendMode && state.blendMode !== 'normal' && !blendMode) {
    addIssue(context, {
      severity: 'warning',
      code: 'BLEND_MODE_APPROXIMATED',
      itemPath,
      sourceType: node.type,
      message: `${state.blendMode} blend mode를 normal로 평탄화했습니다.`
    })
  }

  const lines = content.split('\n')
  let font: PDFFont
  try {
    font = await getTextFont(context)
    for (const line of lines) font.encodeText(line)
  } catch (error) {
    await drawRasterizedText(
      node,
      state,
      context,
      itemPath,
      content,
      fontSize,
      leading,
      origin,
      xVector,
      yScale,
      angle,
      fill,
      blendMode,
      error
    )
    return
  }

  addTextStyleWarning(node, context, itemPath, false)
  const justification = normalizeJustification(node.props.justification)
  try {
    for (let index = 0; index < lines.length; index += 1) {
      const localLinePoint = { x: point.x, y: point.y + leading * index }
      const lineOrigin = toPdfPoint(context.viewport, state.matrix, localLinePoint)
      const line = lines[index]
      const lineWidth = font.widthOfTextAtSize(line, drawSize)
      const alignmentOffset = justification === 'center'
        ? lineWidth / 2
        : justification === 'right' ? lineWidth : 0
      context.page.drawText(line, {
        x: lineOrigin.x - xVector.x * alignmentOffset,
        y: lineOrigin.y - xVector.y * alignmentOffset,
        size: drawSize,
        font,
        color: fill.color,
        opacity: clamp01(state.opacity * fill.alpha),
        rotate: degrees(angle),
        ...(blendMode && { blendMode }),
        lineHeight: drawLeading
      })
    }
    markFlattened(context)
  } catch (error) {
    markFailed(
      context,
      itemPath,
      node.type,
      'DRAW_FAILED',
      error instanceof Error ? error.message : 'PDF text 렌더링에 실패했습니다.'
    )
  }
}

function hasClipMask(children: unknown[]): boolean {
  return children.some((child) => {
    const node = parsePaperNode(child)
    return node?.props.clipMask === true
  })
}

async function renderNode(
  value: unknown,
  parentState: RenderState,
  context: PageContext,
  itemPath: string
): Promise<void> {
  if (Array.isArray(value) && value.length === 0) return

  // Project export나 수동 fixture처럼 노드 배열 자체가 root인 형식도 안전하게 순회한다.
  if (Array.isArray(value) && typeof value[0] !== 'string') {
    if (Array.isArray(value[0]) && value[0][0] === 'dictionary') {
      markSource(context)
      markFailed(context, itemPath, 'dictionary', 'UNSUPPORTED_ITEM', 'Paper.js dictionary/symbol 항목은 지원하지 않습니다.')
      return
    }
    for (let index = 0; index < value.length; index += 1) {
      await renderNode(value[index], parentState, context, `${itemPath}[${index}]`)
    }
    return
  }

  const node = parsePaperNode(value)
  if (!node) {
    markSource(context)
    markFailed(context, itemPath, 'unknown', 'INVALID_ITEM', 'Paper.js compact item 형식이 아닙니다.')
    return
  }

  const state = resolveState(parentState, node.props)
  const data = isRecord(node.props.data) ? node.props.data : null
  if (data?.isSelectionUI === true || data?.isPreview === true) {
    markSource(context)
    markSkipped(context, itemPath, node.type, 'SELECTION_UI_SKIPPED', '선택/미리보기 UI 항목은 출력하지 않습니다.')
    return
  }

  switch (node.type) {
    case 'Layer':
    case 'Group':
    case 'CompoundPath': {
      const children = node.props.children
      if (!Array.isArray(children)) {
        if (node.type === 'Layer') return
        markSource(context)
        markFailed(context, itemPath, node.type, 'INVALID_ITEM', `${node.type} children이 배열이 아닙니다.`)
        return
      }
      if (node.props.clipped === true || hasClipMask(children)) {
        markSource(context)
        markFailed(context, itemPath, node.type, 'UNSUPPORTED_CLIPPING', 'clipping group은 안전하게 평탄화할 수 없습니다.')
        return
      }
      for (let index = 0; index < children.length; index += 1) {
        await renderNode(children[index], state, context, `${itemPath}.children[${index}]`)
      }
      return
    }
    case 'Path':
    case 'Path.Rectangle':
    case 'Path.Circle':
    case 'Path.Line':
      await drawPath(node, state, context, itemPath)
      return
    case 'PointText':
      await drawText(node, state, context, itemPath)
      return
    default:
      markSource(context)
      markFailed(context, itemPath, node.type, 'UNSUPPORTED_ITEM', `${node.type} 항목은 평탄화 대상이 아닙니다.`)
  }
}

function parseCanvasRecord(canvasData: PdfCanvasDataInput): Record<string, unknown> {
  const parsed: unknown = typeof canvasData === 'string' ? JSON.parse(canvasData) : canvasData
  if (!isRecord(parsed)) {
    throw new TypeError('canvasData must be a page-keyed object or its JSON string')
  }
  return parsed
}

function isEmptyPaperRoot(root: unknown): boolean {
  if (Array.isArray(root) && root.length === 0) return true
  const node = parsePaperNode(root)
  return !!node && (node.type === 'Layer' || node.type === 'Group') &&
    Array.isArray(node.props.children) && node.props.children.length === 0
}

function createReport(totalPdfPages: number, requestedPages: number): PdfCanvasFlattenReport {
  return {
    totalPdfPages,
    requestedPages,
    flattenedPages: 0,
    sourceItems: 0,
    flattenedItems: 0,
    skippedItems: 0,
    failedItems: 0,
    warnings: 0,
    hasFailures: false,
    rewroteDocument: false,
    pages: [],
    issuesTruncated: false,
    omittedIssues: 0,
    issues: []
  }
}

async function createDefaultViewportHandle(pdfBytes: Uint8Array): Promise<DefaultViewportHandle> {
  const pdfjs = await import('pdfjs-dist')
  const loadingTask = pdfjs.getDocument({
    data: copyBytes(pdfBytes),
    isEvalSupported: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true
  })
  const document = await loadingTask.promise

  return {
    async getViewport(pageNumber: number): Promise<PdfCanvasViewport> {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      page.cleanup()
      return viewport
    },
    async destroy(): Promise<void> {
      await loadingTask.destroy()
    }
  }
}

/**
 * 실제 SDK canvasData를 모든 페이지에 합성하고, 처리 결과를 항목 단위로 보고한다.
 *
 * 지원하지 않거나 손상된 항목은 다음 항목 처리를 막지 않지만 report.issues에 반드시
 * 기록된다. 아무 항목도 합성되지 않았으면 서명/바이트 안정성을 위해 입력 bytes를
 * 그대로 복사해 반환한다.
 */
export async function flattenPdfCanvasData(
  input: FlattenPdfCanvasInput
): Promise<FlattenPdfCanvasResult> {
  const originalBytes = copyBytes(input.pdfBytes)
  const canvasRecord = parseCanvasRecord(input.canvasData)
  const pdfDoc = await PDFDocument.load(copyBytes(originalBytes), { updateMetadata: false })
  const fontState: PageContext['fontState'] = {}
  const pages = pdfDoc.getPages()
  const entries = Object.entries(canvasRecord)
  const report = createReport(pages.length, entries.length)

  let defaultViewportHandle: DefaultViewportHandle | null = null
  const getViewport = async (pageNumber: number): Promise<PdfCanvasViewport> => {
    if (input.viewportProvider) return input.viewportProvider(pageNumber)
    defaultViewportHandle ??= await createDefaultViewportHandle(originalBytes)
    return defaultViewportHandle.getViewport(pageNumber)
  }

  try {
    const sortedEntries = entries.sort(([left], [right]) => Number(left) - Number(right))
    for (const [pageKey, pageJson] of sortedEntries) {
      const pageNumber = Number(pageKey)
      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        report.failedItems += 1
        addGlobalIssue(report, {
          severity: 'error',
          code: 'INVALID_CANVAS_PAGE',
          message: `canvasData page key가 유효한 양의 정수가 아닙니다: ${pageKey}`
        })
        continue
      }

      const pageReport: PdfCanvasFlattenPageReport = {
        pageNumber,
        sourceItems: 0,
        flattenedItems: 0,
        skippedItems: 0,
        failedItems: 0
      }
      report.pages.push(pageReport)

      if (pageNumber > pages.length) {
        pageReport.sourceItems = 1
        pageReport.failedItems = 1
        report.sourceItems += 1
        report.failedItems += 1
        addGlobalIssue(report, {
          severity: 'error',
          code: 'PAGE_OUT_OF_RANGE',
          pageNumber,
          message: `PDF는 ${pages.length}페이지지만 canvasData에 ${pageNumber}페이지가 있습니다.`
        })
        continue
      }
      if (typeof pageJson !== 'string') {
        pageReport.sourceItems = 1
        pageReport.failedItems = 1
        report.sourceItems += 1
        report.failedItems += 1
        addGlobalIssue(report, {
          severity: 'error',
          code: 'INVALID_PAGE_JSON',
          pageNumber,
          message: '페이지 canvasData는 compact Paper JSON 문자열이어야 합니다.'
        })
        continue
      }

      let root: unknown
      try {
        root = JSON.parse(pageJson)
      } catch (error) {
        pageReport.sourceItems = 1
        pageReport.failedItems = 1
        report.sourceItems += 1
        report.failedItems += 1
        addGlobalIssue(report, {
          severity: 'error',
          code: 'INVALID_PAGE_JSON',
          pageNumber,
          message: error instanceof Error ? error.message : '페이지 Paper JSON 파싱에 실패했습니다.'
        })
        continue
      }
      if (isEmptyPaperRoot(root)) continue

      let viewport: PdfCanvasViewport
      try {
        viewport = await getViewport(pageNumber)
        if (!viewport || typeof viewport.convertToPdfPoint !== 'function') {
          throw new TypeError('viewportProvider returned an invalid viewport')
        }
      } catch (error) {
        pageReport.sourceItems = 1
        pageReport.failedItems = 1
        report.sourceItems += 1
        report.failedItems += 1
        addGlobalIssue(report, {
          severity: 'error',
          code: 'VIEWPORT_FAILED',
          pageNumber,
          message: error instanceof Error ? error.message : 'PDF page viewport를 만들지 못했습니다.'
        })
        continue
      }

      const context: PageContext = {
        pageNumber,
        page: pages[pageNumber - 1],
        viewport,
        pdfDoc,
        fontState,
        textRasterizer: input.textRasterizer,
        report,
        pageReport
      }
      await renderNode(root, EMPTY_STATE, context, 'root')
      if (pageReport.flattenedItems > 0) report.flattenedPages += 1
    }

    report.hasFailures = report.failedItems > 0

    if (report.flattenedItems === 0) {
      return { bytes: originalBytes, report }
    }

    const bytes = await pdfDoc.save({
      addDefaultPage: false,
      updateFieldAppearances: false
    })
    report.rewroteDocument = true
    return { bytes, report }
  } finally {
    const viewportHandle = defaultViewportHandle as DefaultViewportHandle | null
    if (viewportHandle) await viewportHandle.destroy()
  }
}
