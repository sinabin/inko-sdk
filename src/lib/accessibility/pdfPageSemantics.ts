export interface PdfPageSemanticLabels {
  pageRegion: string
  pageText: string
  pageAnnotations: string
  annotationControl: (index: number) => string
  editableCanvas: string
  reviewCanvas: string
}

function hasAccessibleName(element: HTMLElement): boolean {
  if (element.getAttribute('aria-label')?.trim()) return true
  if (element.getAttribute('aria-labelledby')?.trim()) return true
  if (element.getAttribute('title')?.trim()) return true
  if (element instanceof HTMLInputElement && element.labels && element.labels.length > 0) return true
  if (element instanceof HTMLTextAreaElement && element.labels && element.labels.length > 0) return true
  if (element instanceof HTMLSelectElement && element.labels && element.labels.length > 0) return true
  return element.matches('button, a[href]') && Boolean(element.textContent?.trim())
}

function normalizedText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized || null
}

function annotationOwner(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>('[data-annotation-id]') ?? element
}

function inheritedAnnotationName(
  element: HTMLElement
): { attribute: 'aria-label' | 'aria-labelledby'; value: string } | null {
  const owner = annotationOwner(element)
  if (owner === element) return null

  const labelledBy = normalizedText(owner.getAttribute('aria-labelledby'))
  if (labelledBy) return { attribute: 'aria-labelledby', value: labelledBy }

  const ariaLabel = normalizedText(owner.getAttribute('aria-label'))
  if (ariaLabel) return { attribute: 'aria-label', value: ariaLabel }

  const tooltip = [
    owner.getAttribute('title'),
    owner.getAttribute('data-tooltip'),
    owner.getAttribute('data-alternative-text'),
    element.getAttribute('data-tooltip'),
    element.getAttribute('data-alternative-text')
  ].map(normalizedText).find(Boolean)
  return tooltip ? { attribute: 'aria-label', value: tooltip } : null
}

function rectIsUsable(rect: DOMRect): boolean {
  return Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && rect.width > 0
    && rect.height > 0
}

/**
 * AcroForm의 시각 라벨은 text layer에, HTML 입력은 annotation layer에 있어
 * 일반적인 `<label for>` 관계가 존재하지 않는다. 같은 행의 좌·우 텍스트를
 * 우선하고, 없을 때 바로 위 텍스트를 보수적으로 선택한다.
 */
function nearbyVisibleLabel(container: HTMLElement, element: HTMLElement): string | null {
  const textLayer = container.querySelector<HTMLElement>('.inko-text-layer')
  if (!textLayer) return null

  const targetRect = annotationOwner(element).getBoundingClientRect()
  if (!rectIsUsable(targetRect)) return null

  const pageRect = container.getBoundingClientRect()
  const horizontalLimit = Math.max(160, rectIsUsable(pageRect) ? pageRect.width * 0.35 : 320)
  const verticalLimit = Math.max(48, targetRect.height * 2)
  let best: { score: number; text: string } | null = null

  for (const candidate of textLayer.querySelectorAll<HTMLElement>('span')) {
    if (candidate.getAttribute('aria-hidden') === 'true') continue
    const text = normalizedText(candidate.textContent)
    if (!text || text.length > 120) continue

    const rect = candidate.getBoundingClientRect()
    if (!rectIsUsable(rect)) continue

    const overlapY = Math.min(targetRect.bottom, rect.bottom) - Math.max(targetRect.top, rect.top)
    const sameRow = overlapY >= Math.min(targetRect.height, rect.height) * 0.35
    const centerDelta = Math.abs(
      (targetRect.top + targetRect.bottom) / 2 - (rect.top + rect.bottom) / 2
    )
    let score: number | null = null

    if (sameRow && rect.right <= targetRect.left + 2) {
      const gap = Math.max(0, targetRect.left - rect.right)
      if (gap <= horizontalLimit) score = gap + centerDelta * 0.25
    } else if (sameRow && rect.left >= targetRect.right - 2) {
      const gap = Math.max(0, rect.left - targetRect.right)
      if (gap <= horizontalLimit) score = 20 + gap + centerDelta * 0.25
    } else {
      const gap = targetRect.top - rect.bottom
      const overlapX = Math.min(targetRect.right, rect.right) - Math.max(targetRect.left, rect.left)
      if (
        gap >= -2
        && gap <= verticalLimit
        && overlapX >= Math.min(targetRect.width, rect.width) * 0.2
      ) {
        score = 500 + Math.max(0, gap)
      }
    }

    if (score !== null && (!best || score < best.score)) best = { score, text }
  }

  return best?.text ?? null
}

