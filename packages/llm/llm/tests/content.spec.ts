import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentStore,
  DocumentAttachmentLimits,
  ImageMediaType,
} from '@deepseek-ai/dsh-attachment'
import {
  ToolCallId,
  contentHasDocument,
  contentHasImage,
  createUserMessage,
  documentExpansionTokenBudget,
  OFFLOADED_DOCUMENT_TEXT,
  offloadedImageText,
  offloadedImagePrefixCount,
  offloadRequestImagesWithPolicy,
  projectDocumentsForRequest,
  projectImagesForTextModel,
  resolveImageAttachmentAccess,
  requestImageHandleText,
} from '../src/index.ts'
import type { ContentBlock, GenerateOptions, Message } from '../src/index.ts'

const source = { kind: 'plugin' as const, plugin: 'test' }

const OMITTED = '[omitted]'

function offloadBase64(messages: readonly Message[], maxBytes: number | undefined): readonly Message[] {
  return offloadRequestImagesWithPolicy(messages, {
    representation: 'base64',
    ...maxBytes === undefined ? {} : { maxBytes },
    byteQuantum: 1,
    placeholder: () => OMITTED,
  })
}

function image(bytes: number): Extract<ContentBlock, { type: 'image' }> {
  return {
    type: 'image',
    attachment: {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png',
      bytes,
      width: 1,
      height: 1,
    },
  }
}

function document(
  digest = 'b',
  bytes = 12,
  extractedBytes = 10,
): Extract<ContentBlock, { type: 'document' }> {
  return {
    type: 'document',
    attachment: {
      attachmentId: AttachmentId(`sha256:${digest.repeat(64)}`),
      extractedTextId: AttachmentId(`sha256:${digest.toUpperCase().repeat(64)}`),
      mediaType: 'text/plain',
      name: `${digest}.txt`,
      bytes,
      extractedBytes,
      truncated: false,
    },
  }
}

const DOCUMENT_LIMITS: DocumentAttachmentLimits = {
  maxDocumentBytes: 100,
  maxDocumentsPerMessage: 5,
  maxMessageDocumentBytes: 100,
  maxExtractedTextBytes: 100,
  maxMessageExtractedTextBytes: 100,
  maxDocumentNameBytes: 255,
  mediaTypes: ['text/plain'],
}

function projectionStore(
  readDocument: AttachmentStore['readDocument'],
  limits: Partial<DocumentAttachmentLimits> = {},
): AttachmentStore {
  return {
    documentLimits: { ...DOCUMENT_LIMITS, ...limits },
    readDocument,
  } as unknown as AttachmentStore
}

