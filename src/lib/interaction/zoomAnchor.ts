/**
 * 줌 앵커 — 스케일 변경 전후로 화면상 같은 지점이 유지되도록 스크롤 보정
 *
 * 비례식(scroll × ratio) 대신 페이지 요소 기준으로 계산하는 이유:
 * 페이지 사이 gap·컨테이너 padding은 스케일과 무관하게 고정이라
 * 비례식은 뒤 페이지로 갈수록 누적 오차 발생 (50페이지 기준 수백 px)
 */

export interface ZoomAnchor {
  pageEl: HTMLElement   // 앵커 지점을 덮는(또는 가장 가까운) 페이지 요소
  offsetX: number       // 페이지 좌상단 기준 앵커 오프셋 (구 스케일 CSS px)
  offsetY: number
  clientX: number       // 유지할 화면상 앵커 위치 (뷰포트 기준)
  clientY: number
}

/**
 * 줌 전 앵커 캡처 — 앵커 지점(미지정 시 컨테이너 중앙)에 걸친 페이지와 페이지 내부 오프셋 기록
 * 페이지 요소가 아직 없으면 null 반환 (호출측에서 보정 생략)
 */
export function captureZoomAnchor(
  container: HTMLElement,
  clientX?: number,
  clientY?: number
): ZoomAnchor | null {
  const rect = container.getBoundingClientRect()
  const ax = clientX ?? rect.left + rect.width / 2
  const ay = clientY ?? rect.top + rect.height / 2

  const pages = container.querySelectorAll<HTMLElement>('[data-page]')
  if (pages.length === 0) return null

  // 앵커 y를 덮는 페이지 우선, 없으면 수직 거리가 가장 가까운 페이지 선택
  let bestPage: HTMLElement | null = null
  let bestDist = Infinity
  for (const page of pages) {
    const r = page.getBoundingClientRect()
    const dist = ay < r.top ? r.top - ay : ay > r.bottom ? ay - r.bottom : 0
    if (dist < bestDist) {
      bestDist = dist
      bestPage = page
      if (dist === 0) break
    }
  }
  if (!bestPage) return null

  const r = bestPage.getBoundingClientRect()
  return {
    pageEl: bestPage,
    offsetX: ax - r.left,
    offsetY: ay - r.top,
    clientX: ax,
    clientY: ay
  }
}

/**
 * 줌 후 스크롤 보정 — 페이지-로컬 앵커 지점(ratio 배)이 캡처 시점의 화면 위치로 돌아오도록 이동
 * 레이아웃 갱신(새 스케일 반영) 이후에 호출해야 함. scrollLeft/Top 할당은 브라우저가 자동 clamp
 */
export function applyZoomAnchor(container: HTMLElement, anchor: ZoomAnchor, ratio: number): void {
  if (!anchor.pageEl.isConnected) return
  const r = anchor.pageEl.getBoundingClientRect()
  container.scrollLeft += r.left + anchor.offsetX * ratio - anchor.clientX
  container.scrollTop += r.top + anchor.offsetY * ratio - anchor.clientY
}
