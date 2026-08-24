/**
 * PDF 내장 목차(outline) 추출 모듈.
 *
 * pdf.js의 `getOutline()`은 목적지를 두 형태로 돌려준다:
 *  - named destination (문자열) → `getDestination(name)`으로 배열 해석 필요
 *  - explicit destination (배열) → 첫 원소가 페이지 참조 또는 0-base 정수 인덱스
 * 참조 객체만 `getPageIndex(ref)`로 풀고, 정수 인덱스는 그대로 1-base로 변환한다.
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
  url?: unknown
  unsafeUrl?: unknown
}

/** 해석에 필요한 pdf.js 문서 API만 좁게 요구 — 테스트에서 대체 구현 주입 가능 */
export interface OutlineSourceDocument {
  numPages?: number
  getOutline(): Promise<unknown>
  getDestination(id: string): Promise<unknown>
  getPageIndex(ref: unknown): Promise<number>
}

/** 목차 깊이 상한 — 순환 참조가 섞인 손상 PDF에서 무한 재귀 차단 */
const MAX_OUTLINE_DEPTH = 12

/** 목차 항목 수 상한 — 비정상적으로 큰 목차가 UI·메모리를 잠식하지 않도록 방어 */
const MAX_OUTLINE_NODES = 5000

/** pdf.js worker 왕복 동시성 — 첫 페이지 이후에도 렌더링과 입력 응답성을 잠식하지 않는 상한 */
const MAX_OUTLINE_CONCURRENCY = 8

interface PendingDestination {
  node: PdfOutlineNode
  dest: unknown
}

export interface OutlineExtractionOptions {
  /** 문서 교체·기능 비활성화 시 남은 해석을 중단하는 세대 검사 */
  shouldContinue?: () => boolean
  /** 테스트·저사양 호스트용 동시성 재정의 (1~8) */
  concurrency?: number
}

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

    const destinationRef = explicit[0]
    let pageIndex: number
    if (Number.isInteger(destinationRef)) {
      // pdf.js explicit destination은 RefProxy뿐 아니라 0-base 정수 인덱스도 허용
      pageIndex = destinationRef as number
    } else if (
      destinationRef &&
      (typeof destinationRef === 'object' || typeof destinationRef === 'string')
    ) {
      // pdf.js의 정상 RefProxy는 객체. 문자열은 손상·테스트 대역 호환 경로이며
      // getPageIndex가 거부하면 아래 catch에서 안전하게 null로 수렴한다.
      pageIndex = await doc.getPageIndex(destinationRef)
    } else {
      return null
    }

    if (!Number.isInteger(pageIndex) || pageIndex < 0) return null
    if (Number.isInteger(doc.numPages) && pageIndex >= (doc.numPages as number)) return null
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
export async function extractOutline(
  doc: OutlineSourceDocument | null,
  options: OutlineExtractionOptions = {}
): Promise<PdfOutlineNode[]> {
  if (!doc) return []

  const shouldContinue = options.shouldContinue ?? (() => true)
  const requestedConcurrency = Number.isFinite(options.concurrency)
    ? Math.floor(options.concurrency as number)
    : MAX_OUTLINE_CONCURRENCY
  const concurrency = Math.max(1, Math.min(MAX_OUTLINE_CONCURRENCY, requestedConcurrency))

  let raw: unknown
  try {
    raw = await doc.getOutline()
  } catch {
    return []
  }
  if (!shouldContinue()) return []
  if (!Array.isArray(raw) || raw.length === 0) return []

  let remaining = MAX_OUTLINE_NODES

  const pending: PendingDestination[] = []

  function walk(items: unknown[], depth: number, path: string): PdfOutlineNode[] {
    if (depth >= MAX_OUTLINE_DEPTH || !shouldContinue()) return []

    const nodes: PdfOutlineNode[] = []
    for (let i = 0; i < items.length; i++) {
      if (remaining <= 0) break
      const item = items[i] as RawOutlineItem
      if (!item || typeof item !== 'object') continue
      remaining--

      const id = path ? `${path}.${i}` : String(i)
      const node: PdfOutlineNode = {
        id,
        title: normalizeTitle(item.title),
        page: null,
        depth,
        children: [],
        external: typeof item.url === 'string' || typeof item.unsafeUrl === 'string'
      }
      node.children = Array.isArray(item.items) ? walk(item.items, depth + 1, id) : []
      nodes.push(node)
      if (!node.external) pending.push({ node, dest: item.dest })
    }
    return nodes
  }

  const tree = walk(raw, 0, '')
  let cursor = 0
  const workerCount = Math.min(concurrency, pending.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (shouldContinue()) {
      const task = pending[cursor++]
      if (!task) return
      task.node.page = await resolveDestinationPage(doc, task.dest)
    }
  }))

  return shouldContinue() ? tree : []
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
