import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const assetsRoot = resolve(repositoryRoot, 'apps/desktop/assets')
const evidenceRoot = resolve(repositoryRoot, 'apps/desktop/release')
const require = createRequire(resolve(repositoryRoot, 'packages/attachment/attachment-local/package.json'))
const sharp = require('sharp')

const MASTER_SIZE = 1024
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const TRAY_SIZES = [16, 20, 24, 32]

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function createRoundedBlueField() {
  const buffer = Buffer.alloc(MASTER_SIZE * MASTER_SIZE * 4)
  const center = MASTER_SIZE / 2
  const half = 472
  const radius = 205
  for (let y = 0; y < MASTER_SIZE; y += 1) {
    for (let x = 0; x < MASTER_SIZE; x += 1) {
      const qx = Math.abs(x + 0.5 - center) - (half - radius)
      const qy = Math.abs(y + 0.5 - center) - (half - radius)
      const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
      const alpha = Math.round(clamp(0.5 - distance, 0, 1) * 255)
      const vertical = y / (MASTER_SIZE - 1)
      const radial = clamp(1 - Math.hypot((x - 320) / 900, (y - 235) / 900), 0, 1)
      const red = Math.round(42 + 58 * (1 - vertical) + 18 * radial)
      const green = Math.round(64 + 62 * (1 - vertical) + 19 * radial)
      const blue = Math.round(238 + 17 * (1 - vertical))
      const offset = (y * MASTER_SIZE + x) * 4
      buffer[offset] = red
      buffer[offset + 1] = green
      buffer[offset + 2] = blue
      buffer[offset + 3] = alpha
    }
  }
  return buffer
}

async function extractWhale() {
  const sourcePath = resolve(assetsRoot, 'icon-source.png')
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const seed = 500 * info.width + 600
  const visited = new Uint8Array(info.width * info.height)
  const component = new Uint8Array(info.width * info.height)
  const queue = [seed]
  visited[seed] = 1
  let cursor = 0
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  while (cursor < queue.length) {
    const pixel = queue[cursor]
    cursor += 1
    const x = pixel % info.width
    const y = Math.floor(pixel / info.width)
    const offset = pixel * 4
    const minimumChannel = Math.min(data[offset], data[offset + 1], data[offset + 2])
    if (minimumChannel <= 140 || data[offset + 3] < 16) continue
    component[pixel] = 1
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    for (const neighbor of [pixel - 1, pixel + 1, pixel - info.width, pixel + info.width]) {
      if (neighbor < 0 || neighbor >= visited.length || visited[neighbor] === 1) continue
      if (Math.abs((neighbor % info.width) - x) > 1) continue
      visited[neighbor] = 1
      queue.push(neighbor)
    }
  }
  if (maxX <= minX || maxY <= minY) throw new Error('Windows icon generator could not isolate the whale mark.')
  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const whale = Buffer.alloc(width * height * 4)
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sourcePixel = y * info.width + x
      if (component[sourcePixel] !== 1) continue
      const sourceOffset = sourcePixel * 4
      const targetOffset = ((y - minY) * width + x - minX) * 4
      const minimumChannel = Math.min(data[sourceOffset], data[sourceOffset + 1], data[sourceOffset + 2])
      whale[targetOffset] = 255
      whale[targetOffset + 1] = 255
      whale[targetOffset + 2] = 255
      whale[targetOffset + 3] = Math.round(
        data[sourceOffset + 3] * clamp((minimumChannel - 130) / 30, 0, 1),
      )
    }
  }
  return await sharp(whale, { raw: { width, height, channels: 4 } })
    .resize({ width: 800, height: 586, fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
}

async function renderMaster() {
  const whale = await extractWhale()
  return await sharp(createRoundedBlueField(), {
    raw: { width: MASTER_SIZE, height: MASTER_SIZE, channels: 4 },
  }).composite([{ input: whale, left: 112, top: 219 }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
}

async function renderLayer(master, size) {
  const image = sharp(master).resize(size, size, { kernel: 'lanczos3' })
  if (size <= 32) image.sharpen({ sigma: 0.45 })
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] < 8) data[offset] = 0
  }
  for (const pixel of [0, size - 1, (size - 1) * size, size * size - 1]) {
    data[pixel * 4 + 3] = 0
  }
  return await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
}

function encodeIco(layers) {
  const headerBytes = 6 + layers.length * 16
  const header = Buffer.alloc(headerBytes)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(layers.length, 4)
  let imageOffset = headerBytes
  layers.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header[entry + 2] = 0
    header[entry + 3] = 0
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(imageOffset, entry + 12)
    imageOffset += png.length
  })
  return Buffer.concat([header, ...layers.map(layer => layer.png)])
}

function readIcoLayer(ico, requestedSize) {
  const count = ico.readUInt16LE(4)
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16
    const size = ico[entry] === 0 ? 256 : ico[entry]
    if (size !== requestedSize) continue
    const bytes = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    return ico.subarray(offset, offset + bytes)
  }
  throw new Error(`Existing ICO is missing its ${requestedSize}px layer.`)
}

async function renderEvidence(oldIco, trayLayers) {
  await mkdir(evidenceRoot, { recursive: true })
  const comparisonTiles = []
  for (const size of [16, 32]) {
    comparisonTiles.push(await sharp(readIcoLayer(oldIco, size)).resize(80, 80, { kernel: 'nearest' }).png().toBuffer())
    const replacement = trayLayers.find(layer => layer.size === size)
    if (replacement === undefined) throw new Error(`Replacement tray layer is missing at ${size}px.`)
    comparisonTiles.push(await sharp(replacement.png).resize(80, 80, { kernel: 'nearest' }).png().toBuffer())
  }
  const comparison = sharp({
    create: { width: 404, height: 112, channels: 4, background: '#202124' },
  }).composite(comparisonTiles.map((input, index) => ({ input, left: 16 + index * 98, top: 16 })))
  await comparison.png().toFile(resolve(evidenceRoot, 'windows-icon-comparison-old-new.png'))
  await sharp({
    create: { width: 404, height: 112, channels: 4, background: '#f3f4f6' },
  }).composite(comparisonTiles.map((input, index) => ({ input, left: 16 + index * 98, top: 16 })))
    .png()
    .toFile(resolve(evidenceRoot, 'windows-icon-comparison-old-new-light.png'))

  const thumbnails = sharp({
    create: { width: 404, height: 112, channels: 4, background: '#202124' },
  }).composite(trayLayers.map(({ png }, index) => ({
    input: png,
    left: 16 + index * 98 + Math.floor((80 - TRAY_SIZES[index]) / 2),
    top: 16 + Math.floor((80 - TRAY_SIZES[index]) / 2),
  })))
  await thumbnails.png().toFile(resolve(evidenceRoot, 'windows-icon-thumbnails-actual-size.png'))
}

const master = await renderMaster()
await writeFile(resolve(assetsRoot, 'icon-windows-source.png'), master)
const icoLayers = await Promise.all(ICO_SIZES.map(async size => ({ size, png: await renderLayer(master, size) })))
await writeFile(resolve(assetsRoot, 'icon-windows.ico'), encodeIco(icoLayers))
const trayLayers = icoLayers.filter(layer => TRAY_SIZES.includes(layer.size))
for (const layer of trayLayers) {
  await writeFile(resolve(assetsRoot, `tray-windows-${layer.size}.png`), layer.png)
}
await renderEvidence(await readFile(resolve(assetsRoot, 'icon.ico')), trayLayers)
console.log(`Windows icon assets: ${ICO_SIZES.length} ICO layers and ${TRAY_SIZES.length} tray PNGs generated.`)
