import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const FIXTURE_VERSION = 'inko-perf-v1'
export const FIXTURE_PAGE_COUNT = 120
export const DEFAULT_OUTPUT = resolve(tmpdir(), `${FIXTURE_VERSION}-120p.pdf`)

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z')
// Viewer placeholder와 같은 고정 Letter 크기. 120개 DOM 요소가 처음부터
// 최종 높이를 갖고 배치되어 초기 IntersectionObserver 계측이 결정적이다.
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792

/**
 * 120p 성능 fixture를 외부 파일·난수·현재 시각 없이 생성한다.
 * 각 페이지의 텍스트·벡터 도형 부하는 같고 페이지 번호만 다르다.
 */
export async function generatePerformanceFixture() {
  const pdf = await PDFDocument.create({ updateMetadata: false })
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  pdf.setTitle('Inko deterministic 120-page performance fixture')
  pdf.setAuthor('NextH')
  pdf.setSubject('Inko rendering, scrolling and memory regression fixture')
  pdf.setKeywords(['Inko', 'performance', 'deterministic', '120-pages'])
  pdf.setProducer('Inko performance harness')
  pdf.setCreator('Inko performance harness')
  pdf.setCreationDate(FIXED_DATE)
  pdf.setModificationDate(FIXED_DATE)

  for (let pageNumber = 1; pageNumber <= FIXTURE_PAGE_COUNT; pageNumber++) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const hue = (pageNumber % 12) / 12

    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 88,
      width: PAGE_WIDTH,
      height: 88,
      color: rgb(0.051, 0.106, 0.243)
    })
    page.drawText('INKO PERFORMANCE FIXTURE', {
      x: 40,
      y: PAGE_HEIGHT - 49,
      size: 18,
      font: bold,
      color: rgb(1, 1, 1)
    })
    page.drawText(`PAGE ${String(pageNumber).padStart(3, '0')} / ${FIXTURE_PAGE_COUNT}`, {
      x: 430,
      y: PAGE_HEIGHT - 47,
      size: 10,
      font: regular,
      color: rgb(0.91, 0.63, 0.27)
    })

    for (let row = 0; row < 34; row++) {
      const y = PAGE_HEIGHT - 118 - row * 18
      page.drawText(
        `${String(row + 1).padStart(2, '0')}  Deterministic text row for rendering and fast-scroll measurement.`,
        { x: 44, y, size: 8.5, font: regular, color: rgb(0.12, 0.15, 0.2) }
      )
      page.drawLine({
        start: { x: 42, y: y - 5 },
        end: { x: 553, y: y - 5 },
        thickness: row % 4 === 0 ? 0.7 : 0.25,
        color: rgb(0.78, 0.81, 0.86)
      })
    }

    for (let column = 0; column < 10; column++) {
      const x = 44 + column * 51
      const barHeight = 24 + ((pageNumber * 17 + column * 23) % 74)
      page.drawRectangle({
        x,
        y: 62,
        width: 34,
        height: barHeight,
        color: rgb(0.18 + hue * 0.18, 0.42 + column * 0.012, 0.62 - hue * 0.16),
        opacity: 0.82
      })
      page.drawText(String((pageNumber * (column + 3)) % 997), {
        x: x + 2,
        y: 48,
        size: 6,
        font: regular,
        color: rgb(0.22, 0.25, 0.3)
      })
    }

    page.drawText(`fixture=${FIXTURE_VERSION} page=${pageNumber} objects=uniform`, {
      x: 40,
      y: 24,
      size: 7,
      font: regular,
      color: rgb(0.35, 0.38, 0.43)
    })
  }

  const bytes = await pdf.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
    objectsPerTick: 1_000
  })
  return Buffer.from(bytes)
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function inspectFixture(bytes) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  return {
    pages: pdf.getPageCount(),
    bytes: bytes.byteLength,
    sha256: sha256(bytes)
  }
}

export async function verifyFixture(bytes, manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const actual = await inspectFixture(bytes)
  const expected = {
    pages: manifest.pages,
    bytes: manifest.bytes,
    sha256: manifest.sha256
  }
  return {
    ok: actual.pages === expected.pages &&
      actual.bytes === expected.bytes &&
      actual.sha256 === expected.sha256,
    actual,
    expected
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const outputPath = resolve(argumentValue('--output') ?? DEFAULT_OUTPUT)
  const manifestPath = resolve(
    argumentValue('--manifest') ?? resolve(scriptDir, '../../tests/perf/fixture-manifest.json')
  )
  const bytes = await generatePerformanceFixture()
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, bytes)

  const result = process.argv.includes('--verify')
    ? await verifyFixture(bytes, manifestPath)
    : { ok: true, actual: await inspectFixture(bytes) }

  console.log(JSON.stringify({ fixture: outputPath, ...result }, null, 2))
  if (!result.ok) process.exitCode = 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
