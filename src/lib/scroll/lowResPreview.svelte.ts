/**
 * 저해상도 프리뷰 시스템
 *
 * 빠른 스크롤 시 PDF 페이지가 렌더링되지 않고 숫자만 표시되는 문제 해결을 위해
 * PDF 로드 시 모든 페이지의 저해상도 썸네일을 미리 생성하여 캐싱
 *
 * 메모리 계산:
 * - 원본 A4 @ scale 1.0 ≈ 595x842px ≈ 2MB/page
 * - 저해상도 @ scale 0.15 ≈ 89x126px (JPEG 0.7) ≈ 5-10KB/page
 * - 100페이지 × 10KB ≈ 1MB (허용 범위)
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'

const PREVIEW_SCALE = 0.15
const BATCH_SIZE = 5 // 동시 생성 수 (브라우저 응답성 유지)
const JPEG_QUALITY = 0.7 // JPEG 압축 품질

class StalePreviewGenerationError extends Error {
  constructor() {
    super('폐기된 프리뷰 생성 작업')
    this.name = 'StalePreviewGenerationError'
  }
}

export interface LowResPreview {
  // State
  readonly isGenerating: boolean
  readonly generationProgress: number

  // Methods
  generateAllPreviews: (pdfDoc: PDFDocumentProxy, onProgress?: (progress: number) => void) => Promise<void>
  generateSinglePreview: (pdfDoc: PDFDocumentProxy, pageNum: number) => Promise<string>
  getPreview: (pageNum: number) => string | undefined
  hasPreview: (pageNum: number) => boolean
  clearPreviews: () => void
  getCacheSize: () => number
}

export function createLowResPreview(): LowResPreview {
  // 페이지 번호 -> Blob URL 캐시
  let previewCache = $state<Map<number, string>>(new Map())

  // 프리뷰 생성 상태
  let isGenerating = $state(false)
  let generationProgress = $state(0)
  let generationId = 0

  /**
   * 모든 페이지의 저해상도 프리뷰 생성
   * 배치 처리로 브라우저 응답성 유지
   */
  async function generateAllPreviews(
    pdfDoc: PDFDocumentProxy,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (isGenerating) {
      console.log('[LowResPreview] 이미 프리뷰 생성 중')
      return
    }

    const runId = ++generationId
    isGenerating = true
    generationProgress = 0

    const numPages = pdfDoc.numPages
    console.log(`[LowResPreview] ${numPages}페이지 프리뷰 생성 시작`)

    try {
      for (let i = 0; i < numPages; i += BATCH_SIZE) {
        // 배치 생성 (동시에 BATCH_SIZE개 페이지 처리)
        const batchEnd = Math.min(i + BATCH_SIZE, numPages)
        const batch = Array.from(
          { length: batchEnd - i },
          (_, j) => generateSinglePreviewForGeneration(pdfDoc, i + j + 1, runId)
        )

        await Promise.all(batch)

        if (runId !== generationId) {
          throw new StalePreviewGenerationError()
        }

        // 진행률 업데이트
        generationProgress = Math.round((batchEnd / numPages) * 100)
        onProgress?.(generationProgress)

        // 브라우저 응답성 유지를 위한 짧은 대기
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      console.log('[LowResPreview] 모든 프리뷰 생성 완료')
    } catch (err) {
      if (!(err instanceof StalePreviewGenerationError) && runId === generationId) {
        console.error('[LowResPreview] 프리뷰 생성 실패:', err)
      }
    } finally {
      // clearPreviews() 이후 시작한 새 작업의 상태를 예전 작업이 덮어쓰지 않는다.
      if (runId === generationId) {
        isGenerating = false
        generationProgress = 100
      }
    }
  }

  /**
   * 단일 페이지의 저해상도 프리뷰 생성
   */
  async function generateSinglePreview(
    pdfDoc: PDFDocumentProxy,
    pageNum: number
  ): Promise<string> {
    try {
      return await generateSinglePreviewForGeneration(pdfDoc, pageNum, generationId)
    } catch (err) {
      if (!(err instanceof StalePreviewGenerationError)) {
        console.warn(`[LowResPreview] 페이지 ${pageNum} 프리뷰 생성 실패:`, err)
      }
      throw err
    }
  }

  async function generateSinglePreviewForGeneration(
    pdfDoc: PDFDocumentProxy,
    pageNum: number,
    runId: number
  ): Promise<string> {
    if (runId !== generationId) {
      throw new StalePreviewGenerationError()
    }

    // 이미 캐시에 있으면 반환
    if (previewCache.has(pageNum)) {
      return previewCache.get(pageNum)!
    }

    let canvas: HTMLCanvasElement | null = null

    try {
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: PREVIEW_SCALE })

      // 오프스크린 캔버스 생성
      canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Canvas context 생성 실패')
      }

      // PDF 페이지 렌더링
      await page.render({
        canvasContext: ctx,
        viewport: viewport,
        canvas
      }).promise

      // JPEG Blob으로 변환 후 URL 생성
      const blobUrl = await new Promise<string>((resolve, reject) => {
        canvas!.toBlob(
          (blob) => {
            if (blob) {
              resolve(URL.createObjectURL(blob))
            } else {
              reject(new Error('Blob 생성 실패'))
            }
          },
          'image/jpeg',
          JPEG_QUALITY
        )
      })

      if (runId !== generationId) {
        URL.revokeObjectURL(blobUrl)
        throw new StalePreviewGenerationError()
      }

      // 같은 페이지의 경쟁 생성이 있었다면 후발 URL을 즉시 회수한다.
      const existing = previewCache.get(pageNum)
      if (existing) {
        URL.revokeObjectURL(blobUrl)
        return existing
      }

      // 캐시에 저장
      const nextCache = new Map(previewCache)
      nextCache.set(pageNum, blobUrl)
      previewCache = nextCache

      return blobUrl
    } finally {
      if (canvas) {
        // 캔버스 메모리 해제
        canvas.width = 1
        canvas.height = 1
      }
    }
  }

  /**
   * 특정 페이지의 프리뷰 URL 반환
   */
  function getPreview(pageNum: number): string | undefined {
    return previewCache.get(pageNum)
  }

  /**
   * 특정 페이지의 프리뷰 존재 여부 확인
   */
  function hasPreview(pageNum: number): boolean {
    return previewCache.has(pageNum)
  }

  /**
   * 모든 프리뷰 정리 (메모리 해제)
   */
  function clearPreviews(): void {
    generationId++
    isGenerating = false
    previewCache.forEach((url) => URL.revokeObjectURL(url))
    previewCache = new Map()
    generationProgress = 0
    console.log('[LowResPreview] 프리뷰 캐시 정리 완료')
  }

  /**
   * 캐시된 프리뷰 개수 반환
   */
  function getCacheSize(): number {
    return previewCache.size
  }

  return {
    get isGenerating() { return isGenerating },
    get generationProgress() { return generationProgress },

    generateAllPreviews,
    generateSinglePreview,
    getPreview,
    hasPreview,
    clearPreviews,
    getCacheSize
  }
}
