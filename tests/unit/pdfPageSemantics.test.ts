import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPdfPageSemantics,
  type PdfPageSemanticLabels
} from '../../src/lib/accessibility/pdfPageSemantics'

const labels: PdfPageSemanticLabels = {
  pageRegion: 'PDF page 3',
  pageText: 'Text on page 3',
  pageAnnotations: 'Forms and annotations on page 3',
  annotationControl: index => `PDF control ${index} on page 3`,
  editableCanvas: 'Editable annotations on page 3',
  reviewCanvas: 'Review annotations on page 3'
}

function appendControl<T extends HTMLElement>(
  layer: HTMLElement,
  element: T,
  attributes: Record<string, string> = {}
): T {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  layer.append(element)
  return element
}

async function flushMutations(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  } as DOMRect
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('applyPdfPageSemantics', () => {
  it('페이지·텍스트·annotation·편집 canvas에 의미와 대체 이름을 부여한다', () => {
    const container = document.createElement('section')
    const pdfCanvas = document.createElement('canvas')
    pdfCanvas.className = 'scroll-page-canvas-pdf'
    const textLayer = document.createElement('div')
    textLayer.className = 'inko-text-layer'
    const annotationLayer = document.createElement('div')
    annotationLayer.className = 'inko-annotation-layer'
    const unnamedRequired = appendControl(annotationLayer, document.createElement('input'))
    unnamedRequired.required = true
    const paperCanvas = document.createElement('canvas')
    paperCanvas.className = 'scroll-page-canvas-paper'
    const overlay = document.createElement('div')
    overlay.className = 'scroll-page-overlay-container'
    const reviewCanvas = document.createElement('canvas')
    overlay.append(reviewCanvas)
    container.append(pdfCanvas, textLayer, annotationLayer, paperCanvas, overlay)
    document.body.append(container)

    const semantics = applyPdfPageSemantics(container, labels)

    expect(container.getAttribute('role')).toBe('region')
    expect(container.getAttribute('aria-label')).toBe(labels.pageRegion)
    expect(container.getAttribute('aria-busy')).toBe('true')
    expect(container.tabIndex).toBe(-1)
    expect(pdfCanvas.getAttribute('role')).toBe('presentation')
    expect(textLayer.getAttribute('role')).toBe('document')
    expect(textLayer.getAttribute('aria-label')).toBe(labels.pageText)
    expect(annotationLayer.getAttribute('role')).toBe('group')
    expect(annotationLayer.getAttribute('aria-label')).toBe(labels.pageAnnotations)
    expect(unnamedRequired.getAttribute('aria-label')).toBe(labels.annotationControl(1))
    expect(unnamedRequired.getAttribute('aria-required')).toBe('true')
    expect(paperCanvas.getAttribute('role')).toBe('img')
    expect(paperCanvas.getAttribute('aria-label')).toBe(labels.editableCanvas)
    expect(reviewCanvas.getAttribute('role')).toBe('img')
    expect(reviewCanvas.getAttribute('aria-label')).toBe(labels.reviewCanvas)

    semantics.markReady()
    expect(container.getAttribute('aria-busy')).toBe('false')
    semantics.dispose()

    for (const element of [container, pdfCanvas, textLayer, annotationLayer, unnamedRequired, paperCanvas, reviewCanvas]) {
      expect(element.hasAttribute('role')).toBe(false)
      expect(element.hasAttribute('aria-label')).toBe(false)
    }
    expect(container.hasAttribute('aria-busy')).toBe(false)
    expect(container.hasAttribute('tabindex')).toBe(false)
    expect(unnamedRequired.hasAttribute('aria-required')).toBe(false)
  })

  it('기존 접근 가능한 이름은 보존하고 이름 없는 제어만 순번 이름을 보완한다', () => {
    const container = document.createElement('div')
    const layer = document.createElement('div')
    layer.className = 'inko-annotation-layer'
    container.append(layer)
    document.body.append(container)

    const ariaLabelled = appendControl(layer, document.createElement('input'), { 'aria-label': 'Account' })
    const referenced = appendControl(layer, document.createElement('textarea'), { 'aria-labelledby': 'field-name' })
    const titled = appendControl(layer, document.createElement('select'), { title: 'Country' })

    const labelledInput = document.createElement('input')
    const inputLabel = document.createElement('label')
    inputLabel.textContent = 'Email'
    inputLabel.append(labelledInput)
    layer.append(inputLabel)

    const labelledTextarea = document.createElement('textarea')
    const textareaLabel = document.createElement('label')
    textareaLabel.textContent = 'Notes'
    textareaLabel.append(labelledTextarea)
    layer.append(textareaLabel)

    const labelledSelect = document.createElement('select')
    const selectLabel = document.createElement('label')
    selectLabel.textContent = 'Language'
    selectLabel.append(labelledSelect)
    layer.append(selectLabel)

    const namedButton = appendControl(layer, document.createElement('button'))
    namedButton.textContent = 'Submit'
    const namedLink = appendControl(layer, document.createElement('a'), { href: '#next' })
    namedLink.textContent = 'Next'
    const unnamedButton = appendControl(layer, document.createElement('button'))

    const semantics = applyPdfPageSemantics(container, labels)

    expect(ariaLabelled.getAttribute('aria-label')).toBe('Account')
    expect(referenced.getAttribute('aria-labelledby')).toBe('field-name')
    expect(titled.getAttribute('title')).toBe('Country')
    for (const control of [labelledInput, labelledTextarea, labelledSelect, namedButton, namedLink]) {
      expect(control.hasAttribute('aria-label')).toBe(false)
    }
    expect(unnamedButton.getAttribute('aria-label')).toBe(labels.annotationControl(9))
    semantics.dispose()
  })

  it('PDF tooltip·structure-tree ARIA·시각 라벨·fieldName 순으로 양식 이름을 보강한다', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => domRect(0, 0, 1000, 1200)
    const textLayer = document.createElement('div')
    textLayer.className = 'inko-text-layer'
    const visibleLabel = document.createElement('span')
    visibleLabel.textContent = 'Visible account label'
    visibleLabel.getBoundingClientRect = () => domRect(20, 310, 150, 20)
    textLayer.append(visibleLabel)

    const layer = document.createElement('div')
    layer.className = 'inko-annotation-layer'

    const tooltipOwner = document.createElement('section')
    tooltipOwner.dataset.annotationId = 'tooltip'
    tooltipOwner.title = 'Reviewer name'
    const tooltipControl = document.createElement('input')
    tooltipControl.name = 'inko.internalField'
    tooltipOwner.append(tooltipControl)

    const taggedOwner = document.createElement('section')
    taggedOwner.dataset.annotationId = 'tagged'
    taggedOwner.setAttribute('aria-labelledby', 'tagged-field-label')
    const taggedControl = document.createElement('input')
    taggedOwner.append(taggedControl)

    const visibleOwner = document.createElement('section')
    visibleOwner.dataset.annotationId = 'visible'
    visibleOwner.getBoundingClientRect = () => domRect(220, 300, 300, 50)
    const visibleControl = document.createElement('input')
    visibleControl.name = 'inko.opaqueField'
    visibleOwner.append(visibleControl)

    const fieldOwner = document.createElement('section')
    fieldOwner.dataset.annotationId = 'field'
    const fieldControl = document.createElement('select')
    fieldControl.name = 'form.reviewDecision'
    fieldOwner.append(fieldControl)

    const unnamedButton = document.createElement('button')
    layer.append(tooltipOwner, taggedOwner, visibleOwner, fieldOwner, unnamedButton)
    container.append(textLayer, layer)
    document.body.append(container)

    const semantics = applyPdfPageSemantics(container, labels)

    expect(tooltipControl.getAttribute('aria-label')).toBe('Reviewer name')
    expect(taggedControl.getAttribute('aria-labelledby')).toBe('tagged-field-label')
    expect(visibleControl.getAttribute('aria-label')).toBe('Visible account label')
    expect(fieldControl.getAttribute('aria-label')).toBe('Review Decision')
    expect(unnamedButton.getAttribute('aria-label')).toBe(labels.annotationControl(5))
    semantics.dispose()
  })

  it('text note trigger를 button으로 노출하고 popup 내용을 이름으로 사용한다', () => {
    const container = document.createElement('div')
    const layer = document.createElement('div')
    layer.className = 'inko-annotation-layer'

    const note = document.createElement('section')
    note.className = 'textAnnotation'
    note.dataset.annotationId = '5R'
    note.tabIndex = 0
    note.setAttribute('aria-haspopup', 'dialog')
    const icon = document.createElement('img')
    icon.setAttribute('data-l10n-args', JSON.stringify({ type: 'Note' }))
    note.append(icon)

    const popup = document.createElement('section')
    popup.className = 'popupAnnotation'
    popup.dataset.annotationId = 'popup_5R'
    const content = document.createElement('p')
    content.className = 'popupContent'
    content.textContent = 'Review note: verify the total'
    popup.append(content)

    layer.append(note, popup)
    container.append(layer)
    document.body.append(container)

    const semantics = applyPdfPageSemantics(container, labels)

    expect(note.getAttribute('role')).toBe('button')
    expect(note.getAttribute('aria-label')).toBe('Review note: verify the total')
    expect(note.getAttribute('aria-haspopup')).toBe('dialog')
    expect(icon.getAttribute('alt')).toBe('')
    expect(icon.getAttribute('role')).toBe('presentation')

    semantics.dispose()
    expect(note.hasAttribute('role')).toBe(false)
    expect(note.hasAttribute('aria-label')).toBe(false)
    expect(note.getAttribute('aria-haspopup')).toBe('dialog')
    expect(icon.hasAttribute('alt')).toBe(false)
    expect(icon.hasAttribute('role')).toBe(false)
  })

  it('초기 note 타입 fallback을 text layer의 시각 라벨이 준비되면 승격한다', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => domRect(0, 0, 1000, 1200)
    const textLayer = document.createElement('div')
    textLayer.className = 'inko-text-layer'
    const visibleLabel = document.createElement('span')
    visibleLabel.textContent = 'Open reviewer note'
    let textReady = false
    visibleLabel.getBoundingClientRect = () => textReady
      ? domRect(20, 210, 170, 20)
      : domRect(0, 0, 0, 0)
    textLayer.append(visibleLabel)

    const layer = document.createElement('div')
    layer.className = 'inko-annotation-layer'
    const note = document.createElement('section')
    note.className = 'textAnnotation'
    note.dataset.annotationId = '8R'
    note.tabIndex = 0
    note.getBoundingClientRect = () => domRect(230, 200, 40, 40)
    const icon = document.createElement('img')
    icon.setAttribute('data-l10n-args', JSON.stringify({ type: 'Note' }))
    note.append(icon)
    layer.append(note)
    container.append(textLayer, layer)
    document.body.append(container)

    const semantics = applyPdfPageSemantics(container, labels)
    expect(note.getAttribute('aria-label')).toBe('Note')

    textReady = true
    semantics.markReady()
    expect(note.getAttribute('aria-label')).toBe('Open reviewer note')
    semantics.dispose()
  })

  it('dispose 시 SDK가 덮어쓴 기존 semantic 속성을 정확히 복원한다', () => {
    const container = document.createElement('div')
    container.setAttribute('role', 'article')
    container.setAttribute('aria-label', 'Original page')
    container.setAttribute('aria-busy', 'mixed')
    container.setAttribute('tabindex', '0')

    const textLayer = document.createElement('div')
    textLayer.className = 'inko-text-layer'
    textLayer.setAttribute('role', 'region')
    textLayer.setAttribute('aria-label', 'Original text')
    const layer = document.createElement('div')
    layer.className = 'inko-annotation-layer'
    layer.setAttribute('role', 'form')
    layer.setAttribute('aria-label', 'Original form')
    const control = document.createElement('input')
    control.required = true
    control.setAttribute('aria-label', 'Original control')
    control.setAttribute('aria-required', 'false')
    layer.append(control)
    container.append(textLayer, layer)
    document.body.append(container)

    const semantics = applyPdfPageSemantics(container, labels)
    expect(control.getAttribute('aria-required')).toBe('true')
    semantics.dispose()

    expect(container.getAttribute('role')).toBe('article')
    expect(container.getAttribute('aria-label')).toBe('Original page')
    expect(container.getAttribute('aria-busy')).toBe('mixed')
    expect(container.getAttribute('tabindex')).toBe('0')
    expect(textLayer.getAttribute('role')).toBe('region')
    expect(textLayer.getAttribute('aria-label')).toBe('Original text')
    expect(layer.getAttribute('role')).toBe('form')
    expect(layer.getAttribute('aria-label')).toBe('Original form')
    expect(control.getAttribute('aria-label')).toBe('Original control')
    expect(control.getAttribute('aria-required')).toBe('false')
  })

  it('늦게 추가된 PDF.js DOM을 관찰하고 dispose 시 포커스를 페이지 경계로 보존한다', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const semantics = applyPdfPageSemantics(container, labels)

    const layer = document.createElement('div')
    layer.className = 'inko-annotation-layer'
    const control = document.createElement('textarea')
    layer.append(control)
    container.append(layer)
    await flushMutations()

    expect(layer.getAttribute('role')).toBe('group')
    expect(control.getAttribute('aria-label')).toBe(labels.annotationControl(1))
    control.focus()
    expect(document.activeElement).toBe(control)

    semantics.dispose()
    expect(document.activeElement).toBe(container)
    expect(container.hasAttribute('role')).toBe(false)
    expect(container.hasAttribute('aria-label')).toBe(false)
    expect(container.hasAttribute('aria-busy')).toBe(false)
    expect(container.hasAttribute('tabindex')).toBe(false)
    expect(layer.hasAttribute('role')).toBe(false)
    expect(layer.hasAttribute('aria-label')).toBe(false)
    expect(control.hasAttribute('aria-label')).toBe(false)

    const lateTextLayer = document.createElement('div')
    lateTextLayer.className = 'inko-text-layer'
    container.append(lateTextLayer)
    await flushMutations()
    expect(lateTextLayer.hasAttribute('role')).toBe(false)
  })

  it('페이지 내부에 포커스가 없으면 dispose가 현재 외부 포커스를 바꾸지 않는다', () => {
    const external = document.createElement('button')
    const container = document.createElement('div')
    document.body.append(external, container)
    external.focus()
    const semantics = applyPdfPageSemantics(container, labels)

    semantics.dispose()

    expect(document.activeElement).toBe(external)
  })
})
