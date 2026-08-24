import { afterEach, describe, expect, it } from 'vitest'
import {
  getInputConfig,
  getLastPressure,
  getStylusPressure,
  initPointerTracking,
  isStylusInput
} from '../../src/lib/utils/inputDetection'

let cleanup: (() => void) | undefined

function pointer(type: string, pressure: number): PointerEvent {
  return new PointerEvent('pointerdown', { pointerType: type, pressure, bubbles: true })
}

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

describe('inputDetection', () => {
  it('기본 입력은 손가락용 hit target을 사용한다', () => {
    expect(isStylusInput()).toBe(false)
    expect(getInputConfig()).toEqual({
      hitTestTolerance: 20,
      handleSize: 16,
      selectionPadding: 8,
      dashPattern: [8, 6]
    })
  })

  it('pointerdown/move에서 타입과 압력을 갱신하고 cleanup 후에는 멈춘다', () => {
    cleanup = initPointerTracking()
    document.dispatchEvent(pointer('pen', 0.65))
    expect(isStylusInput()).toBe(true)
    expect(getLastPressure()).toBeCloseTo(0.65)
    expect(getInputConfig()).toEqual({
      hitTestTolerance: 5,
      handleSize: 10,
      selectionPadding: 4,
      dashPattern: [4, 4]
    })

    document.dispatchEvent(new PointerEvent('pointermove', {
      pointerType: 'touch', pressure: 0.2, bubbles: true
    }))
    expect(isStylusInput()).toBe(false)
    expect(getLastPressure()).toBeCloseTo(0.2)

    cleanup()
    cleanup = undefined
    document.dispatchEvent(pointer('pen', 0.9))
    expect(isStylusInput()).toBe(false)
    expect(getLastPressure()).toBeCloseTo(0.2)
  })

  it('양수 pen pressure만 반환한다', () => {
    expect(getStylusPressure(pointer('pen', 0.7))).toBeCloseTo(0.7)
    expect(getStylusPressure(pointer('pen', 0))).toBeNull()
    expect(getStylusPressure(pointer('touch', 0.7))).toBeNull()
  })
})
