/**
 * User Overlay Module
 * Svelte 5 runes pattern for displaying other users' canvas data
 *
 * 각 UserOverlay 인스턴스는 하나의 페이지에 대응하며,
 * 로컬 canvasElements Map으로 자체 DOM 요소를 독립 관리함.
 * document.getElementById 사용 금지 — cross-page ID 충돌 방지.
 */
import paper from 'paper'
import type { UserCanvasInfo, PaperExportData } from '../../types'
import { createPaperCanvas, type PaperCanvas } from './paperCanvas.svelte'

export interface UserOverlayOptions {
  containerElement?: HTMLElement
  onOverlayChange?: () => void
}

export function createUserOverlay(options: UserOverlayOptions = {}) {
  const { onOverlayChange } = options

  let users = $state<UserCanvasInfo[]>([])
  let canvasInstances = $state<Map<string, PaperCanvas>>(new Map())
  let containerElement = $state<HTMLElement | null>(null)
  let displayZoom = 1.0  // 현재 시각 줌 — 각 PaperCanvas의 view.zoom으로 전파

  // 로컬 캔버스 요소 추적 — document.getElementById 대신 사용 (cross-page 충돌 방지)
  let canvasElements = new Map<string, HTMLCanvasElement>()

  // 저장된 1.0x 베이스라인 치수 — 컨테이너 레이아웃 전 초기화 시 안정적 크기 보장
  let baseWidth = 0
  let baseHeight = 0

  const visibleUsers = $derived(users.filter(u => u.enabled))
  const userCount = $derived(users.length)

  /**
   * Set container element for overlay canvases
   */
  function setContainer(element: HTMLElement) {
    containerElement = element
  }

  /**
   * 시각 줌 설정 — 각 PaperCanvas의 view.zoom으로 전파.
   * 1.0x baseline 데이터는 그대로 두고 view.zoom만 변경하므로 좌표 변환 불필요.
   */
  function setDisplayScale(zoom: number) {
    displayZoom = zoom
    canvasInstances.forEach((instance) => {
      instance.setZoom(zoom)
    })
  }

  /**
   * Add or update user overlay
   */
  function setUserData(userInfo: UserCanvasInfo) {
    // 기존 사용자 찾기
    const existingIndex = users.findIndex(u => u.canvasId === userInfo.canvasId)

    if (existingIndex >= 0) {
      // 업데이트
      const newUsers = [...users]
      newUsers[existingIndex] = userInfo
      users = newUsers
    } else {
      // 추가
      users = [...users, userInfo]
    }

    // 캔버스 렌더링
    if (userInfo.enabled) {
      renderUserCanvas(userInfo)
    } else {
      hideUserCanvas(userInfo.canvasId)
    }

    onOverlayChange?.()
  }

  /**
   * Remove user overlay
   */
  function removeUser(canvasId: string) {
    users = users.filter(u => u.canvasId !== canvasId)

    // Paper.js 인스턴스 정리
    const instance = canvasInstances.get(canvasId)
    if (instance) {
      instance.dispose()
      canvasInstances.delete(canvasId)
    }

    // DOM 요소 제거 (로컬 Map에서 조회)
    const canvas = canvasElements.get(canvasId)
    if (canvas) {
      canvas.remove()
      canvasElements.delete(canvasId)
    }

    onOverlayChange?.()
  }

  /**
   * Toggle user visibility
   */
  function toggleUserVisibility(canvasId: string) {
    const user = users.find(u => u.canvasId === canvasId)
    if (!user) return

    const newUsers = users.map(u => {
      if (u.canvasId === canvasId) {
        return { ...u, enabled: !u.enabled }
      }
      return u
    })
    users = newUsers

    const updatedUser = newUsers.find(u => u.canvasId === canvasId)!
    if (updatedUser.enabled) {
      renderUserCanvas(updatedUser)
    } else {
      hideUserCanvas(canvasId)
    }

    onOverlayChange?.()
  }

  /**
   * Render user canvas overlay
   * 로컬 canvasElements Map으로 캔버스 추적 — document.getElementById 미사용
   */
  function renderUserCanvas(userInfo: UserCanvasInfo) {
    if (!containerElement) {
      console.warn('[UserOverlay] No container element set')
      return
    }

    // 로컬 Map에서 캔버스 조회 (cross-page 충돌 방지)
    let canvas = canvasElements.get(userInfo.canvasId)

    // Canvas 요소 생성
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      canvas.style.top = '0'
      canvas.style.left = '0'
      canvas.style.pointerEvents = 'none'
      canvas.style.zIndex = '20'
      containerElement.appendChild(canvas)
      canvasElements.set(userInfo.canvasId, canvas)
    }

    // Paper.js 인스턴스 생성 또는 가져오기
    let instance = canvasInstances.get(userInfo.canvasId)
    if (!instance) {
      instance = createPaperCanvas({ isReadOnly: true })
      // 저장된 1.0x 베이스라인 치수 우선, fallback으로 컨테이너 크기 ÷ 현재 줌
      const baseW = baseWidth || (containerElement.clientWidth || containerElement.offsetWidth) / displayZoom
      const baseH = baseHeight || (containerElement.clientHeight || containerElement.offsetHeight) / displayZoom
      instance.init(canvas, baseW, baseH, displayZoom)
      canvasInstances.set(userInfo.canvasId, instance)
    }

    // 캔버스 데이터 파싱 및 렌더링 — 1.0x 좌표를 그대로 import,
    // 시각 스케일은 view.zoom이 담당하므로 수동 변환 없음
    try {
      const data = parseCanvasData(userInfo.canvasData)
      instance.clear()

      if (data.children && data.children.length > 0) {
        const layer = instance.scope?.project?.activeLayer
        if (layer) {
          // Paper.js importJSON은 단일 아이템만 허용하므로 children을 개별 import
          data.children.forEach(child => {
            layer.importJSON(JSON.stringify(child))
          })
        }

        // 사용자 색상으로 오버라이드 (선택적)
        if (userInfo.color) {
          applyUserColor(instance, userInfo.color)
        }
      }

      instance.render()
      canvas.style.display = 'block'
    } catch (e) {
      console.error(`[UserOverlay] Failed to render overlay for ${userInfo.userName}:`, e)
    }
  }

  /**
   * Hide user canvas (로컬 Map에서 조회)
   */
  function hideUserCanvas(canvasId: string) {
    const canvas = canvasElements.get(canvasId)
    if (canvas) {
      canvas.style.display = 'none'
    }
  }

  /**
   * Canvas 데이터 파싱 (Paper.js 형식)
   */
  function parseCanvasData(jsonStr: string): PaperExportData {
    try {
      const data = JSON.parse(jsonStr)

      // Paper.js 형식
      if (data.children && Array.isArray(data.children)) {
        return data
      }

      // 직접 배열
      if (Array.isArray(data)) {
        return { version: 'paper', children: data }
      }

      return { version: 'paper', children: [] }
    } catch {
      return { version: 'paper', children: [] }
    }
  }

  /**
   * Apply user color to all items
   */
  function applyUserColor(instance: PaperCanvas, color: string) {
    const scope = instance.scope
    if (!scope) return

    scope.project.activeLayer.children.forEach(item => {
      if (item.strokeColor) {
        item.strokeColor = new paper.Color(color)
      }
    })
  }

  /**
   * 모든 오버레이의 1.0x 베이스라인 치수 갱신.
   * width/height는 1.0x project 좌표(viewport scale=1.0 기준) — PDF 페이지 본래 크기.
   * 캔버스 픽셀/CSS 크기는 PaperCanvas.applyDimensions가 view.zoom과 함께 일관 적용.
   */
  function updateCanvasSize(width: number, height: number) {
    baseWidth = width
    baseHeight = height

    canvasInstances.forEach((instance) => {
      // setBaseDimensions가 내부적으로 applyDimensions(width, height, currentZoom)을 호출하여
      // canvas pixel/CSS 크기·view.viewSize·view.zoom을 일관되게 갱신
      instance.setBaseDimensions(width, height)
    })
  }

  /**
   * Clear all overlays (로컬 Map 기반 정리)
   */
  function clearAll() {
    canvasInstances.forEach((instance) => {
      instance.dispose()
    })

    canvasElements.forEach((canvas) => {
      canvas.remove()
    })

    canvasInstances.clear()
    canvasElements.clear()
    users = []
    onOverlayChange?.()
  }

  /**
   * Dispose all resources
   */
  function dispose() {
    clearAll()
    containerElement = null
    baseWidth = 0
    baseHeight = 0
  }

  return {
    // State getters
    get users() { return users },
    get visibleUsers() { return visibleUsers },
    get userCount() { return userCount },

    // Methods
    setContainer,
    setDisplayScale,
    setUserData,
    removeUser,
    toggleUserVisibility,
    updateCanvasSize,
    clearAll,
    dispose
  }
}

// Type for the return value
export type UserOverlay = ReturnType<typeof createUserOverlay>
