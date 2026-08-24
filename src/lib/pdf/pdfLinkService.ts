/**
 * PDF.js native annotation과 Inko 스크롤 뷰어를 연결하는 링크 서비스.
 *
 * `pdfjs-dist` 5.4.624의 공개 `IPDFLinkService` 계약을 구현하되,
 * 내부 목적지 이동은 호스트 뷰어에 위임하고 외부 링크는 안전한 속성으로 고정.
 */
import { createValidAbsoluteUrl, isValidExplicitDest } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

const SAFE_EXTERNAL_REL = 'noopener noreferrer nofollow'

interface PdfRefProxy {
  num: number
  gen: number
}

export interface PdfLinkScrollTarget {
  pageNumber: number
  destArray?: unknown[] | null
  allowNegativeOffset?: boolean
  ignoreDestinationZoom?: boolean
  center?: boolean
}

export interface PdfLinkServiceOptions {
  /** 현재 페이지(1-base) 조회 */
  getCurrentPage: () => number
  /** 선택 페이지 상태 반영 */
  setCurrentPage?: (pageNumber: number) => void | Promise<void>
  /** 가상화된 페이지 DOM을 스크롤 전에 준비 */
  ensurePageVisible?: (pageNumber: number) => void | Promise<void>
  /** 호스트 스크롤 엔진으로 목적지 위임 */
  scrollPageIntoView: (target: PdfLinkScrollTarget) => void | Promise<void>
  pageLabelToPageNumber?: (label: string) => number | null
  getRotation?: () => number
  setRotation?: (rotation: number) => void
  onNamedAction?: (action: string) => void
  onOptionalContentConfigChanged?: (config: unknown) => void
  onNavigationError?: (error: unknown) => void
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as PromiseLike<unknown>).then === 'function'
}

function normalizePage(pageNumber: number, totalPages: number): number | null {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) return null
  return pageNumber
}

/** PDF.js `IPDFLinkService` 공개 인터페이스의 Inko 구현체 */
export class InkoPdfLinkService {
  private pdfDocument: PDFDocumentProxy | null = null
  private baseUrl: string | null = null
  private generation = 0
  private disposed = false
  private externalLinksEnabled = true

  constructor(private readonly options: PdfLinkServiceOptions) {}

  get pagesCount(): number {
    return this.pdfDocument?.numPages ?? 0
  }

  get page(): number {
    const pageNumber = this.options.getCurrentPage()
    return normalizePage(pageNumber, this.pagesCount) ?? 1
  }

  set page(value: number) {
    this.goToPage(value)
  }

  get rotation(): number {
    return this.options.getRotation?.() ?? 0
  }

  set rotation(value: number) {
    if (Number.isInteger(value) && value % 90 === 0) this.options.setRotation?.(value)
  }

  get isInPresentationMode(): boolean {
    return false
  }

  get externalLinkEnabled(): boolean {
    return this.externalLinksEnabled
  }

  set externalLinkEnabled(value: boolean) {
    this.externalLinksEnabled = value === true
  }

  /** 현재 PDF 문서 교체. 이전 문서의 느린 목적지 해석은 폐기. */
  setDocument(pdfDocument: PDFDocumentProxy | null, baseUrl: string | null = null): void {
    this.generation += 1
    this.pdfDocument = pdfDocument
    this.baseUrl = baseUrl
    this.disposed = false
  }

  /** named/explicit destination을 해석해 호스트 스크롤로 위임 */
  async goToDestination(dest: string | unknown[]): Promise<void> {
    const pdfDocument = this.pdfDocument
    const generation = this.generation
    if (!pdfDocument || this.disposed) return

    try {
      const explicitDest = typeof dest === 'string'
        ? await pdfDocument.getDestination(dest)
        : dest

      if (
        generation !== this.generation ||
        pdfDocument !== this.pdfDocument ||
        !Array.isArray(explicitDest) ||
        !isValidExplicitDest(explicitDest)
      ) return

      const destinationRef = explicitDest[0]
      let pageNumber: number | null = null

      if (Number.isInteger(destinationRef)) {
        pageNumber = (destinationRef as number) + 1
      } else if (destinationRef && typeof destinationRef === 'object') {
        const ref = destinationRef as PdfRefProxy
        pageNumber = pdfDocument.cachedPageNumber(ref)
        if (!pageNumber) pageNumber = (await pdfDocument.getPageIndex(ref)) + 1
      }

      if (
        generation !== this.generation ||
        pdfDocument !== this.pdfDocument ||
        normalizePage(pageNumber ?? 0, pdfDocument.numPages) === null
      ) return

      this.navigate({
        pageNumber: pageNumber as number,
        destArray: explicitDest,
        ignoreDestinationZoom: true
      }, generation)
    } catch (error) {
      if (generation === this.generation && pdfDocument === this.pdfDocument) {
        this.options.onNavigationError?.(error)
      }
    }
  }

  /** 1-base 페이지 번호 또는 페이지 라벨로 이동 */
  goToPage(value: number | string): void {
    if (!this.pdfDocument || this.disposed) return
    const requestedPage = typeof value === 'string'
      ? this.options.pageLabelToPageNumber?.(value) ?? Number(value)
      : value
    const pageNumber = normalizePage(requestedPage, this.pagesCount)
    if (pageNumber === null) return

    this.navigate({ pageNumber }, this.generation)
  }