describe('document content blocks', () => {
  it('detects nested media and formats an exact request-image handle', () => {
    const textOnlyToolResult = {
      type: 'tool-result' as const,
      toolCallId: ToolCallId('plain'),
      content: [{ type: 'text' as const, text: 'plain' }],
    }
    expect(contentHasImage([textOnlyToolResult])).toBe(false)
    expect(contentHasDocument([textOnlyToolResult])).toBe(false)
    expect(contentHasImage([{ ...textOnlyToolResult, content: [image(3)] }])).toBe(true)
    expect(contentHasDocument([{ ...textOnlyToolResult, content: [document()] }])).toBe(true)
    const attachment = image(3).attachment
    expect(requestImageHandleText(attachment, { width: 2, height: 3 }))
      .toBe(`Image ${attachment.attachmentId}; request preview 2x3px. It may be resized or re-encoded; source dimensions, format, and byte size may differ.`)
  })

  it('remain durable provider-neutral content beside text and images', () => {
    const block = document()
    const message = createUserMessage({ content: [{ type: 'text', text: 'read this' }, block], source })
    expect(message.content).toEqual([{ type: 'text', text: 'read this' }, block])
  })

  it('verifies each unique reference once and projects direct and nested documents to escaped text', async () => {
    const block = document()
    const readDocument = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => ({
      ref,
      data: Uint8Array.of(1),
      text: 'one < two & three',
    }))
    const store = projectionStore(readDocument)
    const nested = {
      type: 'tool-result' as const,
      toolCallId: ToolCallId('doc'),
      content: [block],
    }
    const original = createUserMessage({ content: [block, nested], source })

    const projected = await projectDocumentsForRequest([original], store)

    const text = '<dsh-document name="b.txt" media-type="text/plain" truncated="false">\n'
      + 'one &lt; two &amp; three\n</dsh-document>'
    expect(projected[0]?.content).toEqual([
      { type: 'text', text },
      { ...nested, content: [{ type: 'text', text }] },
    ])
    expect(readDocument).toHaveBeenCalledTimes(1)
    expect(original.content).toEqual([block, nested])
  })

  it('returns the original message list when no documents are present', async () => {
    const messages = [createUserMessage({ content: [{ type: 'text', text: 'plain' }], source })]
    const readDocument = vi.fn()
    const store = projectionStore(readDocument)
    await expect(projectDocumentsForRequest(messages, store)).resolves.toBe(messages)
    expect(readDocument).not.toHaveBeenCalled()
  })

  it('retains unaffected messages, blocks, and nested tool results beside projected documents', async () => {
    const plain = createUserMessage({ content: [{ type: 'text', text: 'plain' }], source })
    const unchangedToolResult = {
      type: 'tool-result' as const,
      toolCallId: ToolCallId('plain-tool'),
      content: [{ type: 'text' as const, text: 'tool text' }],
    }
    const withDocument = createUserMessage({
      content: [document(), { type: 'text', text: 'after' }, unchangedToolResult],
      source,
    })
    const readDocument = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => ({
      ref,
      data: Uint8Array.of(1),
      text: 'projected',
    }))

    const projected = await projectDocumentsForRequest([plain, withDocument], projectionStore(readDocument))

    expect(projected[0]).toBe(plain)
    expect(projected[1]?.content).toEqual([
      { type: 'text', text: '<dsh-document name="b.txt" media-type="text/plain" truncated="false">\nprojected\n</dsh-document>' },
      { type: 'text', text: 'after' },
      unchangedToolResult,
    ])
  })

  it('fails closed if mutable caller content diverges while a document read is pending', async () => {
    const messageTemplate = createUserMessage({ content: [{ type: 'text', text: 'template' }], source })
    const renamed = document()
    const renamedMessage = { ...messageTemplate, content: [renamed] }
    const renameRead = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => {
      ref.name = 'mutated.txt'
      return { ref, data: Uint8Array.of(1), text: 'text' }
    })
    await expect(projectDocumentsForRequest([renamedMessage], projectionStore(renameRead)))
      .rejects.toThrow('Document projection occurrence order diverged')

    const extendedMessage = { ...messageTemplate, content: [document()] }
    const extendRead = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => {
      (extendedMessage.content as ContentBlock[]).push(document('c'))
      return { ref, data: Uint8Array.of(1), text: 'text' }
    })
    await expect(projectDocumentsForRequest([extendedMessage], projectionStore(extendRead)))
      .rejects.toThrow('Document projection occurrence order diverged')
  })

  it.each([
    ['count', { maxDocumentsPerMessage: 1 }],
    ['source bytes', { maxMessageDocumentBytes: 12 }],
    ['extracted bytes', { maxMessageExtractedTextBytes: 12 }],
  ] satisfies readonly [string, Partial<DocumentAttachmentLimits>][]) (
    'omits historical documents past the request %s budget before reading them',
    async (_label, limits) => {
      const first = document('b', 8, 8)
      const second = document('c', 8, 8)
      const readDocument = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => ({
        ref,
        data: Uint8Array.of(1),
        text: `text-${ref.name}`,
      }))
      const original = createUserMessage({ content: [first, second], source })

      const projected = await projectDocumentsForRequest(
        [original],
        projectionStore(readDocument, limits),
      )

      expect(readDocument).toHaveBeenCalledOnce()
      expect(projected[0]?.content).toEqual([
        {
          type: 'text',
          text: '<dsh-document name="b.txt" media-type="text/plain" truncated="false">\ntext-b.txt\n</dsh-document>',
        },
        {
          type: 'text',
          text: '[document omitted to keep the request within its document limits.]',
        },
      ])
    },
  )

  it('keeps the newest message documents when history exceeds the request count budget', async () => {
    const readDocument = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => ({
      ref,
      data: Uint8Array.of(1),
      text: `text-${ref.name}`,
    }))
    const messages = ['a', 'b', 'c', 'd', 'e', 'f'].map(digest => (
      createUserMessage({ content: [document(digest)], source })
    ))

    const projected = await projectDocumentsForRequest(messages, projectionStore(readDocument))

    expect(readDocument.mock.calls.map(([ref]) => ref.name).sort()).toEqual([
      'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt',
    ])
    expect(projected[0]?.content).toEqual([{ type: 'text', text: OFFLOADED_DOCUMENT_TEXT }])
    expect(projected.at(-1)?.content).toEqual([{
      type: 'text',
      text: '<dsh-document name="f.txt" media-type="text/plain" truncated="false">\ntext-f.txt\n</dsh-document>',
    }])
  })

  it('offloads an escaped document whose actual model text exceeds the route expansion budget', async () => {
    const block = document('a', 8, 4)
    const readDocument = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => ({
      ref,
      data: Uint8Array.of(1),
      text: "''''",
    }))

    const projected = await projectDocumentsForRequest(
      [createUserMessage({ content: [block], source })],
      projectionStore(readDocument),
      undefined,
      { maxExpansionTokens: 0 },
    )

    expect(readDocument).toHaveBeenCalledOnce()
    expect(projected[0]?.content).toEqual([{ type: 'text', text: OFFLOADED_DOCUMENT_TEXT }])
  })

  it('keeps a verified document whose escaped text fits a finite route expansion budget', async () => {
    const block = document('a', 8, 4)
    const omitted = document('b', 8, 4)
    const readDocument = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => ({
      ref,
      data: Uint8Array.of(1),
      text: 'fits',
    }))

    const projected = await projectDocumentsForRequest(
      [createUserMessage({ content: [block, omitted], source })],
      projectionStore(readDocument, { maxDocumentsPerMessage: 1 }),
      undefined,
      { maxExpansionTokens: 1_000 },
    )

    expect(projected[0]?.content).toEqual([
      {
        type: 'text',
        text: '<dsh-document name="a.txt" media-type="text/plain" truncated="false">\nfits\n</dsh-document>',
      },
      { type: 'text', text: OFFLOADED_DOCUMENT_TEXT },
    ])
  })

  it.each([-1, 0.5])('rejects invalid document expansion budget %s', async (maxExpansionTokens) => {
    const block = document('a', 8, 4)
    const readDocument = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => ({
      ref,
      data: Uint8Array.of(1),
      text: 'text',
    }))

    await expect(projectDocumentsForRequest(
      [createUserMessage({ content: [block], source })],
      projectionStore(readDocument),
      undefined,
      { maxExpansionTokens },
    )).rejects.toThrow('Document expansion budget must be a non-negative safe integer.')
  })

  it('prices every provider-facing content kind and request option against the exact route context', () => {
    const nested = {
      type: 'tool-result' as const,
      toolCallId: ToolCallId('result'),
      content: [{ type: 'text' as const, text: 'nested' }],
    }
    const extensionBlock = { type: 'extension', payload: { value: 'bounded' } } as unknown as ContentBlock
    const options: GenerateOptions = {
      provider: 'provider',
      model: 'model',
      messages: [createUserMessage({
        source,
        content: [
          { type: 'text', text: 'text' },
          { type: 'reasoning', text: 'reasoning' },
          image(3),
          document('a'),
          { type: 'tool-call', id: ToolCallId('call'), name: 'tool', arguments: '{}' },
          nested,
          extensionBlock,
        ],
      })],
      system: 'system',
      tools: [{ name: 'tool', description: 'description', parameters: { type: 'object' } }],
      temperature: 0,
      maxTokens: 128,
      stop: ['stop'],
      sessionId: 'session' as NonNullable<GenerateOptions['sessionId']>,
      purpose: 'compaction',
    }

    expect(documentExpansionTokenBudget(options, 16_384)).toBeGreaterThan(0)
    expect(documentExpansionTokenBudget({
      provider: options.provider,
      model: options.model,
      messages: options.messages,
    }, 16_384)).toBeGreaterThan(0)
    expect(documentExpansionTokenBudget(options, 0)).toBe(0)
    expect(documentExpansionTokenBudget(options, 0.5)).toBe(0)
  })

  it('limits concurrent historical document reads to two', async () => {
    let active = 0
    let maximum = 0
    const readDocument = vi.fn(async (ref: Extract<ContentBlock, { type: 'document' }>['attachment']) => {
      active += 1
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active -= 1
      return { ref, data: Uint8Array.of(1), text: ref.name }
    })
    const original = createUserMessage({
      content: [document('a'), document('b'), document('c'), document('d')],
      source,
    })

    await projectDocumentsForRequest([original], projectionStore(readDocument))

    expect(readDocument).toHaveBeenCalledTimes(4)
    expect(maximum).toBe(2)
  })
})

