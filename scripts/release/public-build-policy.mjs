/** 공개 npm 패키지 빌드 환경을 fail-closed로 고정 */
export function createPublicPackageBuildEnv(sourceEnv = process.env) {
  if ((sourceEnv.VITE_ALLOWED_ORIGINS ?? '').trim()) {
    throw new Error(
      'Public package build refused: VITE_ALLOWED_ORIGINS must be empty. Build deployment-specific origins outside build:pkg.'
    )
  }

  return {
    ...sourceEnv,
    INKO_PUBLIC_RELEASE: 'true',
    VITE_ALLOWED_ORIGINS: '',
    // production E2E 전용 standalone fixture가 공개 viewer에 굽지 않도록 강제로 제거한다.
    VITE_STANDALONE_DEMO: ''
  }
}
