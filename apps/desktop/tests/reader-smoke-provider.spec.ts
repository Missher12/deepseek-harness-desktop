import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import {
  NATIVE_READER_ANSWER, NATIVE_READER_APPEND, NATIVE_READER_PROMPT, NATIVE_READER_REASONING,
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

it('translates the held HTTP response through the actual Desktop model adapter', async () => {
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
    provider.arm()
    completed = (async () => {
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({
        provider: 'desktop-smoke', model: 'native-thinker', signal: controller.signal,
        messages: [createUserMessage({
          content: [{ type: 'text', text: NATIVE_READER_PROMPT }], source: { kind: 'plugin', plugin: 'native-reader-test' },
        })],
      })) assembler.push(chunk)
      return assembler
    })()
    void completed.catch(() => {})
    await expect.poll(() => provider.phase, { timeout: 5_000 }).toBe('thinking')
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
})
