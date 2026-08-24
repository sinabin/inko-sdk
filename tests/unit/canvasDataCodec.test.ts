import { describe, expect, it } from 'vitest'
import {
  canvasDataMapToRecord,
  canvasDataRecordToMap,
  extractPageCanvasData,
  parseCanvasDataRecord,
  serializeCanvasDataMap
} from '../../src/lib/canvas/canvasDataCodec'

const pageOne = JSON.stringify(['Layer', {
  children: [['Path', { segments: [[0, 0], [10, 10]] }]]
}])
const pageTwo = JSON.stringify(['Layer', {
  children: [['PointText', { content: 'test' }]]
}])

describe('canvasDataCodec — SDK 문서 편집 상태', () => {
  it('페이지별 Paper.js JSON 문자열을 파싱하고 키를 정규화', () => {
    const parsed = parseCanvasDataRecord(JSON.stringify({ '01': pageOne, '2': pageTwo }), 2)

    expect(parsed).toEqual({ '1': pageOne, '2': pageTwo })
  })

  it('편집 상태 최상위는 배열·null·기본형이 아닌 페이지 객체여야 함', () => {
    expect(() => parseCanvasDataRecord({ 1: pageOne } as unknown as string, 2)).toThrow(TypeError)
    for (const value of [null, [], 'page', 1]) {
      expect(() => parseCanvasDataRecord(JSON.stringify(value), 2)).toThrow(TypeError)
    }
  })

  it('페이지 키는 1이상 문서 범위 내 정수만 허용', () => {
    for (const key of ['0', '-1', '1.5', 'page', '3']) {
      expect(() => parseCanvasDataRecord(JSON.stringify({ [key]: pageOne }), 2)).toThrow(TypeError)
    }
  })

  it('각 페이지 값은 유효한 JSON을 담은 문자열이어야 함', () => {
    expect(() => parseCanvasDataRecord(JSON.stringify({ 1: { children: [] } }), 1)).toThrow(TypeError)
    expect(() => parseCanvasDataRecord(JSON.stringify({ 1: '{broken' }), 1)).toThrow(TypeError)
  })

  it('Map↔Record 왕복과 SDK JSON 직렬화에서 페이지 데이터를 보존', () => {
    const source = new Map([[1, pageOne], [2, pageTwo]])
    const record = canvasDataMapToRecord(source, 2)
    const restored = canvasDataRecordToMap(record, 2)

    expect(record).toEqual({ '1': pageOne, '2': pageTwo })
    expect([...restored.entries()]).toEqual([...source.entries()])
    expect(JSON.parse(serializeCanvasDataMap(source, 2))).toEqual(record)
  })

  it('페이지 레코드에서 overlay용 children만 추출', () => {
    const documentData = JSON.stringify({ '1': pageOne, '2': pageTwo })

    expect(JSON.parse(extractPageCanvasData(documentData, '1')!)).toEqual({
      children: [['Path', { segments: [[0, 0], [10, 10]] }]]
    })
  })

  it('빈 페이지는 null, 손상 데이터는 null, 레거시 단일 페이지 JSON은 원문을 반환', () => {
    const emptyPage = JSON.stringify({ '1': JSON.stringify(['Layer', { children: [] }]) })
    expect(extractPageCanvasData(emptyPage, '1')).toBeNull()
    expect(extractPageCanvasData('{broken', '1')).toBeNull()
    expect(extractPageCanvasData(pageOne, '1')).toBe(pageOne)
  })

  it('페이지 레코드에 요청 페이지가 없으면 전체 문서를 레거시 페이지로 오인하지 않음', () => {
    const documentData = JSON.stringify({ '1': pageOne })

    expect(extractPageCanvasData(documentData, '2')).toBeNull()
    expect(extractPageCanvasData(JSON.stringify({}), '1')).toBeNull()
  })
})
