import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import { foldSessionUsage } from '../src/fold.ts'

const header = (overrides: Partial<SessionHeader> = {}): SessionHeader => ({
  version: 0,
  id: 'usage-test' as SessionHeader['id'],
  createdAt: Date.parse('2026-03-01T00:00:00.000Z'),
  isSeeded: false,
  ...overrides,
})

const event = <T extends SessionEvent['type']>(
  seq: number,
  time: string,
  type: T,
  data: Extract<SessionEvent, { type: T }>['data'],
): SessionEvent => ({
  seq: SessionSeq(seq),
  time: Date.parse(time),
  type,
  data,
} as SessionEvent)

const assistant = (turn: number, step: number, usage: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}): SessionEvent => event(0, '2026-03-01T12:00:00.000Z', 'assistant/message', {
  turn,
  step,
  usage,
  message: {
    id: `assistant-${turn}-${step}` as never,
    role: 'assistant',
    source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
    content: [],
  },
})

describe('foldSessionUsage', () => {
  it('replaces repeated usage for one turn and step without double-counting reasoning', () => {
    const chunk = event(1, '2026-03-01T11:59:59.000Z', 'assistant/chunk', {
      turn: 1,
      step: 0,
      chunk: {
        type: 'usage',
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 300,
          cacheWriteTokens: 20,
          reasoningTokens: 30,
        },
      },
    })
    const final = { ...assistant(1, 0, {
      inputTokens: 120,
      outputTokens: 50,
      cacheReadTokens: 300,
      cacheWriteTokens: 30,
      reasoningTokens: 35,
    }), seq: SessionSeq(2) }

    const row = foldSessionUsage(header(), [chunk, final], 'UTC')

    expect(row.tokens).toEqual({
      uncachedInput: 120,
      output: 50,
      cacheRead: 300,
      cacheWrite: 30,
    })
    expect(row.totalTokens).toBe(500)
    expect(row.daily).toEqual([{
      date: '2026-03-01',
      humanMessages: 0,
      tokens: 500,
      toolCalls: 0,
    }])
    expect(row.incompleteUsageSamples).toBe(0)
    expect(row.validUsageSamples).toBe(1)
  })

  it('omits unsafe provider usage instead of estimating it', () => {
    const invalid = assistant(1, 0, { inputTokens: -1, outputTokens: 2 })
    const fractional = { ...assistant(2, 0, { inputTokens: 1.5, outputTokens: 2 }), seq: SessionSeq(1) }
    const nonFinite = { ...assistant(3, 0, { inputTokens: Number.POSITIVE_INFINITY, outputTokens: 2 }), seq: SessionSeq(2) }

    const row = foldSessionUsage(header(), [invalid, fractional, nonFinite], 'UTC')

    expect(row.totalTokens).toBe(0)
    expect(row.daily).toEqual([])
    expect(row.incompleteUsageSamples).toBe(3)
    expect(row.validUsageSamples).toBe(0)
  })

  it('uses local calendar days and completed turn time only', () => {
    const events = [
      event(0, '2026-03-08T07:59:00.000Z', 'user/message', {
        id: 'user-1' as never,
        role: 'user',
        source: { kind: 'user' },
        content: [],
      }),
      event(1, '2026-03-08T08:00:00.000Z', 'turn/start', { turn: 1 }),
      event(2, '2026-03-08T08:00:05.500Z', 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(3, '2026-03-09T06:59:00.000Z', 'user/message', {
        id: 'user-2' as never,
        role: 'user',
        source: { kind: 'user' },
        content: [],
      }),
      event(4, '2026-03-09T07:00:00.000Z', 'turn/start', { turn: 2 }),
    ]

    const row = foldSessionUsage(header(), events, 'America/Los_Angeles')

    expect(row.daily.map(day => day.date)).toEqual(['2026-03-07', '2026-03-08'])
    expect(row.completedTurnDurationMs).toBe(5_500)
    expect(row.completedTurnCount).toBe(1)
  })

  it('counts human activity, model settings, direct and nested tools, and skills', () => {
    const events = [
      event(0, '2026-03-01T10:00:00.000Z', 'user/message', {
        id: 'human' as never,
        role: 'user',
        source: { kind: 'user' },
        content: [],
      }),
      event(1, '2026-03-01T10:00:01.000Z', 'user/message', {
        id: 'skill-injected',
        role: 'user',
        source: { kind: 'skill-invocation', name: 'preview', form: 'instructions' },
        content: [],
      } as never),
      event(2, '2026-03-01T10:00:02.000Z', 'request/header', {
        reason: 'initial',
        header: {
          config: {
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            reasoningEffort: 'max' as never,
          },
        },
      }),
      { ...assistant(1, 0, { inputTokens: 0, outputTokens: 0 }), seq: SessionSeq(3) },
      event(4, '2026-03-01T10:00:03.000Z', 'tool/call', {
        turn: 1,
        step: 0,
        callId: 'call-1' as never,
        name: 'skill',
        arguments: '{"name":"playwright"}',
      }),
      event(5, '2026-03-01T10:00:04.000Z', 'tool/call', {
        turn: 1,
        step: 0,
        callId: 'call-2' as never,
        name: 'bash',
        arguments: '{}',
      }),
      event(6, '2026-03-01T10:00:05.000Z', 'tool/code-dispatch-start' as never, {
        rootCallId: 'call-3',
        parentCallId: 'call-3',
        subCallId: 'call-3:code:0',
        name: 'read_file',
        arguments: { path: '/private/value' },
      } as never),
      event(7, '2026-03-01T10:00:06.000Z', 'tool/call', {
        turn: 1,
        step: 0,
        callId: 'call-4' as never,
        name: 'skill',
        arguments: '{not-json',
      }),
    ]

    const row = foldSessionUsage(header(), events, 'UTC')

    expect(row.daily).toEqual([{
      date: '2026-03-01',
      humanMessages: 1,
      tokens: 0,
      toolCalls: 4,
    }])
    expect(row.models).toEqual({ 'deepseek/deepseek-v4-flash': 1 })
    expect(row.reasoningEfforts).toEqual({ max: 1 })
    expect(row.skills).toEqual({ playwright: 1, preview: 1 })
    expect(row.tools).toEqual({ bash: 1, read_file: 1, skill: 2 })
  })

  it('excludes the inherited fork prefix using the durable seed length', () => {
    const inherited = [
      event(0, '2026-02-01T10:00:00.000Z', 'user/message', {
        id: 'parent-user' as never, role: 'user', source: { kind: 'user' }, content: [],
      }),
      { ...assistant(1, 0, { inputTokens: 50, outputTokens: 10 }), seq: SessionSeq(1) },
    ]
    const own = [
      event(2, '2026-03-01T10:00:00.000Z', 'user/message', {
        id: 'child-user' as never, role: 'user', source: { kind: 'user' }, content: [],
      }),
      { ...assistant(2, 0, { inputTokens: 7, outputTokens: 3 }), seq: SessionSeq(3) },
    ]

    const row = foldSessionUsage(
      header({ parentSession: 'parent' as never, isSeeded: true }),
      [...inherited, ...own],
      'UTC',
      2,
    )

    expect(row.totalTokens).toBe(10)
    expect(row.daily).toEqual([{
      date: '2026-03-01',
      humanMessages: 1,
      tokens: 10,
      toolCalls: 0,
    }])
  })

  it('rejects malformed usage and unsafe aggregate totals without retaining payloads', () => {
    const malformed = (seq: number, turn: number, usage: unknown): SessionEvent => event(
      seq,
      '2026-03-01T12:00:00.000Z',
      'assistant/message',
      {
        turn,
        step: 0,
        usage,
        message: {
          id: `malformed-${turn}`,
          role: 'assistant',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          content: [],
        },
      } as never,
    )
    const events = [
      malformed(0, 0, null),
      malformed(1, 1, 5),
      malformed(2, 2, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 }),
      malformed(3, 3, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 }),
      malformed(4, 4, { inputTokens: 0, outputTokens: 1 }),
    ]

    const row = foldSessionUsage(header(), events, 'UTC')

    expect(row.totalTokens).toBe(Number.MAX_SAFE_INTEGER)
    expect(row.validUsageSamples).toBe(1)
    expect(row.incompleteUsageSamples).toBe(4)
    expect(row.daily[0]?.tokens).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('ignores empty names, malformed skill arguments, and incomplete turn pairs', () => {
    const events = [
      event(0, '2026-03-01T10:00:00.000Z', 'user/message', {
        id: 'empty-skill',
        role: 'user',
        source: { kind: 'skill-invocation', name: '', form: 'instructions' },
        content: [],
      } as never),
      ...['null', '5', '{"name":""}', '{"name":5}'].map((argumentsJson, index) => event(
        index + 1,
        '2026-03-01T10:00:01.000Z',
        'tool/call',
        { turn: 1, step: index, callId: `call-${index}`, name: 'skill', arguments: argumentsJson } as never,
      )),
      event(5, '2026-03-01T10:00:02.000Z', 'tool/call', {
        turn: 1, step: 5, callId: 'empty-tool', name: '', arguments: '{}',
      } as never),
      event(6, '2026-03-01T10:00:03.000Z', 'turn/end', { turn: 7, reason: { kind: 'completed' } }),
      event(7, '2026-03-01T10:00:05.000Z', 'turn/start', { turn: 8 }),
      event(8, '2026-03-01T10:00:04.000Z', 'turn/end', { turn: 8, reason: { kind: 'completed' } }),
      event(9, '2026-03-01T10:00:06.000Z', 'assistant/message', {
        turn: 9,
        step: 0,
        message: {
          id: 'assistant-no-usage',
          role: 'assistant',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          content: [],
        },
      } as never),
      event(10, '2026-03-01T10:00:07.000Z', 'request/header', {
        reason: 'initial',
        header: { config: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } },
      } as never),
      event(11, '2026-03-01T10:00:08.000Z', 'assistant/message', {
        turn: 10,
        step: 0,
        message: {
          id: 'assistant-routed-no-usage',
          role: 'assistant',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          content: [],
        },
      } as never),
    ]

    const row = foldSessionUsage(header(), events, 'UTC')

    expect(row.skills).toEqual({})
    expect(row.tools).toEqual({ skill: 4 })
    expect(row.completedTurnCount).toBe(0)
    expect(row.models).toEqual({ 'deepseek/deepseek-chat': 1 })
    expect(row.reasoningEfforts).toEqual({ high: 1 })
  })

  it('handles an empty durable event suffix', () => {
    const row = foldSessionUsage(header(), [], 'UTC')

    expect(row.lastSeq).toBe(-1)
    expect(row.daily).toEqual([])
    expect(row.totalTokens).toBe(0)
  })

  it('does not publish a completed duration after safe-integer overflow', () => {
    const firstStart = { ...event(0, '2026-03-01T00:00:00.000Z', 'turn/start', { turn: 1 }), time: -4_000_000_000_000_000 }
    const firstEnd = { ...event(1, '2026-03-01T00:00:00.000Z', 'turn/end', {
      turn: 1, reason: { kind: 'completed' },
    }), time: 4_000_000_000_000_000 }
    const secondStart = { ...event(2, '2026-03-01T00:00:00.000Z', 'turn/start', { turn: 2 }), time: -4_000_000_000_000_000 }
    const secondEnd = { ...event(3, '2026-03-01T00:00:00.000Z', 'turn/end', {
      turn: 2, reason: { kind: 'completed' },
    }), time: 4_000_000_000_000_000 }

    const row = foldSessionUsage(header(), [firstStart, firstEnd, secondStart, secondEnd], 'UTC')

    expect(row.completedTurnDurationMs).toBe(8_000_000_000_000_000)
    expect(row.completedTurnCount).toBe(1)
  })
})
