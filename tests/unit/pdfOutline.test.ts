import { describe, it, expect, vi } from 'vitest'
import {
  extractOutline,
  resolveDestinationPage,
  flattenVisibleOutline,
  findActiveOutlineId,
  type OutlineSourceDocument
} from '../../src/lib/pdf/pdfOutline'

/**
 * pdf.js 문서의 목차 관련 API만 흉내내는 테스트 대역.
 * `refs`는 explicit destination의 첫 원소(페이지 참조)를 0-base 인덱스로 매핑한다.
 */
function createDoc(options: {
  outline?: unknown
  refs?: Record<string, number>
  named?: Record<string, unknown>
  failOutline?: boolean
  numPages?: number
}): OutlineSourceDocument {
  const { outline = [], refs = {}, named = {}, failOutline = false, numPages = 20 } = options
  return {
    numPages,
    getOutline: vi.fn(async () => {
      if (failOutline) throw new Error('outline unavailable')
      return outline
    }),
    getDestination: vi.fn(async (id: string) => {
      if (!(id in named)) throw new Error(`unknown destination: ${id}`)
      return named[id]
    }),
    getPageIndex: vi.fn(async (ref: unknown) => {
      const key = String(ref)
      if (!(key in refs)) throw new Error(`unknown ref: ${key}`)
      return refs[key]
    })
  }
}

describe('resolveDestinationPage', () => {
  it('explicit destination 배열의 첫 원소를 1-base 페이지로 변환한다', async () => {
    const doc = createDoc({ refs: { 'ref:4': 4 } })
    await expect(resolveDestinationPage(doc, ['ref:4', 'XYZ', 0, 0, 0])).resolves.toBe(5)
  })

  it('named destination 문자열은 getDestination으로 먼저 해석한다', async () => {
    const doc = createDoc({
      named: { 'chapter.2': ['ref:9', 'Fit'] },
      refs: { 'ref:9': 9 }
    })
    await expect(resolveDestinationPage(doc, 'chapter.2')).resolves.toBe(10)
    expect(doc.getDestination).toHaveBeenCalledWith('chapter.2')
  })

  it('첫 페이지 참조는 1을 반환한다 (0-base → 1-base 경계)', async () => {
    const doc = createDoc({ refs: { 'ref:0': 0 } })
    await expect(resolveDestinationPage(doc, ['ref:0'])).resolves.toBe(1)
  })

  it('정수 explicit destination은 getPageIndex 없이 1-base 페이지로 변환한다', async () => {
    const doc = createDoc({})
    await expect(resolveDestinationPage(doc, [0, 'Fit'])).resolves.toBe(1)
    await expect(resolveDestinationPage(doc, [7, 'XYZ', 0, 0, 0])).resolves.toBe(8)
    expect(doc.getPageIndex).not.toHaveBeenCalled()
  })

  it('named destination이 정수 인덱스로 풀려도 페이지를 해석한다', async () => {
    const doc = createDoc({ named: { appendix: [11, 'Fit'] }, numPages: 12 })
    await expect(resolveDestinationPage(doc, 'appendix')).resolves.toBe(12)
  })

  it('문서 페이지 범위를 벗어난 정수·참조 목적지는 null로 거부한다', async () => {
    const doc = createDoc({ refs: { late: 20 }, numPages: 12 })
    await expect(resolveDestinationPage(doc, [12, 'Fit'])).resolves.toBeNull()
    await expect(resolveDestinationPage(doc, ['late', 'Fit'])).resolves.toBeNull()
  })

  it('dest가 없거나 빈 배열이면 null', async () => {
    const doc = createDoc({})
    await expect(resolveDestinationPage(doc, undefined)).resolves.toBeNull()
    await expect(resolveDestinationPage(doc, [])).resolves.toBeNull()
    await expect(resolveDestinationPage(doc, null)).resolves.toBeNull()
  })

  it('해석 실패(알 수 없는 ref·named)는 예외 대신 null', async () => {
    const doc = createDoc({ refs: {} })
    await expect(resolveDestinationPage(doc, ['ref:missing'])).resolves.toBeNull()
    await expect(resolveDestinationPage(doc, 'no-such-dest')).resolves.toBeNull()
  })
})

