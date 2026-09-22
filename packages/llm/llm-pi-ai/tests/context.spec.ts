import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, ImageVariantId, promptAttachmentBase64CodeUnits } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { ToolCallId, createMessage, createUserMessage, offloadedImageText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { toPiContext } from '../src/context.ts'
import type { PiImageRequestContext } from '../src/context.ts'
import { toPiAssistant } from '../src/replay.ts'

const ref: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

function requestImage(value: ImageAttachmentRef, data: Uint8Array): RequestImageAttachment {
  return {
    variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`),
    attachment: value,
    data,
    mediaType: value.mediaType,
    bytes: data.byteLength,
    width: value.width,
    height: value.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: value.mediaType === 'image/png',
  }
}

function projectionStore(
  readImageRequest: (
    value: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ) => Promise<RequestImageAttachment> = vi.fn((value: ImageAttachmentRef) => (
    Promise.resolve(requestImage(value, Uint8Array.of(1)))
  )),
): AttachmentStore {
  return { readImageRequest, imageHostPath: () => undefined } as unknown as AttachmentStore
}

const attachments = projectionStore()

function imageContext(
  store: AttachmentStore,
  overrides: Partial<Omit<PiImageRequestContext, 'attachments'>> = {},
): PiImageRequestContext {
  return { attachments: store, resolveImageAccess: () => undefined, ...overrides }
}

function imageProjectionBytes(messages: readonly { content: unknown }[]): number {
  let bytes = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      if (message.content.startsWith('[image omitted')) bytes += Buffer.byteLength(message.content, 'utf8')
      continue
    }
    for (const block of message.content as readonly unknown[]) {
      const typed = block as { type?: string; data?: string; text?: string }
      if (typed.type === 'image') bytes += typed.data?.length ?? 0
      else if (typed.type === 'text' && typed.text?.startsWith('[image omitted')) {
        bytes += Buffer.byteLength(typed.text, 'utf8')
      }
    }
  }
  return bytes
}

function request(messages: GenerateOptions['messages']): GenerateOptions {
  return {
    provider: 'openai',
    model: 'gpt-4.1',
    system: 'system prompt',
    tools: [{ name: 'lookup', description: 'look up', parameters: { type: 'object' } }],
    messages,
  }
}

function user(content: ContentBlock[]): Message {
  return createUserMessage({ content, source: { kind: 'plugin', plugin: 'test' } })
}

function history(role: 'system' | 'assistant', content: ContentBlock[]): Message {
  return createMessage({ role, content, source: { kind: 'plugin', plugin: 'test' } })
}

describe('pi-ai request context conversion', () => {
  it('omits absent and empty request-level optional fields', () => {
    const base = { provider: 'openai', model: 'gpt-4.1', messages: [] }
    expect(toPiContext(base)).toEqual({ messages: [] })
    expect(toPiContext({ ...base, tools: [] })).toEqual({ messages: [] })
  })

  it('keeps text-only history unchanged when an image-only budget is present', async () => {
    const context = await toPiContext(
      request([user([{ type: 'text', text: 'no images here' }])]),
      imageContext(attachments, { maxRequestImageBytes: 1 }),
    )

    expect(context.messages).toEqual([{ role: 'user', content: 'no images here', timestamp: 0 }])
  })

  it('converts complete text-only history and rejects nested images without storage', () => {
    const callId = ToolCallId('call-1')
    expect(toPiContext(request([
      history('system', [{ type: 'text', text: 'history system' }]),
      history('assistant', [{ type: 'tool-call', id: callId, name: 'lookup', arguments: '{}' }]),
      user([
        { type: 'text', text: 'after tool' },
        {
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: '' }],
        },
      ]),
    ]))).toMatchObject({
      systemPrompt: 'system prompt',
      tools: [{ name: 'lookup' }],
      messages: [
        { role: 'user', content: 'history system' },
        { role: 'assistant' },
        { role: 'user', content: 'after tool' },
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'lookup',
          content: [{ type: 'text', text: '(no output)' }],
          isError: false,
        },
      ],
    })

    expect(() => toPiContext(request([user([{
      type: 'tool-result',
      toolCallId: callId,
      content: [{ type: 'image', attachment: ref }],
    }])]))).toThrow(/durable attachment service/)
  })

  it('resolves user and tool-result images while preserving explicit fallbacks', async () => {
    const callId = ToolCallId('missing-call')
    const knownCallId = ToolCallId('known-call')
    const context = await toPiContext(request([
      user([{ type: 'text', text: '' }]),
      history('assistant', [
        { type: 'text', text: 'calling' },
        { type: 'tool-call', id: knownCallId, name: 'lookup', arguments: '{}' },
      ]),
      user([
        { type: 'image', attachment: ref },
        { type: 'text', text: 'caption' },
        { type: 'reasoning', text: 'ignored' },
      ]),
      user([{
        type: 'tool-result',
        toolCallId: knownCallId,
        content: [{ type: 'text', text: '' }],
      }]),
      user([{
        type: 'tool-result',
        toolCallId: callId,
        isError: true,
        content: [
          { type: 'tool-result', toolCallId: callId, content: [] },
          { type: 'image', attachment: ref },
        ],
      }]),
    ]), imageContext(attachments))

    expect(context.messages).toEqual([
      { role: 'user', content: '', timestamp: 0 },
      expect.objectContaining({ role: 'assistant' }),
      {
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}`) as string },
          { type: 'image', data: 'AQ==', mimeType: 'image/png' },
          { type: 'text', text: 'caption' },
        ],
        timestamp: 0,
      },
      {
        role: 'toolResult',
        toolCallId: 'known-call',
        toolName: 'lookup',
        content: [{ type: 'text', text: '(no output)' }],
        isError: false,
        timestamp: 0,
      },
      {
        role: 'toolResult',
        toolCallId: 'missing-call',
        toolName: 'unknown',
        content: [
          { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}`) as string },
          { type: 'image', data: 'AQ==', mimeType: 'image/png' },
        ],
        isError: true,
        timestamp: 0,
      },
    ])
  })

  it('uses the shared normalized-path description for retained images', async () => {
    const named = { ...ref, name: 'chart.png', width: 2048, height: 1024 }
    const store = projectionStore(value => Promise.resolve({
      ...requestImage(value, Uint8Array.of(1)),
      width: 1130,
      height: 565,
    }))
    const context = await toPiContext(request([user([{ type: 'image', attachment: named }])]), imageContext(store, {
      resolveImageAccess: () => ({ readonlyPath: '/tmp/dsh/objects/aa/object' }),
    }))
    expect(context.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: expect.stringContaining('Image "chart.png"') as string },
        { type: 'image' },
      ],
    })
    expect(JSON.stringify(context.messages[0])).toContain('/tmp/dsh/objects/aa/object')
    expect(JSON.stringify(context.messages[0])).toContain('request preview 1130x565px')
  })

  it('recursively converts nested tool-result text and images', async () => {
    const callId = ToolCallId('nested-call')
    const context = await toPiContext(request([user([{
      type: 'tool-result',
      toolCallId: callId,
      content: [
        {
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: 'nested text' }],
        },
        {
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'image', attachment: ref }],
        },
      ],
    }])]), imageContext(attachments))

    expect(context.messages).toEqual([{
      role: 'toolResult',
      toolCallId: 'nested-call',
      toolName: 'unknown',
      content: [
        { type: 'text', text: 'nested text' },
        { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}`) as string },
        { type: 'image', data: 'AQ==', mimeType: 'image/png' },
      ],
      isError: false,
      timestamp: 0,
    }])
  })

  it('flattens nested text-only tool results and ignores other block types without storage', () => {
    const callId = ToolCallId('nested-text')
    expect(toPiContext(request([user([{
      type: 'tool-result',
      toolCallId: callId,
      content: [
        { type: 'chart', data: 'ignored' } as unknown as ContentBlock,
        {
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: 'nested' }],
        },
      ],
    }])]))).toMatchObject({
      messages: [{
        role: 'toolResult',
        content: [{ type: 'text', text: 'nested' }],
      }],
    })
  })

  it('replaces the oldest images with placeholders once the request payload bound is exceeded', async () => {
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3)))
    ))
    const store = projectionStore(readImageRequest)
    const sized: ImageAttachmentRef = { ...ref, bytes: 512 }
    const callId = ToolCallId('shot-call')
    // Three 3-byte images cost 4 base64 characters each (12 total); leave room
    // for the oldest placeholder and two retained images, including one nested
    // in a tool result.
    const bound = Buffer.byteLength(offloadedImageText(sized), 'utf8')
      + promptAttachmentBase64CodeUnits(sized.bytes) * 2
    const context = await toPiContext(request([
      user([{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'image', attachment: sized }],
      }]),
      user([{ type: 'image', attachment: sized }, { type: 'text', text: 'newer' }]),
      user([{ type: 'image', attachment: sized }]),
    ]), imageContext(store, { maxRequestImageBytes: bound }))

    expect(context.messages).toEqual([
      {
        role: 'toolResult',
        toolCallId: 'shot-call',
        toolName: 'unknown',
        content: [{ type: 'text', text: offloadedImageText(sized) }],
        isError: false,
        timestamp: 0,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining(`Image ${sized.attachmentId}`) as string },
          { type: 'image', data: 'AQID', mimeType: 'image/png' },
          { type: 'text', text: 'newer' },
        ],
        timestamp: 0,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining(`Image ${sized.attachmentId}`) as string },
          { type: 'image', data: 'AQID', mimeType: 'image/png' },
        ],
        timestamp: 0,
      },
    ])
    expect(readImageRequest).toHaveBeenCalledTimes(1)
  })

  it('replaces enough images that the placeholders they leave still fit the bound', async () => {
    // Replacing an image frees its base64 bytes but adds the text that stands
    // in for it, so the payload the request carries is not monotone in the
    // removal count: omitting one image can make the request larger. Counting
    // only image bytes therefore accepts a projection whose own placeholders
    // push it past the bound — the size rejection the bound exists to prevent.
    //
    // Four distinct 512-byte images under a 2052-code-unit bound: keeping
    // three costs exactly 2052, and the one placeholder costs 220 more.
    const count = 4
    const bound = 2052
    const sized: ImageAttachmentRef = { ...ref, bytes: 512 }
    const store = projectionStore(vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, new Uint8Array(value.bytes)))
    )))
    const history = Array.from({ length: count }, (_, index) => user([{
      type: 'image',
      attachment: {
        ...sized,
        attachmentId: AttachmentId(`sha256:${String(index).padStart(4, '0').repeat(16)}`),
        name: `shot-${index}.png`,
      },
    }]))

    const context = await toPiContext(request(history), {
      attachments: store,
      resolveImageAccess: () => undefined,
      maxRequestImageBytes: bound,
      requestImagePolicy: { maxPixels: 2048 * 2048, maxBytes: 512 },
    })

    // An image message keeps typed blocks and carries its image as base64; a
    // message whose images were all replaced flattens to one plain string
    // holding their placeholders. Only typed blocks hold image bytes.
    let imageBytes = 0
    let placeholderText = 0
    for (const message of context.messages) {
      const content = message.content as unknown
      if (typeof content === 'string') {
        if (content.startsWith('[image omitted')) placeholderText += content.length
        continue
      }
      for (const block of content as readonly unknown[]) {
        const typed = block as { type?: string; data?: string; text?: string }
        if (typed.type === 'image') imageBytes += typed.data?.length ?? 0
        else if (typed.type === 'text' && typed.text?.startsWith('[image omitted')) {
          placeholderText += typed.text.length
        }
      }
    }

    expect(placeholderText).toBeGreaterThan(0)
    expect(imageBytes + placeholderText).toBeLessThanOrEqual(bound)
  })

  it('charges every repeated occurrence while preparing one shared request image', async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 512 }
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, new Uint8Array(value.bytes)))
    ))
    const context = await toPiContext(request([user(Array.from({ length: 4 }, () => ({
      type: 'image' as const,
      attachment: sized,
    })))]), imageContext(projectionStore(readImageRequest), {
      maxRequestImageBytes: 2052,
      requestImagePolicy: { maxPixels: 2048 * 2048, maxBytes: 512 },
    }))

    expect(imageProjectionBytes(context.messages)).toBeLessThanOrEqual(2052)
    expect(readImageRequest).toHaveBeenCalledTimes(1)
  })

  it('rechecks the image projection after retained request versions are encoded', async () => {
    const refs = Array.from({ length: 3 }, (_, index) => ({
      ...ref,
      attachmentId: AttachmentId(`sha256:${String(index).padStart(4, '0').repeat(16)}`),
      bytes: 512,
    }))
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, new Uint8Array(1024)))
    ))
    const context = await toPiContext(request([user(refs.map(attachment => ({
      type: 'image' as const,
      attachment,
    })))]), imageContext(projectionStore(readImageRequest), {
      maxRequestImageBytes: 1500,
      requestImagePolicy: { maxPixels: 2048 * 2048, maxBytes: 512 },
    }))

    expect(imageProjectionBytes(context.messages)).toBeLessThanOrEqual(1500)
    expect(readImageRequest).toHaveBeenCalledTimes(1)
  })

  it('fails explicitly when image placeholders alone exceed the image budget', async () => {
    const readImageRequest = vi.fn()
    await expect(toPiContext(request([user([{ type: 'image', attachment: ref }])]), imageContext(
      projectionStore(readImageRequest),
      { maxRequestImageBytes: 1 },
    ))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('placeholders alone exceed the image budget') as string,
    })
    expect(readImageRequest).not.toHaveBeenCalled()
  })

  it('does not prepare an old image removed by the conservative request projection', async () => {
    const old = { ...ref, attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`), bytes: 512 }
    const recent = { ...ref, attachmentId: AttachmentId(`sha256:${'d'.repeat(64)}`), bytes: 512 }
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => {
      if (value.attachmentId === old.attachmentId) throw new Error('old image must not be read')
      return Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3)))
    })

    const context = await toPiContext(request([user([
      { type: 'image', attachment: old },
      { type: 'image', attachment: recent },
    ])]), imageContext(projectionStore(readImageRequest), {
      maxRequestImageBytes: Buffer.byteLength(offloadedImageText(old), 'utf8')
        + promptAttachmentBase64CodeUnits(old.bytes),
    }))

    expect(context.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: offloadedImageText(old) },
        { type: 'text', text: expect.stringContaining(String(recent.attachmentId)) as string },
        { type: 'image' },
      ],
    })
    expect(readImageRequest).toHaveBeenCalledTimes(1)
    expect(readImageRequest.mock.calls[0]?.[0]).toEqual(recent)
  })

  it('uses independently resolved access when exact encoded bytes require offload', async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 512 }
    const access = { readonlyPath: '/tmp/dsh-normalized-image' }
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => Promise.resolve({
      ...requestImage(value, new Uint8Array(1024)),
    }))

    const context = await toPiContext(request([
      user([
        { type: 'image', attachment: sized },
        { type: 'image', attachment: { ...sized, name: 'second.png' } },
        { type: 'image', attachment: { ...sized, name: 'third.png' } },
      ]),
    ]), imageContext(projectionStore(readImageRequest), {
      maxRequestImageBytes: 1500,
      resolveImageAccess: () => access,
      requestImagePolicy: { maxPixels: 2048 * 2048, maxBytes: 512 },
    }))

    const content = context.messages[0]?.content
    if (typeof content !== 'string') throw new Error('expected a collapsed user text content')
    expect(content).toContain('Normalized copy')
    expect(content).toContain('"second.png"')
    expect(content).toContain('"third.png"')
    expect(imageProjectionBytes(context.messages)).toBeLessThanOrEqual(1500)
    expect(readImageRequest).toHaveBeenCalledTimes(1)
  })

  it('fails before reading when no image projection can fit its placeholders', async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 512 }
    await expect(toPiContext(request([
      user([{ type: 'image', attachment: sized }]),
      user([{ type: 'image', attachment: sized }]),
    ]), imageContext(attachments, { maxRequestImageBytes: 8 }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

    const readImageRequest = vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, new Uint8Array(300)))
    ))
    const store = projectionStore(readImageRequest)
    await expect(toPiContext(request([
      user([{ type: 'image', attachment: { ...ref, bytes: 300 } }]),
    ]), imageContext(store, { maxRequestImageBytes: 8 }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(readImageRequest).not.toHaveBeenCalled()
  })

  it('fails closed when history changes between image preparation and exact projection', async () => {
    const original = { ...ref, bytes: 512 }
    const replacement = {
      ...original,
      attachmentId: AttachmentId(`sha256:${'e'.repeat(64)}`),
    }
    const mutable = structuredClone(user([{ type: 'image', attachment: original }]))
    const readImageRequest = vi.fn(async (value: ImageAttachmentRef) => {
      mutable.content[0] = { type: 'image', attachment: replacement }
      return requestImage(value, Uint8Array.of(1))
    })

    await expect(toPiContext(request([mutable]), imageContext(projectionStore(readImageRequest), {
      maxRequestImageBytes: 1500,
      requestImagePolicy: { maxPixels: 2048 * 2048, maxBytes: 512 },
    }))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('was not prepared') as string,
    })
  })

  it('offloads repeated image-block occurrences by position rather than shared object identity', async () => {
    const sized: ImageAttachmentRef = { ...ref, bytes: 512 }
    const shared: ContentBlock = { type: 'image', attachment: sized }
    const readImageRequest = vi.fn((value: ImageAttachmentRef) => (
      Promise.resolve(requestImage(value, Uint8Array.of(1, 2, 3)))
    ))
    const store = projectionStore(readImageRequest)
    const bound = Buffer.byteLength(offloadedImageText(sized), 'utf8')
      + promptAttachmentBase64CodeUnits(sized.bytes)
    const aliased = await toPiContext(
      request([user([shared, shared])]),
      imageContext(store, { maxRequestImageBytes: bound }),
    )
    const replayed = await toPiContext(request([user([
      { type: 'image', attachment: { ...sized } },
      { type: 'image', attachment: { ...sized } },
    ])]), imageContext(store, { maxRequestImageBytes: bound }))

    const expected = [{
      role: 'user',
      content: [
        { type: 'text', text: offloadedImageText(sized) },
        { type: 'text', text: expect.stringContaining(`Image ${sized.attachmentId}`) as string },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
      ],
      timestamp: 0,
    }]
    expect(aliased.messages).toEqual(expected)
    expect(replayed.messages).toEqual(expected)
    expect(readImageRequest).toHaveBeenCalledTimes(2)
  })

  it('keeps empty text-only users while separating result-only messages', () => {
    const callId = ToolCallId('unknown-call')
    expect(toPiContext(request([
      user([]),
      history('assistant', [
        { type: 'text', text: 'answer' },
        { type: 'tool-call', id: ToolCallId('other-call'), name: 'lookup', arguments: '{}' },
      ]),
      user([{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text: 'result' }],
      }]),
    ]))).toMatchObject({
      messages: [
        { role: 'user', content: '' },
        { role: 'assistant' },
        { role: 'toolResult', toolName: 'unknown' },
      ],
    })
  })

  it('handles in-history system and assistant messages explicitly on the image path', async () => {
    for (const role of ['system', 'assistant'] as const) {
      const readImageRequest = vi.fn()
      const store = projectionStore(readImageRequest)
      await expect(toPiContext(request([
        history(role, [{ type: 'image', attachment: ref }]),
      ]), imageContext(store, { maxRequestImageBytes: 1 }))).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
      expect(readImageRequest).not.toHaveBeenCalled()
    }

    await expect(toPiContext(request([
      history('system', [{ type: 'text', text: 'history system' }]),
      history('assistant', [{ type: 'text', text: 'answer' }]),
      user([{ type: 'text', text: 'plain' }]),
    ]), imageContext(attachments))).resolves.toMatchObject({
      messages: [
        { role: 'user', content: 'history system' },
        { role: 'assistant' },
        { role: 'user', content: 'plain' },
      ],
    })

    expect(() => toPiAssistant(
      history('assistant', [{ type: 'image', attachment: ref }]),
    )).toThrow(/assistant image output/)
  })

})

describe('pi-ai system prompt source', () => {
  const base = { provider: 'openai', model: 'gpt-4.1' }
  const leading = history('system', [{ type: 'text', text: 'lead ' }, { type: 'text', text: 'rule' }])
  const question = user([{ type: 'text', text: 'hi' }])

  it.each<{ label: string; content: ContentBlock[] }>([
    { label: 'image-only', content: [{ type: 'image', attachment: ref }] },
    { label: 'text and image', content: [{ type: 'text', text: 'rule' }, { type: 'image', attachment: ref }] },
    {
      label: 'nested image',
      content: [{
        type: 'tool-result',
        toolCallId: ToolCallId('system-image'),
        content: [{ type: 'image', attachment: ref }],
      }],
    },
  ])('rejects a leading system $label on both conversion paths', async ({ content }) => {
    const options: GenerateOptions = { ...base, messages: [history('system', content), question] }
    const error = {
      code: 'UNSUPPORTED_CONTENT',
      message: 'pi-ai cannot represent an image in an in-history system message',
    }
    expect(() => toPiContext(options)).toThrow(error.message)
    const readImageRequest = vi.fn()
    await expect(toPiContext(options, imageContext(projectionStore(readImageRequest)))).rejects.toMatchObject(error)
    expect(readImageRequest).not.toHaveBeenCalled()
  })

  it('maps a leading system message to systemPrompt on both conversion paths', async () => {
    const options: GenerateOptions = { ...base, messages: [leading, question] }
    const expected = {
      systemPrompt: 'lead rule',
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    }
    expect(toPiContext(options)).toEqual(expected)
    await expect(toPiContext(options, imageContext(attachments))).resolves.toEqual(expected)
    const fromOption: GenerateOptions = { ...base, system: 'lead rule', messages: [question] }
    expect(toPiContext(options)).toEqual(toPiContext(fromOption))
    expect(await toPiContext(options, imageContext(attachments)))
      .toEqual(await toPiContext(fromOption, imageContext(attachments)))
  })

  it('sends no systemPrompt for an empty leading system message on both conversion paths', async () => {
    const options: GenerateOptions = { ...base, messages: [history('system', []), question] }
    const expected = { messages: [{ role: 'user', content: 'hi', timestamp: 0 }] }
    expect(toPiContext(options)).toEqual(expected)
    await expect(toPiContext(options, imageContext(attachments))).resolves.toEqual(expected)
  })

  it('folds a non-leading system message into a user message on both conversion paths', async () => {
    const options: GenerateOptions = { ...base, messages: [question, leading] }
    const expected = {
      messages: [
        { role: 'user', content: 'hi', timestamp: 0 },
        { role: 'user', content: 'lead rule', timestamp: 0 },
      ],
    }
    expect(toPiContext(options)).toEqual(expected)
    await expect(toPiContext(options, imageContext(attachments))).resolves.toEqual(expected)
  })

  it('lets options.system win over a leading system message, which then folds, on both conversion paths', async () => {
    const options: GenerateOptions = { ...base, system: 'direct', messages: [leading, question] }
    const expected = {
      systemPrompt: 'direct',
      messages: [
        { role: 'user', content: 'lead rule', timestamp: 0 },
        { role: 'user', content: 'hi', timestamp: 0 },
      ],
    }
    expect(toPiContext(options)).toEqual(expected)
    await expect(toPiContext(options, imageContext(attachments))).resolves.toEqual(expected)
  })
})
