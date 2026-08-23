/** 브러시 설정 — 색상/두께/투명도/폰트/필압 감도 전역 관리 */
import type { BrushSettings } from '../../types'

export interface BrushSettingsOptions {
  initialColor?: string
  initialWidth?: number
  initialOpacity?: number
  initialFontSize?: number
  initialFontFamily?: string
  initialPressureSensitivity?: number
}

/** 브러시 설정 생성 — 색상, 두께, 투명도, 폰트 크기/종류 관리 */
export function createBrushSettings(options: BrushSettingsOptions = {}) {
  let color = $state(options.initialColor ?? '#000000')
  let width = $state(options.initialWidth ?? 2)
  let opacity = $state(options.initialOpacity ?? 1)
  let fontSize = $state(options.initialFontSize ?? 16)
  let fontFamily = $state(options.initialFontFamily ?? 'sans-serif')
  let pressureSensitivity = $state(options.initialPressureSensitivity ?? 50)

  // 파생 설정 객체
  const settings = $derived<BrushSettings>({
    color,
    width,
    opacity,
    fontSize,
    fontFamily,
    pressureSensitivity
  })

  // 프리셋 목록 — Tailwind 기반 9색. 사용자는 추가로 커스텀 picker로 임의 색 선택 가능
  const colorPresets = [
    '#000000', // 검정
    '#EF4444', // 빨강 (red-500)
    '#F97316', // 주황 (orange-500)
    '#EAB308', // 노랑 (yellow-500)
    '#22C55E', // 초록 (green-500)
    '#06B6D4', // 청록 (cyan-500)
    '#3B82F6', // 파랑 (blue-500)
    '#8B5CF6', // 보라 (violet-500)
    '#EC4899'  // 분홍 (pink-500)
  ]

  const widthPresets = [1, 2, 4, 6, 8, 12, 16, 24]
  const fontSizePresets = [12, 16, 20, 24, 32, 48]

  /** 브러시 색상 설정 */
  function setColor(c: string) {
    color = c
  }

  /** 브러시 두께 설정 (1~50 범위 제한) */
  function setWidth(w: number) {
    width = Math.max(1, Math.min(50, w))
  }

  /** 브러시 투명도 설정 (0~1 범위 제한) */
  function setOpacity(o: number) {
    opacity = Math.max(0, Math.min(1, o))
  }

  /** 폰트 크기 설정 (8~96 범위 제한) */
  function setFontSize(s: number) {
    fontSize = Math.max(8, Math.min(96, s))
  }

  /** 폰트 종류 설정 */
  function setFontFamily(f: string) {
    fontFamily = f
  }

  /** 필압 감도 0-100 — drawingMode pressureGain에 곱해질 비율 (50=기본, 0=무시, 100=2배) */
  function setPressureSensitivity(v: number) {
    pressureSensitivity = Math.max(0, Math.min(100, v))
  }

  /** 모든 설정을 초기값으로 리셋 */
  function reset() {
    color = options.initialColor ?? '#000000'
    width = options.initialWidth ?? 2
    opacity = options.initialOpacity ?? 1
    fontSize = options.initialFontSize ?? 16
    fontFamily = options.initialFontFamily ?? 'sans-serif'
    pressureSensitivity = options.initialPressureSensitivity ?? 50
  }

  /** Paper.js 호환 색상 문자열 반환 (투명도 적용 시 rgba 변환) */
  function getPaperColor(): string {
    if (opacity < 1) {
      // hex → rgba 변환
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${opacity})`
    }
    return color
  }

  return {
    get color() { return color },
    get width() { return width },
    get opacity() { return opacity },
    get fontSize() { return fontSize },
    get fontFamily() { return fontFamily },
    get pressureSensitivity() { return pressureSensitivity },
    get settings() { return settings },

    colorPresets,
    widthPresets,
    fontSizePresets,

    setColor,
    setWidth,
    setOpacity,
    setFontSize,
    setFontFamily,
    setPressureSensitivity,
    reset,
    getPaperColor
  }
}

export type BrushSettingsManager = ReturnType<typeof createBrushSettings>
