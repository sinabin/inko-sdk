/**
 * Canvas State Module
 * Svelte 5 runes pattern for canvas state serialization/deserialization
 */
import paper from 'paper'
import type { PaperExportData } from '../../types'
import { reportError } from '../utils/errorReporter.svelte'

export interface CanvasStateOptions {
  getScope: () => paper.PaperScope | null
  onStateChange?: () => void
}

export function createCanvasState(options: CanvasStateOptions) {
  const { getScope, onStateChange } = options

  // 페이지별 캔버스 데이터 저장
  let canvasDataByPage = $state<Record<number, string>>({})
  let currentPageNum = $state(1)
  let isDirty = $state(false)

  const hasData = $derived(Object.keys(canvasDataByPage).length > 0)

  /**
   * Save current canvas state for a page
   */
  function savePageState(pageNum: number = currentPageNum) {
    const scope = getScope()
    if (!scope) return

    // Selection UI 제외하고 export
    const layer = scope.project.activeLayer
    const itemsToExport = layer.children.filter(
      item => !item.data?.isSelectionUI && !item.data?.isPreview
    )

    if (itemsToExport.length === 0) {
      // 빈 페이지면 데이터 삭제
      const newData = { ...canvasDataByPage }
      delete newData[pageNum]
      canvasDataByPage = newData
    } else {
      // 임시 레이어로 export
      const tempLayer = new paper.Layer()
      itemsToExport.forEach(item => {
        item.clone().copyTo(tempLayer)
      })

      const json = tempLayer.exportJSON()
      canvasDataByPage = { ...canvasDataByPage, [pageNum]: json }

      tempLayer.remove()
    }

    isDirty = true
    onStateChange?.()
  }

  /**
   * Load canvas state for a page
   */
  function loadPageState(pageNum: number) {
    const scope = getScope()
    if (!scope) return

    currentPageNum = pageNum

    // 현재 레이어 클리어
    scope.project.activeLayer.removeChildren()

    // 저장된 데이터가 있으면 로드
    const json = canvasDataByPage[pageNum]
    if (json) {
      try {
        scope.project.activeLayer.importJSON(json)
      } catch (e) {
        reportError('render', `페이지 ${pageNum} 캔버스 로드에 실패했습니다`, e)
      }
    }

    scope.view.update()
  }

  /**
   * Get all canvas data
   */
  function getAllData(): Record<number, string> {
    return { ...canvasDataByPage }
  }

  /**
   * Set all canvas data
   */
  function setAllData(data: Record<number, string>) {
    canvasDataByPage = data
    isDirty = false
  }

  /**
   * Export as JSON string
   */
  function exportToJSON(): string {
    const exportData: Record<number, PaperExportData> = {}

    for (const [pageStr, json] of Object.entries(canvasDataByPage)) {
      const pageNum = parseInt(pageStr)
      try {
        // Paper.js JSON 형식 파싱
        const parsed = JSON.parse(json)
        exportData[pageNum] = {
          version: 'paper',
          children: Array.isArray(parsed) ? parsed : [parsed]
        }
      } catch {
        exportData[pageNum] = {
          version: 'paper',
          children: []
        }
      }
    }

    return JSON.stringify(exportData)
  }

  /**
   * Import from JSON string
   */
  function importFromJSON(jsonStr: string) {
    try {
      const data = JSON.parse(jsonStr)

      // Paper.js 형식인지 확인
      if (typeof data === 'object') {
        const newCanvasData: Record<number, string> = {}

        for (const [pageStr, pageData] of Object.entries(data)) {
          const pageNum = parseInt(pageStr)
          if (isNaN(pageNum)) continue

          // PaperExportData 형식
          if ((pageData as any).children) {
            newCanvasData[pageNum] = JSON.stringify((pageData as any).children)
          }
          // 직접 JSON 문자열
          else if (typeof pageData === 'string') {
            newCanvasData[pageNum] = pageData
          }
        }

        canvasDataByPage = newCanvasData
        isDirty = false

        // 현재 페이지 다시 로드
        loadPageState(currentPageNum)
      }
    } catch (e) {
      reportError('parse', '캔버스 데이터를 불러올 수 없습니다', e)
    }
  }

  /**
   * Clear all data
   */
  function clearAll() {
    canvasDataByPage = {}
    isDirty = true

    const scope = getScope()
    if (scope) {
      scope.project.activeLayer.removeChildren()
      scope.view.update()
    }

    onStateChange?.()
  }

  /**
   * Clear current page
   */
  function clearCurrentPage() {
    const newData = { ...canvasDataByPage }
    delete newData[currentPageNum]
    canvasDataByPage = newData
    isDirty = true

    const scope = getScope()
    if (scope) {
      scope.project.activeLayer.removeChildren()
      scope.view.update()
    }

    onStateChange?.()
  }

  /**
   * Set canvas data for a single page
   */
  function setPageData(pageNum: number, json: string) {
    if (json) {
      canvasDataByPage = { ...canvasDataByPage, [pageNum]: json }
    } else {
      const newData = { ...canvasDataByPage }
      delete newData[pageNum]
      canvasDataByPage = newData
    }
    isDirty = true
  }

  /**
   * Check if a page has data
   */
  function hasPageData(pageNum: number): boolean {
    return pageNum in canvasDataByPage
  }

  /**
   * Get pages with data
   */
  function getPagesWithData(): number[] {
    return Object.keys(canvasDataByPage).map(Number).sort((a, b) => a - b)
  }

  /**
   * Mark as clean (after save)
   */
  function markClean() {
    isDirty = false
  }

  return {
    // State getters
    get canvasDataByPage() { return canvasDataByPage },
    get currentPageNum() { return currentPageNum },
    get isDirty() { return isDirty },
    get hasData() { return hasData },

    // Methods
    savePageState,
    loadPageState,
    getAllData,
    setAllData,
    setPageData,
    exportToJSON,
    importFromJSON,
    clearAll,
    clearCurrentPage,
    hasPageData,
    getPagesWithData,
    markClean
  }
}

// Type for the return value
export type CanvasState = ReturnType<typeof createCanvasState>
