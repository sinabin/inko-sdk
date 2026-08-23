/** PDF 페이지 캔버스 렌더링 모듈 */
import type { PDFPageProxy } from 'pdfjs-dist'
import type { PageDimensions } from '../../types'
import { reportError } from '../utils/errorReporter.svelte'

export interface RenderOptions {
  scale?: number
  devicePixelRatio?: number
  intent?: 'display' | 'print'
}

export function createPdfRenderer() {
  let isRendering = $state(false)
  let currentRenderTask: any = null
  let lastRenderedPage = $state<number | null>(null)
  let lastRenderedScale = $state<number | null>(null)

  /** 페이지 뷰포트 치수 계산 */
  function getPageDimensions(
    page: PDFPageProxy,
    scale: number = 1
  ): PageDimensions {
    const viewport = page.getViewport({ scale: 1 })
    return {
      originalWidth: viewport.width,
      originalHeight: viewport.height,
      width: viewport.width * scale,
      height: viewport.height * scale
    }
  }

  /** 페이지를 캔버스에 렌더링 */
  async function renderPage(
    page: PDFPageProxy,
    canvas: HTMLCanvasElement,
    options: RenderOptions = {}
  ): Promise<boolean> {
    const {
      scale = 1,
      devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.5), // 성능 제한: DPR 최대 1.5
      intent = 'display'
    } = options

    // 이전 렌더링 취소
    if (currentRenderTask) {
      try {
        currentRenderTask.cancel()
      } catch {
        // 취소 무시
      }
    }

    isRendering = true

    try {
      const viewport = page.getViewport({ scale })

      // 캔버스 크기 설정 (고해상도 지원)
      canvas.width = Math.floor(viewport.width * devicePixelRatio)
      canvas.height = Math.floor(viewport.height * devicePixelRatio)

      // CSS 크기 설정
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const context = canvas.getContext('2d', {
        willReadFrequently: false,
        alpha: false
      })

      if (!context) {
        throw new Error('Cannot get 2D context')
      }

      // 고해상도 스케일 적용
      context.scale(devicePixelRatio, devicePixelRatio)

      // 배경 채우기
      context.fillStyle = 'white'
      context.fillRect(0, 0, viewport.width, viewport.height)

      // 렌더링
      currentRenderTask = page.render({
        canvasContext: context,
        viewport,
        intent,
        canvas // pdfjs-dist v5+ 필수 속성
      } as any)

      await currentRenderTask.promise

      lastRenderedPage = page.pageNumber
      lastRenderedScale = scale

      return true
    } catch (e: any) {
      if (e?.name === 'RenderingCancelledException') {
        // 렌더링 취소 시 정상 처리
        return false
      }
      reportError('render', `페이지 ${page.pageNumber} 렌더링에 실패했습니다`, e)
      return false
    } finally {
      isRendering = false
      currentRenderTask = null
    }
  }

  /** 저해상도 미리보기 렌더링 */
  async function renderPreview(
    page: PDFPageProxy,
    canvas: HTMLCanvasElement,
    maxWidth: number = 200
  ): Promise<boolean> {
    const viewport = page.getViewport({ scale: 1 })
    const previewScale = maxWidth / viewport.width

    return renderPage(page, canvas, {
      scale: previewScale,
      devicePixelRatio: 1,
      intent: 'display'
    })
  }

  /** 현재 렌더링 작업 취소 */
  function cancelRender() {
    if (currentRenderTask) {
      try {
        currentRenderTask.cancel()
      } catch {
        // 취소 무시
      }
      currentRenderTask = null
    }
  }

  /** 특정 페이지/스케일 조합의 렌더링 완료 여부 확인 */
  function isAlreadyRendered(pageNum: number, scale: number): boolean {
    return lastRenderedPage === pageNum && lastRenderedScale === scale
  }

  /** 렌더 상태 초기화 */
  function reset() {
    cancelRender()
    lastRenderedPage = null
    lastRenderedScale = null
    isRendering = false
  }

  return {
    get isRendering() { return isRendering },
    get lastRenderedPage() { return lastRenderedPage },
    get lastRenderedScale() { return lastRenderedScale },

    getPageDimensions,
    renderPage,
    renderPreview,
    cancelRender,
    isAlreadyRendered,
    reset
  }
}

export type PdfRenderer = ReturnType<typeof createPdfRenderer>
