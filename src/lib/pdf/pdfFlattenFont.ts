/**
 * Helvetica로 표현할 수 없는 PointText를 Pretendard 투명 PNG로 변환한다.
 *
 * 글꼴과 Canvas는 실제 Unicode fallback이 필요한 export 시점에만 사용한다.
 */
import pretendardRegularUrl from 'pretendard/dist/web/static/woff2/Pretendard-Regular.woff2?url'
import type {
  PdfTextRasterizeInput,
  PdfTextRasterizeResult,
  PdfTextRasterizer
} from './pdfCanvasFlatten'

const FONT_FAMILY = 'InkoPdfFlattenPretendard'
const RASTER_SCALE = 4
const MAX_CANVAS_DIMENSION = 16_384
const MAX_CANVAS_PIXELS = 64 * 1024 * 1024

let fontPromise: Promise<void> | null = null

function requireBrowserFontApis(): void {
  if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') {
    throw new Error('Unicode PointText rasterization requires browser FontFace and document.fonts APIs')
  }
}

async function loadPretendard(): Promise<void> {
  requireBrowserFontApis()
  fontPromise ??= (async () => {
    const face = new FontFace(
      FONT_FAMILY,
      `url(${JSON.stringify(pretendardRegularUrl)}) format("woff2")`,
      { style: 'normal', weight: '400' }
    )
    const loadedFace = await face.load()
    document.fonts.add(loadedFace)
  })().catch((error) => {
    // 일시적 asset 오류 뒤 다음 export에서 재시도 허용
    fontPromise = null
    throw error
  })
  return fontPromise
}

function finitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a positive number`)
}

function textMetrics(context: CanvasRenderingContext2D, line: string, fontSize: number) {
  const measured = context.measureText(line || 'M')
  const width = line ? measured.width : 0
  const ascent = Number.isFinite(measured.actualBoundingBoxAscent) && measured.actualBoundingBoxAscent > 0
    ? measured.actualBoundingBoxAscent
    : fontSize * 0.8
  const descent = Number.isFinite(measured.actualBoundingBoxDescent) && measured.actualBoundingBoxDescent >= 0
    ? measured.actualBoundingBoxDescent
    : fontSize * 0.2
  return { width, ascent, descent }
}

function lineLeft(width: number, justification: PdfTextRasterizeInput['justification']): number {
  return justification === 'center' ? -width / 2 : justification === 'right' ? -width : 0
}

function canvasPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  if (typeof canvas.toBlob !== 'function') {
    return Promise.reject(new Error('Canvas PNG encoding is unavailable'))
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas PNG encoding returned no bytes'))
        return
      }
      blob.arrayBuffer()
        .then((buffer) => {
          if (buffer.byteLength === 0) throw new Error('Canvas PNG encoding returned empty bytes')
          resolve(new Uint8Array(buffer))
        })
        .catch(reject)
    }, 'image/png')
  })
}

/** Pretendard를 4배 해상도로 그려 첫 줄 baseline 기준 PNG 기하를 반환한다. */
export const rasterizePdfFlattenText: PdfTextRasterizer = async (
  input: PdfTextRasterizeInput
): Promise<PdfTextRasterizeResult> => {
  if (!input.content) throw new TypeError('content must not be empty')
  finitePositive(input.fontSize, 'fontSize')
  finitePositive(input.leading, 'leading')
  await loadPretendard()

  const canvas = document.createElement('canvas')
  const measurementContext = canvas.getContext('2d')
  if (!measurementContext) throw new Error('2D Canvas context is unavailable')

  const fontSize = input.fontSize * RASTER_SCALE
  const leading = input.leading * RASTER_SCALE
  const font = `400 ${fontSize}px "${FONT_FAMILY}"`
  await document.fonts.load(font, input.content)
  measurementContext.font = font
  const lines = input.content.split('\n')
  const metrics = lines.map((line) => textMetrics(measurementContext, line, fontSize))

  let minX = 0
  let maxX = 0
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let index = 0; index < metrics.length; index += 1) {
    const metric = metrics[index]
    const left = lineLeft(metric.width, input.justification)
    minX = Math.min(minX, left)
    maxX = Math.max(maxX, left + metric.width)
    const baseline = index * leading
    minY = Math.min(minY, baseline - metric.ascent)
    maxY = Math.max(maxY, baseline + metric.descent)
  }

  const padding = Math.max(2, Math.ceil(fontSize * 0.15))
  const contentWidth = Math.max(1, maxX - minX)
  const width = Math.ceil(contentWidth + padding * 2)
  const height = Math.ceil(Math.max(1, maxY - minY) + padding * 2)
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > MAX_CANVAS_PIXELS) {
    throw new RangeError('Unicode PointText raster exceeds the safe Canvas size')
  }

  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D Canvas context is unavailable after resize')
  context.font = font
  context.textAlign = input.justification
  context.textBaseline = 'alphabetic'
  context.fillStyle = input.color
  const baselineX = padding - minX
  const baselineY = padding - minY
  for (let index = 0; index < lines.length; index += 1) {
    context.fillText(lines[index], baselineX, baselineY + index * leading)
  }

  return {
    pngBytes: await canvasPngBytes(canvas),
    width: width / RASTER_SCALE,
    height: height / RASTER_SCALE,
    baselineX: baselineX / RASTER_SCALE,
    baselineY: baselineY / RASTER_SCALE
  }
}

/** 테스트 격리용. 운영 호출 금지. */
export function __resetPdfFlattenFontResourcesForTesting(): void {
  fontPromise = null
}
