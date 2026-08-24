import { describe, expect, it, vi } from 'vitest'
import type { PdfScrollViewerPort } from '../../src/lib/viewer/viewerPorts'
import { createViewerReviewController } from '../../src/lib/viewer/viewerReviewController.svelte'

const pageJson = JSON.stringify(['Layer', { children: [] }])
const canvasData = JSON.stringify({ 1: pageJson })

function entry(canvasId: string, overrides: Record<string, unknown> = {}) {
  return {
    canvasId,
    userName: canvasId,
    canvasData,
    enabled: false,
    ...overrides
  }
}

function createHarness(overrides: { local?: boolean; readOnly?: boolean } = {}) {
  const loadHistoryCanvasData = vi.fn()
  const viewer = { loadHistoryCanvasData } as unknown as PdfScrollViewerPort
  let localEntries: unknown[] = [entry('v2'), entry('v1')]
  const appendLocalEntry = vi.fn(() => {
    localEntries = [entry('v3'), ...localEntries]
    return { canvasId: 'v3' }
  })
  const onLoadError = vi.fn()
  const controller = createViewerReviewController({
    getScrollViewer: () => viewer,
    getTotalPages: () => 3,
    getFileName: () => 'fixture.pdf',
    getReadOnly: () => overrides.readOnly === true,
    useLocalStorageHistory: overrides.local === true,
    loadLocalEntries: () => localEntries,
    appendLocalEntry,
    onLoadError
  })
  return { controller, loadHistoryCanvasData, appendLocalEntry, onLoadError }
}

describe('viewerReviewController', () => {
  it('공개 isCurrent 버전은 단일 선택, 일반 검토본은 다중 선택을 유지', () => {
    const { controller } = createHarness()
    controller.setPublicEntries([
      entry('v2', { isCurrent: true }),
      entry('v1', { enabled: true })
    ])
    expect(controller.currentEditCanvasId).toBe('v2')
    expect(controller.entries.map((item) => [item.canvasId, item.enabled])).toEqual([
      ['v2', true], ['v1', false]
    ])

    controller.toggleVisibility('v1', true)
    expect(controller.entries.filter((item) => item.enabled).map((item) => item.canvasId)).toEqual(['v1'])

    controller.setPublicEntries([entry('alice', { enabled: true }), entry('bob')])
    controller.toggleVisibility('bob', true)
    expect(controller.entries.every((item) => item.enabled)).toBe(true)
  })

  it('이어서 편집은 codec 검증 후 scroll viewer 전체 상태와 현재 ID를 함께 전환', () => {
    const { controller, loadHistoryCanvasData, onLoadError } = createHarness()
    controller.setPublicEntries([entry('v1')])
    controller.togglePanel()

    expect(controller.continueEditing('v1')).toBe(true)
    expect(loadHistoryCanvasData).toHaveBeenCalledWith({ 1: pageJson })
    expect(controller.currentEditCanvasId).toBe('v1')
    expect(controller.panelVisible).toBe(false)

    controller.setPublicEntries([entry('bad', { canvasData: JSON.stringify({ 9: pageJson }) })])
    expect(controller.continueEditing('bad')).toBe(false)
    expect(onLoadError).toHaveBeenCalledOnce()
  })

  it('live canvas import 실패 시 현재 버전과 열린 패널을 성공 상태로 바꾸지 않음', () => {
    const { controller, loadHistoryCanvasData, onLoadError } = createHarness()
    controller.setPublicEntries([entry('v1')])
    controller.togglePanel()
    loadHistoryCanvasData.mockImplementationOnce(() => {
      throw new Error('Failed to restore canvas data for pages: 1')
    })

    expect(controller.continueEditing('v1')).toBe(false)
    expect(controller.currentEditCanvasId).toBe('')
    expect(controller.panelVisible).toBe(true)
    expect(onLoadError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Failed to restore canvas data for pages: 1'
    }))
  })

  it('standalone 저장·문서별 자동 이어서 편집은 최신 이력 한 번만 적용', () => {
    const { controller, loadHistoryCanvasData, appendLocalEntry } = createHarness({ local: true })
    controller.refreshLocalHistory()
    expect(controller.isVersionHistoryMode).toBe(true)

    const documentIdentity = {}
    expect(controller.continueLatestLocalHistory(documentIdentity)).toBe(true)
    expect(controller.continueLatestLocalHistory(documentIdentity)).toBe(false)
    expect(loadHistoryCanvasData).toHaveBeenCalledTimes(1)
    expect(controller.currentEditCanvasId).toBe('v2')

    expect(controller.recordLocalSave(canvasData)?.canvasId).toBe('v3')
    expect(appendLocalEntry).toHaveBeenCalledWith('fixture.pdf', canvasData)
    expect(controller.currentEditCanvasId).toBe('v3')
  })
})
