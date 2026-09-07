import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import * as FirstPromptTitle from '@deepseek-ai/dsh-session-title-first-prompt-llm'
import {
  NATIVE_READER_ANSWER, NATIVE_READER_APPEND, NATIVE_READER_PROMPT, NATIVE_READER_REASONING, NATIVE_READER_TITLE,
  startReaderSmokeProvider,
} from './reader-smoke-provider.ts'

const requestBody = JSON.stringify({
  model: 'native-thinker', stream: true,
  messages: [{ role: 'user', content: NATIVE_READER_PROMPT }],
})

it('allows exactly one armed fixture request and delivers only explicitly released phases', async () => {
  const provider = await startReaderSmokeProvider()
  try {
    const send = (body = requestBody) => fetch(`${provider.url}/chat/completions`, {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    expect((await send()).status).toBe(500)
    provider.arm()
    expect((await send(requestBody.replace(NATIVE_READER_PROMPT, 'unexpected request'))).status).toBe(500)
    const response = await send()
    expect(response.status).toBe(200)
    expect(provider.phase).toBe('thinking')
    const chunks: string[] = []
    const reading = (async () => {
      if (response.body === null) throw new Error('missing SSE body')
      const decoder = new TextDecoder()
      for await (const chunk of response.body) chunks.push(decoder.decode(chunk, { stream: true }))
      chunks.push(decoder.decode())
    })()
    void reading.catch(() => {})
    await expect.poll(() => chunks.join('')).toContain('reasoning_content')
    expect(chunks.join('')).not.toContain(NATIVE_READER_APPEND)
    provider.append()
    provider.answer()
    provider.finish()
    await reading
    const events = chunks.join('').split('\n\n').filter(Boolean).map(event => event.slice(6))
    const payload = events.filter(event => event !== '[DONE]').map(event => JSON.parse(event) as {
      choices: Array<{ delta: { reasoning_content?: string; content?: string }; finish_reason: string | null }>
    })
    expect(payload.map(event => event.choices[0]?.delta.reasoning_content ?? '').join(''))
      .toBe(NATIVE_READER_REASONING + NATIVE_READER_APPEND)
    expect(payload.map(event => event.choices[0]?.delta.content ?? '').join('')).toBe(NATIVE_READER_ANSWER)
    expect(payload.at(-1)?.choices[0]?.finish_reason).toBe('stop')
    expect(events.at(-1)).toBe('[DONE]')
    expect((await send()).status).toBe(500)
    expect(provider.acceptedRequests).toBe(1)
    expect(provider.requests).toHaveLength(3)
  } finally { await provider.close() }
})

it('owns independent loopback servers and closes an unfinished response on teardown', async () => {
  const first = await startReaderSmokeProvider()
  let second: Awaited<ReturnType<typeof startReaderSmokeProvider>> | undefined
  try {
    second = await startReaderSmokeProvider()
    expect(first.url).not.toBe(second.url)
    first.arm()
    const response = await fetch(`${first.url}/chat/completions`, {
      method: 'POST', body: requestBody, signal: AbortSignal.timeout(5_000),
    })
    const reading = response.text().then(() => 'ended', () => 'closed')
    await first.close()
    expect(await reading).toBe('closed')
    expect(second.phase).toBe('idle')
    expect(second.requests).toEqual([])
  } finally { await Promise.all([first.close(), second?.close()]) }
})

it('keeps the reader stream separate from the actual automatic title request', async () => {
  const provider = await startReaderSmokeProvider()
  const ctx = new Context()
  const controller = new AbortController()
  let completed: Promise<BlockAssembler> | undefined
  vi.stubEnv('DSH_READER_PROTOCOL_TEST_KEY', 'reader-protocol-placeholder')
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { 'desktop-smoke': {
      apiKeyEnv: 'DSH_READER_PROTOCOL_TEST_KEY', api: 'openai-completions', baseURL: provider.url,
      models: [{ id: 'native-thinker', contextWindow: 65_536, maxTokens: 4_096, reasoningEfforts: { high: 'high' } }],
    } } })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
    await ctx.plugin(FirstPromptTitle, {
      targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 64, timeoutMs: 5000,
    })
    const session = ctx.sessions.create(SessionId('native-reader-title'))
    const human = createUserMessage({
      content: [{ type: 'text', text: NATIVE_READER_PROMPT }], source: { kind: 'user' },
    })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', human, { surfaceOp: 'append' })
    provider.arm()
    completed = (async () => {
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({
        provider: 'desktop-smoke', model: 'native-thinker', signal: controller.signal,
        messages: [human],
      })) assembler.push(chunk)
      return assembler
    })()
    void completed.catch(() => {})
    await expect.poll(() => provider.phase, { timeout: 5_000 }).toBe('thinking')
    session.append('request/header', {
      header: { config: { provider: 'desktop-smoke', model: 'native-thinker' } }, reason: 'initial',
    })
    await expect.poll(() => ctx.sessionTitle.get(session)?.source.kind, { timeout: 5_000 }).toBe('provider')
    expect(ctx.sessionTitle.get(session)?.title).toBe(NATIVE_READER_TITLE)
    expect(provider.acceptedTitleRequests).toBe(1)
    provider.append()
    provider.answer()
    provider.finish()
    const result = await completed
    expect(result.message({ kind: 'model', provider: 'desktop-smoke', model: 'native-thinker' }).content).toEqual([
      { type: 'reasoning', text: NATIVE_READER_REASONING + NATIVE_READER_APPEND },
      { type: 'text', text: NATIVE_READER_ANSWER },
    ])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(provider.acceptedRequests).toBe(1)
    expect(provider.requests).toEqual([])
  } finally {
    controller.abort()
    try { await provider.close(); await completed?.catch(() => {}) }
    finally { try { await ctx.fiber.dispose() } finally { vi.unstubAllEnvs() } }
  }
}, 15_000)

