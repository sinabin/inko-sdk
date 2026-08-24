import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  rgb: vi.fn((r: number, g: number, b: number) => ({ r, g, b }))
}))

vi.mock('pdf-lib', () => ({
  PDFDocument: { load: mocks.load },
  StandardFonts: { Helvetica: 'Helvetica' },
  PDFPage: class {},
  rgb: mocks.rgb
}))

import { flattenPdfWithCanvasImage, flattenPdfWithPaperCanvas } from '../../src/lib/utils/pdfFlatten'

function page(width = 612, height = 792) {
  return {
    getSize: vi.fn(() => ({ width, height })),
    drawSvgPath: vi.fn(),
    drawRectangle: vi.fn(),
    drawCircle: vi.fn(),
    drawText: vi.fn(),
    drawImage: vi.fn()
  }
}

function documentFixture(pages = [page()]) {
  return {
    pages,
    embedFont: vi.fn(async () => ({ name: 'font' })),
    embedPng: vi.fn(async () => ({ name: 'png' })),
    save: vi.fn(async () => new Uint8Array([1, 2, 3])),
    getPages: vi.fn(() => pages)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('flattenPdfWithPaperCanvas', () => {
  it('Path 직선·Bezier·fill outline을 PDF 좌표와 색/opacity로 렌더링한다', async () => {
    const target = page()
    const doc = documentFixture([target])
    mocks.load.mockResolvedValue(doc)

    const bytes = await flattenPdfWithPaperCanvas(new Uint8Array([9]), {
      1: { version: 'paper', children: [
        {
          className: 'Path', strokeColor: { components: [1.2, -0.5, 0.25] },
          strokeWidth: 4, opacity: 0.4,
          segments: [
            { point: [20, 40], handleOut: [5, 10] },
            { point: [60, 80], handleIn: [-5, -10] },
            { point: [100, 100] }
          ]
        },
        {
          className: 'Path', fillColor: { components: [0.1, 0.2, 0.3] }, opacity: 1,
          segments: [{ point: [0, 0] }, { point: [20, 20] }]
        },
        {
          className: 'Path',
          segments: [{ point: [0, 0] }, { point: [10, 10] }]
        },
        { className: 'Path', segments: [{ point: [1, 1] }] }
      ] }
    } as any, 2)

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(doc.embedFont).toHaveBeenCalledWith('Helvetica')
    expect(target.drawSvgPath).toHaveBeenCalledTimes(3)
    expect(target.drawSvgPath.mock.calls[0][0]).toContain('M 10 772')
    expect(target.drawSvgPath.mock.calls[0][0]).toContain('C 12.5 767 27.5 757 30 752')
    expect(target.drawSvgPath.mock.calls[0][1]).toMatchObject({
      borderWidth: 2,
      color: { r: 1, g: 0, b: 0.25 },
      opacity: 0.4,
      borderOpacity: 0.4
    })
    expect(target.drawSvgPath.mock.calls[1][1]).toMatchObject({ borderWidth: 0 })
    expect(target.drawSvgPath.mock.calls[2][1]).toMatchObject({
      color: { r: 0, g: 0, b: 0 }, borderWidth: 0
    })
  })

  it('도형·텍스트·중첩 그룹을 렌더링하고 누락 geometry는 건너뛴다', async () => {
    const target = page(400, 500)
    const doc = documentFixture([target])
    mocks.load.mockResolvedValue(doc)

    await flattenPdfWithPaperCanvas(new ArrayBuffer(2), {
      1: { version: 'paper', children: [
        { className: 'Path.Rectangle' },
        { className: 'Path.Rectangle', bounds: { x: 20, y: 30, width: 80, height: 40 },
          strokeWidth: 2, strokeColor: { components: [0.2, 0.4, 0.6] },
          fillColor: { components: [0.8, 0.7, 0.6] } },
        { className: 'Path.Circle' },
        { className: 'Path.Circle', bounds: { x: 30, y: 50, width: 40, height: 60 },
          strokeColor: undefined, strokeWidth: 0, fillColor: { components: [0.3, 0.2, 0.1] } },
        { className: 'PointText', bounds: { x: 2, y: 3, width: 10, height: 5 } },
        { className: 'PointText', content: 'hello', bounds: { x: 20, y: 30, width: 100, height: 20 },
          fontSize: 20, fillColor: { components: [0.1, 0.2, 0.3] } },
        { className: 'CompoundPath', children: [
          { className: 'PointText', content: 'nested', bounds: { x: 4, y: 6, width: 20, height: 10 } }
        ] },
        { className: 'Group', children: [
          { className: 'Path.Rectangle', bounds: { x: 0, y: 0, width: 10, height: 10 } }
        ] },
        { className: 'Group' },
        { className: 'Unknown' }
      ] }
    } as any, 2)

    expect(target.drawRectangle).toHaveBeenCalledTimes(2)
    expect(target.drawRectangle.mock.calls[0][0]).toMatchObject({
      x: 10, y: 465, width: 40, height: 20, borderWidth: 1
    })
    expect(target.drawCircle).toHaveBeenCalledTimes(1)
    expect(target.drawCircle.mock.calls[0][0]).toMatchObject({ x: 25, y: 460, size: 10 })
    expect(target.drawText).toHaveBeenCalledTimes(2)
    expect(target.drawText.mock.calls[0][0]).toBe('hello')
    expect(target.drawText.mock.calls[0][1]).toMatchObject({ x: 10, y: 485, size: 10 })
  })

  it('없는 페이지/children은 무시하고 개별 draw 오류는 다음 item을 막지 않는다', async () => {
    const target = page()
    target.drawCircle.mockImplementationOnce(() => { throw new Error('bad circle') })
    const doc = documentFixture([target])
    mocks.load.mockResolvedValue(doc)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await flattenPdfWithPaperCanvas(new Uint8Array(), {
      1: { version: 'paper', children: [
        { className: 'Path.Circle', bounds: { x: 0, y: 0, width: 10, height: 10 } },
        { className: 'Path.Rectangle', bounds: { x: 0, y: 0, width: 10, height: 10 } }
      ] },
      2: { version: 'paper', children: [] },
      3: { version: 'paper' }
    } as any, 1)

    expect(warn).toHaveBeenCalledWith('[PdfFlatten] Failed to draw item:', expect.any(Error))
    expect(target.drawRectangle).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('flattenPdfWithCanvasImage', () => {
  it('data URL과 raw base64를 임베드해 페이지 전체에 배치한다', async () => {
    const first = page(100, 200)
    const second = page(300, 400)
    const doc = documentFixture([first, second])
    doc.embedPng.mockResolvedValueOnce({ name: 'one' }).mockResolvedValueOnce({ name: 'two' })
    mocks.load.mockResolvedValue(doc)

    const result = await flattenPdfWithCanvasImage(new Uint8Array([1]), {
      1: 'data:image/png;base64,AAAA',
      2: 'BBBB',
      3: 'CCCC',
      4: ''
    }, 9)

    expect(result).toEqual(new Uint8Array([1, 2, 3]))
    expect(doc.embedPng).toHaveBeenNthCalledWith(1, 'AAAA')
    expect(doc.embedPng).toHaveBeenNthCalledWith(2, 'BBBB')
    expect(first.drawImage).toHaveBeenCalledWith({ name: 'one' }, {
      x: 0, y: 0, width: 100, height: 200
    })
    expect(second.drawImage).toHaveBeenCalledWith({ name: 'two' }, {
      x: 0, y: 0, width: 300, height: 400
    })
  })

  it('한 이미지 embed 실패를 경고하고 저장은 계속한다', async () => {
    const first = page()
    const doc = documentFixture([first])
    doc.embedPng.mockRejectedValue(new Error('invalid png'))
    mocks.load.mockResolvedValue(doc)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(flattenPdfWithCanvasImage(new Uint8Array(), { 1: 'bad' }, 1))
      .resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(warn).toHaveBeenCalledWith(
      '[PdfFlatten] Failed to embed image for page 1:', expect.any(Error)
    )
    warn.mockRestore()
  })
})
