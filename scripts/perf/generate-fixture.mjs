import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { degrees, PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const FIXTURE_VERSION = 'inko-perf-v2'
export const FIXTURE_PAGE_COUNT = 120
export const FIXTURE_IMAGE_VARIANTS = 3
export const DEFAULT_OUTPUT = resolve(tmpdir(), `${FIXTURE_VERSION}-120p.pdf`)

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z')
const PAGE_PROFILES = [
  { name: 'letter-portrait', width: 612, height: 792, rotation: 0 },
  { name: 'a4-portrait', width: 595.28, height: 841.89, rotation: 0 },
  { name: 'letter-landscape', width: 792, height: 612, rotation: 0 },
  { name: 'letter-rotated-90', width: 612, height: 792, rotation: 90 },
  { name: 'square-rotated-180', width: 720, height: 720, rotation: 180 },
  { name: 'a4-rotated-270', width: 595.28, height: 841.89, rotation: 270 }
]

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBytes, data])
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  payload.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(payload), 8 + data.length)
  return chunk
}

/** 외부 자산 없이 생성하는 결정적 RGB PNG. 각 variant는 서로 다른 픽셀 패턴을 갖는다. */
function createSyntheticPng(variant) {
  const width = 192
  const height = 128
  const stride = 1 + width * 3
  const scanlines = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    const row = y * stride
    scanlines[row] = 0
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 3
      const checker = ((x >> 4) + (y >> 4) + variant) % 2
      scanlines[offset] = (x * (variant + 3) + y * 2 + checker * 47) % 256
      scanlines[offset + 1] = (y * (variant + 5) + x + checker * 83) % 256
      scanlines[offset + 2] = ((x ^ y) * (variant + 1) + checker * 29) % 256
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function roundedDimension(value) {
  return Math.round(value * 100) / 100
}

function pageSizeSignature(width, height) {
  return `${roundedDimension(width)}x${roundedDimension(height)}`
}

/**
 * 120p 성능 fixture를 외부 파일·난수·현재 시각 없이 생성한다.
 * 혼합 page size/rotation, 표준 폰트 3종, 합성 raster image 3종을 반복해
 * 텍스트·벡터만 있는 단일 Letter 문서보다 실제 렌더 경로를 넓게 자극한다.
 */
export async function generatePerformanceFixture() {
  const pdf = await PDFDocument.create({ updateMetadata: false })
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono = await pdf.embedFont(StandardFonts.Courier)
  const images = await Promise.all(
    Array.from({ length: FIXTURE_IMAGE_VARIANTS }, (_, variant) => (
      pdf.embedPng(createSyntheticPng(variant))
    ))
  )

  pdf.setTitle('Inko deterministic mixed 120-page performance fixture')
  pdf.setAuthor('NextH')
  pdf.setSubject('Inko rendering, scrolling and memory regression fixture')
  pdf.setKeywords(['Inko', 'performance', 'deterministic', 'mixed-pages', '120-pages'])
  pdf.setProducer('Inko performance harness')
  pdf.setCreator('Inko performance harness')
  pdf.setCreationDate(FIXED_DATE)
  pdf.setModificationDate(FIXED_DATE)

  for (let pageNumber = 1; pageNumber <= FIXTURE_PAGE_COUNT; pageNumber++) {
    const profile = PAGE_PROFILES[(pageNumber - 1) % PAGE_PROFILES.length]
    const page = pdf.addPage([profile.width, profile.height])
    page.setRotation(degrees(profile.rotation))
    const image = images[(pageNumber - 1) % images.length]
    const hue = (pageNumber % 12) / 12
    const contentWidth = profile.width - 80

    page.drawRectangle({
      x: 0,
      y: profile.height - 88,
      width: profile.width,
      height: 88,
      color: rgb(0.051, 0.106, 0.243)
    })
    page.drawText('INKO MIXED PERFORMANCE FIXTURE', {
      x: 40,
      y: profile.height - 49,
      size: 16,
      font: bold,
      color: rgb(1, 1, 1)
    })
    page.drawText(`PAGE ${String(pageNumber).padStart(3, '0')} / ${FIXTURE_PAGE_COUNT}`, {
      x: Math.max(40, profile.width - 178),
      y: profile.height - 69,
      size: 9,
      font: mono,
      color: rgb(0.91, 0.63, 0.27)
    })

    const imageWidth = Math.min(176, contentWidth * 0.34)
    const imageHeight = imageWidth * (128 / 192)
    page.drawImage(image, {
      x: profile.width - imageWidth - 40,
      y: profile.height - imageHeight - 114,
      width: imageWidth,
      height: imageHeight,
      opacity: 0.92
    })

    const rowCount = Math.max(18, Math.floor((profile.height - 270) / 17))
    const textWidth = Math.max(210, contentWidth - imageWidth - 18)
    for (let row = 0; row < rowCount; row++) {
      const y = profile.height - 118 - row * 17
      const line = `${String(row + 1).padStart(2, '0')} deterministic mixed text / page ${String(pageNumber).padStart(3, '0')}`
      page.drawText(line, {
        x: 40,
        y,
        size: 8,
        font: row % 5 === 0 ? mono : regular,
        color: rgb(0.12, 0.15, 0.2),
        maxWidth: textWidth
      })
      page.drawLine({
        start: { x: 38, y: y - 5 },
        end: { x: Math.min(profile.width - 40, 38 + contentWidth), y: y - 5 },
        thickness: row % 4 === 0 ? 0.7 : 0.25,
        color: rgb(0.78, 0.81, 0.86),
        opacity: row % 3 === 0 ? 0.7 : 1
      })
    }

    const chartWidth = Math.min(contentWidth, 510)
    const barGap = chartWidth / 10
    for (let column = 0; column < 10; column++) {
      const x = 40 + column * barGap
      const barHeight = 20 + ((pageNumber * 17 + column * 23) % 68)
      page.drawRectangle({
        x,
        y: 60,
        width: Math.max(16, barGap - 14),
        height: barHeight,
        color: rgb(0.18 + hue * 0.18, 0.42 + column * 0.012, 0.62 - hue * 0.16),
        opacity: 0.82
      })
      page.drawText(String((pageNumber * (column + 3)) % 997), {
        x: x + 2,
        y: 47,
        size: 6,
        font: mono,
        color: rgb(0.22, 0.25, 0.3)
      })
    }

    page.drawText(
      `fixture=${FIXTURE_VERSION} profile=${profile.name} rotation=${profile.rotation}`,
      {
        x: 40,
        y: 22,
        size: 7,
        font: mono,
        color: rgb(0.35, 0.38, 0.43)
      }
    )
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
  const pages = pdf.getPages()
  const pageSizeSignatures = [...new Set(
    pages.map((page) => {
      const { width, height } = page.getSize()
      return pageSizeSignature(width, height)
    })
  )].sort()
  const rotations = [...new Set(pages.map((page) => page.getRotation().angle))].sort((a, b) => a - b)
  return {
    pages: pages.length,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    pageSizeSignatures,
    rotations
  }
}

export async function verifyFixture(bytes, manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const actual = await inspectFixture(bytes)
  const expected = {
    pages: manifest.pages,
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    pageSizeSignatures: manifest.pageSizeSignatures,
    rotations: manifest.rotations
  }
  return {
    ok: JSON.stringify(actual) === JSON.stringify(expected),
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
