import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  ControlLeaseId,
  SessionId,
  type BridgeRequest,
  type DecodedDesktopControlEnvelope,
  type DesktopControlErrorCode,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  DesktopControlIpcError,
  installDesktopControlHost,
  type DesktopControlHostRuntime,
  type DesktopControlRequester,
} from '@deepseek-ai/dsh-desktop-control-host'
import * as BrowserTools from '../src/index.ts'

const SESSION = SessionId('desktop-provider-tool-session')
const REF = 'browser:00000000000000000000000000000011'
let callNumber = 0

function leaseEnvelope(
  request: BridgeRequest,
  revision: number,
): DecodedDesktopControlEnvelope {
  return {
    message: {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: request.requestId,
      requestKind: 'control.lease.acquire',
      result: {
        leaseId: ControlLeaseId(`00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`),
        leaseRevision: revision,
        surfaceKind: 'browser-ephemeral',
        targets: [],
        capabilities: ['observe', 'pointer', 'keyboard'],
        idleExpiresAfterMs: 300_000,
        hardExpiresAfterMs: 1_200_000,
      },
    },
  }
}

function actionEnvelope(request: BridgeRequest): DecodedDesktopControlEnvelope {
  return {
    message: {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: request.requestId,
      requestKind: 'browser.click',
      result: { acted: true, snapshotRevision: 9 },
    },
  }
}

function snapshotEnvelope(request: BridgeRequest): DecodedDesktopControlEnvelope {
  return {
    message: {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: request.requestId,
      requestKind: 'browser.snapshot',
      result: {
        surfaceId: 'surface-1',
        url: 'https://example.test/',
        title: 'Example',
        snapshotRevision: 9,
        semanticText: 'Example page',
        refs: [],
      },
    },
  }
}

async function setup(requester: DesktopControlRequester) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(BrowserTools)
  let mounted: DesktopControlHostRuntime | undefined
  await ctx.plugin((hostCtx: Context) => {
    mounted = installDesktopControlHost(hostCtx, { requester })
  })
  if (mounted === undefined) throw new Error('expected Desktop control host')
  expect(ctx.tools.get('browser_click')).toBeDefined()
  return { ctx, mounted }
}

function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`desktop-provider-call-${++callNumber}`),
    name,
    arguments: args,
    agent: {
      id: SESSION,
      options: { provider: 'test', model: 'text' },
      session: { id: SESSION, requestHeader: () => undefined },
    } as never,
  })
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('DesktopBrowserControl composition', () => {
  it('redacts raw Electron policy detail from action, acquire, and stop failures', async () => {
    const raw = 'SENSITIVE RAW TARGET'
    let mode: 'action' | 'acquire' = 'action'
    const requester: DesktopControlRequester = {
      request: vi.fn<DesktopControlRequester['request']>(async (request) => {
        if (request.requestKind === 'control.lease.acquire') {
          if (mode === 'acquire') throw new DesktopControlIpcError('POLICY_DENIED', raw)
          return leaseEnvelope(request, 1)
        }
        throw new DesktopControlIpcError('POLICY_DENIED', raw)
      }),
      revokeSession: vi.fn(async () => {
        throw new DesktopControlIpcError('POLICY_DENIED', raw)
      }),
    }
    const { ctx } = await setup(requester)

    const action = await call(ctx, 'browser_click', { ref: REF })
    expect(action.isError).toBe(true)
    expect(text(action)).toContain('protected browser target')
    expect(text(action)).not.toContain(raw)

    const stop = await call(ctx, 'browser_stop', {})
    expect(stop.isError).toBe(true)
    expect(text(stop)).not.toContain(raw)

    mode = 'acquire'
    const acquire = await call(ctx, 'browser_click', { ref: REF })
    expect(acquire.isError).toBe(true)
    expect(text(acquire)).not.toContain(raw)
  })

  it.each(['LEASE_EXPIRED', 'LEASE_REVOKED'] as const)(
    'forgets a %s action lease so the next tool call reacquires exactly once',
    async (code: DesktopControlErrorCode) => {
      const raw = `SENSITIVE ${code} DETAIL`
      let acquireCount = 0
      let actionCount = 0
      const actionLeases: number[] = []
      const requester: DesktopControlRequester = {
        request: vi.fn<DesktopControlRequester['request']>(async (request) => {
          if (request.requestKind === 'control.lease.acquire') {
            acquireCount += 1
            return leaseEnvelope(request, acquireCount)
          }
          if (request.requestKind !== 'browser.click') throw new Error('unexpected request')
          actionCount += 1
          actionLeases.push(request.leaseRevision)
          if (actionCount === 1) throw new DesktopControlIpcError(code, raw)
          return actionEnvelope(request)
        }),
        revokeSession: vi.fn(async () => undefined),
      }
      const { ctx, mounted } = await setup(requester)

      const first = await call(ctx, 'browser_click', { ref: REF })
      expect(first.isError).toBe(true)
      expect(text(first)).not.toContain(raw)
      expect(mounted.leaseCache.peek(SESSION)).toBeUndefined()
      const second = await call(ctx, 'browser_click', { ref: REF })
      expect(second.isError).toBe(false)
      expect({ acquireCount, actionCount, actionLeases }).toEqual({
        acquireCount: 2,
        actionCount: 2,
        actionLeases: [1, 2],
      })
      expect(mounted.leaseCache.peek(SESSION)?.leaseRevision).toBe(2)
    },
  )

  it.each(['LEASE_EXPIRED', 'LEASE_REVOKED'] as const)(
    'forgets a %s snapshot lease so the next tool call reacquires exactly once',
    async (code: DesktopControlErrorCode) => {
      const raw = `SENSITIVE ${code} SNAPSHOT DETAIL`
      let acquireCount = 0
      let snapshotCount = 0
      const snapshotLeases: number[] = []
      const requester: DesktopControlRequester = {
        request: vi.fn<DesktopControlRequester['request']>(async (request) => {
          if (request.requestKind === 'control.lease.acquire') {
            acquireCount += 1
            return leaseEnvelope(request, acquireCount)
          }
          if (request.requestKind !== 'browser.snapshot') throw new Error('unexpected request')
          snapshotCount += 1
          snapshotLeases.push(request.leaseRevision)
          if (snapshotCount === 1) throw new DesktopControlIpcError(code, raw)
          return snapshotEnvelope(request)
        }),
        revokeSession: vi.fn(async () => undefined),
      }
      const { ctx, mounted } = await setup(requester)

      const first = await call(ctx, 'browser_snapshot', {})
      expect(first.isError).toBe(true)
      expect(text(first)).not.toContain(raw)
      expect(mounted.leaseCache.peek(SESSION)).toBeUndefined()
      const second = await call(ctx, 'browser_snapshot', {})
      expect(second.isError).toBe(false)
      expect({ acquireCount, snapshotCount, snapshotLeases }).toEqual({
        acquireCount: 2,
        snapshotCount: 2,
        snapshotLeases: [1, 2],
      })
      expect(mounted.leaseCache.peek(SESSION)?.leaseRevision).toBe(2)
    },
  )
})
