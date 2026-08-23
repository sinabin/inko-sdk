import { describe, expect, it, vi } from 'vitest'
import { createPageCanvasManager } from '../../src/lib/canvas/pageCanvasManager.svelte'

describe('PageCanvasManager 공개 변경 알림 계약', () => {
  it('clear는 현재 캔버스를 비우고 onCanvasChange를 한 번 호출', () => {
    const onCanvasChange = vi.fn()
    const manager = createPageCanvasManager({ onCanvasChange, pageNum: 1 })
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    manager.init(canvas, 612, 792, 1)

    const scope = manager.paperCanvas?.scope
    if (!scope) throw new Error('PaperScope 초기화 실패')
    scope.activate()
    new scope.Path({
      segments: [[10, 10], [20, 20]],
      strokeColor: 'black'
    })

    manager.clear()

    expect(onCanvasChange).toHaveBeenCalledTimes(1)
    expect(manager.paperCanvas?.getDrawnItems()).toHaveLength(0)
    manager.dispose()
  })
})
