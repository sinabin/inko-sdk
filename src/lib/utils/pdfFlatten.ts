/** Paper.js 캔버스 데이터를 pdf-lib로 PDF에 병합하는 유틸리티 */
import { PDFDocument, rgb, StandardFonts, PDFPage } from 'pdf-lib'
import type { PaperExportData, PaperItem, PaperColor, PaperSegment } from '../../types'

/** Paper.js 캔버스 데이터를 PDF 페이지에 병합하여 Uint8Array로 반환 */
export async function flattenPdfWithPaperCanvas(
  pdfBytes: ArrayBuffer | Uint8Array,
  canvasDataByPage: Record<number, PaperExportData>,
  viewportScale: number
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const pages = pdfDoc.getPages()

  // 텍스트용 표준 폰트 임베드
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  for (const [pageNumStr, paperData] of Object.entries(canvasDataByPage)) {
    const pageNum = parseInt(pageNumStr)
    const page = pages[pageNum - 1]

    if (!page || !paperData.children) continue

    const { height: pageHeight, width: pageWidth } = page.getSize()

    for (const item of paperData.children) {
      try {
        await drawPaperItem(page, item, pageHeight, viewportScale, font)
      } catch (e) {
        console.warn(`[PdfFlatten] Failed to draw item:`, e)
      }
    }
  }

  return pdfDoc.save()
}

/** Paper.js 아이템을 className에 따라 PDF 페이지에 렌더링 */
async function drawPaperItem(
  page: PDFPage,
  item: PaperItem,
  pageHeight: number,
  scale: number,
  font: any
) {
  switch (item.className) {
    case 'Path':
      drawPaperPath(page, item, pageHeight, scale)
      break
    case 'Path.Rectangle':
      drawPaperRectangle(page, item, pageHeight, scale)
      break
    case 'Path.Circle':
      drawPaperCircle(page, item, pageHeight, scale)
      break
    case 'PointText':
      drawPaperText(page, item, pageHeight, scale, font)
      break
    case 'CompoundPath':
      // CompoundPath는 children 개별 처리
      if (item.children) {
        for (const child of item.children) {
          await drawPaperItem(page, child, pageHeight, scale, font)
        }
      }
      break
    case 'Group':
      // Group도 children 개별 처리
      if (item.children) {
        for (const child of item.children) {
          await drawPaperItem(page, child, pageHeight, scale, font)
        }
      }
      break
  }
}

