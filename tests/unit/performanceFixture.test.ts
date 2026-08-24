// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_PAGE_COUNT,
  FIXTURE_VERSION,
  generatePerformanceFixture,
  inspectFixture
} from '../../scripts/perf/generate-fixture.mjs'

interface FixtureManifest {
  version: string
  pages: number
  bytes: number
  sha256: string
}

describe('120p 성능 fixture 계약', () => {
  it('페이지 수·바이트 수·SHA-256이 manifest와 일치하고 재생성해도 같다', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(process.cwd(), 'tests/perf/fixture-manifest.json'), 'utf8')
    ) as FixtureManifest

    const first = await generatePerformanceFixture()
    const second = await generatePerformanceFixture()
    const firstInfo = await inspectFixture(first)
    const secondInfo = await inspectFixture(second)

    expect(FIXTURE_VERSION).toBe(manifest.version)
    expect(FIXTURE_PAGE_COUNT).toBe(manifest.pages)
    expect(firstInfo).toEqual({
      pages: manifest.pages,
      bytes: manifest.bytes,
      sha256: manifest.sha256
    })
    expect(secondInfo).toEqual(firstInfo)
    expect(second.equals(first)).toBe(true)
  }, 15_000)
})
