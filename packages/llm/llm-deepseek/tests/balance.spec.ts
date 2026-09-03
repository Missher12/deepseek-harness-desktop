import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DeepSeekConnectionOptions } from '../src/adapter.ts'
import {
  BALANCE_CAPABILITY_HEADER,
  BALANCE_TIMEOUT_MS,
  injectDeepSeekBalanceBootstrap,
  installDeepSeekBalanceHttp,
  parseDeepSeekBalance,
} from '../src/balance.ts'

interface RegisteredRoute {
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
}

function connection(baseURL = 'https://api.deepseek.com'): DeepSeekConnectionOptions {
  return { baseURL } as DeepSeekConnectionOptions
}

function responseRecorder(): {
  response: ServerResponse
  result: { status: number; headers: Record<string, unknown>; body: string }
} {
  const result = { status: 0, headers: {} as Record<string, unknown>, body: '' }
  const response = {
    writeHead(status: number, headers?: Record<string, unknown>) {
      result.status = status
      result.headers = headers ?? {}
      return this
    },
    end(body?: string) { result.body = body ?? '' },
  } as unknown as ServerResponse
  return { response, result }
}

function request(method: string, capability?: string): IncomingMessage {
  return {
    method,
    headers: capability === undefined ? {} : { [BALANCE_CAPABILITY_HEADER]: capability },
  } as unknown as IncomingMessage
}

function installed(
  baseURL = 'https://api.deepseek.com',
  overrides: {
    options?: () => DeepSeekConnectionOptions
    resolveApiKey?: (connection: DeepSeekConnectionOptions) => Promise<string>
  } = {},
) {
  let route: RegisteredRoute | undefined
  let transform: ((html: string) => string) | undefined
  const disposeRoute = vi.fn()
  const disposeTap = vi.fn()
  const webServer = {
    register(value: RegisteredRoute) { route = value; return disposeRoute },
    tapIndex(value: (html: string) => string) { transform = value; return disposeTap },
  }
  const resolveApiKey = vi.fn(overrides.resolveApiKey ?? (async () => 'placeholder-test-key'))
  const ctx = { get: vi.fn((name: string) => name === 'webServer' ? webServer : undefined) } as unknown as Context
  const dispose = installDeepSeekBalanceHttp(ctx, {
    options: overrides.options ?? (() => connection(baseURL)),
    resolveApiKey,
  })
  if (dispose === undefined || route === undefined || transform === undefined) throw new Error('bridge did not install')
  const html = transform('<html><head></head><body></body></html>')
  const capability = /"capability":"([^"]+)"/u.exec(html)?.[1]
  if (capability === undefined) throw new Error('capability missing')
  return { route, capability, resolveApiKey, dispose, disposeRoute, disposeTap }
}

async function invoke(route: RegisteredRoute, req: IncomingMessage) {
  const recorder = responseRecorder()
  await route.handler(req, recorder.response)
  return recorder.result
}