/** Paper.js Path를 SVG 경로 문자열로 변환하여 PDF에 렌더링 */
function drawPaperPath(
  page: PDFPage,
  item: PaperItem,
  pageHeight: number,
  scale: number
) {
  if (!item.segments || item.segments.length < 2) return

  // 레거시 isOutline 아이템: strokeColor 없고 fillColor만 있는 경우 fillColor로 렌더링
  const hasStroke = item.strokeColor && item.strokeColor.components
  const hasFill = item.fillColor && item.fillColor.components

  const renderColor = hasStroke
    ? paperColorToRgb(item.strokeColor)
    : hasFill
      ? paperColorToRgb(item.fillColor)
      : rgb(0, 0, 0)

  const strokeWidth = hasStroke ? (item.strokeWidth || 1) / scale : 0

  // SVG 경로 문자열 생성
  let pathStr = ''

  item.segments.forEach((segment, index) => {
    const x = segment.point[0] / scale
    const y = convertY(segment.point[1], pageHeight, scale)

    if (index === 0) {
      pathStr += `M ${x} ${y} `
    } else {
      // 핸들이 있으면 베지어 커브 처리
      const prevSegment = item.segments![index - 1]

      if (prevSegment.handleOut || segment.handleIn) {
        const cp1x = prevSegment.handleOut
          ? (prevSegment.point[0] + prevSegment.handleOut[0]) / scale
          : prevSegment.point[0] / scale
        const cp1y = prevSegment.handleOut
          ? convertY(prevSegment.point[1] + prevSegment.handleOut[1], pageHeight, scale)
          : convertY(prevSegment.point[1], pageHeight, scale)

        const cp2x = segment.handleIn
          ? (segment.point[0] + segment.handleIn[0]) / scale
          : segment.point[0] / scale
        const cp2y = segment.handleIn
          ? convertY(segment.point[1] + segment.handleIn[1], pageHeight, scale)
          : convertY(segment.point[1], pageHeight, scale)

        pathStr += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x} ${y} `
      } else {
        pathStr += `L ${x} ${y} `
      }
    }
  })

  // 형광펜 등 반투명 path의 opacity 처리
  const pathOpacity = item.opacity != null && item.opacity < 1 ? item.opacity : undefined

  if (hasStroke) {
    // 일반 스트로크 Path
    page.drawSvgPath(pathStr, {
      x: 0,
      y: 0,
      color: renderColor,
      borderWidth: strokeWidth,
      borderColor: renderColor,
      ...(pathOpacity != null && { opacity: pathOpacity, borderOpacity: pathOpacity })
    })
  } else {
    // 레거시 isOutline (fillColor 전용) → fill로 렌더링
    page.drawSvgPath(pathStr, {
      x: 0,
      y: 0,
      color: renderColor,
      borderWidth: 0,
      ...(pathOpacity != null && { opacity: pathOpacity })
    })
  }
}

/** Paper.js Rectangle을 PDF에 렌더링 */
function drawPaperRectangle(
  page: PDFPage,
  item: PaperItem,
  pageHeight: number,
  scale: number
) {
  if (!item.bounds) return

  const { x, y, width, height } = item.bounds
  const pdfX = x / scale
  const pdfY = convertY(y + height, pageHeight, scale) // 좌하단 기준
  const pdfWidth = width / scale
  const pdfHeight = height / scale

  const strokeColor = paperColorToRgb(item.strokeColor)
  const fillColor = item.fillColor ? paperColorToRgb(item.fillColor) : undefined
  const strokeWidth = (item.strokeWidth || 1) / scale

  page.drawRectangle({
    x: pdfX,
    y: pdfY,
    width: pdfWidth,
    height: pdfHeight,
    borderColor: strokeColor,
    borderWidth: strokeWidth,
    color: fillColor
  })
}

/** Paper.js Circle을 PDF에 렌더링 */
function drawPaperCircle(
  page: PDFPage,
  item: PaperItem,
  pageHeight: number,
  scale: number
) {
  if (!item.bounds) return

  const { x, y, width, height } = item.bounds
  const radius = Math.min(width, height) / 2 / scale
  const centerX = (x + width / 2) / scale
  const centerY = convertY(y + height / 2, pageHeight, scale)

  const strokeColor = paperColorToRgb(item.strokeColor)
  const fillColor = item.fillColor ? paperColorToRgb(item.fillColor) : undefined
  const strokeWidth = (item.strokeWidth || 1) / scale

  page.drawCircle({
    x: centerX,
    y: centerY,
    size: radius,
    borderColor: strokeColor,
    borderWidth: strokeWidth,
    color: fillColor
  })
}

/** Paper.js PointText를 PDF에 렌더링 */
function drawPaperText(
  page: PDFPage,
  item: PaperItem,
  pageHeight: number,
  scale: number,
  font: any
) {
  if (!item.content || !item.bounds) return

  const x = item.bounds.x / scale
  const y = convertY(item.bounds.y, pageHeight, scale)
  const fontSize = (item.fontSize || 16) / scale

  const fillColor = item.fillColor
    ? paperColorToRgb(item.fillColor)
    : rgb(0, 0, 0)

  page.drawText(item.content, {
    x,
    y,
    font,
    size: fontSize,
    color: fillColor
  })
}

/** Paper.js Y좌표를 PDF Y좌표로 변환 (상단 원점 → 하단 원점) */
function convertY(paperY: number, pageHeight: number, scale: number): number {
  return pageHeight - (paperY / scale)
}

/** Paper.js 색상을 pdf-lib RGB로 변환 (0~1 범위 클램핑) */
function paperColorToRgb(color?: PaperColor): ReturnType<typeof rgb> {
  if (!color || !color.components) {
    return rgb(0, 0, 0)
  }

  const [r, g, b] = color.components

  return rgb(
    Math.max(0, Math.min(1, r)),
    Math.max(0, Math.min(1, g)),
    Math.max(0, Math.min(1, b))
  )
}

/** 캔버스를 이미지로 캡처하여 PDF에 임베드하는 대체 방식 (복잡한 경로 렌더링 실패 시 사용) */
export async function flattenPdfWithCanvasImage(
  pdfBytes: ArrayBuffer | Uint8Array,
  canvasImageByPage: Record<number, string>, // base64 PNG 이미지
  viewportScale: number
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const pages = pdfDoc.getPages()

  for (const [pageNumStr, base64Image] of Object.entries(canvasImageByPage)) {
    const pageNum = parseInt(pageNumStr)
    const page = pages[pageNum - 1]

    if (!page || !base64Image) continue

    const { width: pageWidth, height: pageHeight } = page.getSize()

    // data URL 접두사 제거
    const imageData = base64Image.replace(/^data:image\/png;base64,/, '')

    try {
      const pngImage = await pdfDoc.embedPng(imageData)

      // 페이지 전체를 덮도록 이미지 배치
      page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight
      })
    } catch (e) {
      console.warn(`[PdfFlatten] Failed to embed image for page ${pageNum}:`, e)
    }
  }

  return pdfDoc.save()
}
