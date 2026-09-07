import { createServer, type ServerResponse } from 'node:http'

/** Exact isolated user request allowed through the native provider tripwire. */
export const NATIVE_READER_PROMPT = 'Verify the built-in native reading presentation.'
/** Literal reasoning fixture, long enough to exercise the bounded viewport. */
export const NATIVE_READER_REASONING = Array.from({ length: 24 }, (_, index) =>
  `Line ${String(index + 1).padStart(2, '0')}: preserve native reasoning and the reader's selection.`,
).join('\n')
/** A later delta proves that Unicode and a live selection survive appends. */
export const NATIVE_READER_APPEND = '\nNative append: 中文 👨‍👩‍👧‍👦 é.'
/** Native Markdown fixture emitted before the explicit completion barrier. */
export const NATIVE_READER_ANSWER = '# Native reader verified\n\nThe final answer remains visible.\n\n```ts\nconst nativeReader = true\n```\n\n| Check | Result |\n| --- | --- |\n| Native Markdown | Preserved |'

/** One owned provider fixture; every request outside its armed Turn fails loud. */
export interface ReaderSmokeProvider {
  /** Loopback OpenAI-compatible base URL, including `/v1`. */
  readonly url: string
  /** Unexpected method/path pairs; request bodies and headers are never retained. */
  readonly requests: readonly string[]
  /** Number of accepted fixture requests; exactly one is permitted. */
  readonly acceptedRequests: number
  /** Observable barrier state for deterministic UI and transport assertions. */
  readonly phase: 'idle' | 'armed' | 'thinking' | 'appended' | 'answering' | 'completed'
  /** Permit the exact fixture request once, after unrelated native tests finish. */
  arm(): void
  /** Release the later reasoning delta. */
  append(): void
  /** Release the final Markdown while keeping the Turn open. */
  answer(): void
  /** Release the successful terminal event and close the SSE response. */
  finish(): void
  /** Stop accepting requests and close every owned connection; idempotent. */
  close(): Promise<void>
}

function isReaderRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const body = value as { model?: unknown; stream?: unknown; messages?: unknown }
  return body.model === 'native-thinker' && body.stream === true && Array.isArray(body.messages)
    && body.messages.some((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return false
      const message = entry as { role?: unknown; content?: unknown }
      if (message.role !== 'user') return false
      if (typeof message.content === 'string') return message.content.includes(NATIVE_READER_PROMPT)
      return Array.isArray(message.content) && message.content.some((part: unknown) => {
        if (typeof part !== 'object' || part === null) return false
        const block = part as { type?: unknown; text?: unknown }
        return block.type === 'text' && typeof block.text === 'string' && block.text.includes(NATIVE_READER_PROMPT)
      })
    })
}

/**
 * Start the native smoke's local provider tripwire with one explicitly paced Turn.
 * @returns the listener owner and synchronous release controls; callers close it in finally.
 */
export async function startReaderSmokeProvider(): Promise<ReaderSmokeProvider> {
  const requests: string[] = []
  let acceptedRequests = 0
  let phase: ReaderSmokeProvider['phase'] = 'idle'
  let active: ServerResponse | undefined
  let closing: Promise<void> | undefined
  const write = (delta: Record<string, string>, finishReason: string | null = null) => {
    if (active === undefined || active.destroyed) throw new Error('native reader response is not active')
    active.write(`data: ${JSON.stringify({
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(finishReason === null ? {} : { usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    })}\n\n`)
  }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    let bytes = 0
    request.on('error', () => { response.destroy() })
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes <= 1_048_576) chunks.push(chunk)
      else chunks.length = 0
    })
    request.on('end', () => {
      let body: unknown
      if (bytes <= 1_048_576) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* Rejected below. */ }
      }
      if (phase !== 'armed' || request.method !== 'POST' || request.url !== '/v1/chat/completions'
        || !isReaderRequest(body)) {
        requests.push(`${request.method ?? 'UNKNOWN'} ${request.url ?? '/'}`)
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"packaged smoke provider tripwire"}}')
        return
      }
      acceptedRequests += 1
      phase = 'thinking'
      active = response
      response.on('close', () => { if (active === response) active = undefined })
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      write({ role: 'assistant', reasoning_content: NATIVE_READER_REASONING })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('native reader provider has no TCP port')
  }
  const requirePhase = (expected: ReaderSmokeProvider['phase']) => {
    if (phase !== expected) throw new Error(`native reader expected ${expected}, got ${phase}`)
  }
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    get acceptedRequests() { return acceptedRequests },
    get phase() { return phase },
    arm() { requirePhase('idle'); phase = 'armed' },
    append() { requirePhase('thinking'); write({ reasoning_content: NATIVE_READER_APPEND }); phase = 'appended' },
    answer() { requirePhase('appended'); write({ content: NATIVE_READER_ANSWER }); phase = 'answering' },
    finish() {
      requirePhase('answering')
      write({}, 'stop')
      active?.end('data: [DONE]\n\n')
      phase = 'completed'
    },
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
        server.closeAllConnections()
      })
      return closing
    },
  }
}
