import type paper from 'paper'

export type PaperAnnotationKind = 'text' | 'drawing' | 'group' | 'image' | 'annotation'

export interface PaperCanvasAccessibilityState {
  readonly pageNumber: number
  readonly annotationCount: number
  /** 1-base 순번. 선택이 없거나 더 이상 편집 대상이 아니면 null */
  readonly selectedIndex: number | null
  readonly selectedKind: PaperAnnotationKind | null
  readonly selectedText: string | null
  readonly selectedX: number | null
  readonly selectedY: number | null
}

function isExcludedBySelfOrAncestor(item: paper.Item): boolean {
  let current: paper.Item | null = item
  while (current) {
    const data = current.data as Record<string, unknown> | undefined
    if (
      data?.isSelectionUI === true ||
      data?.isPreview === true ||
      data?.isTextCursor === true ||
      current.visible === false ||
      current.locked === true ||
      current.opacity <= 0
    ) return true
    current = current.parent
  }
  return false
}

/**
 * 편집 상태로 직렬화되는 active layer의 최상위 실제 객체만 반환한다.
 * selection box/handle, text cursor, preview, 숨김·잠금 객체는 키보드 순환에서 제외한다.
 */
export function getKeyboardEditablePaperItems(scope: paper.PaperScope): paper.Item[] {
  return scope.project.activeLayer.children.filter(item => !isExcludedBySelfOrAncestor(item))
}

export function getPaperAnnotationKind(item: paper.Item): PaperAnnotationKind {
  const className = (item as paper.Item & { className?: string }).className
  if (className === 'PointText') return 'text'
  if (className === 'Raster' || className === 'PlacedSymbol') return 'image'
  if (className === 'Group' || className === 'Layer') return 'group'
  if (className === 'Path' || className === 'CompoundPath' || item.data?.isHighlighter) {
    return 'drawing'
  }
  return 'annotation'
}

function accessibleText(item: paper.Item): string | null {
  if (getPaperAnnotationKind(item) !== 'text') return null
  const content = (item as paper.Item & { content?: unknown }).content
  if (typeof content !== 'string') return null
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > 60 ? `${normalized.slice(0, 57)}…` : normalized
}

export function getPaperCanvasAccessibilityState(
  scope: paper.PaperScope | null,
  selectedItem: paper.Item | null,
  pageNumber: number
): PaperCanvasAccessibilityState {
  if (!scope) {
    return {
      pageNumber,
      annotationCount: 0,
      selectedIndex: null,
      selectedKind: null,
      selectedText: null,
      selectedX: null,
      selectedY: null
    }
  }

  const items = getKeyboardEditablePaperItems(scope)
  const selectedIndex = selectedItem ? items.indexOf(selectedItem) : -1
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null
  return {
    pageNumber,
    annotationCount: items.length,
    selectedIndex: selected ? selectedIndex + 1 : null,
    selectedKind: selected ? getPaperAnnotationKind(selected) : null,
    selectedText: selected ? accessibleText(selected) : null,
    selectedX: selected ? Math.round(selected.position.x) : null,
    selectedY: selected ? Math.round(selected.position.y) : null
  }
}
