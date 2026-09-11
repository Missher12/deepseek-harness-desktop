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

/** One bounded auxiliary title for the same native reader Turn. */
export const NATIVE_READER_TITLE = 'Native reader presentation'
/** Exact automatic-title framing shared by the isolated native fixtures. */
export const TITLE_FRAME_PREFIX = 'Generate the session title from this JSON array of human messages:\n'
/** Exact automatic-title instruction; auxiliary requests cannot become arbitrary model calls. */
export const TITLE_SYSTEM = [
  'Create a concise title for an AI coding-assistant session from the supplied human messages.',
  'Return only the title on one line, **in plain text of natural language**, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.',
  'Use the language of the messages.',
  'Aim for about 5 words in non-CJK languages or 10 CJK characters.',
].join('\n')

/** One reader Turn and its exact auxiliary title; every other request fails loud. */
export interface ReaderSmokeProvider {
  /** Loopback OpenAI-compatible base URL, including `/v1`. */
  readonly url: string
  /** Unexpected method/path pairs; request bodies and headers are never retained. */
  readonly requests: readonly string[]
  /** Number of accepted main reader requests; exactly one is permitted. */
  readonly acceptedRequests: number
  /** Accepted automatic title requests for this fixture; at most one is permitted. */
  readonly acceptedTitleRequests: number
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

function messageText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.length !== 1) return undefined
  const part: unknown = content[0]
  if (typeof part !== 'object' || part === null) return undefined
  const block = part as { type?: unknown; text?: unknown }
  return block.type === 'text' && typeof block.text === 'string' ? block.text : undefined
}

function requestKind(value: unknown): 'reader' | 'title' | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const body = value as Record<string, unknown>
  if (body.model !== 'native-thinker' || body.stream !== true || !Array.isArray(body.messages)
    || body.messages.some((entry: unknown) => typeof entry !== 'object' || entry === null)) return undefined
  const messages = body.messages as Array<{ role?: unknown; content?: unknown }>
  const titleSystem = messages.some(message => (message.role === 'system' || message.role === 'developer')
    && messageText(message.content) === TITLE_SYSTEM)
  if (!titleSystem && messages.some(message => message.role === 'user' && messageText(message.content) === NATIVE_READER_PROMPT)) {
    return 'reader'
  }
  const [system, user] = messages
  if (messages.length !== 2 || (system?.role !== 'system' && system?.role !== 'developer')
    || messageText(system.content) !== TITLE_SYSTEM || user?.role !== 'user'
    || body.tools !== undefined
    || !((body.max_tokens === 64 && body.max_completion_tokens === undefined)
      || (body.max_completion_tokens === 64 && body.max_tokens === undefined))) return undefined
  const text = messageText(user.content)
  if (text === undefined || !text.startsWith(TITLE_FRAME_PREFIX)) return undefined
  let framed: unknown
  try { framed = JSON.parse(text.slice(TITLE_FRAME_PREFIX.length)) } catch { return undefined }
  if (!Array.isArray(framed) || framed.length !== 1) return undefined
  const item: unknown = framed[0]
  if (typeof item !== 'object' || item === null) return undefined
  const record = item as Record<string, unknown>
  return Object.keys(record).length === 2 && record.text === NATIVE_READER_PROMPT
    && typeof record.seq === 'number' && Number.isSafeInteger(record.seq) && record.seq >= 0
    ? 'title' : undefined
}

/**
 * Start the native smoke's local provider tripwire with one explicitly paced Turn.
 * @param additionalResponse - Optional bounded native scenario; undefined leaves the reader-only tripwire intact.
 * @returns the listener owner and synchronous release controls; callers close it in finally.
 */
export async function startReaderSmokeProvider(
  additionalResponse?: (body: unknown) => string | undefined,
): Promise<ReaderSmokeProvider> {
  const requests: string[] = []
  let acceptedRequests = 0
  let acceptedTitleRequests = 0
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
      const kind = requestKind(body)
      const endpointMatches = request.method === 'POST' && request.url === '/v1/chat/completions'
      const additional = closing === undefined && endpointMatches ? additionalResponse?.(body) : undefined
      if (additional !== undefined) {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        response.end(additional)
        return
      }
      if (closing === undefined && phase !== 'idle' && endpointMatches
        && kind === 'title' && acceptedTitleRequests === 0) {
        acceptedTitleRequests += 1
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        response.end([
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: NATIVE_READER_TITLE }, finish_reason: null }] })}`,
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}`,
          'data: [DONE]', '',
        ].join('\n\n'))
        return
      }
      if (closing !== undefined || phase !== 'armed' || !endpointMatches || kind !== 'reader') {
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
    get acceptedTitleRequests() { return acceptedTitleRequests },
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
