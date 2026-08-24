import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLowResPreview } from '../../src/lib/scroll/lowResPreview.svelte'

function pdf(options: { numPages?: number; render?: () => Promise<void> } = {}) {
  const { numPages = 1, render = () => Promise.resolve() } = options
  return {
    numPages,
    getPage: vi.fn(async () => ({
      getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })),
      render: vi.fn(() => ({ promise: render() }))
    }))
  } as any
}

beforeEach(() => {
  let id = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++id}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
    callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('lowResPreview edge contract', () => {
  it('진행 중 중복 generateAll 요청을 무시하고 progress callback을 배치마다 통지한다', async () => {
    let finish!: () => void
    const source = pdf({ numPages: 1, render: () => new Promise<void>((resolve) => { finish = resolve }) })
    const preview = createLowResPreview()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const progress = vi.fn()
    const first = preview.generateAllPreviews(source, progress)
    await Promise.resolve()
    expect(preview.isGenerating).toBe(true)
    await preview.generateAllPreviews(source)
    expect(source.getPage).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[LowResPreview] 이미 프리뷰 생성 중')
    finish()
    await first
    expect(progress).toHaveBeenCalledWith(100)
    expect(preview.generationProgress).toBe(100)
    expect(preview.isGenerating).toBe(false)
  })

  it('단일 preview cache hit은 재렌더·새 URL 없이 같은 값을 반환한다', async () => {
    const source = pdf()
    const preview = createLowResPreview()
    const first = await preview.generateSinglePreview(source, 1)
    const second = await preview.generateSinglePreview(source, 1)
    expect(second).toBe(first)
    expect(source.getPage).toHaveBeenCalledTimes(1)
    expect(preview.hasPreview(1)).toBe(true)
    expect(preview.getPreview(1)).toBe(first)
  })

  it('동일 페이지 경쟁 생성은 후발 Blob URL을 회수하고 canonical URL을 공유한다', async () => {
    const source = pdf()
    const preview = createLowResPreview()
    const [first, second] = await Promise.all([
      preview.generateSinglePreview(source, 1),
      preview.generateSinglePreview(source, 1)
    ])
    expect(second).toBe(first)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(preview.getCacheSize()).toBe(1)
  })

  it('context/toBlob/render 실패를 warn하고 reject한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = originalCreate(tag)
      if (tag === 'canvas') vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue(null)
      return element
    }) as typeof document.createElement)
    const preview = createLowResPreview()
    await expect(preview.generateSinglePreview(pdf(), 1)).rejects.toThrow('Canvas context 생성 실패')
    expect(warn).toHaveBeenCalledWith(
      '[LowResPreview] 페이지 1 프리뷰 생성 실패:', expect.any(Error)
    )
    vi.restoreAllMocks()

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) { callback(null) })
    const blobFailure = createLowResPreview()
    await expect(blobFailure.generateSinglePreview(pdf(), 2)).rejects.toThrow('Blob 생성 실패')

    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob(['ok']))
    })
    const renderFailure = createLowResPreview()
    await expect(renderFailure.generateSinglePreview(pdf({ render: () => Promise.reject(new Error('render')) }), 3))
      .rejects.toThrow('render')
  })

  it('clear로 stale된 단일 작업은 생성 URL을 회수하고 stale 경고 없이 reject한다', async () => {
    let finish!: () => void
    const source = pdf({ render: () => new Promise<void>((resolve) => { finish = resolve }) })
    const preview = createLowResPreview()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = preview.generateSinglePreview(source, 1)
    for (let round = 0; round < 8 && !finish; round += 1) await Promise.resolve()
    preview.clearPreviews()
    finish()
    await expect(pending).rejects.toMatchObject({ name: 'StalePreviewGenerationError' })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1')
    expect(warn).not.toHaveBeenCalled()
  })

  it('generateAll 내부 실패는 error 로그 후 현재 세대 상태를 100으로 마감한다', async () => {
    const preview = createLowResPreview()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await preview.generateAllPreviews(pdf({ render: () => Promise.reject(new Error('batch failed')) }))
    expect(error).toHaveBeenCalledWith(
      '[LowResPreview] 프리뷰 생성 실패:', expect.any(Error)
    )
    expect(preview.isGenerating).toBe(false)
    expect(preview.generationProgress).toBe(100)

    const empty = createLowResPreview()
    await empty.generateAllPreviews(pdf({ numPages: 0 }))
    expect(empty.generationProgress).toBe(100)
  })
})
