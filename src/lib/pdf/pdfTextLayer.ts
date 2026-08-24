/** PDF.js 텍스트 선택·복사 레이어 생명주기 어댑터 */
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs'

type TextLayerBuilderConstructor = typeof import('pdfjs-dist/web/pdf_viewer.mjs')['TextLayerBuilder']

let builderConstructorPromise: Promise<TextLayerBuilderConstructor> | null = null

/**
 * pdf_viewer 공개 모듈은 같은 버전의 core를 globalThis.pdfjsLib에서 참조한다.
 * core 평가를 먼저 보장한 뒤 viewer를 지연 로드해 정적 import 순서 결합을 제거한다.
 */
function loadTextLayerBuilder(): Promise<TextLayerBuilderConstructor> {
  if (builderConstructorPromise) return builderConstructorPromise

  const task = import('pdfjs-dist').then(async (pdfjsLib) => {
    const scope = globalThis as typeof globalThis & {
      pdfjsLib?: typeof pdfjsLib
    }
    if (scope.pdfjsLib && scope.pdfjsLib.version !== pdfjsLib.version) {
      throw new Error('PDF.js core/viewer version mismatch')
    }
    scope.pdfjsLib ??= pdfjsLib
    return (await import('pdfjs-dist/web/pdf_viewer.mjs')).TextLayerBuilder
  })
  builderConstructorPromise = task
  void task.catch(() => {
    if (builderConstructorPromise === task) builderConstructorPromise = null
  })
  return task
}

export interface PdfTextLayerOptions {
  /** 레이어 배치를 호출부가 직접 제어할 때 사용 */
  onAppend?: (div: HTMLDivElement) => void
  /** PDF 권한 플래그를 TextLayerBuilder에 위임할지 여부 */
  enablePermissions?: boolean
}

export interface PdfTextLayerRenderOptions {
  pdfPage: PDFPageProxy
  viewport: PageViewport
  /** onAppend가 없을 때 레이어를 붙일 기본 컨테이너 */
  container?: HTMLElement
  textContentParams?: {
    includeMarkedContent?: boolean
    disableNormalization?: boolean
  }
}

/** 취소 계열 예외만 정상적인 false 결과로 수렴 */
function isCancellationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  return name === 'AbortException' || name === 'RenderingCancelledException'
}

/**
 * 페이지별 TextLayerBuilder를 생성·교체하는 어댑터.
 * render 완료 전 세대가 바뀌면 이전 레이어의 지연 append를 차단한다.
 */
export function createPdfTextLayer(options: PdfTextLayerOptions = {}) {
  let builder: TextLayerBuilder | null = null
  let currentDiv: HTMLDivElement | null = null
  let rendered = false
  let disposed = false
  let generation = 0

  /** 현재 builder 정리. 호출자가 이미 세대를 올렸으므로 여기서는 증가시키지 않음 */
  function clearCurrent(): void {
    if (builder) {
      try {
        builder.cancel()
      } catch {
        // PDF.js 정리 실패가 다음 페이지의 레이어 생성을 막지 않도록 격리
      }
    }
    currentDiv?.remove()
    builder = null
    currentDiv = null
    rendered = false
  }

  /** 현재 페이지의 선택·복사 텍스트 레이어 렌더링 */
  async function render(renderOptions: PdfTextLayerRenderOptions): Promise<boolean> {
    if (disposed) return false

    const renderGeneration = ++generation
    clearCurrent()

    let Builder: TextLayerBuilderConstructor
    try {
      Builder = await loadTextLayerBuilder()
    } catch (error) {
      if (disposed || renderGeneration !== generation) return false
      throw error
    }
    if (disposed || renderGeneration !== generation) return false

    let nextBuilder: TextLayerBuilder
    nextBuilder = new Builder({
      pdfPage: renderOptions.pdfPage,
      enablePermissions: options.enablePermissions === true,
      onAppend: (div: HTMLDivElement) => {
        if (disposed || renderGeneration !== generation || builder !== nextBuilder) {
          div.remove()
          return
        }

        if (options.onAppend) {
          options.onAppend(div)
        } else {
          renderOptions.container?.append(div)
        }
      }
    })
    builder = nextBuilder
    currentDiv = nextBuilder.div

    try {
      await nextBuilder.render({
        viewport: renderOptions.viewport,
        textContentParams: renderOptions.textContentParams ?? {
          includeMarkedContent: true,
          disableNormalization: true
        }
      })

      if (disposed || renderGeneration !== generation || builder !== nextBuilder) {
        try {
          nextBuilder.cancel()
        } catch {
          // 이미 취소된 PDF.js 작업은 추가 정리 불필요
        }
        nextBuilder.div.remove()
        return false
      }

      rendered = true
      return true
    } catch (error) {
      const stale = disposed || renderGeneration !== generation || builder !== nextBuilder
      if (!stale) clearCurrent()
      else nextBuilder.div.remove()

      if (stale || isCancellationError(error)) return false
      throw error
    }
  }

  /** 진행 중 렌더와 선택 전역 리스너 정리 */
  function cancel(): void {
    if (disposed) return
    generation++
    clearCurrent()
  }

  /** 인스턴스 영구 정리. 이후 render는 false를 반환 */
  function dispose(): void {
    if (disposed) return
    generation++
    clearCurrent()
    disposed = true
  }

  return {
    get div() { return currentDiv },
    get isRendered() { return rendered },
    get isDisposed() { return disposed },
    get generation() { return generation },
    render,
    cancel,
    dispose
  }
}

export type PdfTextLayer = ReturnType<typeof createPdfTextLayer>
