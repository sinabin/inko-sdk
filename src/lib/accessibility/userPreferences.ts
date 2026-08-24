/** 사용자의 모션 축소 설정에 맞춰 트랜지션 시간 반환 */
export function motionDuration(durationMs: number): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return durationMs
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : durationMs
}
