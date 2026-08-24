import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPdfFlattenFontResourcesForTesting,
  rasterizePdfFlattenText
} from '../../src/lib/pdf/pdfFlattenFont'

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
const originalToBlob = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toBlob')

function installFontApis(load = vi.fn(async () => undefined)) {
  const add = vi.fn()
  const fontsLoad = vi.fn(async () => [])
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add, load: fontsLoad }
  })
  const constructed: Array<{ family: string; source: string }> = []
  class FakeFontFace {
    constructor(family: string, source: string) {
      constructed.push({ family, source })
    }

    async load() {
      await load()
      return this
    }
  }
  vi.stubGlobal('FontFace', FakeFontFace)
  return { add, constructed, fontsLoad, load }
}

function installCanvas() {
  const fillText = vi.fn()
  const measureText = vi.fn((text: string) => ({
    width: text.length * 20,
    actualBoundingBoxAscent: 32,
    actualBoundingBoxDescent: 8
  }))
  const context = {
    font: '',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    measureText,
    fillText
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    } as Blob)
  })
  return { context, fillText, measureText, toBlob }
}

const input = {
  content: '한글\nA',
  fontSize: 10,
  leading: 12,
  justification: 'center' as const,
  color: 'rgb(1 2 3)'
}

describe('PDF flatten Unicode text rasterizer', () => {
  beforeEach(() => {
    __resetPdfFlattenFontResourcesForTesting()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
    else delete (document as { fonts?: FontFaceSet }).fonts
    if (originalToBlob) Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', originalToBlob)
    else delete (HTMLCanvasElement.prototype as { toBlob?: HTMLCanvasElement['toBlob'] }).toBlob
  })

  it('Pretendard를 한 번 로드하고 4배 투명 Canvas의 baseline 기하와 PNG를 반환한다', async () => {
    const fontApis = installFontApis()
    const canvas = installCanvas()

    const first = await rasterizePdfFlattenText(input)
    const second = await rasterizePdfFlattenText({ ...input, content: '재사용' })

    expect(fontApis.load).toHaveBeenCalledOnce()
    expect(fontApis.add).toHaveBeenCalledOnce()
    expect(fontApis.constructed).toHaveLength(1)
    expect(fontApis.constructed[0].source).toContain('woff2')
    expect(fontApis.fontsLoad).toHaveBeenCalledTimes(2)
    expect(first).toEqual({
      pngBytes: new Uint8Array([1, 2, 3]),
      width: 13,
      height: 25,
      baselineX: 6.5,
      baselineY: 9.5
    })
    expect(canvas.fillText).toHaveBeenNthCalledWith(1, '한글', 26, 38)
    expect(canvas.fillText).toHaveBeenNthCalledWith(2, 'A', 26, 86)
    expect(second.pngBytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('FontFace asset 실패를 캐시하지 않고 다음 호출에서 재시도한다', async () => {
    const fontLoad = vi.fn()
      .mockRejectedValueOnce(new Error('font unavailable'))
      .mockResolvedValueOnce(undefined)
    installFontApis(fontLoad)
    installCanvas()

    await expect(rasterizePdfFlattenText(input)).rejects.toThrow('font unavailable')
    await expect(rasterizePdfFlattenText(input)).resolves.toMatchObject({
      pngBytes: new Uint8Array([1, 2, 3])
    })
    expect(fontLoad).toHaveBeenCalledTimes(2)
  })

  it('DOM FontFace 경계와 잘못된 입력을 명시적으로 거부한다', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: undefined })
    vi.stubGlobal('FontFace', undefined)

    await expect(rasterizePdfFlattenText(input)).rejects.toThrow('browser FontFace')

    installFontApis()
    installCanvas()
    await expect(rasterizePdfFlattenText({ ...input, content: '' })).rejects.toThrow('content')
    await expect(rasterizePdfFlattenText({ ...input, fontSize: 0 })).rejects.toThrow('fontSize')
  })

  it('Canvas에 PNG encoder가 없으면 명시적인 오류를 반환한다', async () => {
    installFontApis()
    installCanvas()
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: undefined
    })

    await expect(rasterizePdfFlattenText(input)).rejects.toThrow('PNG encoding is unavailable')
  })

  it('Canvas PNG encoder가 Blob을 반환하지 않으면 빈 결과를 거부한다', async () => {
    installFontApis()
    const canvas = installCanvas()
    canvas.toBlob.mockImplementation((callback) => callback(null))

    await expect(rasterizePdfFlattenText(input)).rejects.toThrow('PNG encoding returned no bytes')
  })

  it('측정된 텍스트가 안전 Canvas 한계를 넘으면 raster 생성을 중단한다', async () => {
    installFontApis()
    const canvas = installCanvas()
    canvas.measureText.mockReturnValue({
      width: 20_000,
      actualBoundingBoxAscent: 32,
      actualBoundingBoxDescent: 8
    })

    await expect(rasterizePdfFlattenText(input)).rejects.toThrow(
      'Unicode PointText raster exceeds the safe Canvas size'
    )
    expect(canvas.toBlob).not.toHaveBeenCalled()
  })
})
