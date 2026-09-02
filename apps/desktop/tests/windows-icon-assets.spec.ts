import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

interface DecodedPng {
  width: number
  height: number
  rgba: Buffer
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

function decodeRgbaPng(buffer: Buffer): DecodedPng {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  let offset = 8
  let width = 0
  let height = 0
  const compressed: Buffer[] = []
  while (offset < buffer.length) {
    const bytes = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + bytes)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect(data[8], 'PNG bit depth').toBe(8)
      expect(data[9], 'PNG color type').toBe(6)
      expect(data[12], 'PNG interlace method').toBe(0)
    } else if (type === 'IDAT') {
      compressed.push(data)
    }
    offset += bytes + 12
    if (type === 'IEND') break
  }
  const encoded = inflateSync(Buffer.concat(compressed))
  const stride = width * 4
  const rgba = Buffer.alloc(stride * height)
  let inputOffset = 0
  for (let row = 0; row < height; row += 1) {
    const filter = encoded[inputOffset] ?? -1
    inputOffset += 1
    for (let column = 0; column < stride; column += 1) {
      const raw = encoded[inputOffset + column] ?? 0
      const outputOffset = row * stride + column
      const left = column >= 4 ? rgba[outputOffset - 4] ?? 0 : 0
      const above = row > 0 ? rgba[outputOffset - stride] ?? 0 : 0
      const upperLeft = row > 0 && column >= 4 ? rgba[outputOffset - stride - 4] ?? 0 : 0
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : filter === 4 ? paeth(left, above, upperLeft)
                : -1
      if (predictor < 0) throw new Error(`Unsupported PNG filter: ${String(filter)}`)
      rgba[outputOffset] = (raw + predictor) & 0xff
    }
    inputOffset += stride
  }
  return { width, height, rgba }
}

function expectLegibleTransparentIcon(png: DecodedPng, expectedSize: number): void {
  expect(png.width).toBe(expectedSize)
  expect(png.height).toBe(expectedSize)
  const alpha = (x: number, y: number): number => png.rgba[(y * png.width + x) * 4 + 3] ?? 0
  expect([
    alpha(0, 0),
    alpha(expectedSize - 1, 0),
    alpha(0, expectedSize - 1),
    alpha(expectedSize - 1, expectedSize - 1),
  ]).toEqual([0, 0, 0, 0])
  let occupied = 0
  let minX = expectedSize
  let minY = expectedSize
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < expectedSize; y += 1) {
    for (let x = 0; x < expectedSize; x += 1) {
      if (alpha(x, y) < 16) continue
      occupied += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  expect(occupied).toBeGreaterThan(expectedSize * expectedSize * 0.55)
  expect(maxX - minX + 1).toBeGreaterThanOrEqual(Math.floor(expectedSize * 0.88))
  expect(maxY - minY + 1).toBeGreaterThanOrEqual(Math.floor(expectedSize * 0.88))
}

describe('Windows icon assets', () => {
  it('ships a true-RGBA tightly occupied master and four tray sizes', () => {
    const master = decodeRgbaPng(readFileSync(new URL('../assets/icon-windows-source.png', import.meta.url)))
    expectLegibleTransparentIcon(master, 1024)
    for (const size of [16, 20, 24, 32]) {
      const icon = decodeRgbaPng(readFileSync(new URL(`../assets/tray-windows-${String(size)}.png`, import.meta.url)))
      expectLegibleTransparentIcon(icon, size)
    }
  })

  it('embeds every required RGBA PNG layer in the Windows ICO', () => {
    const ico = readFileSync(new URL('../assets/icon-windows.ico', import.meta.url))
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    const count = ico.readUInt16LE(4)
    expect(count).toBe(9)
    const actualSizes: number[] = []
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + index * 16
      const width = ico[entry] === 0 ? 256 : ico[entry] ?? 0
      const height = ico[entry + 1] === 0 ? 256 : ico[entry + 1] ?? 0
      expect(height).toBe(width)
      expect(ico.readUInt16LE(entry + 6)).toBe(32)
      const bytes = ico.readUInt32LE(entry + 8)
      const imageOffset = ico.readUInt32LE(entry + 12)
      expect(imageOffset + bytes).toBeLessThanOrEqual(ico.length)
      const png = decodeRgbaPng(ico.subarray(imageOffset, imageOffset + bytes))
      expectLegibleTransparentIcon(png, width)
      actualSizes.push(width)
    }
    expect(actualSizes).toEqual([16, 20, 24, 32, 40, 48, 64, 128, 256])
  })
})