describe('base64 request-image offload', () => {
  it('preserves every image when no payload bound is configured', () => {
    const messages = [createUserMessage({ content: [image(300)], source })]
    expect(offloadBase64(messages, undefined)).toBe(messages)
  })

  it('preserves the original request when its base64 payload fits exactly', () => {
    const messages = [createUserMessage({ content: [image(3), image(3)], source })]
    expect(offloadBase64(messages, 8)).toBe(messages)
  })

  it('keeps five 3 MiB images at 20 MiB and offloads the oldest after one more raw byte', () => {
    const rawImageBytes = 3 * 1024 * 1024
    const maxRequestImageBytes = 20 * 1024 * 1024
    const exact = [createUserMessage({
      content: Array.from({ length: 5 }, () => image(rawImageBytes)),
      source,
    })]
    expect(offloadBase64(exact, maxRequestImageBytes)).toBe(exact)

    const over = [createUserMessage({
      content: [image(rawImageBytes + 1), ...Array.from({ length: 4 }, () => image(rawImageBytes))],
      source,
    })]
    expect(offloadBase64(over, maxRequestImageBytes)[0]?.content).toEqual([
      { type: 'text', text: OMITTED },
      ...Array.from({ length: 4 }, () => image(rawImageBytes)),
    ])
  })

  it('replaces the oldest nested occurrences without mutating durable messages', () => {
    const shared = image(3)
    const messages = [
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId('shot'),
          content: [shared],
        }],
        source,
      }),
      createUserMessage({ content: [shared, image(3)], source }),
    ]

    const fitted = offloadBase64(messages, 8)
    expect(fitted).not.toBe(messages)
    expect(fitted[0]?.content).toEqual([{
      type: 'tool-result',
      toolCallId: ToolCallId('shot'),
      content: [{ type: 'text', text: OMITTED }],
    }])
    expect(fitted[1]?.content).toEqual([shared, image(3)])
    expect(messages[0]?.content[0]).toMatchObject({ type: 'tool-result', content: [shared] })
  })

  it('replaces a single image that cannot fit', () => {
    const messages = [createUserMessage({ content: [image(300)], source })]
    expect(offloadBase64(messages, 8)[0]?.content)
      .toEqual([{ type: 'text', text: OMITTED }])
  })

  it('keeps unchanged nested content while replacing a later image', () => {
    const nested = {
      type: 'tool-result' as const,
      toolCallId: ToolCallId('text-only'),
      content: [{ type: 'text' as const, text: 'kept' }],
    }
    const messages = [createUserMessage({ content: [nested, image(3)], source })]
    expect(offloadBase64(messages, 1)[0]?.content).toEqual([
      nested,
      { type: 'text', text: OMITTED },
    ])
  })
})

