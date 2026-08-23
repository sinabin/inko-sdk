/** Paper.js 캔버스 초기화 및 관리 모듈 — 1.0x baseline 좌표계 + view.zoom 시각 스케일 */
import paper from 'paper'

export interface PaperCanvasOptions {
  isReadOnly?: boolean
}

export function createPaperCanvas(options: PaperCanvasOptions = {}) {
  let scope = $state<paper.PaperScope | null>(null)
  let project = $state<paper.Project | null>(null)
  let view = $state<paper.View | null>(null)
  let canvasElement = $state<HTMLCanvasElement | null>(null)

  // 1.0x 기준 논리 크기 — Paper.js project 좌표계 (데이터 저장 기준)
  let baseWidth = 0
  let baseHeight = 0
  // 현재 시각 줌 — view.zoom과 일치
  let currentZoom = 1

  const isReady = $derived(scope !== null && project !== null)
  const isReadOnly = options.isReadOnly ?? false

  /** 캔버스 물리/CSS 픽셀 크기 + Paper.js view.zoom·viewSize를 일관되게 설정
   *  컨테이너 시각 크기와 정확히 일치하도록 모든 길이를 동일하게 floor 적용 */
  function applyDimensions(baseW: number, baseH: number, zoom: number, dpr?: number): void {
    if (!canvasElement || !view) return

    const pixelRatio = dpr ?? Math.min(window.devicePixelRatio || 1, 2.0)
    const cssW = Math.floor(baseW * zoom)
    const cssH = Math.floor(baseH * zoom)

    // Paper의 _pixelRatio는 PaperScope.setup() 시점에 devicePixelRatio/backingStorePixelRatio로
    // 캐시됨. iframe이 다른 DPR 환경에서 로드됐거나 Chrome이 backingStorePixelRatio를 보고하면
    // 우리가 기대한 pixelRatio와 어긋나, 백버퍼 크기(canvas.width)와 context.scale 사이에 불일치가
    // 생겨 PointerEvent 좌표와 그려진 stroke 위치가 어긋난다 (4K 모니터 등 고DPR 환경 한정).
    // 매번 호출 시 동기화한다.
    ;(view as any)._pixelRatio = pixelRatio

    canvasElement.style.width = `${cssW}px`
    canvasElement.style.height = `${cssH}px`

    // Paper의 CanvasView._setElementSize를 직접 호출 — 다음을 일관되게 수행한다:
    //   (a) canvas.width = cssW * _pixelRatio  (백버퍼)
    //   (b) context.restore()→save()→scale(_pixelRatio, _pixelRatio)  (고DPR 렌더 보정)
    // viewSize setter를 통하면 delta=0일 때 _setElementSize가 스킵되어 새 pixelRatio가 미반영
    // 되므로, _setElementSize를 직접 호출 후 _viewSize 상태만 갱신한다.
    ;(view as any)._setElementSize(cssW, cssH)
    ;(view as any)._viewSize = new paper.Size(cssW, cssH)

    view.zoom = zoom
    // project (0,0)이 view (0,0)에 정렬되도록 center를 baseDim/2로 설정
    view.center = new paper.Point(baseW / 2, baseH / 2)

    baseWidth = baseW
    baseHeight = baseH
    currentZoom = zoom
  }

  /** Paper.js 초기화 — 1.0x baseline 크기 + 현재 시각 줌으로 캔버스 설정 */
  function init(canvas: HTMLCanvasElement, baseW: number, baseH: number, zoom: number = 1, dpr?: number): paper.PaperScope {
    const paperScope = new paper.PaperScope()
    paperScope.setup(canvas)

    scope = paperScope
    project = paperScope.project
    view = paperScope.view
    canvasElement = canvas

    applyDimensions(baseW, baseH, zoom, dpr)

    // 임베드 환경의 터치 이벤트 안정화: setPointerCapture로 pointerup 보장
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.isPrimary) {
        try { canvas.setPointerCapture(e.pointerId) } catch {}
      }
    })

    if (isReadOnly && project) {
      project.activeLayer.locked = true
    }

    return paperScope
  }

  /** Paper.js 리소스 해제 */
  function dispose() {
    if (project) {
      project.clear()
      project.remove()
    }
    scope = null
    project = null
    view = null
    canvasElement = null
    baseWidth = 0
    baseHeight = 0
    currentZoom = 1
  }

  /** 줌만 변경 (baseDim 유지) — 데이터는 그대로, 시각만 확대/축소. 즉시 재렌더링 트리거 */
  function setZoom(zoom: number) {
    if (!view || !canvasElement) return
    applyDimensions(baseWidth, baseHeight, zoom)
    view.update()
  }

  /** 현재 줌 레벨 반환 */
  function getZoom(): number {
    return currentZoom
  }

  /** 1.0x baseline 크기 변경 (PDF 페이지 자체 크기가 바뀌지 않으면 호출 불필요) */
  function setBaseDimensions(baseW: number, baseH: number) {
    if (!view || !canvasElement) return
    applyDimensions(baseW, baseH, currentZoom)
    view.update()
  }

  /** 활성 레이어 반환 */
  function getActiveLayer(): paper.Layer | null {
    return project?.activeLayer ?? null
  }

  /** 활성 레이어의 모든 아이템 제거 */
  function clear() {
    project?.activeLayer.removeChildren()
  }

  /** 뷰 강제 렌더링 */
  function render() {
    view?.update()
  }

  /** 캔버스를 JSON으로 내보내기 (1.0x project 좌표계 기준) */
  function exportJSON(): string {
    if (!project) return '[]'
    return project.activeLayer.exportJSON()
  }

  /** JSON 데이터를 캔버스에 가져오기 (1.0x project 좌표계 가정) */
  function importJSON(json: string) {
    if (!project) return
    project.activeLayer.removeChildren()
    project.activeLayer.importJSON(json)
  }

  /** 선택 UI 제외한 사용자 드로잉 아이템 목록 반환 */
  function getDrawnItems(): paper.Item[] {
    if (!project) return []
    return project.activeLayer.children.filter(
      item => !item.data?.isSelectionUI
    )
  }

  /** 이 스코프를 활성화 (멀티 캔버스 환경) */
  function activate() {
    scope?.activate()
  }

  return {
    // Getters
    get scope() { return scope },
    get project() { return project },
    get view() { return view },
    get canvas() { return canvasElement },
    get isReady() { return isReady },
    get isReadOnly() { return isReadOnly },
    get baseWidth() { return baseWidth },
    get baseHeight() { return baseHeight },
    get zoom() { return currentZoom },

    // Methods
    init,
    dispose,
    setZoom,
    getZoom,
    setBaseDimensions,
    getActiveLayer,
    clear,
    render,
    exportJSON,
    importJSON,
    getDrawnItems,
    activate
  }
}

export type PaperCanvas = ReturnType<typeof createPaperCanvas>
