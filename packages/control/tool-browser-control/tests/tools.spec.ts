import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  BrowserControl,
  BrowserControlError,
  BrowserRef,
  ControlLeaseId,
  ImmutablePng,
  PngTransferId,
  type BrowserActionRequest,
  type BrowserActionResult,
  type BrowserSnapshotEnvelope,
  type BrowserSnapshotRequest,
  type ControlLeaseAcquireRequest,
  type ControlLeaseAcquireResult,
  type SessionIdType,
} from '@deepseek-ai/dsh-browser-control'
import * as BrowserTools from '../src/index.ts'

const NAMES = [
  'browser_back', 'browser_click', 'browser_forward', 'browser_key',
  'browser_navigate', 'browser_reload', 'browser_scroll', 'browser_select',
  'browser_snapshot', 'browser_stop', 'browser_type', 'browser_wait',
] as const

const REF_1 = 'browser:00000000000000000000000000000001'
const REF_2 = 'browser:00000000000000000000000000000002'
const REF_3 = 'browser:00000000000000000000000000000003'
const REF_4 = 'browser:00000000000000000000000000000004'
const SECRET_REF = 'browser:00000000000000000000000000000005'
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

const LEASE = Object.freeze({
  leaseId: ControlLeaseId('00000000-0000-4000-8000-000000000101'),
  leaseRevision: 7,
  surfaceKind: 'browser-ephemeral',
  targets: Object.freeze([]),
  capabilities: Object.freeze(['observe', 'pointer', 'keyboard'] as const),
  idleExpiresAfterMs: 300_000,
  hardExpiresAfterMs: 1_200_000,
}) satisfies ControlLeaseAcquireResult

class FakeBrowserControl extends BrowserControl {
  readonly acquireRequests: ControlLeaseAcquireRequest[] = []
  readonly snapshotRequests: BrowserSnapshotRequest[] = []
  readonly actionRequests: BrowserActionRequest[] = []
  readonly revoked: SessionIdType[] = []
  nextSnapshot: BrowserSnapshotEnvelope = {
    result: {
      surfaceId: 'surface-1',
      url: 'https://example.test/',
      title: 'Example',
      snapshotRevision: 3,
      semanticText: `[ref=${REF_1}] button "Continue"`,
      refs: Object.freeze([{ ref: BrowserRef(REF_1), role: 'button', name: 'Continue' }]),
    },
  }
  rejectWith?: BrowserControlError

  override async acquireLease(request: ControlLeaseAcquireRequest): Promise<ControlLeaseAcquireResult> {
    this.acquireRequests.push(request)
    return LEASE
  }

  override async snapshot(request: BrowserSnapshotRequest): Promise<BrowserSnapshotEnvelope> {
    if (this.rejectWith) throw this.rejectWith
    this.snapshotRequests.push(request)
    return this.nextSnapshot
  }

  override async act(request: BrowserActionRequest): Promise<BrowserActionResult> {
    if (this.rejectWith) throw this.rejectWith
    this.actionRequests.push(request)
    if (request.requestKind === 'browser.navigate'
      || request.requestKind === 'browser.back'
      || request.requestKind === 'browser.forward'
      || request.requestKind === 'browser.reload') {
      return { url: 'https://example.test/next', snapshotRevision: 4 }
    }
    if (request.requestKind === 'browser.wait') return { waited: true, snapshotRevision: 4 }
    return { acted: true, snapshotRevision: 4 }
  }

  override async revokeSession(sessionId: SessionIdType): Promise<void> {
    this.revoked.push(sessionId)
  }
}

