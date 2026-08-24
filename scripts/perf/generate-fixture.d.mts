export const FIXTURE_VERSION: string
export const FIXTURE_PAGE_COUNT: number
export const FIXTURE_IMAGE_VARIANTS: number
export const DEFAULT_OUTPUT: string

export interface FixtureInspection {
  pages: number
  bytes: number
  sha256: string
  pageSizeSignatures: string[]
  rotations: number[]
}

export function generatePerformanceFixture(): Promise<Buffer>
export function sha256(bytes: Uint8Array): string
export function inspectFixture(bytes: Uint8Array): Promise<FixtureInspection>
export function verifyFixture(
  bytes: Uint8Array,
  manifestPath: string
): Promise<{
  ok: boolean
  actual: FixtureInspection
  expected: FixtureInspection
}>
