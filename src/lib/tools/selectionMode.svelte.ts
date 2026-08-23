/**
 * Selection Mode Module
 * 임베드 환경 안정화: Paper.js Tool 대신 직접 PointerEvent 처리
 * 단일 선택 + 드래그 이동 + 종횡비 유지 리사이즈
 */
import paper from 'paper'
import { createSelectionBox, type SelectionBox } from '../canvas/selectionBox.svelte'
import { getInputConfig } from '../utils/inputDetection'

export interface SelectionModeOptions {
  getScope: () => paper.PaperScope | null
  getScrollContainer?: () => HTMLElement | null
  onSelectionChange?: (hasSelection: boolean) => void
  onItemModified?: () => void
  onItemDeleted?: () => void
}

export function createSelectionMode(options: SelectionModeOptions) {
  const {
    getScope,
    getScrollContainer,
    onSelectionChange,
    onItemModified,
    onItemDeleted
  } = options

  let isActive = $state(false)
  let selectedItem = $state<paper.Item | null>(null)
  let selectionBox: SelectionBox | null = null

  // Drag state
  let isDragging = false
  let dragStart: paper.Point | null = null
  let itemStartPosition: paper.Point | null = null

  // Resize state
  let isResizing = false
  let resizeHandleName: string | null = null
  let resizeStartBounds: paper.Rectangle | null = null
  let resizeStartPoint: paper.Point | null = null

  // Pointer event state
  let canvasElement: HTMLCanvasElement | null = null
  let activePointerId: number | null = null

  // Event handler references
  let handlePointerDown: ((e: PointerEvent) => void) | null = null
  let handlePointerMove: ((e: PointerEvent) => void) | null = null
  let handlePointerUp: ((e: PointerEvent) => void) | null = null
  let handleKeyDown: ((e: KeyboardEvent) => void) | null = null
  let handleTouchStart: ((e: TouchEvent) => void) | null = null

  const hasSelection = $derived(selectedItem !== null)

  /**
   * PointerEvent 좌표 -> Paper.js project 좌표 변환
   */
  function getProjectPoint(e: PointerEvent): paper.Point {
    const scope = getScope()
    if (!scope?.view || !canvasElement) return new paper.Point(0, 0)

    const rect = canvasElement.getBoundingClientRect()
    const viewPoint = new paper.Point(
      e.clientX - rect.left,
      e.clientY - rect.top
    )
    return scope.view.viewToProject(viewPoint)
  }

  /** scroll container의 touch-action을 none으로 변경 (드래그/리사이즈 중 스크롤 방지) */
  function lockScrollContainer() {
    const scrollContainer = getScrollContainer?.()
    if (scrollContainer) {
      scrollContainer.style.touchAction = 'none'
    }
  }

  /** scroll container의 touch-action을 복원 (선택 모드 기본: pan-y pan-x) */
  function unlockScrollContainer() {
    const scrollContainer = getScrollContainer?.()
    if (scrollContainer) {
      scrollContainer.style.touchAction = 'pan-y pan-x'
    }
  }

  /**
   * Activate selection mode
   */
  function activate() {
    const scope = getScope()
    if (!scope) {
      console.warn('[SelectionMode] No Paper.js scope available')
      return
    }

    scope.activate()
    isActive = true
    selectionBox = createSelectionBox({ getScope })

    canvasElement = scope.view?.element as HTMLCanvasElement | null
    if (!canvasElement) return

    handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      const scope = getScope()
      if (!scope) return

      try { canvasElement!.setPointerCapture(e.pointerId) } catch {}
      activePointerId = e.pointerId

      const point = getProjectPoint(e)

      // 1. 핸들 hit test (리사이즈 우선)
      if (selectedItem && selectionBox) {
        const handleName = selectionBox.hitTestHandle(point)
        if (handleName) {
          isResizing = true
          resizeHandleName = handleName
          resizeStartBounds = selectedItem.bounds.clone()
          resizeStartPoint = point
          lockScrollContainer()
          return
        }
      }

      // 2. 아이템 hit test
      const inputConfig = getInputConfig()
      const hitResult = scope.project.hitTest(point, {
        fill: true,
        stroke: true,
        segments: true,
        tolerance: inputConfig.hitTestTolerance
      })

      // Selection UI 클릭은 무시
      if (hitResult?.item?.data?.isSelectionUI) return

      if (hitResult?.item) {
        const item = findTopLevelItem(hitResult.item)
        // 단일 선택
        if (selectedItem !== item) {
          selectItem(item)
        }

        // 드래그 시작
        isDragging = true
        dragStart = point
        itemStartPosition = item.position.clone()
        lockScrollContainer()
      } else {
        // 빈 공간 클릭: 선택 해제
        clearSelection()
      }
    }

    handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return

      const point = getProjectPoint(e)

      // 리사이즈 처리
      if (isResizing && selectedItem && resizeStartBounds && resizeStartPoint && resizeHandleName) {
        performResize(selectedItem, point)
        return
      }

      // 드래그 처리
      if (!isDragging || !dragStart || !selectedItem) return

      const delta = point.subtract(dragStart)
      if (itemStartPosition) {
        selectedItem.position = itemStartPosition.add(delta)
      }

      selectionBox?.update([selectedItem])
    }

    handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return

      if ((isDragging || isResizing) && selectedItem) {
        onItemModified?.()
      }

      isDragging = false
      dragStart = null
      itemStartPosition = null
      isResizing = false
      resizeHandleName = null
      resizeStartBounds = null
      resizeStartPoint = null
      activePointerId = null

      unlockScrollContainer()

      try { canvasElement!.releasePointerCapture(e.pointerId) } catch {}
    }

    handleKeyDown = (e: KeyboardEvent) => {
      // 텍스트 입력 중(input/textarea/contentEditable)에는 Delete/Backspace를 가로채지 않음.
      // TextInputOverlay textarea에서 한글 지우려고 Backspace 누를 때 객체가 삭제되는 버그 방지
      const target = e.target as HTMLElement | null
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key === 'Escape') {
        clearSelection()
      }
    }

    // 터치 드래그 시 브라우저 스크롤 방지 -- 아이템/핸들 터치 시에만 preventDefault
    handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return

      const scope = getScope()
      if (!scope?.view || !canvasElement) return

      const touch = e.touches[0]
      const rect = canvasElement.getBoundingClientRect()
      const viewPoint = new paper.Point(
        touch.clientX - rect.left,
        touch.clientY - rect.top
      )
      const point = scope.view.viewToProject(viewPoint)

      // 핸들 터치 시 스크롤 방지
      if (selectedItem && selectionBox) {
        const handleName = selectionBox.hitTestHandle(point)
        if (handleName) {
          e.preventDefault()
          return
        }
      }

      const inputConfig = getInputConfig()
      const hitResult = scope.project.hitTest(point, {
        fill: true,
        stroke: true,
        segments: true,
        tolerance: inputConfig.hitTestTolerance
      })

      if (hitResult?.item && !hitResult.item.data?.isSelectionUI) {
        // 아이템 터치 -> 브라우저 스크롤 방지, 드래그 허용
        e.preventDefault()
      }
    }

    canvasElement.addEventListener('touchstart', handleTouchStart, { passive: false })
    canvasElement.addEventListener('pointerdown', handlePointerDown)
    canvasElement.addEventListener('pointermove', handlePointerMove)
    canvasElement.addEventListener('pointerup', handlePointerUp)
    canvasElement.addEventListener('pointercancel', handlePointerUp)
    document.addEventListener('keydown', handleKeyDown)
  }

  /**
   * 리사이즈 수행 (종횡비 유지)
   * 드래그 거리에 따른 균일 스케일 적용
   */
  function performResize(item: paper.Item, currentPoint: paper.Point): void {
    if (!resizeStartBounds || !resizeStartPoint || !resizeHandleName) return

    const startBounds = resizeStartBounds
    const startPoint = resizeStartPoint

    // 핸들 방향에 따른 기준점(anchor) 결정 — 대각선 반대편
    let anchor: paper.Point
    switch (resizeHandleName) {
      case 'topLeft': anchor = startBounds.bottomRight; break
      case 'topCenter': anchor = startBounds.bottomCenter; break
      case 'topRight': anchor = startBounds.bottomLeft; break
      case 'leftCenter': anchor = startBounds.rightCenter; break
      case 'rightCenter': anchor = startBounds.leftCenter; break
      case 'bottomLeft': anchor = startBounds.topRight; break
      case 'bottomCenter': anchor = startBounds.topCenter; break
      case 'bottomRight': anchor = startBounds.topLeft; break
      default: return
    }

    // 시작 시점과 현재 시점의 anchor로부터 거리 비율로 스케일 팩터 계산
    const startDist = startPoint.getDistance(anchor)
    const currentDist = currentPoint.getDistance(anchor)
    if (startDist < 1) return

    let scaleFactor = currentDist / startDist

    // 최소/최대 스케일 제한
    const minSize = 10
    const maxScale = 10
    if (startBounds.width * scaleFactor < minSize || startBounds.height * scaleFactor < minSize) {
      scaleFactor = minSize / Math.min(startBounds.width, startBounds.height)
    }
    if (scaleFactor > maxScale) scaleFactor = maxScale

    // 원본 bounds 기준으로 다시 계산 (누적 오차 방지)
    // item을 원래 크기로 되돌린 후 새 스케일 적용
    const currentBounds = item.bounds
    const revertFactor = startBounds.width / currentBounds.width
    if (Math.abs(revertFactor - 1) > 0.001) {
      item.scale(revertFactor, anchor)
      if (item.strokeWidth) item.strokeWidth *= revertFactor
      if ((item as any).fontSize) (item as any).fontSize *= revertFactor
    }

    // 새 스케일 적용
    item.scale(scaleFactor, anchor)
    if (item.strokeWidth) item.strokeWidth *= scaleFactor
    if ((item as any).fontSize) (item as any).fontSize *= scaleFactor

    selectionBox?.update([item])
  }

  /** 진행 중인 드래그/리사이즈 취소 (멀티터치 제스처 감지 시 호출) */
  function cancelOperation() {
    if (canvasElement && activePointerId !== null) {
      try { canvasElement.releasePointerCapture(activePointerId) } catch {}
    }

    // 드래그 중이었으면 원래 위치로 복원
    if (isDragging && selectedItem && itemStartPosition) {
      selectedItem.position = itemStartPosition
      selectionBox?.update([selectedItem])
    }

    isDragging = false
    dragStart = null
    itemStartPosition = null
    isResizing = false
    resizeHandleName = null
    resizeStartBounds = null
    resizeStartPoint = null
    activePointerId = null

    unlockScrollContainer()
  }

  /** 최상위 아이템 탐색 (그룹 내부 아이템이면 그룹 반환) */
  function findTopLevelItem(item: paper.Item): paper.Item {
    while (item.parent && !(item.parent instanceof paper.Layer)) {
      if (item.parent.data?.isSelectionUI) {
        return item
      }
      item = item.parent
    }
    return item
  }

  /** 단일 아이템 선택 */
  function selectItem(item: paper.Item) {
    if (item.data?.isSelectionUI) return
    selectedItem = item
    selectionBox?.draw([item])
    onSelectionChange?.(true)
  }

  /** 선택 해제 */
  function clearSelection() {
    selectedItem = null
    selectionBox?.remove()
    onSelectionChange?.(false)
  }

  /** 선택된 아이템 삭제 */
  function deleteSelected() {
    if (!selectedItem) return
    selectedItem.remove()
    clearSelection()
    onItemDeleted?.()
  }

  /** 선택된 아이템 이동 */
  function moveSelected(deltaX: number, deltaY: number) {
    if (!selectedItem) return
    const delta = new paper.Point(deltaX, deltaY)
    selectedItem.position = selectedItem.position.add(delta)
    selectionBox?.update([selectedItem])
    onItemModified?.()
  }

  /**
   * Deactivate selection mode
   */
  function deactivate() {
    clearSelection()

    if (canvasElement) {
      if (handleTouchStart) canvasElement.removeEventListener('touchstart', handleTouchStart)
      if (handlePointerDown) canvasElement.removeEventListener('pointerdown', handlePointerDown)
      if (handlePointerMove) canvasElement.removeEventListener('pointermove', handlePointerMove)
      if (handlePointerUp) {
        canvasElement.removeEventListener('pointerup', handlePointerUp)
        canvasElement.removeEventListener('pointercancel', handlePointerUp)
      }
    }
    if (handleKeyDown) document.removeEventListener('keydown', handleKeyDown)

    canvasElement = null
    handleTouchStart = null
    handlePointerDown = null
    handlePointerMove = null
    handlePointerUp = null
    handleKeyDown = null
    activePointerId = null
    selectionBox = null
    isActive = false
    isDragging = false
    dragStart = null
    itemStartPosition = null
    isResizing = false
    resizeHandleName = null
    resizeStartBounds = null
    resizeStartPoint = null

    unlockScrollContainer()
  }

  /** 선택 모드 토글 */
  function toggle() {
    if (isActive) {
      deactivate()
    } else {
      activate()
    }
  }

  return {
    get isActive() { return isActive },
    get selectedItem() { return selectedItem },
    get hasSelection() { return hasSelection },
    activate,
    deactivate,
    toggle,
    cancelOperation,
    selectItem,
    clearSelection,
    deleteSelected,
    moveSelected
  }
}

export type SelectionMode = ReturnType<typeof createSelectionMode>
