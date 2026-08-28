import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolResult } from '@deepseek-ai/dsh-tools'
import { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  ComputerControl,
  ComputerControlError,
  ComputerRef,
  ControlLeaseId,
  ImmutablePng,
  PngTransferId,
  type ComputerActionRequest,
  type ComputerActionResult,
  type ComputerListRequest,
  type ComputerListResult,
  type ComputerSnapshotEnvelope,
  type ComputerSnapshotRequest,
  type ComputerControlStatus,
  type ControlLeaseAcquireRequest,
  type ControlLeaseAcquireResult,
  type SessionIdType,
} from '@deepseek-ai/dsh-computer-control'
import * as ComputerTools from '../src/index.ts'

const NAMES = [
  'computer_click', 'computer_double_click', 'computer_drag', 'computer_focus',
  'computer_key', 'computer_list', 'computer_scroll', 'computer_snapshot',
  'computer_status', 'computer_stop', 'computer_type', 'computer_wait',
] as const
const SESSION = 'computer-tool-session'
const APP = 'app.notes'
const WINDOW = 'window-1'
const REF = 'computer:00000000000000000000000000000001'
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

class FakeComputerControl extends ComputerControl {
  readonly acquireRequests: ControlLeaseAcquireRequest[] = []
  readonly listRequests: ComputerListRequest[] = []
  readonly snapshotRequests: ComputerSnapshotRequest[] = []
  readonly actionRequests: ComputerActionRequest[] = []
  readonly stopped: SessionIdType[] = []
  readonly statusSessions: SessionIdType[] = []
  acquireError?: ComputerControlError
  nextSnapshot: ComputerSnapshotEnvelope = {
    result: {
      appId: APP,
      windowId: WINDOW,
      snapshotRevision: 2,
      semanticText: `[ref=${REF}] button "Continue"`,
      refs: [{ ref: ComputerRef(REF), role: 'button', name: 'Continue' }],
    },
  }

  override acquireLease(request: ControlLeaseAcquireRequest): Promise<ControlLeaseAcquireResult> {
    this.acquireRequests.push(request)
    if (this.acquireError !== undefined) return Promise.reject(this.acquireError)
    return Promise.resolve({
      leaseId: ControlLeaseId('00000000-0000-4000-8000-000000000301'),
      leaseRevision: 3,
      surfaceKind: 'native-application',
      targets: request.targets,
      capabilities: request.capabilities,
      idleExpiresAfterMs: 300_000,
      hardExpiresAfterMs: 1_200_000,
    })
  }

  override status(sessionId: SessionIdType): Promise<ComputerControlStatus> {
    this.statusSessions.push(sessionId)
    return Promise.resolve({ supported: true, viewing: 'granted', assistive: 'granted' })
  }

  override list(request: ComputerListRequest): Promise<ComputerListResult> {
    this.listRequests.push(request)
    return Promise.resolve({ apps: [{ appId: APP, name: 'Notes', windows: [{ windowId: WINDOW, title: 'Draft' }] }] })
  }

  override snapshot(request: ComputerSnapshotRequest): Promise<ComputerSnapshotEnvelope> {
    this.snapshotRequests.push(request)
    return Promise.resolve(this.nextSnapshot)
  }

  override act(request: ComputerActionRequest): Promise<ComputerActionResult> {
    this.actionRequests.push(request)
    return Promise.resolve(request.requestKind === 'computer.wait'
      ? { waited: true, snapshotRevision: request.snapshotRevision + 1 }
      : { acted: true, snapshotRevision: request.snapshotRevision + 1 })
  }

