/**
 * 경량 i18n — 빌드 의존성 없는 자체 구현 (Svelte 5 runes).
 *
 * - 내장 언어: 한국어(ko, 기본·fallback) / 영어(en)
 * - 고객 확장: setMessages(override)로 임의 언어·문구 덮어쓰기
 * - 적용 경로: SDK mount 옵션 locale/messages → applyConfig 메시지 → PdfViewer가 setLocale/setMessages 호출
 *
 * 컴포넌트에서 `{t('tool.pen')}`처럼 사용하면 locale/override 변경 시 자동 재렌더(runes 반응성).
 */
import { ko } from './messages.ko'
import { en } from './messages.en'

type Dict = Record<string, string>

const BUILTIN: Record<string, Dict> = { ko, en }

// 현재 로케일·오버라이드 — 모듈 레벨 $state (컴포넌트 t() 호출 시 의존성 추적됨)
let locale = $state<string>('ko')
let overrides = $state<Dict>({})

function syncDocumentLanguage(value: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value
  }
}

syncDocumentLanguage('ko')

/** 로케일 설정 — 내장(ko/en) 또는 messages로 제공된 커스텀 언어 코드 */
export function setLocale(l: string | undefined | null): void {
  if (typeof l !== 'string') return
  const nextLocale = l.trim()
  if (!nextLocale) return

  locale = nextLocale
  syncDocumentLanguage(nextLocale)
}

/** 고객 제공 문구 병합 — 키별 덮어쓰기 (커스텀 언어/문구 커스터마이징) */
export function setMessages(m: Dict | undefined | null): void {
  if (m && typeof m === 'object') overrides = { ...overrides, ...m }
}

export function currentLocale(): string {
  return locale
}

/**
 * 번역 조회 — 우선순위: 고객 override > 현재 로케일 > 한국어 기본 > 키 원문.
 * @param key  i18n 키 (예: 'tool.pen')
 * @param params  {name} 등 자리표시자 치환값
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = BUILTIN[locale] ?? BUILTIN.ko
  let s = overrides[key] ?? dict[key] ?? BUILTIN.ko[key] ?? key
  if (params) {
    for (const p in params) {
      s = s.split('{' + p + '}').join(String(params[p]))
    }
  }
  return s
}
