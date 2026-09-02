import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  admitEncodedDocuments,
  admitEncodedImages,
  assertPromptAttachmentBase64CodeUnits,
  MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS,
  promptAttachmentBase64CodeUnits,
} from '@deepseek-ai/dsh-attachment'
import type {
  DocumentAttachmentRef,
  ImageAttachmentRef,
  SaveDocumentAttachment,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment/types'

const PNG = 'AAAA' // canonical base64, 3 bytes

const DOCUMENT_LIMITS = {
  maxDocumentBytes: 3,
  maxDocumentsPerMessage: 2,
  maxMessageDocumentBytes: 6,
  maxExtractedTextBytes: 16,
  maxMessageExtractedTextBytes: 32,
  maxDocumentNameBytes: 255,
  mediaTypes: ['text/plain', 'application/pdf'] as const,
}

describe('combined prompt attachment carrier', () => {
  it('computes canonical base64 code units without allocating the encoded payload', () => {
    expect(promptAttachmentBase64CodeUnits(0)).toBe(0)
    expect(promptAttachmentBase64CodeUnits(1)).toBe(4)
    expect(promptAttachmentBase64CodeUnits(3)).toBe(4)
    expect(promptAttachmentBase64CodeUnits(4)).toBe(8)
  })

  it('rejects a mixed encoded payload above the shared carrier budget', () => {
    expect(() => {
      assertPromptAttachmentBase64CodeUnits([
        MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS - 4,
        4,
      ])
    }).not.toThrow()
    expect(() => {
      assertPromptAttachmentBase64CodeUnits([
        MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS,
        4,
      ])
    }).toThrow(expect.objectContaining({ code: 'ATTACHMENTS_TOO_LARGE' }))
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid encoded payload length %s',
    (length) => {
      expect(() => {
        assertPromptAttachmentBase64CodeUnits([length])
      }).toThrow(expect.objectContaining({ code: 'INVALID_ATTACHMENT_PAYLOAD_LENGTH' }))
    },
  )
})

/** Delegation double: records the exact saveImages batch and answers ordered refs. */
function storeOf() {
  const store = {
    saveImages: vi.fn((inputs: readonly SaveImageAttachment[]) => Promise.resolve(inputs.map((input, index): ImageAttachmentRef => ({
      attachmentId: `att-${index + 1}` as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    })))),
  }
  return { store: store as unknown as AttachmentStore, mocks: store }
}

describe('admitEncodedImages', () => {
  it('decodes every member and delegates one ordered batch to saveImages', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [
      { mediaType: 'image/png', data: PNG, name: 'first.png' },
      { mediaType: 'image/jpeg', data: PNG, name: 'second.jpg' },
    ])
    expect(mocks.saveImages).toHaveBeenCalledTimes(1)
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect(batch.map(input => [input.name, input.mediaType, input.data.byteLength]))
      .toEqual([['first.png', 'image/png', 3], ['second.jpg', 'image/jpeg', 3]])
    expect(refs.map(ref => ref.attachmentId)).toEqual(['att-1', 'att-2'])
  })

  it('accepts a canonical one-byte padded image without rewriting its spelling', async () => {
    const { store, mocks } = storeOf()
    await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data: 'AA==' }])).resolves.toHaveLength(1)
    expect(mocks.saveImages.mock.calls[0]?.[0][0]?.data).toEqual(Uint8Array.of(0))
  })

  it('omits the name from store inputs when the upload has none', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [{ mediaType: 'image/webp', data: PNG }])
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect('name' in (batch[0] as object)).toBe(false)
    expect(refs[0]?.name).toBeUndefined()
  })

  it('delegates an empty batch unchanged', async () => {
    const { store, mocks } = storeOf()
    await expect(admitEncodedImages(store, [])).resolves.toEqual([])
    expect(mocks.saveImages).toHaveBeenCalledWith([])
  })

  it('rejects non-canonical and empty base64 payloads before any store call', async () => {
    const { store, mocks } = storeOf()
    for (const data of ['', 'AAA', '!!!!']) {
      await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data }]))
        .rejects.toMatchObject({ name: 'AttachmentError', code: 'INVALID_IMAGE_BASE64' })
    }
    expect(mocks.saveImages).not.toHaveBeenCalled()
  })

  it.each(['AB==', 'AAB='])('rejects non-zero image padding bits before decoding %s', async (data) => {
    const { store, mocks } = storeOf()
    const decode = vi.spyOn(Buffer, 'from')
    try {
      await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data }]))
        .rejects.toMatchObject({ code: 'INVALID_IMAGE_BASE64' })
      expect(decode).not.toHaveBeenCalled()
      expect(mocks.saveImages).not.toHaveBeenCalled()
    } finally {
      decode.mockRestore()
    }
  })

  it('propagates the store batch rejection unchanged', async () => {
    const { store, mocks } = storeOf()
    const refused = Object.assign(new Error('Image batch exceeds the configured image-count limit.'), { code: 'TOO_MANY_IMAGES' })
    mocks.saveImages.mockRejectedValueOnce(refused)
    await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data: PNG }])).rejects.toBe(refused)
  })
})

