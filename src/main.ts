import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { reportError } from './lib/utils/errorReporter.svelte'

// 미포착 동기 예외 — 사용자에게 토스트로 노출 + 콘솔 기록
window.addEventListener('error', (event) => {
  // 외부 리소스(이미지·스크립트) 로드 실패는 message 없는 ErrorEvent로 옴 → 별도 처리
  const cause = event.error ?? event.message ?? 'Unknown error'
  reportError('unknown', '예상치 못한 오류가 발생했습니다', cause)
})

// 미포착 Promise rejection
window.addEventListener('unhandledrejection', (event) => {
  reportError('unknown', '비동기 작업이 실패했습니다', event.reason)
})

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