function nonErrorFailure(message: string): Error {
  const failure = new Error(message)
  Reflect.setPrototypeOf(failure, { toString: () => message })
  return failure
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DeepSeek balance payload', () => {
  it('prefers CNY while retaining a valid USD fallback', () => {
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        { currency: 'USD', total_balance: '4.25', granted_balance: '1', topped_up_balance: '3.25' },
        { currency: 'CNY', total_balance: '110.00', granted_balance: '10', topped_up_balance: '100' },
      ],
    }, 100)).toEqual({
      fetchedAt: 100, currency: 'CNY', totalBalance: 110,
      grantedBalance: 10, toppedUpBalance: 100, error: null,
    })
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '4.25', granted_balance: '1', topped_up_balance: '3.25' }],
    }, 101).currency).toBe('USD')
  })

  it('rejects unavailable or malformed total balances', () => {
    expect(parseDeepSeekBalance({ is_available: false, balance_infos: [] }, 100).error).not.toBeNull()
    const malformed = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '-1', granted_balance: '0', topped_up_balance: '0' }],
    }, 100)
    expect(malformed.totalBalance).toBeNull()
    expect(malformed.error).not.toBeNull()
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '1abc' }],
    }, 100).error).not.toBeNull()
  })

  it('ignores unsupported or malformed entries before using a valid USD fallback', () => {
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        { currency: 'EUR', total_balance: '99' },
        { currency: 'CNY', total_balance: '1abc' },
        { currency: 'USD', total_balance: '4.25', granted_balance: '1', topped_up_balance: '3.25' },
      ],
    }, 100)).toEqual({
      fetchedAt: 100, currency: 'USD', totalBalance: 4.25,
      grantedBalance: 1, toppedUpBalance: 3.25, error: null,
    })
  })

  it('rejects unexpected roots, missing lists, and every malformed entry shape', () => {
    for (const payload of [null, [], 'balance']) {
      expect(parseDeepSeekBalance(payload, 100).error).toBe('unexpected balance payload')
    }
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: {} }, 100).error)
      .toBe('no balance entries')
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [null, [], 'entry', { currency: 'CNY' }, { currency: 'USD', total_balance: '' }],
    }, 100).error).toBe('no balance entries')
  })

  it('revalidates selected provider records and tolerates a disappearing currency label', () => {
    let totalReads = 0
    const changingTotal = {
      currency: 'CNY',
      get total_balance() { return totalReads++ === 0 ? '1' : '' },
    }
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [changingTotal],
    }, 100).error).toBe('invalid total balance')

    let currencyReads = 0
    const changingCurrency = {
      total_balance: '1',
      get currency() { return currencyReads++ === 0 ? 'CNY' : '' },
    }
    expect(parseDeepSeekBalance({
      is_available: true,
      balance_infos: [changingCurrency],
    }, 101)).toMatchObject({ currency: null, totalBalance: 1, error: null })
  })
})