describe('offloadedImagePrefixCount', () => {
  it('removes nothing under unbounded budgets and whole quanta past them', () => {
    const lengths = [4, 4, 4, 4]
    expect(offloadedImagePrefixCount(lengths, {})).toBe(0)
    expect(offloadedImagePrefixCount(lengths, { maxBytes: 16 })).toBe(0)
    expect(offloadedImagePrefixCount(lengths, { maxImages: 4 })).toBe(0)
    // One excess image rounds up to the whole count quantum.
    expect(offloadedImagePrefixCount([...lengths, 4], { maxImages: 4, countQuantum: 2 })).toBe(2)
    // One excess byte removes a whole byte quantum, crossing the second image.
    expect(offloadedImagePrefixCount([...lengths, 1], { maxBytes: 16, byteQuantum: 5 })).toBe(2)
  })
})

describe('offloadRequestImagesWithPolicy', () => {
  it('drops 129 MiB to 64 MiB and keeps the removed prefix stable through 192 MiB', () => {
    const mib = 1024 * 1024
    const project = (count: number) => offloadRequestImagesWithPolicy([
      createUserMessage({ content: Array.from({ length: count }, () => image(mib)), source }),
    ], {
      representation: 'raw',
      maxBytes: 128 * mib,
      byteQuantum: 64 * mib,
      placeholder: () => OMITTED,
    })[0]?.content

    expect(project(128)?.filter(block => block.type === 'image')).toHaveLength(128)
    expect(project(129)?.filter(block => block.type === 'text')).toHaveLength(65)
    expect(project(192)?.filter(block => block.type === 'text')).toHaveLength(65)
    expect(project(193)?.filter(block => block.type === 'text')).toHaveLength(129)
  })

  it('rounds a count excess up to a 20-image removal step', () => {
    const projected = offloadRequestImagesWithPolicy([
      createUserMessage({ content: Array.from({ length: 601 }, () => image(1)), source }),
    ], {
      representation: 'raw',
      maxImages: 600,
      countQuantum: 20,
      placeholder: () => OMITTED,
    })
    expect(projected[0]?.content.filter(block => block.type === 'text')).toHaveLength(20)
    expect(projected[0]?.content.filter(block => block.type === 'image')).toHaveLength(581)
  })

  it('uses route-owned request byte lengths when supplied', () => {
    const messages = [createUserMessage({ content: [image(100), image(100)], source })]
    const projected = offloadRequestImagesWithPolicy(messages, {
      representation: 'raw',
      maxBytes: 3,
      byteLength: () => 2,
      placeholder: () => OMITTED,
    })
    expect(projected[0]?.content).toEqual([
      { type: 'text', text: OMITTED },
      image(100),
    ])
  })

  it('builds a distinct placeholder from each omitted attachment', () => {
    const first = image(3)
    const second = image(3)
    first.attachment = { ...first.attachment, name: 'first.png' }
    second.attachment = { ...second.attachment, name: 'second.png' }
    const projected = offloadRequestImagesWithPolicy([
      createUserMessage({ content: [first, second], source }),
    ], {
      representation: 'raw',
      maxBytes: 3,
      placeholder: ref => `omitted:${ref.name}`,
    })
    expect(projected[0]?.content).toEqual([
      { type: 'text', text: 'omitted:first.png' },
      second,
    ])
  })
})

