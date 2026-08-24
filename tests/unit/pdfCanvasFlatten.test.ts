import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  rgb: vi.fn((r: number, g: number, b: number) => ({ r, g, b })),
  degrees: vi.fn((angle: number) => ({ type: 'degrees', angle })),
  pushGraphicsState: vi.fn(() => ({ op: 'push' })),
  popGraphicsState: vi.fn(() => ({ op: 'pop' })),
  setLineJoin: vi.fn((style: number) => ({ op: 'join', style })),
  getDocument: vi.fn()
}))

vi.mock('pdf-lib', () => ({
  BlendMode: {
    Normal: 'Normal', Multiply: 'Multiply', Screen: 'Screen', Overlay: 'Overlay',
    Darken: 'Darken', Lighten: 'Lighten', ColorDodge: 'ColorDodge',
    ColorBurn: 'ColorBurn', HardLight: 'HardLight', SoftLight: 'SoftLight',
    Difference: 'Difference', Exclusion: 'Exclusion'
  },
  LineCapStyle: { Butt: 0, Round: 1, Projecting: 2 },
  LineJoinStyle: { Miter: 0, Round: 1, Bevel: 2 },
  PDFDocument: { load: mocks.load },
  StandardFonts: { Helvetica: 'Helvetica' },
  degrees: mocks.degrees,
  popGraphicsState: mocks.popGraphicsState,
  pushGraphicsState: mocks.pushGraphicsState,
  rgb: mocks.rgb,
  setLineJoin: mocks.setLineJoin
}))

vi.mock('pdfjs-dist', () => ({
  getDocument: mocks.getDocument
}))

import {
  flattenPdfCanvasData,
  PDF_CANVAS_FLATTEN_ISSUE_LIMIT,
  type PdfCanvasViewport
} from '../../src/lib/pdf/pdfCanvasFlatten'

function pdfPage() {
  return {
    drawImage: vi.fn(),
    drawSvgPath: vi.fn(),
    drawText: vi.fn(),
    pushOperators: vi.fn()
  }
}

function pdfDocument(pages = [pdfPage()]) {
  const font = {
    encodeText: vi.fn((text: string) => {
      if (/[^\u0000-\u00ff]/.test(text)) throw new Error('WinAnsi cannot encode text')
      return { value: text }
    }),
    widthOfTextAtSize: vi.fn((text: string, size: number) => text.length * size / 2)
  }
  return {
    pages,
    font,
    getPages: vi.fn(() => pages),
    embedFont: vi.fn(async () => font),
    embedPng: vi.fn(async () => ({ name: 'png' })),
    save: vi.fn(async () => new Uint8Array([7, 8, 9]))
  }
}

const portraitViewport: PdfCanvasViewport = {
  width: 600,
  height: 800,
  convertToPdfPoint: (x, y) => [x + 10, 820 - y]
}

const rotatedCropViewport: PdfCanvasViewport = {
  width: 400,
  height: 300,
  convertToPdfPoint: (x, y) => [y + 20, x + 30]
}

