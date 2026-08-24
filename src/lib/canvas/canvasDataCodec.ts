/** 문서 전체의 페이지별 Paper.js JSON 레코드 */
export type CanvasDataRecord = Record<string, string>

const DEFAULT_MAX_PAGE = Number.MAX_SAFE_INTEGER

/** 페이지 상한을 검증 */
function assertMaxPage(maxPage: number): void {
  if (!Number.isInteger(maxPage) || maxPage < 1) {
    throw new TypeError('maxPage must be a positive integer')
  }
}

/** 페이지별 편집 상태 객체를 정규화하고 각 Paper.js JSON을 검증 */
export function normalizeCanvasDataRecord(
  value: unknown,
  maxPage: number = DEFAULT_MAX_PAGE
): CanvasDataRecord {
  assertMaxPage(maxPage)

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('canvasData must be a page-keyed object')
  }

  const normalized: CanvasDataRecord = {}
  Object.entries(value as Record<string, unknown>).forEach(([pageKey, pageJson]) => {
    const pageNum = Number(pageKey)
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > maxPage) {
      throw new TypeError(`invalid canvas page: ${pageKey}`)
    }
    if (typeof pageJson !== 'string') {
      throw new TypeError(`canvas page ${pageKey} must be a JSON string`)
    }

    try {
      JSON.parse(pageJson)
    } catch {
      throw new TypeError(`canvas page ${pageKey} must contain valid JSON`)
    }

    normalized[String(pageNum)] = pageJson
  })

  return normalized
}

/** SDK canvasData 문자열을 페이지별 Paper.js JSON 레코드로 파싱 */
export function parseCanvasDataRecord(canvasData: string, maxPage: number): CanvasDataRecord {
  if (typeof canvasData !== 'string') {
    throw new TypeError('canvasData must be a JSON string')
  }
  return normalizeCanvasDataRecord(JSON.parse(canvasData), maxPage)
}

/** Map 형태의 편집 상태를 JSON 직렬화 가능한 레코드로 변환 */
export function canvasDataMapToRecord(
  data: ReadonlyMap<number, string>,
  maxPage: number = DEFAULT_MAX_PAGE
): CanvasDataRecord {
  const record: Record<string, unknown> = {}
  data.forEach((pageJson, pageNum) => {
    record[String(pageNum)] = pageJson
  })
  return normalizeCanvasDataRecord(record, maxPage)
}

/** 페이지별 레코드를 내부 Map 형태로 변환 */
export function canvasDataRecordToMap(
  data: CanvasDataRecord,
  maxPage: number = DEFAULT_MAX_PAGE
): Map<number, string> {
  const normalized = normalizeCanvasDataRecord(data, maxPage)
  return new Map(
    Object.entries(normalized).map(([pageKey, pageJson]) => [Number(pageKey), pageJson])
  )
}

/** Map 형태의 문서 상태를 SDK canvasData 문자열로 직렬화 */
export function serializeCanvasDataMap(
  data: ReadonlyMap<number, string>,
  maxPage: number = DEFAULT_MAX_PAGE
): string {
  return JSON.stringify(canvasDataMapToRecord(data, maxPage))
}

/** 문서 전체 canvasData인지 레거시 단일 페이지 Paper.js JSON인지 구분 */
function isPageKeyedCanvasDocument(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const keys = Object.keys(value)
  return keys.length === 0 || keys.every((key) => {
    const pageNum = Number(key)
    return Number.isInteger(pageNum) && pageNum >= 1
  })
}

/** 복수 검토본 canvasData에서 특정 페이지의 Paper.js children만 추출 */
export function extractPageCanvasData(canvasData: string, pageKey: string): string | null {
  try {
    const parsed = JSON.parse(canvasData)

    if (isPageKeyedCanvasDocument(parsed)) {
      // 문서 레코드에 요청 페이지가 없을 때 전체 문서 JSON을 단일 페이지 데이터로
      // 오인하지 않는다. 레거시 호환은 문서 레코드가 아닌 Paper.js JSON에만 적용한다.
      if (!Object.prototype.hasOwnProperty.call(parsed, pageKey)) return null

      const pageData = parsed[pageKey]
      const layerDefinition = typeof pageData === 'string' ? JSON.parse(pageData) : pageData
      const layerProperties = layerDefinition?.[1] || {}
      const children = layerProperties.children || []

      if (children.length === 0) return null
      return JSON.stringify({ children })
    }

    // 레거시 페이지 단일 JSON은 기존 호환 경로를 유지
    return canvasData
  } catch {
    return null
  }
}