function humanizeFieldName(element: HTMLElement): string | null {
  const rawName = normalizedText(element.getAttribute('name') || element.getAttribute('data-field-name'))
  if (!rawName) return null

  const leaf = rawName
    .replace(/\[\d+\]/g, '')
    .split(/[./:]/)
    .filter(Boolean)
    .at(-1)
  const text = normalizedText(
    leaf
      ?.replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
  )
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null
}

function textNoteName(
  annotationLayer: HTMLElement,
  note: HTMLElement
): { value: string; priority: number } | null {
  const annotationId = normalizedText(note.getAttribute('data-annotation-id'))
  if (annotationId) {
    const popup = Array.from(
      annotationLayer.querySelectorAll<HTMLElement>('.popupAnnotation[data-annotation-id]')
    ).find(candidate => candidate.dataset.annotationId === `popup_${annotationId}`)
    const popupText = normalizedText(popup?.querySelector<HTMLElement>('.popupContent')?.textContent)
    if (popupText) return { value: popupText, priority: 3 }
  }

  const image = note.querySelector<HTMLImageElement>('img')
  const imageName = normalizedText(image?.alt || image?.title)
  if (imageName) return { value: imageName, priority: 5 }

  const l10nArgs = image?.getAttribute('data-l10n-args')
  if (l10nArgs) {
    try {
      const type = normalizedText((JSON.parse(l10nArgs) as { type?: string }).type)
      if (type) return { value: type, priority: 5 }
    } catch {
      // 손상된 PDF.js localization metadata는 다음 fallback으로 처리한다.
    }
  }
  return null
}

