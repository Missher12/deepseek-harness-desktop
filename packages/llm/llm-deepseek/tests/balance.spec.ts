import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DeepSeekConnectionOptions } from '../src/adapter.ts'
import {
  BALANCE_CAPABILITY_HEADER,
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

function installed(baseURL = 'https://api.deepseek.com') {
  let route: RegisteredRoute | undefined
  let transform: ((html: string) => string) | undefined
  const disposeRoute = vi.fn()
  const disposeTap = vi.fn()
  const webServer = {
    register(value: RegisteredRoute) { route = value; return disposeRoute },
    tapIndex(value: (html: string) => string) { transform = value; return disposeTap },
  }
  const resolveApiKey = vi.fn(async () => 'placeholder-test-key')
  const ctx = { get: vi.fn((name: string) => name === 'webServer' ? webServer : undefined) } as unknown as Context
  const dispose = installDeepSeekBalanceHttp(ctx, {
    options: () => connection(baseURL),
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

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
})

describe('DeepSeek balance HTTP bridge', () => {
  it('injects an escaped generation capability and rejects unauthorized or mutating requests', async () => {
    const { route } = installed()
    expect(injectDeepSeekBalanceBootstrap('<head></head>', '</script>')).not.toContain('</script></script>')
    expect((await invoke(route, request('GET'))).status).toBe(403)
    expect((await invoke(route, request('POST', 'wrong'))).status).toBe(405)
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

  it('disposes the route and index transform together', () => {
    const bridge = installed()
    bridge.dispose()
    expect(bridge.disposeTap).toHaveBeenCalledOnce()
    expect(bridge.disposeRoute).toHaveBeenCalledOnce()
  })
})