  /** PDF 좌표를 포함한 XYZ 목적지로 이동 */
  goToXY(pageNumber: number, x: number, y: number): void {
    if (!this.pdfDocument || this.disposed) return
    if (normalizePage(pageNumber, this.pagesCount) === null) return
    this.navigate({
      pageNumber,
      destArray: [null, { name: 'XYZ' }, x, y],
      ignoreDestinationZoom: true
    }, this.generation)
  }

  /** 외부 링크에 프로토콜 검증·새 창·opener/referrer 차단 속성 부여 */
  addLinkAttributes(link: HTMLAnchorElement, url: string): void {
    const validUrl = this.baseUrl
      ? createValidAbsoluteUrl(url, this.baseUrl)
      : createValidAbsoluteUrl(url)
    if (!this.externalLinksEnabled || !validUrl) {
      link.removeAttribute('href')
      link.removeAttribute('target')
      link.rel = SAFE_EXTERNAL_REL
      link.title = validUrl ? `Disabled: ${validUrl.href}` : 'Blocked unsafe link'
      link.onclick = () => false
      return
    }

    link.href = validUrl.href
    link.title = validUrl.href
    link.target = '_blank'
    link.rel = SAFE_EXTERNAL_REL
  }

  getDestinationHash(dest: string | unknown[]): string {
    try {
      const value = typeof dest === 'string' ? dest : JSON.stringify(dest)
      return value ? this.getAnchorUrl(`#${encodeURIComponent(value)}`) : this.getAnchorUrl('')
    } catch {
      return this.getAnchorUrl('')
    }
  }

  getAnchorUrl(anchor: string): string {
    return this.baseUrl ? `${this.baseUrl}${anchor}` : anchor
  }

  /** PDF.js 주소 해시의 안전한 페이지/named destination만 해석 */
  setHash(hash: string): void {
    if (!this.pdfDocument || this.disposed || typeof hash !== 'string') return
    const value = hash.startsWith('#') ? hash.slice(1) : hash

    if (value.includes('=')) {
      const params = new URLSearchParams(value)
      const page = params.get('page')
      if (page) this.goToPage(Number(page))
      const namedDestination = params.get('nameddest')
      if (namedDestination) void this.goToDestination(namedDestination)
      return
    }

    try {
      const decoded = decodeURIComponent(value)
      let destination: string | unknown[] = decoded
      try {
        const parsed = JSON.parse(decoded)
        if (Array.isArray(parsed)) destination = parsed
      } catch {
        // JSON이 아니면 named destination으로 해석
      }
      void this.goToDestination(destination)
    } catch {
      // 잘못된 percent-encoding 무시
    }
  }

  executeNamedAction(action: string): void {
    switch (action) {
      case 'NextPage':
        this.goToPage(this.page + 1)
        break
      case 'PrevPage':
        this.goToPage(this.page - 1)
        break
      case 'FirstPage':
        this.goToPage(1)
        break
      case 'LastPage':
        this.goToPage(this.pagesCount)
        break
      default:
        this.options.onNamedAction?.(action)
        break
    }
  }

  /** 선택적 콘텐츠 상태 변경을 현재 문서 세대에만 반영 */
  async executeSetOCGState(action: Object): Promise<void> {
    const pdfDocument = this.pdfDocument
    const generation = this.generation
    if (!pdfDocument || this.disposed) return

    try {
      const config = await pdfDocument.getOptionalContentConfig()
      if (generation !== this.generation || pdfDocument !== this.pdfDocument) return
      config.setOCGState(action as { state: unknown; preserveRB: unknown })
      this.options.onOptionalContentConfigChanged?.(config)
    } catch (error) {
      if (generation === this.generation && pdfDocument === this.pdfDocument) {
        this.options.onNavigationError?.(error)
      }
    }
  }

  dispose(): void {
    this.generation += 1
    this.disposed = true
    this.pdfDocument = null
    this.baseUrl = null
  }

  /** ensure가 비동기여도 문서 세대가 유지된 경우에만 스크롤 */
  private navigate(target: PdfLinkScrollTarget, generation: number): void {
    const pdfDocument = this.pdfDocument
    if (!pdfDocument || generation !== this.generation || this.disposed) return

    const finish = () => {
      if (generation !== this.generation || pdfDocument !== this.pdfDocument || this.disposed) return
      try {
        const selected = this.options.setCurrentPage?.(target.pageNumber)
        if (isPromiseLike(selected)) selected.catch((error) => this.options.onNavigationError?.(error))
        const scrolled = this.options.scrollPageIntoView(target)
        if (isPromiseLike(scrolled)) scrolled.catch((error) => this.options.onNavigationError?.(error))
      } catch (error) {
        this.options.onNavigationError?.(error)
      }
    }

    try {
      const ensured = this.options.ensurePageVisible?.(target.pageNumber)
      if (isPromiseLike(ensured)) {
        void Promise.resolve(ensured).then(finish).catch((error) => {
          if (generation === this.generation) this.options.onNavigationError?.(error)
        })
      } else {
        finish()
      }
    } catch (error) {
      this.options.onNavigationError?.(error)
    }
  }
}

/** 객체 생성·문서 연결·해제를 하나의 수명주기 API로 노출 */
export function createPdfLinkService(options: PdfLinkServiceOptions) {
  const service = new InkoPdfLinkService(options)
  return {
    service,
    setDocument: (pdfDocument: PDFDocumentProxy | null, baseUrl: string | null = null) => {
      service.setDocument(pdfDocument, baseUrl)
    },
    dispose: () => service.dispose()
  }
}

export type PdfLinkService = InkoPdfLinkService
