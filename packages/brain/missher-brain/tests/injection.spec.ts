import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { augmentPreStepDecision } from '../src/injection.js'
import type { BrainContribution, BrainProvider, PreparedBrainBatch } from '../src/contracts.js'

function batch(items: readonly BrainContribution[]): PreparedBrainBatch & {
  accept: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
} {
  return {
    items,
    accept: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  }
}

function provider(id: string, prepared: PreparedBrainBatch | Promise<PreparedBrainBatch>): BrainProvider & {
  prepare: ReturnType<typeof vi.fn<BrainProvider['prepare']>>
} {
  return {
    protocolVersion: 1,
    id,
    byteBudget: 3_000,
    prepare: vi.fn<BrainProvider['prepare']>(async () => await prepared),
    async status() {
      return { state: 'ready', count: prepared instanceof Promise ? 0 : prepared.items.length }
    },
  }
}

function item(handle: string, providerId: string, text: string): BrainContribution {
  return {
    handle,
    providerId,
    kind: providerId === 'evolution' ? 'learned-rule' : 'reviewed-memory',
    text,
    reference: `${providerId}:${handle}`,
    recordedAt: '2026-08-24T00:00:00.000Z',
    score: 0,
    pinned: false,
  }
}

const direct = createUserMessage({
  content: [{ type: 'text', text: 'How should I release this?' }],
  source: { kind: 'user' },
})

describe('brain pre-step injection', () => {
  it('accepts only selected handles and appends one sourced recall message', async () => {
    const memoryBatch = batch([item('memory-1', 'memory', 'Keep releases reversible.')])
    const evolutionBatch = batch([item('rule-1', 'evolution', 'Run native smoke before publishing.')])
    const decision = { kind: 'enter' as const, messages: [direct] }

    const result = await augmentPreStepDecision({
      decision,
      providers: [provider('memory', memoryBatch), provider('evolution', evolutionBatch)],
      projectKey: 'project-1',
      sessionId: 'session-1',
      turn: 1,
      topLevel: true,
      step: 1,
      signal: new AbortController().signal,
      timeoutMs: 100,
      maxItems: 1,
      maxBytes: 4_000,
    })

    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') throw new Error('expected entered decision')
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1]?.source).toMatchObject({ kind: 'plugin', plugin: 'missher-brain', form: 'recall' })
    expect(memoryBatch.accept).toHaveBeenCalledWith(['memory-1'])
    expect(evolutionBatch.cancel).toHaveBeenCalledOnce()
  })

  it('returns the exact downstream decision when every provider times out', async () => {
    const decision = { kind: 'enter' as const, messages: [direct] }
    const never = new Promise<PreparedBrainBatch>(() => undefined)

    await expect(augmentPreStepDecision({
      decision,
      providers: [provider('never', never)],
      projectKey: 'project-1',
      sessionId: 'session-1',
      turn: 1,
      topLevel: true,
      step: 1,
      signal: new AbortController().signal,
      timeoutMs: 10,
      maxItems: 6,
      maxBytes: 4_000,
    })).resolves.toBe(decision)
  })

  it('contains provider rejection, failed acceptance, and failed cancellation', async () => {
    const failedAccept = batch([item('bad-accept', 'memory', 'Highest-priority reviewed fact.')])
    failedAccept.accept.mockRejectedValueOnce(new Error('accept failed'))
    failedAccept.cancel.mockRejectedValueOnce(new Error('cancel failed'))
    const rejected = provider('rejected', Promise.reject(new Error('prepare failed')))
    const decision = { kind: 'enter' as const, messages: [direct] }

    await expect(augmentPreStepDecision({
      decision,
      providers: [provider('memory', failedAccept), rejected],
      projectKey: 'project-1',
      sessionId: 'session-1',
      turn: 1,
      topLevel: true,
      step: 1,
      signal: new AbortController().signal,
      timeoutMs: 100,
      maxItems: 6,
      maxBytes: 4_000,
    })).resolves.toBe(decision)
    expect(failedAccept.accept).toHaveBeenCalledOnce()
    expect(failedAccept.cancel).toHaveBeenCalledOnce()
  })

  it('cancels an already-prepared batch when another provider aborts the shared turn', async () => {
    const controller = new AbortController()
    const prepared = batch([item('prepared', 'memory', 'prepared')])
    const first = provider('memory', prepared)
    const aborting = provider('evolution', Promise.resolve(batch([])))
    aborting.prepare.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1)
      })
      controller.abort(new Error('turn stopped'))
      return batch([])
    })
    const decision = { kind: 'enter' as const, messages: [direct] }

    await expect(augmentPreStepDecision({
      decision,
      providers: [first, aborting],
      projectKey: 'project-1',
      sessionId: 'session-1',
      turn: 1,
      topLevel: true,
      step: 1,
      signal: controller.signal,
      timeoutMs: 100,
      maxItems: 6,
      maxBytes: 4_000,
    })).resolves.toBe(decision)
    expect(prepared.cancel).toHaveBeenCalledOnce()
  })

  it('fails open for invalid runtime limits and ignores non-text direct blocks', async () => {
    const prepared = batch([item('memory-1', 'memory', 'fact')])
    const decision = {
      kind: 'enter' as const,
      messages: [createUserMessage({
        content: [{ type: 'reasoning', text: 'not a query' }, { type: 'text', text: 'actual query' }],
        source: { kind: 'user' },
      })],
    }

    await expect(augmentPreStepDecision({
      decision,
      providers: [provider('memory', prepared)],
      projectKey: 'project-1',
      sessionId: 'session-1',
      turn: 1,
      topLevel: true,
      step: 1,
      signal: new AbortController().signal,
      timeoutMs: 0,
      maxItems: 6,
      maxBytes: 4_000,
    })).resolves.toBe(decision)
  })

  it.each([
    [{ kind: 'reject' as const }, true, 1],
    [{ kind: 'enter' as const, messages: [direct] }, false, 1],
    [{ kind: 'enter' as const, messages: [direct] }, true, 2],
    [{ kind: 'enter' as const, messages: [createUserMessage({ content: [{ type: 'text', text: 'plugin' }], source: { kind: 'plugin', plugin: 'test' } })] }, true, 1],
  ])('does not prepare providers outside an eligible top-level direct-user first step', async (decision, topLevel, step) => {
    const prepared = batch([item('unused', 'memory', 'unused')])
    const candidate = provider('memory', prepared)

    await expect(augmentPreStepDecision({
      decision,
      providers: [candidate],
      projectKey: 'project-1',
      sessionId: 'session-1',
      turn: 1,
      topLevel,
      step,
      signal: new AbortController().signal,
      timeoutMs: 100,
      maxItems: 6,
      maxBytes: 4_000,
    })).resolves.toBe(decision)
    expect(candidate.prepare).not.toHaveBeenCalled()
  })
})
