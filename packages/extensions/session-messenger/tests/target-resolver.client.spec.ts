import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  assertTargetStillOrdinaryAndUnarchived,
  resolveOrdinaryOperatorSource,
  resolveOrdinaryTarget,
} from '../src/target-resolver.ts'

function agent(id: string, options: {
  origin?: 'subagent'
  parentSession?: string
  preset?: string
  events?: unknown[]
} = {}) {
  return {
    id: SessionId(id),
    status: 'idle',
    options: {},
    session: {
      header: {
        version: 0,
        id: SessionId(id),
        createdAt: 1,
        ...(options.origin === undefined ? {} : { origin: options.origin }),
        ...(options.parentSession === undefined ? {} : { parentSession: SessionId(options.parentSession) }),
        ...(options.preset === undefined ? {} : { agentPreset: options.preset }),
      },
      snapshotEvents: () => options.events ?? [],
    },
    inbox: { nextTurn: [], nextStep: [] },
    ctx: {},
    inject: vi.fn(),
    followup: vi.fn(),
    whenIdle: vi.fn(),
  } as unknown as Agent & { inject: ReturnType<typeof vi.fn>; followup: ReturnType<typeof vi.fn> }
}

function harness(
  resolver: (id: ReturnType<typeof SessionId>) => Agent | undefined | Promise<Agent | undefined>,
  archivedSessionIds: ReturnType<typeof SessionId>[] = [],
) {
  const resolve = vi.fn(resolver)
  const resume = vi.fn()
  const isOwnedBy = vi.fn((_id: ReturnType<typeof SessionId>, _owner: Agent) => false)
  const ctx = {
    typert: { lookups: { get: vi.fn((key: string) => key === 'agent' ? { resolve } : undefined) } },
    workspaceRegistry: { archivedSessionIds },
    agents: { resume, get: vi.fn(), isOwnedBy },
  }
  return { ctx, resolve, resume, isOwnedBy }
}

describe('resolveOrdinaryTarget', () => {
  it.each([
    ['', 'invalid-target-id'],
    ['   ', 'invalid-target-id'],
    ['contains\nnewline', 'invalid-target-id'],
    ['\u001fcontrol', 'invalid-target-id'],
    ['鲸', 'invalid-target-id'],
    ['x'.repeat(257), 'invalid-target-id'],
  ])('rejects malformed printable Session ID %j before lookup', async (raw, code) => {
    const caller = agent('caller')
    const h = harness(() => agent('target'))
    await expect(resolveOrdinaryTarget(h.ctx as never, caller, raw)).rejects.toMatchObject({ code })
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.resume).not.toHaveBeenCalled()
  })

  it('rejects self and a pre-lookup archived target without resolution or side effects', async () => {
    const caller = agent('caller')
    const archived = SessionId('archived')
    const h = harness(() => agent('target'), [archived])
    await expect(resolveOrdinaryTarget(h.ctx as never, caller, 'caller'))
      .rejects.toMatchObject({ code: 'self-target' })
    await expect(resolveOrdinaryTarget(h.ctx as never, caller, 'archived'))
      .rejects.toMatchObject({ code: 'target-archived' })
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.resume).not.toHaveBeenCalled()
    expect(caller.inject).not.toHaveBeenCalled()
    expect(caller.followup).not.toHaveBeenCalled()
  })

  it('rejects missing and deleted targets with stable codes', async () => {
    const caller = agent('caller')
    const missing = harness(() => undefined)
    await expect(resolveOrdinaryTarget(missing.ctx as never, caller, 'missing'))
      .rejects.toMatchObject({ code: 'target-not-found' })

    const deleted = harness(() => {
      throw new RemoteError('session/not-found', 'gone', { sessionId: SessionId('deleted') })
    })
    await expect(resolveOrdinaryTarget(deleted.ctx as never, caller, 'deleted'))
      .rejects.toMatchObject({ code: 'target-not-found' })
    expect(missing.resume).not.toHaveBeenCalled()
    expect(deleted.resume).not.toHaveBeenCalled()
  })

  it('rejects live and cold subagent-owned targets', async () => {
    const caller = agent('caller')
    const liveTarget = agent('child', { origin: 'subagent' })
    const live = harness(() => liveTarget)
    await expect(resolveOrdinaryTarget(live.ctx as never, caller, 'child'))
      .rejects.toMatchObject({ code: 'target-subagent' })

    const cold = harness(() => {
      throw new RemoteError('session/agent-busy', 'subagent owner', {
        reason: 'use subagent delivery for this child session',
      })
    })
    await expect(resolveOrdinaryTarget(cold.ctx as never, caller, 'cold-child'))
      .rejects.toMatchObject({ code: 'target-subagent' })
    expect(liveTarget.inject).not.toHaveBeenCalled()
    expect(liveTarget.followup).not.toHaveBeenCalled()
  })

  it('recognizes legacy live subagent ownership through the Agent registry', async () => {
    const caller = agent('caller')
    const parent = agent('parent')
    const target = agent('legacy-child', { parentSession: 'parent' })
    const h = harness(() => target)
    h.ctx.agents.get.mockReturnValue(parent)
    h.isOwnedBy.mockReturnValue(true)

    await expect(resolveOrdinaryTarget(h.ctx as never, caller, 'legacy-child'))
      .rejects.toMatchObject({ code: 'target-subagent' })
    expect(h.isOwnedBy).toHaveBeenCalledWith(target.id, parent)
  })

  it('rechecks archive state after awaited lookup and before returning', async () => {
    const caller = agent('caller')
    const target = agent('racing-target')
    const archived: ReturnType<typeof SessionId>[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = harness(async () => {
      await gate
      return target
    }, archived)

    const resolution = resolveOrdinaryTarget(h.ctx as never, caller, 'racing-target')
    archived.push(target.id)
    release()
    await expect(resolution).rejects.toMatchObject({ code: 'target-archived' })
    expect(target.inject).not.toHaveBeenCalled()
    expect(target.followup).not.toHaveBeenCalled()
  })

  it('returns live and policy-restored cold ordinary Agents unchanged', async () => {
    const caller = agent('caller')
    const liveTarget = agent('live')
    const coldTarget = agent('cold', { preset: 'recorded-preset' })
    const live = harness(() => liveTarget)
    const cold = harness(() => coldTarget)

    await expect(resolveOrdinaryTarget(live.ctx as never, caller, 'live')).resolves.toBe(liveTarget)
    await expect(resolveOrdinaryTarget(cold.ctx as never, caller, 'cold')).resolves.toBe(coldTarget)
    expect(coldTarget.session.header.agentPreset).toBe('recorded-preset')
    expect(cold.resolve).toHaveBeenCalledWith(SessionId('cold'))
    expect(cold.resume).not.toHaveBeenCalled()
  })

  it('fails closed when the configured Agent lookup is absent or throws an unknown policy failure', async () => {
    const caller = agent('caller')
    const unavailable = {
      workspaceRegistry: { archivedSessionIds: [] },
      typert: { lookups: { get: vi.fn(() => undefined) } },
      agents: { resume: vi.fn(), get: vi.fn(), isOwnedBy: vi.fn() },
    }
    await expect(resolveOrdinaryTarget(unavailable as never, caller, 'target'))
      .rejects.toMatchObject({ code: 'target-lookup-unavailable' })

    const broken = harness(() => { throw new RemoteError('gateway/internal', 'internal', {}) })
    await expect(resolveOrdinaryTarget(broken.ctx as never, caller, 'target'))
      .rejects.toMatchObject({ code: 'target-lookup-failed' })
  })
})