/** PDF.js가 생성한 페이지 DOM과 canvas에 안정적인 페이지 경계·대체 이름 부여 */
export function applyPdfPageSemantics(
  container: HTMLElement,
  labels: PdfPageSemanticLabels
): { markReady(): void; dispose(): void } {
  const attributeSnapshots = new Map<HTMLElement, Map<string, string | null>>()
  const generatedNames = new Map<HTMLElement, {
    attribute: 'aria-label' | 'aria-labelledby'
    value: string
    priority: number
  }>()
  let disposed = false

  function setOwnedAttribute(element: HTMLElement, name: string, value: string): void {
    let snapshot = attributeSnapshots.get(element)
    if (!snapshot) {
      snapshot = new Map()
      attributeSnapshots.set(element, snapshot)
    }
    if (!snapshot.has(name)) snapshot.set(name, element.getAttribute(name))
    element.setAttribute(name, value)
  }

  function removeOwnedAttribute(element: HTMLElement, name: string): void {
    let snapshot = attributeSnapshots.get(element)
    if (!snapshot) {
      snapshot = new Map()
      attributeSnapshots.set(element, snapshot)
    }
    if (!snapshot.has(name)) snapshot.set(name, element.getAttribute(name))
    element.removeAttribute(name)
  }

  function restoreOwnedAttributes(): void {
    for (const [element, snapshot] of attributeSnapshots) {
      for (const [name, value] of snapshot) {
        if (value === null) element.removeAttribute(name)
        else element.setAttribute(name, value)
      }
    }
    attributeSnapshots.clear()
    generatedNames.clear()
  }

  setOwnedAttribute(container, 'role', 'region')
  setOwnedAttribute(container, 'aria-label', labels.pageRegion)
  setOwnedAttribute(container, 'aria-busy', 'true')
  setOwnedAttribute(container, 'tabindex', '-1')

  function enhance(): void {
    if (disposed) return
    const pdfCanvas = container.querySelector<HTMLElement>('.scroll-page-canvas-pdf')
    if (pdfCanvas) {
      setOwnedAttribute(pdfCanvas, 'role', 'presentation')
    }

    const textLayer = container.querySelector<HTMLElement>('.inko-text-layer')
    if (textLayer) {
      setOwnedAttribute(textLayer, 'role', 'document')
      setOwnedAttribute(textLayer, 'aria-label', labels.pageText)
    }

    const annotationLayer = container.querySelector<HTMLElement>('.inko-annotation-layer')
    if (annotationLayer) {
      setOwnedAttribute(annotationLayer, 'role', 'group')
      setOwnedAttribute(annotationLayer, 'aria-label', labels.pageAnnotations)
      const controls = annotationLayer.querySelectorAll<HTMLElement>(
        'input, textarea, select, button, a[href], .textAnnotation[tabindex]'
      )
      controls.forEach((control, index) => {
        const isTextNote = control.matches('.textAnnotation[tabindex]')
        if (isTextNote && !control.hasAttribute('role')) {
          setOwnedAttribute(control, 'role', 'button')
        }
        const previousGeneratedName = generatedNames.get(control)
        const generatedNameStillOwned = previousGeneratedName
          && control.getAttribute(previousGeneratedName.attribute) === previousGeneratedName.value
        if (previousGeneratedName && !generatedNameStillOwned) generatedNames.delete(control)

        if (!hasAccessibleName(control) || generatedNameStillOwned) {
          const inheritedName = inheritedAnnotationName(control)
          const nearbyLabel = nearbyVisibleLabel(container, control)
          const noteName = isTextNote ? textNoteName(annotationLayer, control) : null
          const fieldName = humanizeFieldName(control)
          const nextName = inheritedName
            ? { ...inheritedName, priority: 1 }
            : nearbyLabel
              ? { attribute: 'aria-label' as const, value: nearbyLabel, priority: 2 }
              : noteName
                ? { attribute: 'aria-label' as const, ...noteName }
                : fieldName
                  ? { attribute: 'aria-label' as const, value: fieldName, priority: 4 }
                  : {
                      attribute: 'aria-label' as const,
                      value: labels.annotationControl(index + 1),
                      priority: 6
                    }

          if (
            !previousGeneratedName
            || nextName.priority < previousGeneratedName.priority
            || (
              nextName.priority === previousGeneratedName.priority
              && nextName.value !== previousGeneratedName.value
            )
          ) {
            if (previousGeneratedName && previousGeneratedName.attribute !== nextName.attribute) {
              removeOwnedAttribute(control, previousGeneratedName.attribute)
            }
            setOwnedAttribute(control, nextName.attribute, nextName.value)
            generatedNames.set(control, nextName)
          }
        }
        if (isTextNote) {
          const icon = control.querySelector<HTMLImageElement>('img')
          if (icon) {
            // 이름은 상위 button이 제공하므로 PDF.js note glyph는 중복 낭독하지 않는다.
            setOwnedAttribute(icon, 'alt', '')
            setOwnedAttribute(icon, 'role', 'presentation')
          }
        }
        if (
          (control instanceof HTMLInputElement
            || control instanceof HTMLTextAreaElement
            || control instanceof HTMLSelectElement)
          && control.required
        ) {
          setOwnedAttribute(control, 'aria-required', 'true')
        }
      })
    }

    container.querySelectorAll<HTMLElement>('.scroll-page-canvas-paper').forEach(canvas => {
      setOwnedAttribute(canvas, 'role', 'img')
      setOwnedAttribute(canvas, 'aria-label', labels.editableCanvas)
    })
    container.querySelectorAll<HTMLElement>('.scroll-page-overlay-container canvas').forEach(canvas => {
      setOwnedAttribute(canvas, 'role', 'img')
      setOwnedAttribute(canvas, 'aria-label', labels.reviewCanvas)
    })
  }

  const observer = new MutationObserver(enhance)
  observer.observe(container, { childList: true, subtree: true })
  enhance()

  return {
    markReady() {
      if (disposed) return
      enhance()
      setOwnedAttribute(container, 'aria-busy', 'false')
    },
    dispose() {
      if (disposed) return
      disposed = true
      observer.disconnect()
      if (container.contains(document.activeElement)) container.focus()
      restoreOwnedAttributes()
    }
  }
}