describe('model-facing image access', () => {
  it('describes the request preview, immutable normalized path, and source uncertainty', () => {
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 4_000,
      width: 2048,
      height: 1536,
      name: 'source "map".png',
    }
    const access = { readonlyPath: '/tmp/.dsh/attachments/v1/objects/bb/object' }
    const version = {
      variantId: ImageVariantId(`sha256:${'c'.repeat(64)}`),
      attachment,
      data: Uint8Array.of(1),
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 923,
      height: 692,
      depth: 'uchar' as const,
      space: 'srgb' as const,
      hasAlpha: true,
    }
    expect(requestImageHandleText(attachment, version, access)).toBe(
      `Image "source \\"map\\".png" (${attachment.attachmentId}); request preview 923x692px.`
      + ' Normalized copy (read-only; may be resized or re-encoded): "/tmp/.dsh/attachments/v1/objects/bb/object" (2048x1536px, image/png).'
      + ' Source dimensions, format, and byte size may differ.'
      + ' Copy to a writable path ending in .png before editing.',
    )
  })

  it('bridges a provider host object only through the mounted filesystem mapping', () => {
    const attachment = image(1).attachment
    const attachments = {
      imageHostPath: () => '/host/.dsh/attachments/object',
    } as unknown as AttachmentStore
    const mapped = (hostPath: string): string | undefined => hostPath === '/host/.dsh/attachments/object'
      ? '/workspace/.attachments/object'
      : undefined
    expect(resolveImageAttachmentAccess(
      attachments,
      mapped,
      attachment,
    )).toEqual({ readonlyPath: '/workspace/.attachments/object' })
    expect(resolveImageAttachmentAccess(
      attachments,
      () => undefined,
      attachment,
    )).toBeUndefined()
    expect(resolveImageAttachmentAccess(
      { imageHostPath: () => undefined } as unknown as AttachmentStore,
      mapped,
      attachment,
    )).toBeUndefined()
  })

  it('names each occurrence from its own reference when one prepared version is shared', () => {
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 4_000,
      width: 8,
      height: 8,
      name: 'second.png',
    }
    const version = {
      variantId: ImageVariantId(`sha256:${'c'.repeat(64)}`),
      attachment,
      data: Uint8Array.of(1),
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 8,
      height: 8,
      depth: 'uchar' as const,
      space: 'srgb' as const,
      hasAlpha: false,
    }
    expect(requestImageHandleText({ ...attachment, name: 'first.png' }, version))
      .toContain('"first.png"')
  })

  it('keeps a useful omission identity with and without a local path', () => {
    const ref = {
      attachmentId: AttachmentId(`sha256:${'d'.repeat(64)}`),
      mediaType: 'image/jpeg' as const,
      bytes: 10,
      width: 10,
      height: 5,
      name: 'photo.jpg',
    }
    expect(offloadedImageText(ref)).toContain('No local normalized image path is available')
    expect(offloadedImageText(ref, { readonlyPath: '/tmp/object' })).toBe(
      `[image omitted to fit request image limits; "photo.jpg" (${ref.attachmentId}).`
      + ' Normalized copy (read-only; may be resized or re-encoded): "/tmp/object" (10x5px, image/jpeg).'
      + ' Source dimensions, format, and byte size may differ.'
      + ' Copy to a writable path ending in .jpg before editing.]',
    )
  })

  it.each([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
  ] as const)('names the writable extension for %s', (mediaType, suffix) => {
    const ref = {
      attachmentId: AttachmentId(`sha256:${'e'.repeat(64)}`),
      mediaType,
      bytes: 1,
      width: 1,
      height: 1,
    }
    expect(offloadedImageText(ref, { readonlyPath: '/tmp/object' }))
      .toContain(`writable path ending in ${suffix}`)
  })

  it('rejects a media type that escaped the closed union at runtime', () => {
    const ref = {
      attachmentId: AttachmentId(`sha256:${'e'.repeat(64)}`),
      mediaType: 'image/tiff' as unknown as ImageMediaType,
      bytes: 1,
      width: 1,
      height: 1,
    }
    expect(() => offloadedImageText(ref, { readonlyPath: '/tmp/object' }))
      .toThrow('unreachable variant in image extension: "image/tiff"')
  })
})

