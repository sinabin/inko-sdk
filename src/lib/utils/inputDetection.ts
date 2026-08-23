/** PointerEvent 기반 입력 장치(스타일러스/터치) 감지 및 장치별 설정 제공 */

export interface InputConfig {
  hitTestTolerance: number // 히트 테스트 허용 오차 (px)
  handleSize: number // 선택 핸들 크기 (px)
  selectionPadding: number // 선택 영역 패딩 (px)
  dashPattern: number[] // 선택 박스 대시 패턴
}

const FINGER_CONFIG: InputConfig = {
  hitTestTolerance: 20,
  handleSize: 16,
  selectionPadding: 8,
  dashPattern: [8, 6]
}

const STYLUS_CONFIG: InputConfig = {
  hitTestTolerance: 5,
  handleSize: 10,
  selectionPadding: 4,
  dashPattern: [4, 4]
}

// 마지막 감지된 포인터 타입
let lastPointerType: string = 'touch'
let lastPressure: number = 0

/** 전역 포인터 타입 추적 초기화, cleanup 함수 반환 */
export function initPointerTracking(): () => void {
  function handlePointerDown(e: PointerEvent) {
    lastPointerType = e.pointerType
    lastPressure = e.pressure
  }

  function handlePointerMove(e: PointerEvent) {
    lastPointerType = e.pointerType
    lastPressure = e.pressure
  }

  document.addEventListener('pointerdown', handlePointerDown, { passive: true })
  document.addEventListener('pointermove', handlePointerMove, { passive: true })

  return () => {
    document.removeEventListener('pointerdown', handlePointerDown)
    document.removeEventListener('pointermove', handlePointerMove)
  }
}

/** 현재 입력 장치에 맞는 설정 반환 */
export function getInputConfig(): InputConfig {
  return lastPointerType === 'pen' ? STYLUS_CONFIG : FINGER_CONFIG
}

/** 현재 입력이 스타일러스(S Pen)인지 판별 */
export function isStylusInput(): boolean {
  return lastPointerType === 'pen'
}

/** 스타일러스 압력값(0~1) 반환, 스타일러스가 아니면 null 반환 */
export function getStylusPressure(event: PointerEvent): number | null {
  if (event.pointerType === 'pen' && event.pressure > 0) {
    return event.pressure
  }
  return null
}

/** 마지막 감지된 압력값 반환 */
export function getLastPressure(): number {
  return lastPressure
}
