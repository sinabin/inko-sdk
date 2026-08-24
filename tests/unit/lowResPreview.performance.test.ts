import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLowResPreview } from '../../src/lib/scroll/lowResPreview.svelte'

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

function immediatePdf(numPages: number, marker: string) {
  let active = 0
  let peak = 0
  return {
    numPages,
    get active() { return active },
    get peak() { return peak },
    getPage: vi.fn(async (pageNumber: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => {
        active++
        peak = Math.max(peak, active)
        return { promise: Promise.resolve().finally(() => { active-- }) }
      },
      marker: `${marker}-${pageNumber}`
    }))
  } as any
}

describe('lowResPreview Blob 수명 계약', () => {
  const created: string[] = []
  const revoked: string[] = []
  let nextUrl = 0

  beforeEach(() => {
    created.length = 0
    revoked.length = 0
    nextUrl = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:preview-${++nextUrl}`
      created.push(url)
      return url
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url)
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob(['preview'], { type: 'image/jpeg' }))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('12페이지를 최대 5개씩 생성하고 clear 시 모든 URL을 해제한다', async () => {
    const pdf = immediatePdf(12, 'a')
    const preview = createLowResPreview()

    await preview.generateAllPreviews(pdf)

    expect(pdf.peak).toBeLessThanOrEqual(5)
    expect(preview.getCacheSize()).toBe(12)
    expect(created).toHaveLength(12)
    preview.clearPreviews()
    expect(preview.getCacheSize()).toBe(0)
    expect(new Set(revoked)).toEqual(new Set(created))
  })

  it('clear 이후 완료된 이전 세대 Blob은 캐시에 재진입하지 않고 즉시 해제한다', async () => {
    let resolveOld!: () => void
    const oldRender = new Promise<void>((resolve) => { resolveOld = resolve })
    const oldPdf = {
      numPages: 1,
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 90, height: 120 }),
        render: () => ({ promise: oldRender })
      }))
    } as any
    const newPdf = immediatePdf(1, 'new')
    const preview = createLowResPreview()

    const oldGeneration = preview.generateAllPreviews(oldPdf)
    await flushMicrotasks()
    preview.clearPreviews()
    const newGeneration = preview.generateAllPreviews(newPdf)
    await newGeneration
    const currentUrl = preview.getPreview(1)

    resolveOld()
    await oldGeneration
    await flushMicrotasks()

    expect(preview.getCacheSize()).toBe(1)
    expect(preview.getPreview(1)).toBe(currentUrl)
    expect(created.filter((url) => url !== currentUrl).every((url) => revoked.includes(url))).toBe(true)
  })
})
