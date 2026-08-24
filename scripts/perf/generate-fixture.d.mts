export const FIXTURE_VERSION: string
export const FIXTURE_PAGE_COUNT: number
export const DEFAULT_OUTPUT: string

export interface FixtureInspection {
  pages: number
  bytes: number
  sha256: string
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
