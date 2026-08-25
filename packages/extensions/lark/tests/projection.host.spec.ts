import { describe, expect, test } from 'vitest'
import { TurnProjection } from '../src/projection.ts'

const event = (type: string, data: unknown, time = 1000, view?: unknown) => ({
  type: 'session/event', sessionId: 'session-1', event: { type, seq: 1, time, data }, ...(view === undefined ? {} : { view }),
})

describe('safe Harness turn projection', () => {
  test('streams only visible assistant text and real usage', () => {
    const projection = new TurnProjection('session-1')
    projection.apply(event('turn/start', { turn: 7 }, 1000))
    projection.apply(event('assistant/chunk', { turn: 7, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hel' } }, 1100))
    projection.apply(event('assistant/chunk', { turn: 7, step: 1, chunk: { type: 'reasoning-delta', index: 1, text: 'private chain' } }, 1101))
    projection.apply(event('assistant/message', {
      turn: 7, step: 1,
      message: { role: 'assistant', id: 'm', source: { kind: 'model', provider: 'p', model: 'm' }, content: [
        { type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'Hello' },
      ] },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 3 },
    }, 1200))
    expect(projection.snapshot()).toMatchObject({
      turn: 7, text: 'Hello', status: 'streaming',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 3 },
    })
    expect(JSON.stringify(projection.snapshot())).not.toContain('private chain')
    expect(JSON.stringify(projection.snapshot())).not.toContain('hidden')
  })

  test('uses Host tool views but excludes raw arguments, output, and environment values', () => {
    const projection = new TurnProjection('session-1')
    projection.apply(event('turn/start', { turn: 1 }))
    projection.apply(event('tool/call', {
      turn: 1, step: 1, callId: 'c1', name: 'bash',
      arguments: '{"env":{"TOKEN":"raw-secret"},"command":"echo raw-secret"}',
    }, 1100, { for: 'call', view: { card: 'terminal', title: 'Run tests', cwd: '/project' } }))
    projection.apply(event('tool/result', {
      turn: 1, step: 1, message: { id: 'r', role: 'user', source: { kind: 'tool', callId: 'c1' }, content: [] },
      meta: { env: 'raw-secret' },
    }, 1200, { for: 'result', view: { card: 'terminal', title: 'Tests passed', output: 'raw-secret', exitCode: 0 } }))
    expect(projection.snapshot().tools).toEqual([{ callId: 'c1', title: 'Tests passed', kind: 'terminal', status: 'completed' }])
    expect(JSON.stringify(projection.snapshot())).not.toContain('raw-secret')
  })

  test('tracks approvals, elapsed time, and exact terminal reason', () => {
    const projection = new TurnProjection('session-1')
    projection.apply(event('turn/start', { turn: 2 }, 1000))
    projection.apply({ type: 'approval/requested', sessionId: 'session-1', approvalId: 'a1', toolName: 'bash', rpcId: 'rpc-1' })
    projection.apply({ type: 'approval/resolved', sessionId: 'session-1', approvalId: 'a1', outcome: { kind: 'denied' } })
    projection.apply(event('turn/end', { turn: 2, reason: { kind: 'completed' } }, 2500))
    expect(projection.snapshot()).toMatchObject({
      status: 'completed', elapsedMs: 1500,
      approvals: [{ approvalId: 'a1', toolName: 'bash', status: 'resolved' }],
    })
  })

  test('ignores other sessions and system/user content', () => {
    const projection = new TurnProjection('session-1')
    projection.apply({ ...event('turn/start', { turn: 1 }), sessionId: 'other' })
    projection.apply(event('user/message', { content: [{ type: 'text', text: 'system secret' }] }))
    expect(projection.snapshot()).toMatchObject({ status: 'placeholder', text: '' })
    expect(JSON.stringify(projection.snapshot())).not.toContain('system secret')
  })
})