function pageJson(children: unknown[]): string {
  return JSON.stringify(['Layer', { applyMatrix: true, children }])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('flattenPdfCanvasData', () => {
  it('실제 compact Paper Layer의 pen/highlighter/rectangle/circle/line/text를 평탄화한다', async () => {
    const page = pdfPage()
    const doc = pdfDocument([page])
    mocks.load.mockResolvedValue(doc)

    const canvasData = JSON.stringify({
      1: pageJson([
        ['Path', {
          segments: [[10, 20], [30, 40]],
          strokeColor: [0.1, 0.2, 0.3], strokeWidth: 3,
          strokeCap: 'round', strokeJoin: 'round'
        }],
        ['Path', {
          segments: [[50, 60], [70, 80]],
          strokeColor: [1, 1, 0], strokeWidth: 12,
          opacity: 0.3, blendMode: 'multiply', data: { isHighlighter: true }
        }],
        ['Path', {
          segments: [[100, 110], [220, 110], [220, 240], [100, 240]],
          closed: true, strokeColor: [1, 0, 0], strokeWidth: 2
        }],
        ['Path', {
          segments: [
            [[300, 250], [0, -27.6], [0, 27.6]],
            [[350, 300], [-27.6, 0], [27.6, 0]],
            [[300, 350], [0, 27.6], [0, -27.6]],
            [[250, 300], [27.6, 0], [-27.6, 0]]
          ],
          closed: true, strokeColor: [0, 1, 0], strokeWidth: 4
        }],
        ['Path', {
          segments: [[20, 700], [200, 650]],
          strokeColor: [0, 0, 1], strokeWidth: 5
        }],
        ['PointText', {
          point: [40, 500], content: 'hello', fillColor: [0.2, 0.2, 0.2],
          fontSize: 18, fontFamily: 'sans-serif'
        }]
      ])
    })

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1, 2, 3]),
      canvasData,
      viewportProvider: () => portraitViewport
    })

    expect(result.bytes).toEqual(new Uint8Array([7, 8, 9]))
    expect(result.report).toMatchObject({
      totalPdfPages: 1,
      requestedPages: 1,
      flattenedPages: 1,
      sourceItems: 6,
      flattenedItems: 6,
      skippedItems: 0,
      failedItems: 0,
      hasFailures: false,
      rewroteDocument: true
    })
    expect(page.drawSvgPath).toHaveBeenCalledTimes(5)
    expect(page.drawSvgPath.mock.calls[0][0]).toContain('M 20 -800 L 40 -780')
    expect(page.drawSvgPath.mock.calls[0][1]).toMatchObject({
      borderWidth: 3,
      borderOpacity: 1,
      borderLineCap: 1
    })
    expect(page.drawSvgPath.mock.calls[1][1]).toMatchObject({
      borderWidth: 12,
      borderOpacity: 0.3,
      blendMode: 'Multiply'
    })
    expect(page.drawSvgPath.mock.calls[2][0]).toMatch(/Z$/)
    expect(page.drawSvgPath.mock.calls[3][0]).toContain(' C ')
    expect(page.drawText).toHaveBeenCalledWith('hello', expect.objectContaining({
      x: 50,
      y: 320,
      size: 18,
      rotate: { type: 'degrees', angle: 0 }
    }))
    expect(doc.save).toHaveBeenCalledWith({
      addDefaultPage: false,
      updateFieldAppearances: false
    })
  })

  it('모든 page-keyed 상태를 DOM 가상화와 무관하게 처리하고 matrix/회전 viewport를 적용한다', async () => {
    const first = pdfPage()
    const second = pdfPage()
    const third = pdfPage()
    const doc = pdfDocument([first, second, third])
    mocks.load.mockResolvedValue(doc)
    const viewportProvider = vi.fn((pageNumber: number) =>
      pageNumber === 1 ? portraitViewport : rotatedCropViewport
    )

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        1: pageJson([
          ['Path', { segments: [[1, 2], [3, 4]], strokeColor: [0, 0, 0] }]
        ]),
        3: pageJson([
          ['Group', {
            matrix: [1, 0, 0, 1, 10, 20],
            children: [
              ['Path', { segments: [[5, 7], [15, 17]], strokeColor: [0, 0, 0] }],
              ['PointText', { point: [5, 7], content: 'R', fillColor: [0, 0, 0], fontSize: 10 }]
            ]
          }]
        ])
      },
      viewportProvider
    })

    expect(viewportProvider.mock.calls.map(([pageNumber]) => pageNumber)).toEqual([1, 3])
    expect(second.drawSvgPath).not.toHaveBeenCalled()
    expect(third.drawSvgPath.mock.calls[0][0]).toContain('M 47 -45 L 57 -55')
    expect(third.drawText).toHaveBeenCalledWith('R', expect.objectContaining({
      x: 47,
      y: 45,
      rotate: { type: 'degrees', angle: 90 }
    }))
    expect(result.report.pages.map((page) => page.pageNumber)).toEqual([1, 3])
    expect(result.report.flattenedPages).toBe(2)
  })

  it('Paper.js canonical PointText의 matrix translation을 baseline 좌표로 사용한다', async () => {
    const page = pdfPage()
    const doc = pdfDocument([page])
    mocks.load.mockResolvedValue(doc)

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        1: pageJson([
          ['PointText', {
            applyMatrix: false,
            matrix: [1, 0, 0, 1, 380, 550],
            content: 'matrix text',
            fillColor: [0.05, 0.15, 0.55],
            fontSize: 18,
            leading: 21.6
          }]
        ])
      },
      viewportProvider: () => portraitViewport
    })

    expect(page.drawText).toHaveBeenCalledWith('matrix text', expect.objectContaining({
      x: 390,
      y: 270,
      size: 18,
      rotate: { type: 'degrees', angle: 0 }
    }))
    expect(result.report).toMatchObject({
      flattenedItems: 1,
      failedItems: 0,
      hasFailures: false
    })
  })

  it('legacy object geometry와 색상 alpha/dash/정렬/스타일 근사를 명시적으로 처리한다', async () => {
    const page = pdfPage()
    const doc = pdfDocument([page])
    mocks.load.mockResolvedValue(doc)

    const legacyRoot = {
      children: [
        {
          className: 'Path.Rectangle',
          segments: [
            { point: { x: 10, y: 10 } },
            { point: { x: 50, y: 10 } },
            { point: { x: 50, y: 40 } },
            { point: { x: 10, y: 40 } }
          ],
          closed: true,
          strokeColor: '#ff0000',
          fillColor: { components: [0.5], alpha: 0.4 },
          strokeWidth: 2,
          strokeCap: 'square',
          strokeJoin: 'bevel',
          dashArray: [2, -1, 'bad', 3],
          opacity: 0.5,
          blendMode: 'hue'
        },
        {
          className: 'Path.Circle',
          segments: [[60, 60], [80, 80]],
          strokeColor: ['gray', 0.2, 0.5],
          strokeCap: 'butt'
        },
        {
          className: 'PointText',
          point: { x: 100, y: 100 },
          content: 'A\nBB',
          fillColor: [0.2, 0.3, 0.4, 0.5],
          fontSize: 12,
          leading: 15,
          fontFamily: 'serif',
          fontWeight: 'bold',
          justification: 'center',
          matrix: [2, 0, 0, 1, 0, 0],
          blendMode: 'hue'
        }
      ]
    }

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: { 1: JSON.stringify(legacyRoot) },
      viewportProvider: () => portraitViewport
    })

    expect(page.drawSvgPath).toHaveBeenCalledTimes(2)
    expect(page.drawSvgPath.mock.calls[0][1]).toMatchObject({
      opacity: 0.2,
      borderOpacity: 0.5,
      borderLineCap: 2,
      borderDashArray: [2, 3]
    })
    expect(mocks.setLineJoin).toHaveBeenCalledWith(2)
    expect(page.drawSvgPath.mock.calls[1][1]).toMatchObject({
      borderOpacity: 0.5,
      borderLineCap: 0
    })
    expect(page.drawText).toHaveBeenCalledTimes(2)
    expect(result.report.warnings).toBeGreaterThanOrEqual(4)
    expect(result.report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'BLEND_MODE_APPROXIMATED',
      'TEXT_STYLE_APPROXIMATED'
    ]))
  })

  it('손상·미지원·인코딩 실패를 item/page별로 보고하고 다음 항목은 계속 처리한다', async () => {
    const first = pdfPage()
    const second = pdfPage()
    const doc = pdfDocument([first, second])
    mocks.load.mockResolvedValue(doc)

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        1: pageJson([
          ['Raster', { source: 'data:image/png;base64,AAAA' }],
          ['Path', { segments: [[1, 2]], strokeColor: [0, 0, 0] }],
          ['Path', { segments: [[1, 2], [3, 4]], strokeColor: [0, 0, 0], visible: false }],
          ['Path', { segments: [[1, 2], [3, 4]], strokeColor: [0, 0, 0], data: { isSelectionUI: true } }],
          ['Path', { segments: [[1, 2], [3, 4]], strokeColor: ['cmyk', 0, 0, 0, 1] }],
          ['PointText', { point: [10, 20], content: '한글', fillColor: [0, 0, 0] }],
          ['Path', { segments: [[10, 20], [30, 40]], strokeColor: [0, 0, 0] }]
        ]),
        2: '{invalid',
        3: pageJson([])
      },
      viewportProvider: () => portraitViewport
    })

    expect(first.drawSvgPath).toHaveBeenCalledTimes(1)
    expect(result.report).toMatchObject({
      flattenedItems: 1,
      skippedItems: 2,
      failedItems: 6,
      hasFailures: true,
      rewroteDocument: true
    })
    expect(result.report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'UNSUPPORTED_ITEM',
      'INVALID_GEOMETRY',
      'ITEM_HIDDEN',
      'SELECTION_UI_SKIPPED',
      'UNSUPPORTED_COLOR',
      'TEXT_ENCODING_FAILED',
      'INVALID_PAGE_JSON',
      'PAGE_OUT_OF_RANGE'
    ]))
    expect(result.report.issues.every((issue) => issue.message.length > 0)).toBe(true)
  })

  it('주입한 textRasterizer로 한국어 PointText를 PNG 시각 평탄화하고 warning으로 보고한다', async () => {
    const page = pdfPage()
    const doc = pdfDocument([page])
    mocks.load.mockResolvedValue(doc)
    const textRasterizer = vi.fn(async () => ({
      pngBytes: new Uint8Array([10, 20, 30]),
      width: 100,
      height: 30,
      baselineX: 5,
      baselineY: 20
    }))

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        1: pageJson([
          ['PointText', {
            point: [40, 50], content: '한글 텍스트', fillColor: [0, 0, 0],
            fontSize: 16, fontFamily: 'Pretendard', fontWeight: 700
          }]
        ])
      },
      viewportProvider: () => portraitViewport,
      textRasterizer
    })

    expect(textRasterizer).toHaveBeenCalledWith({
      content: '한글 텍스트',
      fontSize: 16,
      leading: 19.2,
      justification: 'left',
      color: 'rgb(0 0 0)'
    })
    expect(doc.embedPng).toHaveBeenCalledWith(new Uint8Array([10, 20, 30]))
    expect(page.drawText).not.toHaveBeenCalled()
    expect(page.drawImage).toHaveBeenCalledWith({ name: 'png' }, expect.objectContaining({
      x: 45,
      y: 760,
      width: 100,
      height: 30,
      opacity: 1,
      rotate: { type: 'degrees', angle: 0 }
    }))
    expect(result.report.failedItems).toBe(0)
    expect(result.report.hasFailures).toBe(false)
    expect(result.report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'TEXT_RASTERIZED'
    }))
  })

  it('DOM 없는 호출에서 Unicode rasterizer 실패를 item 실패로 격리한다', async () => {
    const page = pdfPage()
    const doc = pdfDocument([page])
    mocks.load.mockResolvedValue(doc)

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        1: pageJson([
          ['PointText', { point: [10, 20], content: '한글', fillColor: [0, 0, 0] }]
        ])
      },
      viewportProvider: () => portraitViewport
    })

    expect(result.report).toMatchObject({
      flattenedItems: 0,
      failedItems: 1,
      hasFailures: true,
      rewroteDocument: false
    })
    expect(result.report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'TEXT_ENCODING_FAILED',
      message: expect.stringContaining('textRasterizer가 없습니다')
    }))

    const rasterizerFailure = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        1: pageJson([
          ['PointText', { point: [10, 20], content: '한글', fillColor: [0, 0, 0] }]
        ])
      },
      viewportProvider: () => portraitViewport,
      textRasterizer: async () => { throw new Error('canvas unavailable') }
    })
    expect(rasterizerFailure.report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'TEXT_RASTERIZATION_FAILED',
      message: 'canvas unavailable'
    }))
    expect(page.drawImage).not.toHaveBeenCalled()
    expect(doc.save).not.toHaveBeenCalled()
  })

  it('한 draw 오류 후 다음 item을 계속 처리한다', async () => {
    const page = pdfPage()
    page.drawSvgPath.mockImplementationOnce(() => { throw new Error('broken content stream') })
    const doc = pdfDocument([page])
    mocks.load.mockResolvedValue(doc)

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        1: pageJson([
          ['Path', { segments: [[1, 2], [3, 4]], strokeColor: [0, 0, 0] }],
          ['Path', { segments: [[5, 6], [7, 8]], strokeColor: [0, 0, 0] }]
        ])
      },
      viewportProvider: () => portraitViewport
    })

    expect(page.drawSvgPath).toHaveBeenCalledTimes(2)
    expect(result.report.flattenedItems).toBe(1)
    expect(result.report.failedItems).toBe(1)
    expect(result.report.issues).toContainEqual(expect.objectContaining({
      code: 'DRAW_FAILED', message: 'broken content stream'
    }))
  })

  it('구조·clipping·text style 오류와 text draw 실패를 모두 보고한다', async () => {
    const page = pdfPage()
    page.drawText.mockImplementation(() => { throw new Error('text stream failed') })
    const doc = pdfDocument([page, pdfPage()])
    mocks.load.mockResolvedValue(doc)

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        1: JSON.stringify([
          ['Group', {}],
          ['Group', { clipped: true, children: [
            ['Path', { segments: [[1, 2], [3, 4]], strokeColor: [0, 0, 0] }]
          ] }],
          ['Group', { children: [
            ['Path', { clipMask: true, segments: [[1, 2], [3, 4]], strokeColor: [0, 0, 0] }]
          ] }],
          ['Path', {}],
          ['Path', { segments: [[1, 2], [3, 4]] }],
          ['PointText', { point: [1, 2], content: 'hidden', visible: false }],
          ['PointText', { point: [1, 2], content: '' }],
          ['PointText', { point: [1, 2], content: 'bad color', fillColor: ['cmyk', 0, 0, 0, 1] }],
          ['PointText', { point: [1, 2], content: 'bad size', fontSize: 0 }],
          ['PointText', { point: [1, 2], content: 'draw me', fillColor: [0, 0, 0] }],
          42
        ]),
        2: JSON.stringify([[['dictionary', {}]], ['Layer', { children: [] }]])
      },
      viewportProvider: () => portraitViewport
    })

    expect(result.report.flattenedItems).toBe(0)
    expect(result.report.hasFailures).toBe(true)
    expect(result.report.rewroteDocument).toBe(false)
    expect(result.report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'INVALID_ITEM',
      'UNSUPPORTED_CLIPPING',
      'INVALID_GEOMETRY',
      'ITEM_HIDDEN',
      'UNSUPPORTED_COLOR',
      'DRAW_FAILED',
      'UNSUPPORTED_ITEM'
    ]))
  })

  it('잘못된 page key/value와 viewport 실패를 구조화해 반환한다', async () => {
    const doc = pdfDocument([pdfPage(), pdfPage()])
    mocks.load.mockResolvedValue(doc)

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: {
        bad: '[]',
        1: 123,
        2: pageJson([
          ['Path', { segments: [[1, 2], [3, 4]], strokeColor: [0, 0, 0] }]
        ])
      } as any,
      viewportProvider: () => null as any
    })

    expect(result.report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_CANVAS_PAGE' }),
      expect.objectContaining({ code: 'INVALID_PAGE_JSON', pageNumber: 1 }),
      expect.objectContaining({ code: 'VIEWPORT_FAILED', pageNumber: 2 })
    ]))
    expect(result.report.rewroteDocument).toBe(false)
  })

  it('기본 PDF.js viewport provider를 사용하고 loading task를 항상 정리한다', async () => {
    const page = pdfPage()
    const doc = pdfDocument([page])
    mocks.load.mockResolvedValue(doc)
    const pdfjsPage = {
      getViewport: vi.fn(() => portraitViewport),
      cleanup: vi.fn()
    }
    const pdfjsDocument = { getPage: vi.fn(async () => pdfjsPage) }
    const loadingTask = {
      promise: Promise.resolve(pdfjsDocument),
      destroy: vi.fn(async () => undefined)
    }
    mocks.getDocument.mockReturnValue(loadingTask)

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1, 2, 3]),
      canvasData: {
        1: pageJson([
          ['Path', { segments: [[1, 2], [3, 4]], strokeColor: [0, 0, 0] }]
        ])
      }
    })

    expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(Uint8Array),
      isEvalSupported: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true
    }))
    expect(pdfjsDocument.getPage).toHaveBeenCalledWith(1)
    expect(pdfjsPage.getViewport).toHaveBeenCalledWith({ scale: 1 })
    expect(pdfjsPage.cleanup).toHaveBeenCalled()
    expect(loadingTask.destroy).toHaveBeenCalled()
    expect(result.report.failedItems).toBe(0)
  })

  it('빈 canvasData는 PDF를 재작성하지 않고 정확한 입력 bytes를 반환한다', async () => {
    const doc = pdfDocument([pdfPage()])
    mocks.load.mockResolvedValue(doc)
    const viewportProvider = vi.fn(() => portraitViewport)
    const input = new Uint8Array([9, 8, 7])

    const result = await flattenPdfCanvasData({
      pdfBytes: input,
      canvasData: { 1: '[]' },
      viewportProvider
    })

    expect(result.bytes).toEqual(input)
    expect(result.bytes).not.toBe(input)
    expect(result.report.rewroteDocument).toBe(false)
    expect(doc.save).not.toHaveBeenCalled()
    expect(viewportProvider).not.toHaveBeenCalled()
  })

  it('대량 실패 issue는 상수 한도로 자르되 전체 실패 집계를 유지한다', async () => {
    const doc = pdfDocument([pdfPage()])
    mocks.load.mockResolvedValue(doc)
    const failureCount = PDF_CANVAS_FLATTEN_ISSUE_LIMIT + 125
    const unsupportedItems = Array.from(
      { length: failureCount },
      (_, index) => ['Raster', { source: `invalid-${index}` }]
    )

    const result = await flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: { 1: pageJson(unsupportedItems) },
      viewportProvider: () => portraitViewport
    })

    expect(result.report.sourceItems).toBe(failureCount)
    expect(result.report.failedItems).toBe(failureCount)
    expect(result.report.issues).toHaveLength(PDF_CANVAS_FLATTEN_ISSUE_LIMIT)
    expect(result.report.omittedIssues).toBe(125)
    expect(result.report.issuesTruncated).toBe(true)
    expect(result.report.hasFailures).toBe(true)
  })

  it('outer canvasData가 page-keyed object가 아니면 즉시 거부한다', async () => {
    const doc = pdfDocument([pdfPage()])
    mocks.load.mockResolvedValue(doc)

    await expect(flattenPdfCanvasData({
      pdfBytes: new Uint8Array([1]),
      canvasData: '[]',
      viewportProvider: () => portraitViewport
    })).rejects.toThrow('canvasData must be a page-keyed object')
  })
})
