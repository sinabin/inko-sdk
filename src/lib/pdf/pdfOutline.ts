/**
 * PDF 내장 목차(outline) 추출 모듈.
 *
 * pdf.js의 `getOutline()`은 목적지를 두 형태로 돌려준다:
 *  - named destination (문자열) → `getDestination(name)`으로 배열 해석 필요
 *  - explicit destination (배열) → 첫 원소가 페이지 참조
 * 두 경우 모두 최종적으로 `getPageIndex(ref)`로 0-base 인덱스를 얻는다.
 *
 * 해석 실패(손상된 dest·외부 링크·액션 전용 항목)는 예외를 던지지 않고
 * `page: null`로 남긴다 — 목차 일부가 깨져도 나머지는 계속 쓸 수 있어야 하기 때문.
 */
import type { PdfOutlineNode } from '../../types'

/** pdf.js가 돌려주는 목차 항목의 최소 형태 — 버전 간 필드 추가에 영향받지 않도록 좁게 선언 */
interface RawOutlineItem {
  title?: unknown
  dest?: unknown
  items?: unknown
}

/** 해석에 필요한 pdf.js 문서 API만 좁게 요구 — 테스트에서 대체 구현 주입 가능 */
export interface OutlineSourceDocument {
  getOutline(): Promise<unknown>
  getDestination(id: string): Promise<unknown>
  getPageIndex(ref: unknown): Promise<number>
}

/** 목차 깊이 상한 — 순환 참조가 섞인 손상 PDF에서 무한 재귀 차단 */
const MAX_OUTLINE_DEPTH = 12

/** 목차 항목 수 상한 — 비정상적으로 큰 목차가 UI·메모리를 잠식하지 않도록 방어 */
const MAX_OUTLINE_NODES = 5000

/** 제목 정규화 — 비문자열·공백은 빈 문자열로 수렴시켜 UI가 대체 문구를 쓰게 함 */
function normalizeTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * destination을 1-base 페이지 번호로 해석. 실패 시 null.
 * 문자열이면 named destination이므로 배열로 먼저 풀어낸다.
 */
export async function resolveDestinationPage(
  doc: OutlineSourceDocument,
  dest: unknown
): Promise<number | null> {
  try {
    let explicit: unknown = dest
    if (typeof explicit === 'string') {
      explicit = await doc.getDestination(explicit)
    }
    if (!Array.isArray(explicit) || explicit.length === 0) return null

    const pageIndex = await doc.getPageIndex(explicit[0])
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return null
    return pageIndex + 1
  } catch {
    // 손상된 dest 하나 때문에 목차 전체를 버리지 않음
    return null
  }
}

/**
 * PDF 내장 목차를 뷰어용 트리로 변환.
 * 목차가 없거나 읽을 수 없으면 빈 배열 — 호출부는 길이로만 노출 여부를 판단하면 된다.
 */
export async function extractOutline(doc: OutlineSourceDocument | null): Promise<PdfOutlineNode[]> {
  if (!doc) return []

  let raw: unknown
  try {
    raw = await doc.getOutline()
  } catch {
    return []
  }
  if (!Array.isArray(raw) || raw.length === 0) return []

  let remaining = MAX_OUTLINE_NODES

  async function walk(items: unknown[], depth: number, path: string): Promise<PdfOutlineNode[]> {
    if (depth >= MAX_OUTLINE_DEPTH) return []

    // 형제 항목은 병렬로 해석 — 목적지 해석은 pdf.js 워커 왕복이라
    // 순차 처리하면 항목 수만큼 지연이 누적되고 페이지 렌더와 오래 경쟁한다.
    const pending: Array<Promise<PdfOutlineNode>> = []
    for (let i = 0; i < items.length; i++) {
      if (remaining <= 0) break
      const item = items[i] as RawOutlineItem
      if (!item || typeof item !== 'object') continue
      remaining--

      const id = path ? `${path}.${i}` : String(i)
      pending.push(
        (async () => {
          const [page, children] = await Promise.all([
            resolveDestinationPage(doc!, item.dest),
            Array.isArray(item.items) ? walk(item.items, depth + 1, id) : Promise.resolve([])
          ])
          return {
            id,
            title: normalizeTitle(item.title),
            page,
            depth,
            children
          }
        })()
      )
    }
    return Promise.all(pending)
  }

  return walk(raw, 0, '')
}

/**
 * 접힌 항목의 하위를 제외하고 렌더 순서(깊이 우선)로 평탄화.
 * 트리를 재귀 컴포넌트 대신 단일 목록으로 그리기 위한 변환 —
 * 들여쓰기는 각 노드의 `depth`가 이미 들고 있다.
 */
export function flattenVisibleOutline(
  nodes: PdfOutlineNode[],
  collapsedIds: ReadonlySet<string> = new Set()
): PdfOutlineNode[] {
  const flat: PdfOutlineNode[] = []
  const visit = (list: PdfOutlineNode[]) => {
    list.forEach((node) => {
      flat.push(node)
      if (node.children.length > 0 && !collapsedIds.has(node.id)) visit(node.children)
    })
  }
  visit(nodes)
  return flat
}

/**
 * 현재 페이지에 해당하는 목차 항목 ID — 문서 순서상 현재 페이지를 넘지 않는 마지막 항목.
 * 목차는 페이지 오름차순이 보장되지 않으므로(손상·비선형 PDF) 순회하며 최댓값을 고른다.
 * 일치 항목이 없으면 null.
 */
export function findActiveOutlineId(
  nodes: PdfOutlineNode[],
  currentPage: number
): string | null {
  if (!Number.isInteger(currentPage) || currentPage < 1) return null

  let bestId: string | null = null
  let bestPage = 0

  const visit = (list: PdfOutlineNode[]) => {
    list.forEach((node) => {
      if (node.page !== null && node.page <= currentPage && node.page >= bestPage) {
        bestPage = node.page
        bestId = node.id
      }
      if (node.children.length > 0) visit(node.children)
    })
  }
  visit(nodes)
  return bestId
}
