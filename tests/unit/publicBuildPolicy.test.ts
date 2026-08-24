import { describe, expect, it } from 'vitest'
import { createPublicPackageBuildEnv } from '../../scripts/release/public-build-policy.mjs'

describe('public package build environment', () => {
  it('배포 전용 origin이 있으면 공개 패키지 빌드를 거부한다', () => {
    expect(() => createPublicPackageBuildEnv({
      VITE_ALLOWED_ORIGINS: 'https://private.example.com'
    })).toThrow(/VITE_ALLOWED_ORIGINS must be empty/)
  })

  it('공개 플래그·빈 origin을 강제하고 E2E standalone fixture는 제거한다', () => {
    expect(createPublicPackageBuildEnv({ CI: 'true', VITE_STANDALONE_DEMO: 'true' })).toMatchObject({
      CI: 'true',
      INKO_PUBLIC_RELEASE: 'true',
      VITE_ALLOWED_ORIGINS: '',
      VITE_STANDALONE_DEMO: ''
    })
  })
})
