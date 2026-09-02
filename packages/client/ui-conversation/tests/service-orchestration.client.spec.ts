// @vitest-environment jsdom
// ConversationController scope addressing over the runtime's real scope tag:
// TestSessions mints tagged scopes through the production createScope, so the
// service's scopeOf/binding path runs against production resolution (no local
// tag probe).
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  AttachmentId,
  promptAttachmentBase64CodeUnits,
} from '@deepseek-ai/dsh-attachment'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { QueuedMessage, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'
import { InputHub } from '../src/client/input/hub.ts'
import { UnsupportedDocumentMediaTypeError, UnsupportedImageMediaTypeError } from '../src/client/attachment-files.ts'
import { ConversationController } from '../src/client/service.ts'
import { zh } from '../src/client/locales.ts'

async function bench(readAttachment?: SessionFace['readAttachment']) {
  const runtime = await SlotTestRuntime.create()
  const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const updateQueue = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const cancel = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const loadOlder = vi.fn(() => Promise.resolve())
  await runtime.sessions.add({
    id: 's1',
    session: { prompt, updateQueue, cancel, loadOlder, ...(readAttachment === undefined ? {} : { readAttachment }) },
  })
  // config.input is required (the apply shares its hub with the inject
  // factories); the bench passes its own instance explicitly.
  const hub = new InputHub(runtime.ctx, makeTranslate(zh, {}))
  const fiber = runtime.ctx.plugin(ConversationController, {
    input: hub,
    blocks: new ComposerBlockRegistry(),
  })
  await fiber.await()
  const root = runtime.ctx.get('conversation') as ConversationController
  const scoped = runtime.sessions.scope('s1')!.get('conversation') as ConversationController
  const shell = hub.shellFor(runtime.sessions.binding('s1')!)
  return { runtime, fiber, root, scoped, hub, shell, prompt, updateQueue, cancel, loadOlder }
}

describe('ConversationController', () => {
  it('routes operations through the public Session binding', async () => {
    const b = await bench()
    await b.scoped.send('hello')
    await b.scoped.updateQueue('item-1' as never, { kind: 'remove' })
    await b.scoped.cancel()
    await b.scoped.loadOlder()
    expect(b.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello' }], 'queue')
    expect(b.updateQueue).toHaveBeenCalledWith('item-1', { kind: 'remove' })
    expect(b.cancel).toHaveBeenCalledOnce()
    expect(b.loadOlder).toHaveBeenCalledOnce()
    await b.runtime.dispose()
  })

  it('folds Session business failures into callback rejections', async () => {
    const b = await bench()
    b.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'agent-busy', message: 'busy', details: {} } } as never)
    await expect(b.scoped.send('x')).rejects.toThrow('conversation.send failed: agent-busy: busy')
    b.cancel.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'nope', details: {} } } as never)
    await expect(b.scoped.cancel()).rejects.toThrow('conversation.cancel failed: internal: nope')
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'internal', message: 'broken', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-1' as never, { kind: 'steer' }))
      .rejects.toThrow('conversation.updateQueue failed: internal: broken')
    await b.runtime.dispose()
  })

  it('treats strict-steer races as converged Queue delivery', async () => {
    const b = await bench()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'steer-unavailable', message: 'closed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-1' as never, { kind: 'steer' })).resolves.toBeUndefined()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-2' as never, { kind: 'steer' })).resolves.toBeUndefined()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-3' as never, { kind: 'remove' }))
      .rejects.toThrow('conversation.updateQueue failed: queue-item-not-found: claimed')
    await b.runtime.dispose()
  })

  it('releases draft previews when their session scope is disposed', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:draft-1')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    try {
      const [attachment] = b.root.createDraftImages([
        new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }),
      ])
      if (attachment === undefined) throw new Error('draft attachment missing')
      b.root.input.for(b.runtime.sessions.scope('s1')!).addImages([attachment.id])
      await b.runtime.sessions.remove('s1')
      expect(b.root.draftImages([attachment.id])).toEqual([])
      expect(revoked).toHaveBeenCalledWith('blob:draft-1')
    } finally {
      created.mockRestore()
      revoked.mockRestore()
    }
    await b.runtime.dispose()
  })

  it('validates every MIME type before allocating previews', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    created.mockClear()
    expect(() => b.root.createDraftImages([
      new File([Uint8Array.of(1)], 'valid.png', { type: 'image/png' }),
      new File([Uint8Array.of(2)], 'invalid.svg', { type: 'image/svg+xml' }),
    ])).toThrow(UnsupportedImageMediaTypeError)
    expect(created).not.toHaveBeenCalled()
    created.mockRestore()
    await b.runtime.dispose()
  })

  it('keeps mixed image and document order and sends document bytes without a browser path', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image')
    const image = new File([Uint8Array.of(1)], 'pixel.png', { type: 'image/png' })
    const document = new File([new TextEncoder().encode('hello')], 'notes.md', { type: 'text/markdown' })
    Object.defineProperty(image, 'arrayBuffer', { value: () => Promise.resolve(Uint8Array.of(1).buffer) })
    Object.defineProperty(document, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode('hello').buffer),
    })

    const attachments = b.root.createDraftImages([image, document])
    expect(attachments.map(attachment => attachment.kind)).toEqual(['image', 'document'])
    expect(created).toHaveBeenCalledTimes(1)
    const outcome = await b.root.sendSession(
      b.runtime.sessions.behavior('s1'),
      'review',
      attachments.map(attachment => attachment.id),
      'queue',
    )

    expect(outcome).toEqual({ kind: 'success' })
    expect(b.prompt).toHaveBeenCalledWith([
      { type: 'image', mediaType: 'image/png', data: 'AQ==', name: 'pixel.png' },
      { type: 'document', mediaType: 'text/markdown', data: 'aGVsbG8=', name: 'notes.md' },
      { type: 'text', text: 'review' },
    ], 'queue', undefined)
    expect(JSON.stringify(b.prompt.mock.calls)).not.toContain('path')
    created.mockRestore()
    await b.runtime.dispose()
  })

  it('rejects a category-valid mixed batch above the shared request carrier before reading any file', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image')
    const files = [
      new File([Uint8Array.of(1)], 'large.png', { type: 'image/png' }),
      new File([Uint8Array.of(2)], 'large.md', { type: 'text/markdown' }),
      new File([Uint8Array.of(3)], 'extra.md', { type: 'text/markdown' }),
    ]
    const sizes = [200 * 1024 * 1024, 20 * 1024 * 1024, 3 * 1024 * 1024]
    const reads = files.map((file, index) => {
      Object.defineProperty(file, 'size', { value: sizes[index] })
      return vi.spyOn(file, 'arrayBuffer')
    })
    expect(sizes.reduce((total, bytes) => total + promptAttachmentBase64CodeUnits(bytes), 0))
      .toBeGreaterThan(296 * 1024 * 1024)

    const attachments = b.root.createDraftImages(files)
    await expect(b.root.sendSession(
      b.runtime.sessions.behavior('s1'),
      'review',
      attachments.map(attachment => attachment.id),
      'queue',
    )).rejects.toMatchObject({ code: 'ATTACHMENTS_TOO_LARGE' })
    expect(reads.every(read => read.mock.calls.length === 0)).toBe(true)
    expect(b.prompt).not.toHaveBeenCalled()
    created.mockRestore()
    await b.runtime.dispose()
  })

  it('reads mixed attachments sequentially instead of retaining every raw file buffer at once', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image')
    const image = new File([Uint8Array.of(1)], 'pixel.png', { type: 'image/png' })
    const document = new File([Uint8Array.of(2)], 'notes.md', { type: 'text/markdown' })
    let releaseImage!: (value: ArrayBuffer) => void
    const imageRead = vi.spyOn(image, 'arrayBuffer').mockReturnValue(new Promise((resolve) => {
      releaseImage = resolve
    }))
    const documentRead = vi.spyOn(document, 'arrayBuffer').mockResolvedValue(Uint8Array.of(2).buffer)
    const attachments = b.root.createDraftImages([image, document])

    const sending = b.root.sendSession(
      b.runtime.sessions.behavior('s1'),
      '',
      attachments.map(attachment => attachment.id),
      'queue',
    )
    await Promise.resolve()
    expect(imageRead).toHaveBeenCalledOnce()
    expect(documentRead).not.toHaveBeenCalled()
    releaseImage(Uint8Array.of(1).buffer)
    await expect(sending).resolves.toEqual({ kind: 'success' })
    expect(documentRead).toHaveBeenCalledOnce()
    created.mockRestore()
    await b.runtime.dispose()
  })

  it('rejects executable, archive, and unknown document types before allocating previews', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    for (const name of ['payload.exe', 'archive.zip', 'legacy.doc']) {
      expect(() => b.root.createDraftImages([
        new File([Uint8Array.of(1)], name, { type: 'application/octet-stream' }),
      ])).toThrow(UnsupportedDocumentMediaTypeError)
    }
    expect(created).not.toHaveBeenCalled()
    created.mockRestore()
    await b.runtime.dispose()
  })

  it('accepts the shared extension and extensionless text-document roster', async () => {
    const b = await bench()
    const attachments = b.root.createDraftImages([
      new File(['header'], 'value.hpp', { type: '' }),
      new File(['guide'], 'README', { type: 'text/plain' }),
      new File(['title'], 'page.html', { type: 'text/html' }),
      new File(['KEY=value'], '.env', { type: 'text/plain' }),
    ])
    expect(attachments).toMatchObject([
      { kind: 'document', mediaType: 'text/plain' },
      { kind: 'document', mediaType: 'text/plain' },
      { kind: 'document', mediaType: 'text/plain' },
      { kind: 'document', mediaType: 'text/plain' },
    ])
    await b.runtime.dispose()
  })

  it('rejects arbitrary extensionless text MIME names and keeps empty-type failures bounded', async () => {
    const b = await bench()
    expect(() => b.root.createDraftImages([
      new File(['plain'], 'NOTICE-CUSTOM', { type: 'text/plain' }),
    ])).toThrow(UnsupportedDocumentMediaTypeError)
    expect(() => b.root.createDraftImages([
      new File(['plain'], '.txt', { type: 'text/plain' }),
    ])).toThrow(UnsupportedDocumentMediaTypeError)
    expect(() => b.root.createDraftImages([
      new File([Uint8Array.of(1)], '', { type: '' }),
    ])).toThrow('unsupported document type: (unnamed) (empty MIME)')
    expect(new UnsupportedImageMediaTypeError('').message).toBe('unsupported image media type: (empty)')
    await b.runtime.dispose()
  })

  it('invalidates pending historical image loads when the rendered session is released', async () => {
    const read = Promise.withResolvers<Awaited<ReturnType<SessionFace['readAttachment']>>>()
    const b = await bench(() => read.promise)
    const sessionId = b.runtime.sessions.behavior('s1').sessionId
    const attachment = {
      attachmentId: AttachmentId('image-1'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    } as const
    const pending = b.root.resolveImage(sessionId, attachment)
    b.root.releaseSessionImages(sessionId)
    read.resolve({ ok: true, value: { attachment, data: Uint8Array.of(1) } })
    await expect(pending).rejects.toThrow('historical image scope was released')
    await b.runtime.dispose()
  })

  it('fails loudly from the root scope, on an unbound session, or without SessionRuntime', async () => {
    const b = await bench()
    await expect(b.root.send('x')).rejects.toThrow(/requires a session scope/)
    await b.runtime.sessions.remove('s1')
    await expect(b.scoped.send('x')).rejects.toThrow(/resolved no binding/)
    await b.runtime.dispose()
    // No SessionRuntime at all: a bare context (the runtime always provides one).
    const bare = new Context()
    await bare.plugin(ConversationController, {
      input: new InputHub(bare, makeTranslate(zh, {})),
      blocks: new ComposerBlockRegistry(),
    }).await()
    const orphan = bare.get('conversation') as ConversationController
    await expect(orphan.send('x')).rejects.toThrow(/sessions service unavailable/)
  })
})