describe('projectImagesForTextModel', () => {
  it('returns image-free history unchanged', () => {
    const messages = [createUserMessage({ content: [{ type: 'text', text: 'plain' }], source })]
    expect(projectImagesForTextModel(messages)).toBe(messages)
  })

  it('replaces direct and nested images while retaining unaffected messages and blocks', () => {
    const plain = createUserMessage({ content: [{ type: 'text', text: 'plain' }], source })
    const nested = {
      type: 'tool-result' as const,
      toolCallId: ToolCallId('nested-image'),
      content: [{ type: 'text' as const, text: 'before' }, image(3), { type: 'text' as const, text: 'after' }],
    }
    const unchangedNested = {
      type: 'tool-result' as const,
      toolCallId: ToolCallId('text-only'),
      content: [{ type: 'text' as const, text: 'unchanged' }],
    }
    const visual = createUserMessage({
      content: [{ type: 'text', text: 'lead' }, image(3), unchangedNested, nested],
      source,
    })

    const projected = projectImagesForTextModel([plain, visual])
    expect(projected[0]).toBe(plain)
    expect(projected[1]?.content).toEqual([
      { type: 'text', text: 'lead' },
      { type: 'text', text: '[image omitted because this model accepts text only; attachment sha256:aaaaaaaa]' },
      unchangedNested,
      {
        ...nested,
        content: [
          { type: 'text', text: 'before' },
          { type: 'text', text: '[image omitted because this model accepts text only; attachment sha256:aaaaaaaa]' },
          { type: 'text', text: 'after' },
        ],
      },
    ])
  })
})