describe('admitEncodedDocuments', () => {
  it('decodes canonical base64 and delegates one ordered document batch', async () => {
    const saveDocuments = vi.fn((inputs: readonly SaveDocumentAttachment[]) => Promise.resolve(
      inputs.map((input, index): DocumentAttachmentRef => ({
        attachmentId: `att-doc-${index + 1}` as DocumentAttachmentRef['attachmentId'],
        extractedTextId: `att-text-${index + 1}` as DocumentAttachmentRef['extractedTextId'],
        mediaType: input.mediaType,
        name: input.name,
        bytes: input.data.byteLength,
        extractedBytes: 3,
        truncated: false,
      })),
    ))
    const store = { documentLimits: DOCUMENT_LIMITS, saveDocuments } as unknown as AttachmentStore

    const refs = await admitEncodedDocuments(store, [
      { mediaType: 'application/pdf', data: 'AAA=', name: 'brief.pdf' },
      { mediaType: 'text/plain', data: PNG, name: 'notes.txt' },
    ])

    expect(saveDocuments).toHaveBeenCalledTimes(1)
    expect(saveDocuments.mock.calls[0]?.[0].map(input => [input.name, input.mediaType, input.data.byteLength]))
      .toEqual([['brief.pdf', 'application/pdf', 2], ['notes.txt', 'text/plain', 3]])
    expect(refs.map(ref => ref.name)).toEqual(['brief.pdf', 'notes.txt'])
  })

  it('rejects empty and non-canonical document base64 before storage', async () => {
    const saveDocuments = vi.fn()
    const store = { documentLimits: DOCUMENT_LIMITS, saveDocuments } as unknown as AttachmentStore
    for (const data of ['', 'AAA', '!!!!']) {
      await expect(admitEncodedDocuments(store, [{ mediaType: 'text/plain', data, name: 'notes.txt' }]))
        .rejects.toMatchObject({ code: 'INVALID_DOCUMENT_BASE64' })
    }
    expect(saveDocuments).not.toHaveBeenCalled()
  })

  it('rejects count, per-document bytes, and aggregate bytes before decoding any member', async () => {
    const saveDocuments = vi.fn()
    const store = {
      documentLimits: { ...DOCUMENT_LIMITS, maxMessageDocumentBytes: 4 }, saveDocuments,
    } as unknown as AttachmentStore
    const decode = vi.spyOn(Buffer, 'from')
    try {
      await expect(admitEncodedDocuments(store, Array.from({ length: 3 }, () => ({
        mediaType: 'text/plain' as const,
        data: '!!!!',
        name: 'notes.txt',
      })))).rejects.toMatchObject({ code: 'TOO_MANY_DOCUMENTS' })
      await expect(admitEncodedDocuments(store, [{
        mediaType: 'text/plain', data: 'AAAAAA==', name: 'large.txt',
      }])).rejects.toMatchObject({ code: 'DOCUMENT_TOO_LARGE' })
      await expect(admitEncodedDocuments({
        documentLimits: { ...DOCUMENT_LIMITS, maxDocumentBytes: 1 }, saveDocuments,
      } as unknown as AttachmentStore, [{
        mediaType: 'text/plain', data: 'AAA=', name: 'decoded-large.txt',
      }])).rejects.toMatchObject({ code: 'DOCUMENT_TOO_LARGE' })
      await expect(admitEncodedDocuments(store, [
        { mediaType: 'text/plain', data: 'AAAA', name: 'first.txt' },
        { mediaType: 'text/plain', data: 'AAAA', name: 'second.txt' },
      ])).rejects.toMatchObject({ code: 'DOCUMENTS_TOO_LARGE' })
      await expect(admitEncodedDocuments(store, [{
        mediaType: 'application/json', data: 'YQ==', name: 'data.json',
      }])).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCUMENT_TYPE' })

      expect(decode).not.toHaveBeenCalled()
      expect(saveDocuments).not.toHaveBeenCalled()
    } finally {
      decode.mockRestore()
    }
  })

  it('validates every canonical form before decoding the first document', async () => {
    const saveDocuments = vi.fn()
    const store = { documentLimits: DOCUMENT_LIMITS, saveDocuments } as unknown as AttachmentStore
    const decode = vi.spyOn(Buffer, 'from')
    try {
      await expect(admitEncodedDocuments(store, [
        { mediaType: 'text/plain', data: 'YQ==', name: 'first.txt' },
        { mediaType: 'text/plain', data: 'AA=A', name: 'second.txt' },
      ])).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_BASE64' })

      expect(decode).not.toHaveBeenCalled()
      expect(saveDocuments).not.toHaveBeenCalled()
    } finally {
      decode.mockRestore()
    }
  })

  it.each(['AB==', 'AAB='])('rejects non-zero document padding bits before decoding %s', async (data) => {
    const saveDocuments = vi.fn()
    const store = { documentLimits: DOCUMENT_LIMITS, saveDocuments } as unknown as AttachmentStore
    const decode = vi.spyOn(Buffer, 'from')
    try {
      await expect(admitEncodedDocuments(store, [{ mediaType: 'text/plain', data, name: 'notes.txt' }]))
        .rejects.toMatchObject({ code: 'INVALID_DOCUMENT_BASE64' })
      expect(decode).not.toHaveBeenCalled()
      expect(saveDocuments).not.toHaveBeenCalled()
    } finally {
      decode.mockRestore()
    }
  })
})