describe('assertTargetStillOrdinaryAndUnarchived', () => {
  it('is the final synchronous archive and ordinary-session fence', () => {
    const target = agent('target')
    const h = harness(() => target)
    expect(() => { assertTargetStillOrdinaryAndUnarchived(h.ctx as never, target) }).not.toThrow()
    h.ctx.workspaceRegistry.archivedSessionIds.push(target.id)
    expect(() => { assertTargetStillOrdinaryAndUnarchived(h.ctx as never, target) })
      .toThrow(expect.objectContaining({ code: 'target-archived' }))
  })
})

describe('resolveOrdinaryOperatorSource', () => {
  it('accepts only the exact live ordinary source with an established turn', () => {
    const source = agent('source', { events: [{ type: 'turn/start', data: { turn: 1 } }] })
    const h = harness(() => undefined)
    h.ctx.agents.get.mockImplementation(id => id === source.id ? source : undefined)

    expect(resolveOrdinaryOperatorSource(h.ctx as never, 'source')).toBe(source)
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.resume).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined, 'source-not-found'],
    ['blank', agent('blank'), 'source-blank'],
    ['child', agent('child', { origin: 'subagent', events: [{ type: 'turn/start' }] }), 'source-subagent'],
  ])('rejects %s sources without lookup or mutation', (_label, source, code) => {
    const h = harness(() => undefined)
    h.ctx.agents.get.mockReturnValue(source)

    expect(() => resolveOrdinaryOperatorSource(h.ctx as never, source?.id ?? 'missing'))
      .toThrow(expect.objectContaining({ code }))
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.resume).not.toHaveBeenCalled()
  })

  it('rejects archived and legacy-owned sources using current Host state', () => {
    const parent = agent('parent', { events: [{ type: 'turn/start' }] })
    const archived = agent('archived', { events: [{ type: 'turn/start' }] })
    const child = agent('legacy-child', {
      parentSession: 'parent',
      events: [{ type: 'turn/start' }],
    })
    const h = harness(() => undefined, [archived.id])
    h.ctx.agents.get.mockImplementation((id) => {
      if (id === parent.id) return parent
      if (id === archived.id) return archived
      if (id === child.id) return child
      return undefined
    })
    h.isOwnedBy.mockImplementation(id => id === child.id)

    expect(() => resolveOrdinaryOperatorSource(h.ctx as never, 'archived'))
      .toThrow(expect.objectContaining({ code: 'source-archived' }))
    expect(() => resolveOrdinaryOperatorSource(h.ctx as never, 'legacy-child'))
      .toThrow(expect.objectContaining({ code: 'source-subagent' }))
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.resume).not.toHaveBeenCalled()
  })
})
