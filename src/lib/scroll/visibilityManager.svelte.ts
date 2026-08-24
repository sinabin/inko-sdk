/** IntersectionObserver 기반 페이지 가시성 관리 */

export interface VisibleRange {
  start: number
  end: number
}

export interface VisibilityManagerOptions {
  scrollContainer: HTMLElement
  totalPages: number
  bufferPages?: number
  onVisibilityChange: (visibleRange: VisibleRange) => void
}

export interface VisibilityManager {
  observe: (pageNum: number, element: HTMLElement) => void
  unobserve: (pageNum: number) => void
  updateTotalPages: (total: number) => void
  getVisibleRange: () => VisibleRange
  getBufferedRange: () => VisibleRange
  isInViewport: (pageNum: number) => boolean
  isNearViewport: (pageNum: number) => boolean
  getCenterPage: () => number
  dispose: () => void

  readonly visiblePages: Set<number>
  readonly centerPage: number
}

/** 동적 rootMargin — 뷰포트 높이의 50%를 상하 버퍼로 확장 (프리렌더링 여유 영역) */
function calculateDynamicRootMargin(container: HTMLElement): string {
  const viewportHeight = container.clientHeight
  const bufferPixels = Math.round(viewportHeight * 0.5)
  return `${bufferPixels}px 0px ${bufferPixels}px 0px`
}

export function createVisibilityManager(options: VisibilityManagerOptions): VisibilityManager {
  const { scrollContainer, bufferPages = 2, onVisibilityChange } = options

  let totalPages = $state(options.totalPages)
  let visiblePages = $state<Set<number>>(new Set())
  let centerPage = $state(1)

  let intersectionObserver: IntersectionObserver | null = null
  const observedElements = new Map<number, HTMLElement>()

  /** IntersectionObserver 생성 — threshold [0.01, 0.5], rootMargin 뷰포트 50% 버퍼 */
  function createObserver(): IntersectionObserver {
    const rootMargin = calculateDynamicRootMargin(scrollContainer)

    return new IntersectionObserver(
      (entries) => {
        let changed = false
        const previousCenterPage = centerPage

        entries.forEach(entry => {
          const pageNum = parseInt(entry.target.getAttribute('data-page') || '0')
          if (pageNum === 0) return

          if (entry.isIntersecting) {
            if (!visiblePages.has(pageNum)) {
              // Svelte $state(Set) 반응성: 새 Set 생성으로 변경 감지 트리거
              visiblePages = new Set([...visiblePages, pageNum])
              changed = true
            }
          } else {
            if (visiblePages.has(pageNum)) {
              const newSet = new Set(visiblePages)
              newSet.delete(pageNum)
              visiblePages = newSet // 새 Set 할당으로 반응성 트리거
              changed = true
            }
          }
        })

        // threshold 교차는 가시 Set을 바꾸지 않아도 페이지 중심을 바꿀 수 있다.
        // smooth scroll 중 같은 두 페이지가 계속 교차한 채 이동하는 경우도 재계산한다.
        updateCenterPage()
        if (changed || centerPage !== previousCenterPage) {
          onVisibilityChange(getVisibleRange())
        }
      },
      {
        root: scrollContainer,
        rootMargin,
        threshold: [0.01, 0.5]
      }
    )
  }

  /** 중심 페이지 계산 — 실제 뷰포트 중심에 가장 가까운 페이지 반환 */
  function updateCenterPage(): void {
    if (visiblePages.size === 0) {
      centerPage = 1
      return
    }

    const sortedPages = [...visiblePages].sort((a, b) => a - b)
    const containerRect = scrollContainer.getBoundingClientRect()
    const viewportCenter = containerRect.top + containerRect.height / 2
    let closestPage = sortedPages[0]!
    let closestDistance = Number.POSITIVE_INFINITY

    for (const pageNum of sortedPages) {
      const element = observedElements.get(pageNum)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter)
      if (distance < closestDistance) {
        closestPage = pageNum
        closestDistance = distance
      }
    }

    centerPage = closestPage
  }

  /** 가시 범위 계산 — 가시 페이지만 포함 */
  function getVisibleRange(): VisibleRange {
    if (visiblePages.size === 0) {
      return { start: 1, end: 1 }
    }

    const sortedPages = [...visiblePages].sort((a, b) => a - b)
    return {
      start: sortedPages[0]!,
      end: sortedPages[sortedPages.length - 1]!
    }
  }

  /** 버퍼 범위 계산 — 가시 페이지 + 버퍼 페이지 포함 */
  function getBufferedRange(): VisibleRange {
    const visible = getVisibleRange()
    return {
      start: Math.max(1, visible.start - bufferPages),
      end: Math.min(totalPages, visible.end + bufferPages)
    }
  }

  /** 페이지가 뷰포트에 있는지 확인 */
  function isInViewport(pageNum: number): boolean {
    return visiblePages.has(pageNum)
  }

  /** 페이지가 뷰포트 근처에 있는지 확인 (버퍼 포함) */
  function isNearViewport(pageNum: number): boolean {
    const buffered = getBufferedRange()
    return pageNum >= buffered.start && pageNum <= buffered.end
  }

  /** 페이지 관찰 시작 — 기존 관찰 중인 요소는 자동 해제 */
  function observe(pageNum: number, element: HTMLElement): void {
    if (!intersectionObserver) {
      intersectionObserver = createObserver()
    }

    const existing = observedElements.get(pageNum)
    if (existing) {
      intersectionObserver.unobserve(existing)
    }

    element.setAttribute('data-page', String(pageNum))
    intersectionObserver.observe(element)
    observedElements.set(pageNum, element)
  }

  /** 페이지 관찰 중지 */
  function unobserve(pageNum: number): void {
    const element = observedElements.get(pageNum)
    if (element && intersectionObserver) {
      intersectionObserver.unobserve(element)
      observedElements.delete(pageNum)
    }
  }

  /** 총 페이지 수 갱신 */
  function updateTotalPages(total: number): void {
    totalPages = total
  }

  /** 리소스 정리 — Observer 해제 및 상태 초기화 */
  function dispose(): void {
    if (intersectionObserver) {
      intersectionObserver.disconnect()
      intersectionObserver = null
    }
    observedElements.clear()
    visiblePages = new Set()
  }

  return {
    observe,
    unobserve,
    updateTotalPages,
    getVisibleRange,
    getBufferedRange,
    isInViewport,
    isNearViewport,
    getCenterPage: () => centerPage,
    dispose,

    get visiblePages() { return visiblePages },
    get centerPage() { return centerPage }
  }
}