describe('InputHub queue steering (empty-draft accelerated Enter)', () => {
  const row = (id: string): QueuedMessage => ({
    id: id as never,
    messageId: `message-${id}` as never,
    placement: 'queued',
    content: [{ type: 'text', text: id }],
    preview: id,
    text: id,
  })

  it('steers every queued row in FIFO order and leaves steering rows alone', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), { ...row('q-2'), placement: 'steering' }, row('q-3')]
    })
    b.shell.steerQueue()
    await vi.waitFor(() => {
      expect(b.updateQueue).toHaveBeenCalledTimes(2)
    })
    expect(b.updateQueue).toHaveBeenNthCalledWith(1, 'q-1', { kind: 'steer' })
    expect(b.updateQueue).toHaveBeenNthCalledWith(2, 'q-3', { kind: 'steer' })
    expect(b.shell.notices.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('converges silently when the turn closes or a row is claimed mid-steer', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), row('q-2')]
    })
    // The turn closes before the second row: the flush stops, silently.
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'steer-unavailable', message: 'closed', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => { expect(b.updateQueue).toHaveBeenCalledTimes(1) })
    expect(b.shell.notices.getSnapshot()).toBeNull()

    // A row the host already claimed (e.g. a repeated empty-draft chord):
    // the duplicate strict steer is a silent no-op.
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-3')]
    })
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => { expect(b.updateQueue).toHaveBeenCalledTimes(2) })
    expect(b.shell.notices.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('surfaces one notice on a genuine steer failure and stops', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), row('q-2')]
    })
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'internal', message: 'broken', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => {
      expect(b.shell.notices.getSnapshot()).toEqual(
        expect.objectContaining({ level: 'error', text: '插话发送失败，请重试。' }),
      )
    })
    expect(b.updateQueue).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('no-ops without queued rows', async () => {
    const b = await bench()
    b.shell.steerQueue()
    expect(b.updateQueue).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })
})