describe('extractOutline', () => {
  it('중첩 목차를 깊이·페이지와 함께 트리로 변환한다', async () => {
    const doc = createDoc({
      outline: [
        {
          title: '1장',
          dest: ['ref:0'],
          items: [{ title: '1.1절', dest: ['ref:2'], items: [] }]
        },
        { title: '2장', dest: 'ch2', items: [] }
      ],
      named: { ch2: ['ref:7'] },
      refs: { 'ref:0': 0, 'ref:2': 2, 'ref:7': 7 }
    })

    const tree = await extractOutline(doc)

    expect(tree).toHaveLength(2)
    expect(tree[0]).toMatchObject({ id: '0', title: '1장', page: 1, depth: 0 })
    expect(tree[0].children[0]).toMatchObject({ id: '0.0', title: '1.1절', page: 3, depth: 1 })
    expect(tree[1]).toMatchObject({ id: '1', title: '2장', page: 8, depth: 0 })
  })

  it('목차가 없으면(null·빈 배열) 빈 배열을 반환한다', async () => {
    await expect(extractOutline(createDoc({ outline: null }))).resolves.toEqual([])
    await expect(extractOutline(createDoc({ outline: [] }))).resolves.toEqual([])
  })

  it('문서가 null이면 빈 배열 — 호출부가 로드 전 상태를 분기하지 않아도 된다', async () => {
    await expect(extractOutline(null)).resolves.toEqual([])
  })

  it('getOutline 자체가 실패해도 예외를 던지지 않는다', async () => {
    await expect(extractOutline(createDoc({ failOutline: true }))).resolves.toEqual([])
  })

  it('일부 항목의 dest 해석이 실패해도 나머지 항목은 보존한다', async () => {
    const doc = createDoc({
      outline: [
        { title: '정상', dest: ['ref:1'] },
        { title: '깨진 링크', dest: ['ref:absent'] }
      ],
      refs: { 'ref:1': 1 }
    })

    const tree = await extractOutline(doc)

    expect(tree).toHaveLength(2)
    expect(tree[0].page).toBe(2)
    expect(tree[1].page).toBeNull()
  })

  it('제목이 문자열이 아니면 빈 문자열로 정규화한다', async () => {
    const doc = createDoc({ outline: [{ title: undefined, dest: null }] })
    const tree = await extractOutline(doc)
    expect(tree[0].title).toBe('')
  })

  it('외부 URL 항목은 주소를 노출·실행하지 않고 이동 불가 구조로 보존한다', async () => {
    const doc = createDoc({
      outline: [{ title: 'Website', dest: null, url: 'https://example.com', items: [] }]
    })
    const tree = await extractOutline(doc)
    expect(tree[0]).toMatchObject({ title: 'Website', page: null, external: true })
    expect(doc.getPageIndex).not.toHaveBeenCalled()
  })

  it('목차 목적지 worker 왕복은 최대 8개까지만 동시에 실행한다', async () => {
    let active = 0
    let maxActive = 0
    const outline = Array.from({ length: 40 }, (_, index) => ({
      title: `item-${index}`,
      dest: [{ num: index, gen: 0 }],
      items: []
    }))
    const doc: OutlineSourceDocument = {
      numPages: 40,
      getOutline: vi.fn(async () => outline),
      getDestination: vi.fn(async () => null),
      getPageIndex: vi.fn(async (ref: unknown) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active--
        return (ref as { num: number }).num
      })
    }

    const tree = await extractOutline(doc)

    expect(tree).toHaveLength(40)
    expect(maxActive).toBeGreaterThan(1)
    expect(maxActive).toBeLessThanOrEqual(8)
  })

  it('문서 세대가 바뀌면 남은 목적지 해석을 중단하고 결과를 버린다', async () => {
    let current = true
    const doc = createDoc({
      outline: Array.from({ length: 20 }, (_, index) => ({
        title: `item-${index}`,
        dest: [`ref:${index}`],
        items: []
      })),
      refs: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`ref:${index}`, index])),
      numPages: 20
    })
    vi.mocked(doc.getPageIndex).mockImplementation(async (ref: unknown) => {
      current = false
      return Number(String(ref).split(':')[1])
    })

    await expect(extractOutline(doc, { shouldContinue: () => current })).resolves.toEqual([])
    expect(doc.getPageIndex).toHaveBeenCalledTimes(1)
  })

  it('순환 참조가 섞인 목차에서도 깊이 상한으로 종료한다', async () => {
    const cyclic: Record<string, unknown> = { title: 'loop', dest: null }
    cyclic.items = [cyclic]

    const tree = await extractOutline(createDoc({ outline: [cyclic] }))

    let depth = 0
    let node = tree[0]
    while (node?.children.length) {
      depth++
      node = node.children[0]
    }
    expect(depth).toBeLessThan(12)
  })
})

describe('flattenVisibleOutline', () => {
  const tree = [
    {
      id: '0',
      title: 'A',
      page: 1,
      depth: 0,
      children: [{ id: '0.0', title: 'A-1', page: 2, depth: 1, children: [] }]
    },
    { id: '1', title: 'B', page: 5, depth: 0, children: [] }
  ]

  it('기본은 전체 펼침 순서로 평탄화한다', () => {
    expect(flattenVisibleOutline(tree).map((n) => n.id)).toEqual(['0', '0.0', '1'])
  })

  it('접힌 노드의 하위는 제외한다', () => {
    const rows = flattenVisibleOutline(tree, new Set(['0']))
    expect(rows.map((n) => n.id)).toEqual(['0', '1'])
  })
})

describe('findActiveOutlineId', () => {
  const tree = [
    {
      id: '0',
      title: 'A',
      page: 1,
      depth: 0,
      children: [{ id: '0.0', title: 'A-1', page: 4, depth: 1, children: [] }]
    },
    { id: '1', title: 'B', page: 9, depth: 0, children: [] }
  ]

  it('현재 페이지를 넘지 않는 마지막 항목을 고른다', () => {
    expect(findActiveOutlineId(tree, 1)).toBe('0')
    expect(findActiveOutlineId(tree, 4)).toBe('0.0')
    expect(findActiveOutlineId(tree, 7)).toBe('0.0')
    expect(findActiveOutlineId(tree, 9)).toBe('1')
  })

  it('일치 항목이 없으면 null', () => {
    const later = [{ id: '0', title: 'A', page: 5, depth: 0, children: [] }]
    expect(findActiveOutlineId(later, 2)).toBeNull()
    expect(findActiveOutlineId([], 3)).toBeNull()
  })

  it('페이지 해석에 실패한 항목은 후보에서 제외한다', () => {
    const withNull = [{ id: '0', title: 'A', page: null, depth: 0, children: [] }]
    expect(findActiveOutlineId(withNull, 3)).toBeNull()
  })
})
