import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import LocalAttachmentStore, {
  DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
  DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
  DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
  DEFAULT_IMAGE_COMPRESSION_CONCURRENCY,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_IMAGE_DIMENSION,
  DEFAULT_MAX_IMAGE_PIXELS,
  DEFAULT_MAX_IMAGES_PER_MESSAGE,
  DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_MAX_DOCUMENTS_PER_MESSAGE,
  DEFAULT_MAX_MESSAGE_DOCUMENT_BYTES,
  DEFAULT_MAX_EXTRACTED_TEXT_BYTES,
  DEFAULT_MAX_MESSAGE_EXTRACTED_TEXT_BYTES,
} from '../src/index.ts'

describe('local attachment service', () => {
  it('resolves every omitted admission limit explicitly', () => {
    const service = new LocalAttachmentStore(new Context(), {})
    expect(DEFAULT_MAX_IMAGE_BYTES).toBe(50 * 1024 * 1024)
    expect(DEFAULT_MAX_IMAGES_PER_MESSAGE).toBe(20)
    expect(DEFAULT_MAX_MESSAGE_IMAGE_BYTES).toBe(200 * 1024 * 1024)
    expect(DEFAULT_MAX_IMAGE_PIXELS).toBe(64_000_000)
    expect(DEFAULT_MAX_IMAGE_DIMENSION).toBe(16384)
    expect(service.imageLimits).toEqual({
      maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
      maxImagesPerMessage: DEFAULT_MAX_IMAGES_PER_MESSAGE,
      maxMessageImageBytes: DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
      maxImagePixels: DEFAULT_MAX_IMAGE_PIXELS,
      maxImageDimension: DEFAULT_MAX_IMAGE_DIMENSION,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    })
    expect(service.documentLimits).toEqual({
      maxDocumentBytes: DEFAULT_MAX_DOCUMENT_BYTES,
      maxDocumentsPerMessage: DEFAULT_MAX_DOCUMENTS_PER_MESSAGE,
      maxMessageDocumentBytes: DEFAULT_MAX_MESSAGE_DOCUMENT_BYTES,
      maxExtractedTextBytes: DEFAULT_MAX_EXTRACTED_TEXT_BYTES,
      maxMessageExtractedTextBytes: DEFAULT_MAX_MESSAGE_EXTRACTED_TEXT_BYTES,
      maxDocumentNameBytes: 255,
      mediaTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/markdown',
        'application/json',
        'text/csv',
        'application/yaml',
        'application/xml',
      ],
    })
    expect(service.normalizationPolicy).toEqual({
      maxPixels: DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
      maxDimension: DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
      maxBytes: DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
    })
    expect(service.imageCompressionConcurrency).toBe(DEFAULT_IMAGE_COMPRESSION_CONCURRENCY)
    const ref = {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 1,
      height: 1,
    }
    expect(service.imageHostPath(ref)).toBe(join(
      service.root,
      'objects',
      'aa',
      'a'.repeat(64),
    ))
    expect(() => service.imageHostPath({ ...ref, attachmentId: AttachmentId('invalid') }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ATTACHMENT_REF' }))
  })

  it('resolves and validates the instance image-compression concurrency', () => {
    expect(new LocalAttachmentStore(new Context(), { imageCompressionConcurrency: 1 }).imageCompressionConcurrency).toBe(1)
    for (const imageCompressionConcurrency of [0, 1.5, 9]) {
      expect(() => new LocalAttachmentStore(new Context(), { imageCompressionConcurrency }))
        .toThrow(/imageCompressionConcurrency must be an integer from 1 through 8/)
    }
  })

  it('saves and reads through the service boundary', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-service-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const data = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC',
        'base64',
      ))
      const ref = await service.saveImage({ data, mediaType: 'image/png' })
      await expect(service.readImage(ref)).resolves.toEqual({ ref, data })
      const hostPath = service.imageHostPath(ref)
      expect(hostPath).toBe(join(
        dshHome,
        'attachments',
        'v1',
        'objects',
        String(ref.attachmentId).slice('sha256:'.length, 'sha256:'.length + 2),
        String(ref.attachmentId).slice('sha256:'.length),
      ))
      await expect(readFile(hostPath)).resolves.toEqual(Buffer.from(data))
      const request = await service.readImageRequest(ref, { maxPixels: 1, maxBytes: 1024 })
      expect(request).not.toHaveProperty('access')

      const fileData = Uint8Array.of(0, 1, 2, 255)
      const fileRef = await service.saveFile({ data: fileData, name: 'notes.bin' })
      const filePath = service.fileHostPath(fileRef)
      expect(filePath).toContain(join('files', String(fileRef.attachmentId).slice(7, 9)))
      await expect(readFile(filePath)).resolves.toEqual(Buffer.from(fileData))

      const streamRef = await service.saveFileStream({
        data: (async function* (): AsyncIterable<Uint8Array> { yield fileData })(),
        name: 'stream.bin',
      })
      await expect(readFile(service.fileHostPath(streamRef))).resolves.toEqual(Buffer.from(fileData))
      const streamed: Uint8Array[] = []
      for await (const chunk of service.readFileStream(streamRef)) streamed.push(chunk)
      expect(Buffer.concat(streamed)).toEqual(Buffer.from(fileData))
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('saves and verifies documents through the service boundary', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-document-service-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const ref = await service.saveDocument({
        data: new TextEncoder().encode('document body'),
        mediaType: 'text/plain',
        name: 'notes.txt',
      })
      await expect(service.readDocument(ref)).resolves.toMatchObject({ ref, text: 'document body' })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('validates documents without persisting and commits successful batches in order', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-document-validation-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const first = { data: new TextEncoder().encode('first'), mediaType: 'text/plain' as const, name: 'first.txt' }
      const second = { data: new TextEncoder().encode('second'), mediaType: 'text/plain' as const, name: 'second.txt' }
      await expect(service.validateDocument(first)).resolves.toBeUndefined()
      expect(existsSync(service.root)).toBe(false)
      const refs = await service.saveDocuments([first, second])
      expect(refs.map(ref => ref.name)).toEqual(['first.txt', 'second.txt'])
      await expect(Promise.all(refs.map(ref => service.readDocument(ref))))
        .resolves.toMatchObject([{ text: 'first' }, { text: 'second' }])
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('prepares the full document batch before enforcing aggregate extracted text', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-document-batch-'))
    try {
      const service = new LocalAttachmentStore(new Context(), {
        dshHome,
        maxExtractedTextBytes: 20,
        maxMessageExtractedTextBytes: 10,
      })
      await expect(service.saveDocuments([
        { data: new TextEncoder().encode('12345678'), mediaType: 'text/plain', name: 'one.txt' },
        { data: new TextEncoder().encode('abcdefgh'), mediaType: 'text/plain', name: 'two.txt' },
      ])).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTED_TEXT_TOO_LARGE' })
      expect(existsSync(service.root)).toBe(false)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('enforces the aggregate extracted-text cap for direct single-document saves', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-document-single-'))
    try {
      const service = new LocalAttachmentStore(new Context(), {
        dshHome,
        maxExtractedTextBytes: 20,
        maxMessageExtractedTextBytes: 5,
      })
      await expect(service.saveDocument({
        data: new TextEncoder().encode('12345678'), mediaType: 'text/plain', name: 'one.txt',
      })).rejects.toMatchObject({ code: 'DOCUMENT_EXTRACTED_TEXT_TOO_LARGE' })
      expect(existsSync(service.root)).toBe(false)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('commits a fully prepared image batch in input order', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-batch-success-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const first = new Uint8Array(await sharp({
        create: { width: 2, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } },
      }).png().toBuffer())
      const second = new Uint8Array(await sharp({
        create: { width: 1, height: 2, channels: 3, background: { r: 4, g: 5, b: 6 } },
      }).png().toBuffer())

      const refs = await service.saveImages([
        { data: first, mediaType: 'image/png', name: 'first.png' },
        { data: second, mediaType: 'image/png', name: 'second.png' },
      ])

      expect(refs.map(ref => ref.name)).toEqual(['first.png', 'second.png'])
      await expect(Promise.all(refs.map(ref => service.readImage(ref))))
        .resolves.toHaveLength(2)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it.each([3, 4] as const)('admits a 16-bit %s-channel PNG as an 8-bit normalized object', async (channels) => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-16-bit-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const source = new Uint8Array(await sharp({
        create: { width: 7, height: 5, channels, background: { r: 12, g: 34, b: 56, alpha: 0.5 } },
      }).toColourspace('rgb16').png().toBuffer())

      const saved = await service.saveImage({ data: source, mediaType: 'image/png' })
      const stored = await service.readImage(saved)
      const metadata = await sharp(stored.data).metadata()

      expect(stored.data).not.toEqual(source)
      expect(metadata).toMatchObject({ depth: 'uchar', space: 'srgb', hasAlpha: channels === 4 })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('prepares every batch member before any write', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-batch-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const valid = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC',
        'base64',
      ))
      await expect(service.saveImages([
        { data: valid, mediaType: 'image/png' },
        { data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' },
      ])).rejects.toThrow(/Unsupported or malformed image data/)
      expect(existsSync(service.root)).toBe(false)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('validates without persisting: a rejected image leaves no storage root behind', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-validate-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      await expect(service.validateImage({ data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' }))
        .rejects.toThrow(/Unsupported or malformed image data/)
      const valid = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC',
        'base64',
      ))
      const limited = new LocalAttachmentStore(new Context(), { dshHome, maxImageBytes: 1 })
      await expect(limited.validateImage({ data: valid, mediaType: 'image/png' }))
        .rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' })
      await expect(service.validateImage({ data: valid, mediaType: 'image/png' })).resolves.toBeUndefined()
      expect(existsSync(service.root)).toBe(false)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })
})

/**
 * The product admission envelope, exercised against real encoded bytes rather
 * than the fixture limits the unit specs use. These are the numbers the client
 * prompt and the Host validator share, so a regression here is a regression in
 * what a reader can attach.
 */
describe('large source images', () => {
  /**
   * Deterministic photographic noise: high entropy, so the encoder cannot
   * shrink it and the source byte length stays predictable.
   * @param width - pixel width.
   * @param height - pixel height.
   * @returns encoded PNG bytes.
   */
  async function noisePng(width: number, height: number): Promise<Uint8Array> {
    const pixels = Buffer.allocUnsafe(width * height * 3)
    let state = 0x2545f491
    for (let index = 0; index < pixels.length; index++) {
      // xorshift32: deterministic, and no PRNG dependency in the suite.
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      pixels[index] = state & 0xff
    }
    return new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 0 }).toBuffer())
  }

  /**
   * Deterministic low-entropy pixels, so a screen-sized source stays small.
   * @param width - pixel width.
   * @param height - pixel height.
   * @returns encoded PNG bytes.
   */
  async function gradientPng(width: number, height: number): Promise<Uint8Array> {
    const pixels = Buffer.allocUnsafe(width * height * 3)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 3
        pixels[offset] = x & 0xff
        pixels[offset + 1] = (x >> 8) & 0xff
        pixels[offset + 2] = y & 0xff
      }
    }
    return new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png().toBuffer())
  }

  it('admits a source the previous byte limit refused and downsizes it for the request', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-large-bytes-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      expect(service.imageLimits.maxImageBytes).toBe(50 * 1024 * 1024)
      const source = await noisePng(3000, 3000)
      // 25.8 MiB measured: over the previous 20 MiB refusal, under the new limit.
      expect(source.byteLength).toBeGreaterThan(20 * 1024 * 1024)
      expect(source.byteLength).toBeLessThan(50 * 1024 * 1024)

      const ref = await service.saveImage({ data: source, mediaType: 'image/png', name: 'photo.png' })
      expect(ref.bytes).toBeLessThanOrEqual(DEFAULT_NORMALIZED_IMAGE_MAX_BYTES)
      expect(ref.width * ref.height).toBeLessThanOrEqual(DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS)
      expect(ref.originalDimensions).toEqual({ width: 3000, height: 3000 })
      await expect(service.readImage(ref)).resolves.toMatchObject({ ref })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  }, 30_000)

  it('admits a long edge past the previous cap and still bounds the stored pixels', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-large-edge-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      expect(service.imageLimits.maxImageDimension).toBe(16384)
      const source = await gradientPng(16384, 200)
      const ref = await service.saveImage({ data: source, mediaType: 'image/png', name: 'long.png' })
      // The source carries a long edge the previous 8192 cap refused outright.
      expect(ref.originalDimensions).toEqual({ width: 16384, height: 200 })
      // The long-edge cap is what bounds the stored object, so the aspect ratio
      // is preserved rather than the strip collapsing to the pixel budget.
      expect(Math.max(ref.width, ref.height)).toBeLessThanOrEqual(16384)
      expect(ref.width / ref.height).toBeCloseTo(16384 / 200, 2)
      expect(ref.width * ref.height).toBeLessThanOrEqual(DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  }, 30_000)

  it('accepts a source exactly at the byte limit and refuses one byte more', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-exact-bytes-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome, maxImageBytes: 256 })
      const payload = new Uint8Array(await sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 7, g: 7, b: 7 } },
      }).png().toBuffer())
      expect(payload.byteLength).toBeLessThan(256)
      const exact = new Uint8Array(256)
      exact.set(payload)
      const over = new Uint8Array(257)
      over.set(payload)

      await expect(service.validateImage({ data: exact, mediaType: 'image/png' })).resolves.toBeUndefined()
      await expect(service.validateImage({ data: over, mediaType: 'image/png' }))
        .rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('accepts exactly the pixel budget and refuses one pixel more', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-exact-pixels-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome, maxImagePixels: 64 })
      const exact = await gradientPng(8, 8)
      const over = await gradientPng(9, 8)

      await expect(service.validateImage({ data: exact, mediaType: 'image/png' })).resolves.toBeUndefined()
      await expect(service.validateImage({ data: over, mediaType: 'image/png' }))
        .rejects.toMatchObject({ code: 'IMAGE_TOO_MANY_PIXELS' })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('accepts exactly the edge cap and refuses one pixel more', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-exact-edge-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome, maxImageDimension: 40 })
      await expect(service.validateImage({ data: await gradientPng(40, 3), mediaType: 'image/png' }))
        .resolves.toBeUndefined()
      await expect(service.validateImage({ data: await gradientPng(41, 3), mediaType: 'image/png' }))
        .rejects.toMatchObject({ code: 'IMAGE_DIMENSION_TOO_LARGE' })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('admits twenty images and refuses twenty-one', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-count-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome, maxImagesPerMessage: 20 })
      const one = await gradientPng(2, 2)
      const batch = Array.from({ length: 20 }, () => ({ data: one, mediaType: 'image/png' as const }))
      await expect(service.saveImages(batch)).resolves.toHaveLength(20)
      await expect(service.saveImages([...batch, { data: one, mediaType: 'image/png' }]))
        .rejects.toMatchObject({ code: 'TOO_MANY_IMAGES' })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  }, 30_000)

  it('refuses an aggregate over the message budget', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-aggregate-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome, maxMessageImageBytes: 64 })
      const one = await gradientPng(64, 64)
      expect(one.byteLength).toBeGreaterThan(64)
      await expect(service.saveImages([
        { data: one, mediaType: 'image/png' },
        { data: one, mediaType: 'image/png' },
      ])).rejects.toMatchObject({ code: 'IMAGES_TOO_LARGE' })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('keeps aspect ratio and transparency through a large-source downscale', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-shape-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const strip = await gradientPng(9000, 1200)
      const wide = await service.saveImage({ data: strip, mediaType: 'image/png' })
      expect(wide.width / wide.height).toBeCloseTo(9000 / 1200, 2)

      const transparent = new Uint8Array(await sharp({
        create: { width: 3000, height: 2000, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.25 } },
      }).png().toBuffer())
      const kept = await service.saveImage({ data: transparent, mediaType: 'image/png' })
      const stored = await service.readImage(kept)
      expect((await sharp(stored.data).metadata()).hasAlpha).toBe(true)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  }, 30_000)

  it('refuses a forged format and a truncated source before storing anything', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-forged-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const real = await gradientPng(64, 64)
      // PNG bytes declared as JPEG, and a header-only PNG: both are decodable
      // failures rather than size failures, so neither reaches storage.
      await expect(service.saveImage({ data: real, mediaType: 'image/jpeg' }))
        .rejects.toMatchObject({ code: 'IMAGE_TYPE_MISMATCH' })
      await expect(service.saveImage({ data: real.subarray(0, 24), mediaType: 'image/png' }))
        .rejects.toMatchObject({ code: 'INVALID_IMAGE' })
      expect(existsSync(service.root)).toBe(false)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })
})