class TestAttachments extends AttachmentStore {
  readonly saved: SaveImageAttachment[] = []
  readonly imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: 4_194_304,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 4_194_304,
    maxImagePixels: 4_194_304,
    maxImageDimension: 2_048,
    mediaTypes: Object.freeze(['image/png'] as const),
  })

  override validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  override saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push({ ...input, data: new Uint8Array(input.data) })
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'1'.repeat(64)}`),
      mediaType: 'image/png', bytes: input.data.byteLength, width: 1, height: 1,
      ...(input.name === undefined ? {} : { name: input.name }),
    })
  }

  override readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    throw new Error('unreachable in browser tool tests')
  }
}

class VisionCatalog extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'vision', name: 'Vision', inputModalities: ['text', 'image'] }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('browser tool tests never stream')
  }
}

async function setup(provider = true, vision = false) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserTools)
  if (vision) {
    await ctx.plugin(TestAttachments)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], new VisionCatalog())
  }
  if (provider) await ctx.plugin(FakeBrowserControl)
  return {
    ctx,
    browser: ctx.get('browserControl') as FakeBrowserControl | undefined,
    attachments: ctx.get('attachments') as TestAttachments | undefined,
  }
}

let callNumber = 0
function agent(sessionId = 'session-a', model = 'text') {
  return {
    id: sessionId,
    options: { provider: 'test', model },
    session: {
      id: sessionId,
      requestHeader: () => undefined,
    },
  } as never
}

function call(ctx: Context, name: string, args: unknown, caller = agent()) {
  return ctx.tools.execute({
    callId: `browser-call-${++callNumber}` as never,
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: caller,
  })
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('closed BrowserControl tools', () => {
  it('registers exactly twelve tools only while a BrowserControl provider exists', async () => {
    const absent = await setup(false)
    expect(absent.ctx.tools.schemas()).toEqual([])

    const present = await setup(true)
    expect(present.ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([...NAMES])
  })

  it('withdraws all twelve tools when the optional provider fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(BrowserTools)
    const provider = await ctx.plugin(FakeBrowserControl)
    expect(ctx.tools.schemas()).toHaveLength(12)
    await provider.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('publishes closed schemas with no authority, file, upload, chooser, selector, or coordinate inputs', async () => {
    const { ctx } = await setup()
    const forbidden = new Set([
      'approved', 'chooser', 'digest', 'file', 'file_path', 'grant', 'selector',
      'upload', 'x', 'y', 'fromX', 'fromY', 'toX', 'toY',
    ])
    for (const schema of ctx.tools.schemas()) {
      expect(schema.parameters).toMatchObject({ type: 'object', additionalProperties: false })
      const properties = (schema.parameters as { properties?: Record<string, unknown> }).properties ?? {}
      for (const key of Object.keys(properties)) expect(forbidden.has(key), `${schema.name}.${key}`).toBe(false)
    }
    expect(ctx.tools.schemas().find(schema => schema.name === 'browser_click')?.parameters)
      .toMatchObject({ properties: { ref: { type: 'string' } }, required: ['ref'] })
    expect(ctx.tools.schemas().find(schema => schema.name === 'browser_navigate')?.parameters)
      .toMatchObject({ properties: { url: { type: 'string' } }, required: ['url'] })
  })

  it('rejects unknown fields before provider calls and caps duration waits at ten seconds', async () => {
    const { ctx, browser } = await setup()
    const extra = await call(ctx, 'browser_click', { ref: REF_1, x: 1 })
    expect(extra.isError).toBe(true)
    expect(text(extra)).toContain('not a declared property')
    const tooLong = await call(ctx, 'browser_wait', { mode: 'duration', duration_ms: 10_001 })
    expect(tooLong.isError).toBe(true)
    expect(text(tooLong)).toContain('10,000')
    const extraDuration = await call(ctx, 'browser_wait', { mode: 'navigation', duration_ms: 1 })
    expect(extraDuration.isError).toBe(true)
    const hugeScroll = await call(ctx, 'browser_scroll', {
      delta_x: 0, delta_y: Number.MAX_SAFE_INTEGER,
    })
    expect(hugeScroll.isError).toBe(true)
    expect(text(hugeScroll)).toContain('bounded delta range')
    expect(browser?.actionRequests).toEqual([])
  })

  it('maps every action to the closed protocol DTO and reuses one lease within a turn', async () => {
    const { ctx, browser } = await setup()
    await call(ctx, 'browser_navigate', { url: 'https://example.test/next' })
    await call(ctx, 'browser_click', { ref: REF_1 })
    await call(ctx, 'browser_type', { ref: REF_2, text: 'hello' })
    await call(ctx, 'browser_key', { key: 'Enter', modifiers: ['Meta'] })
    await call(ctx, 'browser_select', { ref: REF_3, value: 'one' })
    await call(ctx, 'browser_scroll', { ref: REF_4, delta_x: 0, delta_y: 600 })
    await call(ctx, 'browser_wait', { mode: 'duration', duration_ms: 250 })
    await call(ctx, 'browser_wait', { mode: 'navigation' })
    await call(ctx, 'browser_wait', { mode: 'loading-idle' })
    await call(ctx, 'browser_back', {})
    await call(ctx, 'browser_forward', {})
    await call(ctx, 'browser_reload', {})

    expect(browser?.acquireRequests).toHaveLength(1)
    expect(browser?.acquireRequests[0]).toMatchObject({
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'control.lease.acquire',
      sessionId: 'session-a',
      surfaceKind: 'browser-ephemeral',
      targets: [],
      capabilities: ['observe', 'pointer', 'keyboard'],
    })
    expect(browser?.actionRequests.map(request => ({
      requestKind: request.requestKind,
      ...request.requestKind === 'browser.click' ? { ref: request.ref } : {},
      ...request.requestKind === 'browser.wait' ? { mode: request.mode } : {},
    }))).toEqual([
      { requestKind: 'browser.navigate' },
      { requestKind: 'browser.click', ref: REF_1 },
      { requestKind: 'browser.type' },
      { requestKind: 'browser.key' },
      { requestKind: 'browser.select' },
      { requestKind: 'browser.scroll' },
      { requestKind: 'browser.wait', mode: 'duration' },
      { requestKind: 'browser.wait', mode: 'navigation' },
      { requestKind: 'browser.wait', mode: 'loading-idle' },
      { requestKind: 'browser.back' },
      { requestKind: 'browser.forward' },
      { requestKind: 'browser.reload' },
    ])
    for (const request of browser?.actionRequests ?? []) {
      expect(request.leaseId).toBe(LEASE.leaseId)
      expect(request.leaseRevision).toBe(LEASE.leaseRevision)
      expect(request.requestId).toSatisfy((value: string) => /^[0-9a-f-]{36}$/u.test(value))
    }
  })

  it('stops without acquiring or asking approval and revokes the official session', async () => {
    const { ctx, browser } = await setup()
    const result = await call(ctx, 'browser_stop', {})
    expect(result.isError).toBe(false)
    expect(browser?.acquireRequests).toEqual([])
    expect(browser?.revoked).toEqual(['session-a'])
  })

  it('maps provider policy denial without leaking the protected target', async () => {
    const { ctx, browser } = await setup()
    if (!browser) throw new Error('provider missing')
    browser.rejectWith = new BrowserControlError('POLICY_DENIED', `password ref ${SECRET_REF}`)
    const result = await call(ctx, 'browser_click', { ref: SECRET_REF })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('protected browser target')
    expect(text(result)).not.toContain(SECRET_REF)
  })

  it('requests semantic-only snapshots for text routes', async () => {
    const { ctx, browser } = await setup()
    const result = await call(ctx, 'browser_snapshot', {})
    expect(result.isError).toBe(false)
    expect(browser?.snapshotRequests[0]).toMatchObject({ includeImage: false })
    expect(text(result)).toContain(`[ref=${REF_1}] button`)
    expect(result.content.some(block => block.type === 'image')).toBe(false)
  })

  it('never turns screenshot bytes into text', async () => {
    const { ctx, browser } = await setup()
    if (!browser) throw new Error('provider missing')
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    browser.nextSnapshot = {
      result: {
        surfaceId: 'surface-1', url: 'https://example.test/', title: 'Example', snapshotRevision: 3,
        semanticText: `[ref=${REF_1}] button "Continue"`, refs: [],
        image: {
          transferId: PngTransferId(randomUUID()), byteLength: pngBytes.byteLength,
          sha256: '0'.repeat(64), width: 1, height: 1,
        },
      },
      png: new ImmutablePng(pngBytes),
    }
    const result = await call(ctx, 'browser_snapshot', {})
    expect(text(result)).not.toContain(Buffer.from(pngBytes).toString('base64'))
  })

  it('saves verified PNG bytes and returns an ImageBlock only for an exact visual route', async () => {
    const { ctx, browser, attachments } = await setup(true, true)
    if (!browser || !attachments) throw new Error('visual setup missing')
    browser.nextSnapshot = {
      result: {
        surfaceId: 'surface-1', url: 'https://example.test/', title: 'Example', snapshotRevision: 3,
        semanticText: `[ref=${REF_1}] button "Continue"`, refs: [],
        image: {
          transferId: PngTransferId(randomUUID()), byteLength: PNG_1X1.byteLength,
          sha256: '0'.repeat(64), width: 1, height: 1,
        },
      },
      png: new ImmutablePng(PNG_1X1),
    }

    const result = await call(ctx, 'browser_snapshot', {}, agent('session-vision', 'vision'))
    expect(result.isError).toBe(false)
    expect(browser.snapshotRequests[0]).toMatchObject({ includeImage: true, sessionId: 'session-vision' })
    expect(attachments.saved).toHaveLength(1)
    expect(Buffer.from(attachments.saved[0]?.data ?? [])).toEqual(PNG_1X1)
    expect(attachments.saved[0]?.name).toBe('browser-snapshot.png')
    expect(result.content[1]).toMatchObject({
      type: 'image',
      attachment: { mediaType: 'image/png', width: 1, height: 1 },
    })
    expect(text(result)).not.toContain(PNG_1X1.toString('base64'))
  })
})
