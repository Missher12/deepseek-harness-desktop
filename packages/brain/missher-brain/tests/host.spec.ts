import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import BrainHub from '../src/index.js'
import type { BrainProvider } from '../src/contracts.js'

const direct = createUserMessage({
  content: [{ type: 'text', text: 'remember the release boundary' }],
  source: { kind: 'user' },
})

function agent(parentSession?: string, cwd: string | null = '/private/example/project'): Agent {
  return {
    id: 'agent-1',
    options: {},
    status: 'running',
    session: {
      id: 'agent-1',
      header: {
        id: 'agent-1',
        cwd: cwd ?? undefined,
        createdAt: 0,
        parentSession,
        ...(parentSession === undefined ? {} : { origin: 'subagent' as const, delegationDepth: 1 }),
      },
    } as Agent['session'],
  } as Agent
}

function provider(): BrainProvider & { prepare: ReturnType<typeof vi.fn<BrainProvider['prepare']>> } {
  return {
    protocolVersion: 1,
    id: 'memory',
    byteBudget: 3_000,
    prepare: vi.fn<BrainProvider['prepare']>(async () => ({
      items: [{
        handle: 'm1',
        providerId: 'memory',
        kind: 'reviewed-memory' as const,
        text: 'Keep release operations reversible.',
        reference: 'memory:m1',
        recordedAt: '2026-08-24T00:00:00.000Z',
        score: 0,
        pinned: false,
      }],
      accept: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    })),
    async status() {
      return { state: 'ready', count: 1 }
    },
  }
}

describe('BrainHub Host composition', () => {
  it('projects a bounded pathless provider snapshot for the Desktop settings page', async () => {
    const ctx = new Context()
    await ctx.plugin(BrainHub)
    const memory = provider()
    ctx.missherBrain.register(memory)
    ctx.missherBrain.register({
      ...provider(),
      id: 'evolution',
      byteBudget: 2_000,
      async status() { throw new Error('/private/secret must not escape') },
    })

    const snapshot = await ctx.missherBrain.snapshot()
    expect(snapshot.generatedAt).toBeTypeOf('number')
    expect(snapshot).toEqual({
      generatedAt: snapshot.generatedAt,
      limits: { maxItems: 6, maxBytes: 4_000, timeoutMs: 150 },
      providers: [
        { id: 'memory', state: 'ready', count: 1, byteBudget: 3_000 },
        { id: 'evolution', state: 'unavailable', count: 0, byteBudget: 2_000 },
      ],
    })

    await ctx.fiber.dispose()
  })

  it('bounds a stalled provider status read without exposing its failure', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    try {
      await ctx.plugin(BrainHub)
      ctx.missherBrain.register({
        ...provider(),
        id: 'stalled',
        async status() { return new Promise(() => undefined) },
      })

      const pending = ctx.missherBrain.snapshot()
      await vi.advanceTimersByTimeAsync(300)
      const snapshot = await pending
      expect(snapshot.generatedAt).toBeTypeOf('number')
      expect(snapshot).toEqual({
        generatedAt: snapshot.generatedAt,
        limits: { maxItems: 6, maxBytes: 4_000, timeoutMs: 150 },
        providers: [{ id: 'stalled', state: 'unavailable', count: 0, byteBudget: 3_000 }],
      })
    } finally {
      vi.useRealTimers()
      await ctx.fiber.dispose()
    }
  })

  it('injects through the real scoped pre-step waterfall without exposing the cwd to providers', async () => {
    const ctx = new Context()
    await ctx.plugin(BrainHub)
    const memory = provider()
    ctx.missherBrain.register(memory)
    expect(ctx.missherBrain.listProviders()).toEqual([memory])
    const owner = agent()

    const decision = await agentEvents(ctx, owner).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }),
    )

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected entered decision')
    expect(decision.messages).toHaveLength(2)
    expect(memory.prepare).toHaveBeenCalledOnce()
    const request = memory.prepare.mock.calls[0]?.[0]
    expect(request).toBeDefined()
    if (request === undefined) throw new Error('expected one provider request')
    expect(request.projectKey).toMatch(/^[a-f0-9]{64}$/)
    expect(request.query).toBe('remember the release boundary')
    expect(request.sessionId).toBe('agent-1')
    expect(request.turn).toBe(1)
    expect(JSON.stringify(memory.prepare.mock.calls)).not.toContain('/private/example/project')

    await ctx.fiber.dispose()
  })

  it('does not recall into a durable subagent child', async () => {
    const ctx = new Context()
    await ctx.plugin(BrainHub)
    const memory = provider()
    ctx.missherBrain.register(memory)
    const child = agent('parent-1')

    const downstream = { kind: 'enter' as const, messages: [direct] }
    await expect(agentEvents(ctx, child).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve(downstream),
    )).resolves.toBe(downstream)
    expect(memory.prepare).not.toHaveBeenCalled()

    await ctx.fiber.dispose()
  })

  it('does not prepare providers when the session has no project cwd', async () => {
    const ctx = new Context()
    await ctx.plugin(BrainHub)
    const memory = provider()
    ctx.missherBrain.register(memory)
    const owner = agent(undefined, null)

    const downstream = { kind: 'enter' as const, messages: [direct] }
    await expect(agentEvents(ctx, owner).waterfall(
      'agent/pre-step',
      { messages: [direct], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve(downstream),
    )).resolves.toBe(downstream)
    expect(memory.prepare).not.toHaveBeenCalled()

    await ctx.fiber.dispose()
  })
})