  override stop(sessionId: SessionIdType): Promise<void> {
    this.stopped.push(sessionId)
    return Promise.resolve()
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

  override validateImage(_input: SaveImageAttachment): Promise<void> { return Promise.resolve() }
  override saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push({ ...input, data: new Uint8Array(input.data) })
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'3'.repeat(64)}`),
      mediaType: 'image/png', bytes: input.data.byteLength, width: 1, height: 1,
      ...(input.name === undefined ? {} : { name: input.name }),
    })
  }
  override readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    throw new Error('unreachable in computer tool tests')
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
    throw new Error('computer tool tests never stream')
  }
}

async function setup(provider: boolean, vision = false) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ComputerTools)
  if (vision) {
    await ctx.plugin(TestAttachments)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], new VisionCatalog())
  }
  if (provider) await ctx.plugin(FakeComputerControl)
  return {
    ctx,
    computer: ctx.get('computerControl') as FakeComputerControl | undefined,
    attachments: ctx.get('attachments') as TestAttachments | undefined,
  }
}

let callNumber = 0
function call(ctx: Context, name: string, args: unknown, model = 'text'): Promise<ToolResult> {
  return ctx.tools.execute({
    callId: `computer-call-${++callNumber}` as never,
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent: {
      id: SESSION,
      options: { provider: 'test', model },
      session: { id: SESSION, requestHeader: () => undefined },
    } as never,
  })
}

describe('closed ComputerControl tools', () => {
  it('registers exactly twelve tools only while a ComputerControl provider exists', async () => {
    expect((await setup(false)).ctx.tools.schemas()).toEqual([])
    expect((await setup(true)).ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([...NAMES])
  })

  it('publishes strict roots without renderer, lease, approval, or generic command authority', async () => {
    const schemas = (await setup(true)).ctx.tools.schemas()
    const forbidden = new Set([
      'approved', 'command', 'deadlineUnixMs', 'digest', 'grant', 'leaseId',
      'leaseRevision', 'payload', 'requestId', 'sessionId', 'windowHandle',
    ])
    for (const schema of schemas) {
      expect(schema.parameters).toMatchObject({ type: 'object', additionalProperties: false })
      const properties = (schema.parameters as { properties?: Record<string, unknown> }).properties ?? {}
      for (const key of Object.keys(properties)) expect(forbidden.has(key), `${schema.name}.${key}`).toBe(false)
    }
    expect(schemas.find(schema => schema.name === 'computer_stop')?.parameters)
      .toMatchObject({ properties: {} })
  })

  it('keeps status and list lease-free, then derives one exact multi-window lease and live revisions', async () => {
    const { ctx, computer } = await setup(true)
    await call(ctx, 'computer_status', {})
    await call(ctx, 'computer_list', {})
    expect(computer?.acquireRequests).toEqual([])
    expect(computer?.statusSessions).toEqual([SESSION])

    await call(ctx, 'computer_snapshot', { app_id: APP, window_id: WINDOW })
    await call(ctx, 'computer_focus', { app_id: APP, window_id: WINDOW })
    await call(ctx, 'computer_click', { app_id: APP, window_id: WINDOW, ref: REF })
    await call(ctx, 'computer_type', { app_id: APP, window_id: WINDOW, ref: REF, text: 'private draft' })
    await call(ctx, 'computer_key', { app_id: APP, window_id: WINDOW, key: 'Enter', modifiers: ['Meta'] })
    await call(ctx, 'computer_scroll', { app_id: APP, window_id: WINDOW, ref: REF, delta_x: 0, delta_y: 200 })
    await call(ctx, 'computer_wait', { app_id: APP, window_id: WINDOW, duration_ms: 10_000 })

    expect(computer?.acquireRequests).toHaveLength(1)
    expect(computer?.acquireRequests[0]).toMatchObject({
      surfaceKind: 'native-application',
      targets: [{ appId: APP, windowIds: [WINDOW] }],
      capabilities: ['observe', 'pointer', 'keyboard'],
    })
    expect(computer?.snapshotRequests[0]).toMatchObject({
      appId: APP, windowId: WINDOW, snapshotRevision: 1, includeImage: false,
    })
    expect(computer?.actionRequests.map(request => [request.requestKind, request.snapshotRevision])).toEqual([
      ['computer.focus', 2], ['computer.click', 3], ['computer.type', 4],
      ['computer.key', 5], ['computer.scroll', 6], ['computer.wait', 7],
    ])
  })

  it('denies coordinate actions to text routes and saves screenshots only as vision attachments', async () => {
    const textOnly = await setup(true)
    const denied = await call(textOnly.ctx, 'computer_click', {
      app_id: APP, window_id: WINDOW, x: 12, y: 20,
    })
    expect(denied.isError).toBe(true)
    expect(textOnly.computer?.actionRequests).toEqual([])

    const vision = await setup(true, true)
    const bytes = new ImmutablePng(PNG_1X1)
    vision.computer!.nextSnapshot = {
      result: {
        appId: APP, windowId: WINDOW, snapshotRevision: 2,
        semanticText: 'Window', refs: [],
        image: {
          transferId: PngTransferId('00000000-0000-4000-8000-000000000302'),
          byteLength: bytes.byteLength,
          sha256: 'b1ff9c8ea3a780bad09b346c423d2d0e46815926879b18e841d928376a946640',
          width: 1,
          height: 1,
        },
      },
      png: bytes,
    }
    const snapshot = await call(vision.ctx, 'computer_snapshot', { app_id: APP, window_id: WINDOW }, 'vision')
    expect(snapshot.isError).toBe(false)
    expect(vision.computer?.snapshotRequests[0]?.includeImage).toBe(true)
    expect(vision.attachments?.saved).toHaveLength(1)
    await call(vision.ctx, 'computer_double_click', { app_id: APP, window_id: WINDOW, x: 12, y: 20 }, 'vision')
    await call(vision.ctx, 'computer_drag', {
      app_id: APP, window_id: WINDOW, from_x: 1, from_y: 2, to_x: 3, to_y: 4,
    }, 'vision')
    expect(vision.computer?.actionRequests.map(request => request.requestKind))
      .toEqual(['computer.double-click', 'computer.drag'])
  })

  it('stops without lease acquisition or approval and rejects extra arguments first', async () => {
    const { ctx, computer } = await setup(true)
    const invalid = await call(ctx, 'computer_stop', { approved: true })
    expect(invalid.isError).toBe(true)
    const stopped = await call(ctx, 'computer_stop', {})
    expect(stopped.isError).toBe(false)
    expect(computer?.acquireRequests).toEqual([])
    expect(computer?.stopped).toEqual([SESSION])
  })

  it.each([
    ['CONTROL_DISABLED', 'Error: Computer control is disabled. Enable it in Settings > Browser & Computer Control, then retry.'],
    ['TARGET_NOT_AUTHORIZED', 'Error: The requested app is not authorized for Computer Control. Authorize it in Settings > Browser & Computer Control, then retry.'],
    ['APPROVAL_DENIED', 'Error: Desktop control was not allowed in the native approval dialog. Retry and choose Allow.'],
    ['PERMISSION_DENIED', 'Error: Computer control needs operating-system Screen Viewing and Assistive Control permissions. Grant both to DeepSeek Harness, restart the app, then retry.'],
    ['POLICY_DENIED', 'Error: Computer control was denied because the requested operation or target is protected.'],
  ] as const)('maps %s to safe actionable guidance', async (code, expected) => {
    const { ctx, computer } = await setup(true)
    computer!.acquireError = new ComputerControlError(code, 'private native target and window detail')

    const result = await call(ctx, 'computer_snapshot', { app_id: APP, window_id: WINDOW })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: expected }])
    expect(JSON.stringify(result)).not.toContain('private native target')
  })
})