describe('DeepSeek balance HTTP bridge', () => {
  it('creates a URL-safe capability without requiring Buffer base64url support', () => {
    const nativeToString = Buffer.prototype.toString
    const toString = vi.spyOn(Buffer.prototype, 'toString').mockImplementation(function (
      this: Buffer,
      encoding?: unknown,
      start?: unknown,
      end?: unknown,
    ) {
      if (encoding === 'base64url') throw new TypeError('Unknown encoding: base64url')
      return nativeToString.call(
        this,
        encoding as BufferEncoding | undefined,
        start as number | undefined,
        end as number | undefined,
      )
    })
    try {
      const { capability } = installed()
      expect(capability).toMatch(/^[A-Za-z0-9_-]+$/u)
      expect(capability).not.toContain('=')
    } finally {
      toString.mockRestore()
    }
  })

  it('injects an escaped generation capability and rejects unauthorized or mutating requests', async () => {
    const { route } = installed()
    expect(injectDeepSeekBalanceBootstrap('<head></head>', '</script>')).not.toContain('</script></script>')
    expect(injectDeepSeekBalanceBootstrap('<body></body>', 'capability')).toMatch(/^<script/u)
    expect((await invoke(route, request('GET'))).status).toBe(403)
    expect((await invoke(route, request('POST', 'wrong'))).status).toBe(405)
  })

  it('accepts an array capability header and returns a bodyless HEAD response', async () => {
    const { route, capability } = installed()
    const req = request('HEAD')
    req.headers[BALANCE_CAPABILITY_HEADER] = [capability]
    const result = await invoke(route, req)
    expect(result.status).toBe(200)
    expect(result.headers['content-length']).toBeGreaterThan(0)
    expect(result.body).toBe('')
  })

  it('coalesces concurrent reads, caches success, and does not cache failures', async () => {
    const success = {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '8.50', granted_balance: '0', topped_up_balance: '8.50' }],
    }
    const first = Promise.withResolvers<Response>()
    const providerFetch = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(new Response('failed', { status: 500 }))
      .mockResolvedValue(new Response(JSON.stringify(success), { status: 200 }))
    vi.stubGlobal('fetch', providerFetch)
    const { route, capability } = installed()

    const a = invoke(route, request('GET', capability))
    const b = invoke(route, request('GET', capability))
    await vi.waitFor(() => { expect(providerFetch).toHaveBeenCalledTimes(1) })
    first.resolve(new Response(JSON.stringify(success), { status: 200 }))
    expect(JSON.parse((await a).body) as unknown).toMatchObject({ totalBalance: 8.5 })
    expect(JSON.parse((await b).body) as unknown).toMatchObject({ totalBalance: 8.5 })
    await invoke(route, request('GET', capability))
    expect(providerFetch).toHaveBeenCalledTimes(1)

    const failing = installed()
    expect((await invoke(failing.route, request('GET', failing.capability))).status).toBe(200)
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect((await invoke(failing.route, request('GET', failing.capability))).status).toBe(200)
    expect(providerFetch).toHaveBeenCalledTimes(3)
  })

  it('never resolves or sends the credential to a non-official endpoint', async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)
    const bridge = installed('https://gateway.example')
    const result = await invoke(bridge.route, request('GET', bridge.capability))
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body) as unknown).toMatchObject({ totalBalance: null })
    expect(bridge.resolveApiKey).not.toHaveBeenCalled()
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it.each(['http://api.deepseek.com', 'not a URL'])(
    'rejects a non-official balance base URL before credential resolution: %s',
    async (baseURL) => {
      const providerFetch = vi.fn()
      vi.stubGlobal('fetch', providerFetch)
      const bridge = installed(baseURL)
      const result = await invoke(bridge.route, request('GET', bridge.capability))
      expect(JSON.parse(result.body) as unknown).toMatchObject({
        error: 'balance endpoint is available only for api.deepseek.com',
      })
      expect(bridge.resolveApiKey).not.toHaveBeenCalled()
      expect(providerFetch).not.toHaveBeenCalled()
    },
  )

  it('reports provider transport and JSON failures without caching them', async () => {
    const providerStringFailure = nonErrorFailure('provider string failure')
    const jsonStringFailure = nonErrorFailure('json string failure')
    const providerFetch = vi.fn()
      .mockRejectedValueOnce(new Error('provider offline'))
      .mockRejectedValueOnce(providerStringFailure)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('json unavailable')),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(jsonStringFailure),
      })
    vi.stubGlobal('fetch', providerFetch)

    for (const expected of ['provider offline', 'provider string failure', 'json unavailable', 'json string failure']) {
      const bridge = installed()
      const result = await invoke(bridge.route, request('GET', bridge.capability))
      const snapshot = JSON.parse(result.body) as { error: string }
      expect(snapshot.error).toContain(expected)
    }
    expect(providerFetch).toHaveBeenCalledTimes(4)
  })

  it('turns credential-resolution failures into safe snapshots', async () => {
    const errored = installed('https://api.deepseek.com', {
      options: () => { throw new Error('options unavailable') },
    })
    expect(JSON.parse((await invoke(errored.route, request('GET', errored.capability))).body) as unknown)
      .toMatchObject({ error: 'options unavailable' })

    const rejected = installed('https://api.deepseek.com', {
      resolveApiKey: () => Promise.reject(nonErrorFailure('credential unavailable')),
    })
    expect(JSON.parse((await invoke(rejected.route, request('GET', rejected.capability))).body) as unknown)
      .toMatchObject({ error: 'credential unavailable' })
  })

  it('aborts a provider read after the bounded timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_endpoint: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('provider timeout')) })
    })))
    const bridge = installed()
    const pending = invoke(bridge.route, request('GET', bridge.capability))
    await vi.advanceTimersByTimeAsync(BALANCE_TIMEOUT_MS)
    expect(JSON.parse((await pending).body) as unknown).toMatchObject({ error: 'provider timeout' })
  })

  it('skips installation when the WebServer service is absent', () => {
    const ctx = { get: () => undefined } as unknown as Context
    expect(installDeepSeekBalanceHttp(ctx, {
      options: () => connection(),
      resolveApiKey: () => Promise.resolve('unused'),
    })).toBeUndefined()
  })

  it('disposes the route and index transform together', () => {
    const bridge = installed()
    bridge.dispose()
    expect(bridge.disposeTap).toHaveBeenCalledOnce()
    expect(bridge.disposeRoute).toHaveBeenCalledOnce()
  })
})
