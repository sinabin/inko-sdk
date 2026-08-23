/** PDF 페이지 네비게이션 모듈 */

export interface PageNavigationOptions {
  initialPage?: number // 초기 페이지 번호
  onPageChange?: (page: number) => void // 페이지 변경 콜백
}

export function createPageNavigation(options: PageNavigationOptions = {}) {
  let currentPage = $state(options.initialPage ?? 1)
  let totalPages = $state(0)

  const hasNextPage = $derived(currentPage < totalPages)
  const hasPrevPage = $derived(currentPage > 1)
  const isFirstPage = $derived(currentPage === 1)
  const isLastPage = $derived(currentPage === totalPages)

  /** 총 페이지 수 설정 (PDF 로드 후 호출) */
  function setTotalPages(total: number) {
    totalPages = total
    // 현재 페이지가 범위 초과 시 조정
    if (currentPage > total) {
      currentPage = Math.max(1, total)
    }
  }

  /** 특정 페이지로 이동 */
  function goToPage(pageNum: number): boolean {
    if (pageNum < 1 || pageNum > totalPages) {
      return false
    }
    if (pageNum === currentPage) {
      return true
    }

    currentPage = pageNum
    options.onPageChange?.(pageNum)
    return true
  }

  /** 다음 페이지로 이동 */
  function nextPage(): boolean {
    if (!hasNextPage) return false
    return goToPage(currentPage + 1)
  }

  /** 이전 페이지로 이동 */
  function prevPage(): boolean {
    if (!hasPrevPage) return false
    return goToPage(currentPage - 1)
  }

  /** 첫 페이지로 이동 */
  function firstPage(): boolean {
    return goToPage(1)
  }

  /** 마지막 페이지로 이동 */
  function lastPage(): boolean {
    return goToPage(totalPages)
  }

  /** 네비게이션 초기화 */
  function reset() {
    currentPage = 1
    totalPages = 0
  }

  /** 현재 페이지 직접 설정 (onPageChange 콜백 미트리거, 스크롤 뷰어 알림용) */
  function setCurrentPage(pageNum: number) {
    if (pageNum >= 1 && pageNum <= totalPages) {
      currentPage = pageNum
    }
  }

  return {
    get currentPage() { return currentPage },
    get totalPages() { return totalPages },
    get hasNextPage() { return hasNextPage },
    get hasPrevPage() { return hasPrevPage },
    get isFirstPage() { return isFirstPage },
    get isLastPage() { return isLastPage },

    setTotalPages,
    setCurrentPage,
    goToPage,
    nextPage,
    prevPage,
    firstPage,
    lastPage,
    reset
  }
}

export type PageNavigation = ReturnType<typeof createPageNavigation>
