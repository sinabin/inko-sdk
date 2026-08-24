import { describe, expect, it } from 'vitest'
import { degrees, PDFDocument } from 'pdf-lib'
import { flattenPdfCanvasData } from '../../src/lib/pdf/pdfCanvasFlatten'

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
))

function pageJson(children: unknown[]): string {
  return JSON.stringify(['Layer', { applyMatrix: true, children }])
}

describe('flattenPdfCanvasData real PDF write smoke', () => {
  it('CropBox/Rotate 페이지를 PDF.js viewport로 합성하고 기존 AcroForm 값을 보존한다', async () => {
    const source = await PDFDocument.create({ updateMetadata: false })
    const rotatedPage = source.addPage([420, 500])
    rotatedPage.setCropBox(20, 30, 240, 320)
    rotatedPage.setRotation(degrees(90))
    const formPage = source.addPage([300, 400])
    const form = source.getForm()
    const field = form.createTextField('existing-value')
    field.setText('saved before flatten')
    field.addToPage(formPage, { x: 30, y: 330, width: 180, height: 24 })
    const inputBytes = await source.save()

    const result = await flattenPdfCanvasData({
      pdfBytes: inputBytes,
      canvasData: {
        1: pageJson([
          ['Path', {
            segments: [[10, 20], [80, 60], [160, 120]],
            strokeColor: [0.9, 0.1, 0.1], strokeWidth: 4,
            strokeCap: 'round', strokeJoin: 'round'
          }]
        ]),
        2: pageJson([
          ['PointText', {
            point: [40, 80], content: 'flattened', fillColor: [0.1, 0.2, 0.7],
            fontSize: 16, fontFamily: 'sans-serif'
          }]
        ])
      },
      // PDF.js PageViewport(scale=1)의 exact inverse transform:
      // p1 viewBox=[20,30,260,350], Rotate=90 -> [xPdf,yPdf]=[yView+20,xView+30]
      // p2 viewBox=[0,0,300,400], Rotate=0 -> [xPdf,yPdf]=[xView,400-yView]
      viewportProvider: (pageNumber) => pageNumber === 1
        ? { width: 320, height: 240, convertToPdfPoint: (x, y) => [y + 20, x + 30] }
        : { width: 300, height: 400, convertToPdfPoint: (x, y) => [x, 400 - y] }
    })

    expect(result.bytes.slice(0, 4)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect(result.report).toMatchObject({
      totalPdfPages: 2,
      flattenedPages: 2,
      flattenedItems: 2,
      failedItems: 0,
      hasFailures: false,
      rewroteDocument: true
    })

    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false })
    expect(reopened.getPageCount()).toBe(2)
    expect(reopened.getPage(0).getRotation().angle).toBe(90)
    expect(reopened.getPage(0).getCropBox()).toMatchObject({
      x: 20, y: 30, width: 240, height: 320
    })
    expect(reopened.getForm().getTextField('existing-value').getText()).toBe('saved before flatten')
  })

  it('주입한 한글 raster PNG를 실제 PDF image content로 임베딩한다', async () => {
    const source = await PDFDocument.create({ updateMetadata: false })
    source.addPage([300, 400])
    const inputBytes = await source.save()
    const result = await flattenPdfCanvasData({
      pdfBytes: inputBytes,
      canvasData: {
        1: pageJson([
          ['PointText', {
            point: [36, 72],
            content: '한글 평탄화 ①',
            fillColor: [0.05, 0.1, 0.2],
            fontSize: 18,
            fontFamily: 'Pretendard'
          }]
        ])
      },
      textRasterizer: async () => ({
        pngBytes: ONE_PIXEL_PNG,
        width: 120,
        height: 24,
        baselineX: 2,
        baselineY: 18
      }),
      viewportProvider: () => ({
        width: 300,
        height: 400,
        convertToPdfPoint: (x, y) => [x, 400 - y]
      })
    })

    expect(result.report).toMatchObject({
      flattenedItems: 1,
      failedItems: 0,
      hasFailures: false,
      rewroteDocument: true
    })
    expect(result.report.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'TEXT_RASTERIZED',
        pageNumber: 1
      })
    ])
    const reopened = await PDFDocument.load(result.bytes, { updateMetadata: false })
    expect(reopened.getPageCount()).toBe(1)
    expect(result.bytes.byteLength).toBeGreaterThan(inputBytes.byteLength)
  })
})
