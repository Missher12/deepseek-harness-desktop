import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from '../src/http-bridge.ts'
import { MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS } from '@deepseek-ai/dsh-attachment/types'

describe('HTTP bridge abort', () => {
  it('destroys a declared-oversize request instead of draining it', async () => {
    const destroyed: true[] = []
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, 1000)
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'directoryPicker/pick', payload: { args: {} },
    })
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/directoryPicker/pick',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let carrierSignal: AbortSignal | undefined
    const pending = bridge(request, response, {
      requestBodyMode: () => 'buffered',
      fetch: async (input) => {
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, Number.MAX_SAFE_INTEGER)
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })

  it('streams a declared 2.19 GiB request before the body ends and bypasses the JSON buffer cap', async () => {
    const request = new Readable({ read() {} }) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session/uploadFileBinary?sessionId=s1',
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(Math.ceil(2.19 * 1024 ** 3)),
      },
    })
    let status: number | undefined
    const responseBytes: Uint8Array[] = []
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number) { status = code; return this },
      write(chunk: Uint8Array) { responseBytes.push(chunk); return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    const received: Uint8Array[] = []
    const pending = bridge(request, response, {
      requestBodyMode: () => 'streaming',
      fetch: async (input) => {
        resolveStarted()
        if (input.body === null) throw new Error('streaming request lost its body')
        for await (const chunk of input.body) received.push(chunk)
        return new Response('stored')
      },
    }, 1)

    await started
    expect(received).toEqual([])
    request.push(Buffer.from([1, 2]))
    request.push(Buffer.from([3, 4]))
    request.push(null)
    await pending
    expect(status).toBe(200)
    expect(received).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3, 4)])
    expect(Buffer.concat(responseBytes).toString()).toBe('stored')
  })

  it('closes an unread streaming request after returning an early validation response', async () => {
    const destroyed: true[] = []
    const request = new Readable({ read() {} }) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session/uploadFileBinary',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      requestBodyMode: () => 'streaming',
      fetch: () => Promise.resolve(new Response(null, { status: 415 })),
    }, 1)
    expect(status).toBe(415)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toEqual([true])
  })
})

/**
 * Build the minimal node:http pair the bridge reads and writes.
 * @param contentLength - declared request body length; omitted sends no header.
 * @param body - request body chunks; omitted sends an already-ended empty stream.
 * @returns the request, the response, and a reader for the written status.
 */
function bridgeHarness(contentLength?: number, body: readonly Buffer[] = []) {
  const request = Readable.from(body) as unknown as IncomingMessage
  Object.assign(request, {
    url: '/api/session.prompt',
    method: 'POST',
    headers: contentLength === undefined
      ? { 'content-type': 'application/json' }
      : { 'content-type': 'application/json', 'content-length': String(contentLength) },
    destroy: () => {},
  })
  let status: number | undefined
  let beginWrite: () => void = () => {}
  const written = new Promise<void>((resolve) => { beginWrite = resolve })
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(code: number) { status = code; beginWrite(); return this },
    write() { return true },
    end(this: { writableEnded: boolean }) { this.writableEnded = true; beginWrite(); return this },
  }) as unknown as ServerResponse
  // The admit path streams a real response, so a test that awaits only the
  // bridge would wait on a response object that never finishes it.
  return { request, response, written, status: () => status }
}

describe('prompt carrier budget', () => {
  /**
   * Base64 code units a canonical encoding of `bytes` occupies. The carrier
   * counts these, not the decoded bytes the attachment limits name, which is
   * what makes the two budgets differ by a third.
   */
  function encodedCodeUnits(bytes: number): number {
    return Math.ceil(bytes / 3) * 4
  }

  it('pins the carrier ceiling the bridge and the attachment budget both assume', () => {
    // The bridge's default envelope is the attachment ceiling plus framing for
    // prompt text, names, and RPC JSON.
    expect(DEFAULT_MAX_REQUEST_BODY_BYTES - MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS)
      .toBe(4 * 1024 * 1024)
    // A full 200 MiB image budget fits, because base64 costs a third more than
    // the decoded bytes the attachment limits name.
    expect(encodedCodeUnits(200 * 1024 * 1024)).toBeLessThan(MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS)
    // The document budget cannot ride alongside the full image budget: their
    // encoded sum is larger than the carrier ceiling. The composer refuses that
    // combination up front rather than letting the Host answer 413 for it.
    const both = encodedCodeUnits(200 * 1024 * 1024) + encodedCodeUnits(50 * 1024 * 1024)
    expect(both).toBeGreaterThan(MAX_PROMPT_ATTACHMENT_BASE64_CODE_UNITS)
  })

  it('rejects a declared body one byte past the carrier ceiling with 413', async () => {
    // A declared length is answered from the header alone, so the bridge
    // refuses before reading a body: no test tenant allocates 300 MiB to prove
    // which side of the ceiling a request falls on, and the handler is never
    // reached for a refused request.
    let reached = false
    const refused = bridgeHarness(DEFAULT_MAX_REQUEST_BODY_BYTES + 1)
    await bridge(refused.request, refused.response, {
      requestBodyMode: () => 'buffered',
      fetch: async () => { reached = true; return Response.json({}) },
    })
    expect(refused.status()).toBe(413)
    expect(reached).toBe(false)
  })
})
