/**
 * 테마/화이트라벨 적용 — 고객 제공 theme 옵션을 CSS 변수로 주입.
 *
 * 디자인 토큰(app.css :root)이 semantic ← primitive 구조라,
 * primitive(--blue-*, --green-*, --purple-*)를 덮으면 파생 semantic 토큰까지 일괄 리브랜드된다.
 * 정밀 제어가 필요하면 theme.cssVars로 임의 토큰을 직접 덮을 수 있다 (이스케이프 해치).
 */
export interface ViewerTheme {
  /** 주 색상 — 활성 도구·강조·포커스 (기본 #1890ff) */
  primaryColor?: string
  /** 저장 버튼 색상 (기본 녹색) */
  saveColor?: string
  /** 작업 이력 색상 (기본 보라) */
  historyColor?: string
  /** 툴바 로고 이미지 URL (좌상단 표시) */
  logoUrl?: string
  /** 임의 CSS 변수 직접 오버라이드 — 예: { '--radius-md': '12px', 'color-surface': '#fafafa' } */
  cssVars?: Record<string, string>
}

export function applyTheme(theme: ViewerTheme | undefined | null): void {
  if (!theme || typeof theme !== 'object') return
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const set = (name: string, value?: string) => {
    if (typeof value === 'string' && value.length > 0) root.style.setProperty(name, value)
  }

  if (theme.primaryColor) {
    // primitive 덮기 → --color-primary 계열 semantic 토큰 자동 파생
    set('--blue-500', theme.primaryColor)
    set('--blue-600', theme.primaryColor)
    set('--blue-700', theme.primaryColor)
    // var()가 아닌 하드코딩 토큰은 직접 덮기
    set('--color-primary', theme.primaryColor)
    set('--color-primary-hover', theme.primaryColor)
    set('--color-primary-strong', theme.primaryColor)
  }
  if (theme.saveColor) {
    set('--green-500', theme.saveColor)
    set('--green-600', theme.saveColor)
    set('--green-light', theme.saveColor)
    set('--color-action-save', theme.saveColor)
    set('--color-action-save-hover', theme.saveColor)
  }
  if (theme.historyColor) {
    set('--purple-500', theme.historyColor)
    set('--purple-light', theme.historyColor)
    set('--color-history', theme.historyColor)
    set('--color-history-hover', theme.historyColor)
  }
  if (theme.cssVars && typeof theme.cssVars === 'object') {
    for (const k in theme.cssVars) {
      const name = k.startsWith('--') ? k : '--' + k
      set(name, theme.cssVars[k])
    }
  }
}
