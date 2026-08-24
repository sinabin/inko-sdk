import type { ToolMode } from '../../types'

export const VIEWER_TOOL_MODES: readonly ToolMode[] = [
  'select', 'contentSelect', 'pen', 'highlighter', 'eraser', 'text', 'rectangle', 'circle', 'line'
]

const SHAPE_TOOL_MODES: readonly ToolMode[] = ['rectangle', 'circle', 'line']

/** PdfViewer에서 호스트 설정으로 변경되는 순수 상태 */
export interface ViewerConfigPolicyState {
  currentTool: ToolMode
  enabledTools: ToolMode[] | null
  features: Record<string, boolean>
  logoUrl: string
  brushColor: string
  brushWidth: number
}

export interface ViewerConfigPolicyContext {
  /** 책갈피 재활성화 시 즉시 다시 읽을 PDF 문서가 있는지 */
  hasPdfDocument?: boolean
}

export interface ViewerConfigPolicyEffects {
  hideThumbnails: boolean
  outlineAction: 'none' | 'reset' | 'refresh'
}

export interface ViewerConfigPolicyResult {
  state: ViewerConfigPolicyState
  effects: ViewerConfigPolicyEffects
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 공개 SDK의 enabled 목록을 실제 ToolMode로 정규화 */
export function normalizeEnabledTools(value: unknown): ToolMode[] | null {
  if (!Array.isArray(value)) return null

  const normalized: ToolMode[] = []
  value.forEach((candidate) => {
    if (candidate === 'shape') {
      SHAPE_TOOL_MODES.forEach((shape) => {
        if (!normalized.includes(shape)) normalized.push(shape)
      })
    } else if (
      VIEWER_TOOL_MODES.includes(candidate as ToolMode) &&
      !normalized.includes(candidate as ToolMode)
    ) {
      normalized.push(candidate as ToolMode)
    }
  })
  return normalized
}

/** applyConfig의 상태 변경과 컴포넌트가 실행할 UI 효과를 함께 계획 */
export function planViewerConfigUpdate(
  current: ViewerConfigPolicyState,
  config: unknown,
  context: ViewerConfigPolicyContext = {}
): ViewerConfigPolicyResult {
  const noEffects: ViewerConfigPolicyEffects = {
    hideThumbnails: false,
    outlineAction: 'none'
  }
  if (!isRecord(config)) return { state: current, effects: noEffects }

  let currentTool = current.currentTool
  let enabledTools = current.enabledTools ? [...current.enabledTools] : null
  let features = { ...current.features }
  let logoUrl = current.logoUrl
  let brushColor = current.brushColor
  let brushWidth = current.brushWidth
  let effects = noEffects

  if (isRecord(config.theme) && typeof config.theme.logoUrl === 'string') {
    logoUrl = config.theme.logoUrl
  }

  if (isRecord(config.tools)) {
    const toolConfig = config.tools
    const nextEnabled = normalizeEnabledTools(toolConfig.enabled)
    if (nextEnabled !== null) enabledTools = nextEnabled

    if (isRecord(toolConfig.features)) {
      // 현재 PdfViewer 계약: features가 오면 맵 전체를 교체,
      // 미지정 키는 툴바에서 기본 노출로 해석
      features = { ...toolConfig.features } as Record<string, boolean>

      const bookmarksWereEnabled = current.features.bookmarks !== false
      effects = {
        hideThumbnails: features.thumbnails === false,
        outlineAction: features.bookmarks === false
          ? 'reset'
          : !bookmarksWereEnabled && context.hasPdfDocument === true
            ? 'refresh'
            : 'none'
      }
    }

    const requestedDefault =
      typeof toolConfig.defaultTool === 'string' &&
      VIEWER_TOOL_MODES.includes(toolConfig.defaultTool as ToolMode)
        ? toolConfig.defaultTool as ToolMode
        : null
    const activeEnabled = nextEnabled ?? enabledTools

    if (requestedDefault && (!activeEnabled || activeEnabled.includes(requestedDefault))) {
      currentTool = requestedDefault
    } else if (nextEnabled && !nextEnabled.includes(currentTool) && nextEnabled.length > 0) {
      currentTool = nextEnabled[0]!
    }

    if (typeof toolConfig.defaultColor === 'string') {
      brushColor = toolConfig.defaultColor
    }
    if (typeof toolConfig.defaultWidth === 'number') {
      // createBrushSettings.setWidth의 현재 계약과 동일한 범위 유지
      brushWidth = Math.max(1, Math.min(50, toolConfig.defaultWidth))
    }
  }

  return {
    state: {
      currentTool,
      enabledTools,
      features,
      logoUrl,
      brushColor,
      brushWidth
    },
    effects
  }
}

/** applyConfig의 도구·브랜드 부분 갱신 규칙만 순수 상태로 적용 */
export function applyViewerConfigPolicy(
  current: ViewerConfigPolicyState,
  config: unknown
): ViewerConfigPolicyState {
  return planViewerConfigUpdate(current, config).state
}