const titleRequest = {
  model: 'native-thinker', stream: true, max_tokens: 64,
  messages: [
    { role: 'developer', content: [
      'Create a concise title for an AI coding-assistant session from the supplied human messages.',
      'Return only the title on one line, **in plain text of natural language**, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.',
      'Use the language of the messages.',
      'Aim for about 5 words in non-CJK languages or 10 CJK characters.',
    ].join('\n') },
    { role: 'user', content: 'Generate the session title from this JSON array of human messages:\n'
      + JSON.stringify([{ seq: 2, text: NATIVE_READER_PROMPT }]) },
  ],
}

it.each(['before-reader', 'during-reader', 'after-reader'] as const)(
  'accepts one exact title %s without consuming or advancing the reader stream',
  async (order) => {
    const provider = await startReaderSmokeProvider()
    const send = (body: unknown) => fetch(`${provider.url}/chat/completions`, {
      method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
    })
    const title = async () => {
      const response = await send(titleRequest)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain(NATIVE_READER_TITLE)
    }
    try {
      expect((await send(titleRequest)).status).toBe(500)
      provider.arm()
      if (order === 'before-reader') {
        await title()
        expect(provider.phase).toBe('armed')
      }
      const response = await send(JSON.parse(requestBody))
      const reading = response.text().then(value => value, () => 'closed')
      expect(response.status).toBe(200)
      if (order === 'during-reader') await title()
      expect(provider.phase).toBe('thinking')
      provider.append(); provider.answer(); provider.finish()
      await reading
      if (order === 'after-reader') await title()
      expect(provider.phase).toBe('completed')
      expect((await send(titleRequest)).status).toBe(500)
      expect((await send(JSON.parse(requestBody))).status).toBe(500)
      expect(provider.acceptedRequests).toBe(1)
      expect(provider.acceptedTitleRequests).toBe(1)
      expect(provider.requests).toHaveLength(3)
    } finally { await provider.close() }
  },
)

it.each([
  { ...titleRequest, model: 'other' },
  { ...titleRequest, stream: false },
  { ...titleRequest, max_tokens: 65 },
  { ...titleRequest, tools: [] },
  { ...titleRequest, messages: [...titleRequest.messages, { role: 'assistant', content: 'unrelated' }] },
  { ...titleRequest, messages: [titleRequest.messages[0], { role: 'user', content: NATIVE_READER_PROMPT }] },
  { ...titleRequest, messages: [titleRequest.messages[0], { role: 'user', content: 'Generate the session title from this JSON array of human messages:\n[{"seq":2,"text":"other task"}]' }] },
  { ...titleRequest, messages: [titleRequest.messages[0], { role: 'user', content: 'prefix ' + NATIVE_READER_PROMPT }] },
])('rejects malformed or unrelated title requests without consuming either slot: %#', async (body) => {
  const provider = await startReaderSmokeProvider()
  try {
    provider.arm()
    const response = await fetch(`${provider.url}/chat/completions`, {
      method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
    })
    expect(response.status).toBe(500)
    expect(provider.acceptedRequests).toBe(0)
    expect(provider.acceptedTitleRequests).toBe(0)
    expect(provider.phase).toBe('armed')
  } finally { await provider.close() }
})
