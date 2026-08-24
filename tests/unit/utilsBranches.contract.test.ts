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

import { flattenPdfWithPaperCanvas } from '../../src/lib/utils/pdfFlatten'

function fixture() {
  const page = {
    getSize: vi.fn(() => ({ width: 200, height: 300 })),
    drawSvgPath: vi.fn(),
    drawRectangle: vi.fn(),
    drawCircle: vi.fn(),
    drawText: vi.fn()
  }
  const document = {
    getPages: vi.fn(() => [page]),
    embedFont: vi.fn(async () => ({ name: 'font' })),
    save: vi.fn(async () => new Uint8Array([1]))
  }
  return { page, document }
}

beforeEach(() => vi.clearAllMocks())

describe('PDF flatten branch contracts', () => {
  it('uses default stroke width and endpoint coordinates for one-sided Bezier handles', async () => {
    const { page, document } = fixture()
    mocks.load.mockResolvedValue(document)

    await flattenPdfWithPaperCanvas(new Uint8Array(), {
      1: {
        version: 'paper',
        children: [
          {
            className: 'Path',
            strokeColor: { components: [0, 0, 0] },
            strokeWidth: 0,
            segments: [
              { point: [10, 20] },
              { point: [30, 40], handleIn: [-5, -6] }
            ]
          },
          {
            className: 'Path',
            strokeColor: { components: [0, 0, 0] },
            segments: [
              { point: [50, 60], handleOut: [7, 8] },
              { point: [90, 100] }
            ]
          }
        ]
      }
    } as any, 2)

    expect(page.drawSvgPath).toHaveBeenCalledTimes(2)
    expect(page.drawSvgPath.mock.calls[0][0]).toContain('C 5 290 12.5 283 15 280')
    expect(page.drawSvgPath.mock.calls[0][1].borderWidth).toBe(0.5)
    expect(page.drawSvgPath.mock.calls[1][0]).toContain('C 28.5 266 45 250 45 250')
  })

  it('preserves opacity for a fill-only outline', async () => {
    const { page, document } = fixture()
    mocks.load.mockResolvedValue(document)

    await flattenPdfWithPaperCanvas(new Uint8Array(), {
      1: {
        version: 'paper',
        children: [{
          className: 'Path',
          fillColor: { components: [0.2, 0.3, 0.4] },
          opacity: 0.25,
          segments: [{ point: [0, 0] }, { point: [10, 10] }]
        }]
      }
    } as any, 1)

    expect(page.drawSvgPath).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      borderWidth: 0,
      opacity: 0.25
    }))
  })
})
