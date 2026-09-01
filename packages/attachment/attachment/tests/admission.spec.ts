import { describe, expect, it, vi } from 'vitest'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { admitEncodedDocuments, admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type {
  DocumentAttachmentRef,
  ImageAttachmentRef,
  SaveDocumentAttachment,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment/types'

const PNG = 'AAAA' // canonical base64, 3 bytes

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
    const store = { saveDocuments } as unknown as AttachmentStore

    const refs = await admitEncodedDocuments(store, [
      { mediaType: 'application/pdf', data: PNG, name: 'brief.pdf' },
      { mediaType: 'text/plain', data: PNG, name: 'notes.txt' },
    ])

    expect(saveDocuments).toHaveBeenCalledTimes(1)
    expect(saveDocuments.mock.calls[0]?.[0].map(input => [input.name, input.mediaType, input.data.byteLength]))
      .toEqual([['brief.pdf', 'application/pdf', 3], ['notes.txt', 'text/plain', 3]])
    expect(refs.map(ref => ref.name)).toEqual(['brief.pdf', 'notes.txt'])
  })

  it('rejects empty and non-canonical document base64 before storage', async () => {
    const saveDocuments = vi.fn()
    const store = { saveDocuments } as unknown as AttachmentStore
    for (const data of ['', 'AAA', '!!!!']) {
      await expect(admitEncodedDocuments(store, [{ mediaType: 'text/plain', data, name: 'notes.txt' }]))
        .rejects.toMatchObject({ code: 'INVALID_DOCUMENT_BASE64' })
    }
    expect(saveDocuments).not.toHaveBeenCalled()
  })
})
