import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, DocumentAttachmentLimits, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import {
  CallId,
  contentHasDocument,
  contentHasImage,
  createUserMessage,
  documentExpansionTokenBudget,
  OFFLOADED_DOCUMENT_TEXT,
  OFFLOADED_IMAGE_TEXT,
  offloadRequestImages,
  offloadRequestImagesWithPolicy,
  projectDocumentsForRequest,
  projectImagesForTextModel,
  requestImageHandleText,
} from '../src/index.ts'
import type { ContentBlock, GenerateOptions } from '../src/index.ts'

const source = { kind: 'plugin' as const, plugin: 'test' }

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
      toolCallId: CallId('plain'),
      content: [{ type: 'text' as const, text: 'plain' }],
    }
    expect(contentHasImage([textOnlyToolResult])).toBe(false)
    expect(contentHasDocument([textOnlyToolResult])).toBe(false)
    expect(contentHasImage([{ ...textOnlyToolResult, content: [image(3)] }])).toBe(true)
    expect(contentHasDocument([{ ...textOnlyToolResult, content: [document()] }])).toBe(true)
    const attachment = image(3).attachment
    expect(requestImageHandleText({ attachment, width: 2, height: 3 } as RequestImageAttachment))
      .toBe(`Image ${attachment.attachmentId}; request image 2x3px.`)
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
      toolCallId: CallId('doc'),
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
      toolCallId: CallId('plain-tool'),
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
      toolCallId: CallId('result'),
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
          { type: 'tool-call', id: CallId('call'), name: 'tool', arguments: '{}' },
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

describe('offloadRequestImages', () => {
  it('preserves every image when no payload bound is configured', () => {
    const messages = [createUserMessage({ content: [image(300)], source })]
    expect(offloadRequestImages(messages, undefined)).toBe(messages)
  })

  it('preserves the original request when its base64 payload fits exactly', () => {
    const messages = [createUserMessage({ content: [image(3), image(3)], source })]
    expect(offloadRequestImages(messages, 8)).toBe(messages)
  })

  it('keeps five 3 MiB images at 20 MiB and offloads the oldest after one more raw byte', () => {
    const rawImageBytes = 3 * 1024 * 1024
    const maxRequestImageBytes = 20 * 1024 * 1024
    const exact = [createUserMessage({
      content: Array.from({ length: 5 }, () => image(rawImageBytes)),
      source,
    })]
    expect(offloadRequestImages(exact, maxRequestImageBytes)).toBe(exact)

    const over = [createUserMessage({
      content: [image(rawImageBytes + 1), ...Array.from({ length: 4 }, () => image(rawImageBytes))],
      source,
    })]
    expect(offloadRequestImages(over, maxRequestImageBytes)[0]?.content).toEqual([
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
      ...Array.from({ length: 4 }, () => image(rawImageBytes)),
    ])
  })

  it('replaces the oldest nested occurrences without mutating durable messages', () => {
    const shared = image(3)
    const messages = [
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('shot'),
          content: [shared],
        }],
        source,
      }),
      createUserMessage({ content: [shared, image(3)], source }),
    ]

    const fitted = offloadRequestImages(messages, 8)
    expect(fitted).not.toBe(messages)
    expect(fitted[0]?.content).toEqual([{
      type: 'tool-result',
      toolCallId: CallId('shot'),
      content: [{ type: 'text', text: OFFLOADED_IMAGE_TEXT }],
    }])
    expect(fitted[1]?.content).toEqual([shared, image(3)])
    expect(messages[0]?.content[0]).toMatchObject({ type: 'tool-result', content: [shared] })
  })

  it('replaces a single image that cannot fit', () => {
    const messages = [createUserMessage({ content: [image(300)], source })]
    expect(offloadRequestImages(messages, 8)[0]?.content)
      .toEqual([{ type: 'text', text: OFFLOADED_IMAGE_TEXT }])
  })

  it('keeps unchanged nested content while replacing a later image', () => {
    const nested = {
      type: 'tool-result' as const,
      toolCallId: CallId('text-only'),
      content: [{ type: 'text' as const, text: 'kept' }],
    }
    const messages = [createUserMessage({ content: [nested, image(3)], source })]
    expect(offloadRequestImages(messages, 1)[0]?.content).toEqual([
      nested,
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
    ])
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
    })
    expect(projected[0]?.content).toEqual([
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
      image(100),
    ])
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
      toolCallId: CallId('nested-image'),
      content: [{ type: 'text' as const, text: 'before' }, image(3), { type: 'text' as const, text: 'after' }],
    }
    const unchangedNested = {
      type: 'tool-result' as const,
      toolCallId: CallId('text-only'),
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
