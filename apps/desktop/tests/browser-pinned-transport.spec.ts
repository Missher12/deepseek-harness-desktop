import { Duplex } from 'node:stream'
import { connect, type Socket } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserError } from '../src/browser/contracts.ts'
import {
  BrowserProxyAuthenticationOwner,
  LoopbackPinnedNavigationTransport,
} from '../src/browser/pinned-transport.ts'

class FakeProxySession {
  readonly configurations: Record<string, unknown>[] = []
  readonly forceReloadProxyConfig = vi.fn(async () => {})

  async setProxy(configuration: Record<string, unknown>): Promise<void> {
    this.configurations.push(configuration)
  }
}

class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T | PromiseLike<T>) => void
  constructor() { this.promise = new Promise((resolve) => { this.resolve = resolve }) }
}

function inertSocket(): Duplex {
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) { callback() },
  })
  queueMicrotask(() => { socket.emit('connect') })
  return socket
}

function proxyPort(session: FakeProxySession): number {
  const rules = session.configurations.at(-1)?.proxyRules
  const match = typeof rules === 'string' ? /127\.0\.0\.1:(\d+)$/u.exec(rules) : undefined
  if (match?.[1] === undefined) throw new Error('proxy was not configured')
  return Number.parseInt(match[1], 10)
}

async function rawProxyRequest(port: number, request: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let response = ''
    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('data', (chunk: string) => {
      response += chunk
      if (response.includes('\r\n\r\n')) {
        socket.destroy()
        resolve(response)
      }
    })
    socket.once('connect', () => { socket.write(request) })
  })
}

async function openProxySocket(port: number, request: string): Promise<Socket> {
  const socket = connect({ host: '127.0.0.1', port })
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => { reject(error) }
    socket.once('error', failed)
    socket.once('connect', () => {
      socket.removeListener('error', failed)
      resolve()
    })
  })
  socket.on('error', () => {})
  socket.write(request)
  return socket
}

async function settlesPromptly(operation: Promise<void>): Promise<'disposed' | 'timeout'> {
  return await Promise.race([
    operation.then(() => 'disposed' as const),
    new Promise<'timeout'>((resolve) => { setTimeout(() => { resolve('timeout') }, 150) }),
  ])
}

function proxyAuthorization(transport: LoopbackPinnedNavigationTransport, port: number): string {
  let credentials: readonly [string, string] | undefined
  const handled = transport.handleAuthentication({
    isProxy: true,
    scheme: 'basic',
    host: '127.0.0.1',
    port,
    realm: 'dsh-agent-browser',
  }, (username, password) => {
    if (username !== undefined && password !== undefined) credentials = [username, password]
  })
  if (!handled || credentials === undefined) throw new Error('proxy authentication was not supplied')
  return `Basic ${Buffer.from(credentials.join(':')).toString('base64')}`
}

function authorizeRequest(request: string, authorization: string): string {
  return request.replace('\r\n\r\n', `\r\nProxy-Authorization: ${authorization}\r\n\r\n`)
}

function navigation(url: string, addresses: readonly string[]) {
  return Object.freeze({ url: new URL(url).href, hostname: new URL(url).hostname, addresses })
}

describe('loopback pinned HTTPS CONNECT transport', () => {
  it('routes Chromium proxy challenges only to the exact active generation owner', () => {
    const owner = new BrowserProxyAuthenticationOwner()
    const firstContents = {}
    const secondContents = {}
    const firstAuthenticator = { handleAuthentication: vi.fn(() => true) }
    const secondAuthenticator = { handleAuthentication: vi.fn(() => true) }
    const challenge = {
      isProxy: true, scheme: 'basic', host: '127.0.0.1', port: 1234, realm: 'dsh-agent-browser',
    }
    const callback = vi.fn()

    const first = owner.register(firstContents, 1, firstAuthenticator)
    expect(owner.handle(secondContents, challenge, callback)).toBe(false)
    expect(owner.handle(firstContents, challenge, callback)).toBe(true)
    first.dispose()
    const second = owner.register(secondContents, 2, secondAuthenticator)
    first.dispose()

    expect(owner.handle(firstContents, challenge, callback)).toBe(false)
    expect(owner.handle(secondContents, challenge, callback)).toBe(true)
    expect(secondAuthenticator.handleAuthentication).toHaveBeenCalledOnce()
    second.dispose()
  })

  it('requires generation-private Chromium proxy authentication before pinning CONNECT', async () => {
    const session = new FakeProxySession()
    const connector = vi.fn(() => inertSocket())
    const resolveAndValidate = vi.fn(async (url: string) => navigation(url, ['93.184.216.34']))
    const transport = new LoopbackPinnedNavigationTransport({
      session,
      generation: 7,
      isGenerationActive: generation => generation === 7,
      connect: connector,
    })

    await transport.load({ url: 'https://example.test/path', resolveAndValidate, commit: async () => {} })
    const port = proxyPort(session)
    const unauthenticated = await rawProxyRequest(
      port,
      'CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n',
    )
    expect(unauthenticated).toContain('407 Proxy Authentication Required')
    expect(connector).not.toHaveBeenCalled()
    const authorization = proxyAuthorization(transport, port)
    const response = await rawProxyRequest(
      proxyPort(session),
      authorizeRequest('CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n', authorization),
    )

    expect(response).toContain('200 Connection Established')
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({ host: '93.184.216.34', port: 443 }))
    expect(resolveAndValidate).toHaveBeenLastCalledWith('https://example.test/', expect.any(AbortSignal))
    const configuration = session.configurations[0]
    expect(configuration?.proxyBypassRules).toBe('<-loopback>')
    if (typeof configuration?.proxyRules !== 'string') throw new Error('proxy rules were not configured')
    expect(configuration.proxyRules).toContain('https=127.0.0.1:')
    await transport.dispose()
  })

  it('rejects a public-to-private DNS rebind without opening an upstream socket', async () => {
    const session = new FakeProxySession()
    const connector = vi.fn(() => inertSocket())
    let resolution = 0
    const transport = new LoopbackPinnedNavigationTransport({
      session,
      generation: 2,
      isGenerationActive: () => true,
      connect: connector,
    })
    const resolveAndValidate = vi.fn(async (url: string) => {
      resolution += 1
      if (resolution === 1) return navigation(url, ['93.184.216.34'])
      throw new AgentBrowserError('POLICY_DENIED', 'private DNS answer')
    })

    await transport.load({ url: 'https://rebind.test/', resolveAndValidate, commit: async () => {} })
    const authorization = proxyAuthorization(transport, proxyPort(session))
    const response = await rawProxyRequest(
      proxyPort(session),
      authorizeRequest('CONNECT rebind.test:443 HTTP/1.1\r\nHost: rebind.test:443\r\n\r\n', authorization),
    )

    expect(response).toContain('403 Forbidden')
    expect(connector).not.toHaveBeenCalled()
    await transport.dispose()
  })

  it.each([
    ['ordinary HTTP', 'GET http://example.test/ HTTP/1.1\r\nHost: example.test\r\n\r\n', '405 Method Not Allowed'],
    ['non-443 CONNECT', 'CONNECT example.test:8443 HTTP/1.1\r\nHost: example.test:8443\r\n\r\n', '403 Forbidden'],
    ['userinfo authority', 'CONNECT user@example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n', '403 Forbidden'],
  ])('rejects %s proxy traffic', async (_label, request, status) => {
    const session = new FakeProxySession()
    const connector = vi.fn(() => inertSocket())
    const transport = new LoopbackPinnedNavigationTransport({
      session,
      generation: 3,
      isGenerationActive: () => true,
      connect: connector,
    })
    await transport.load({
      url: 'https://example.test/',
      resolveAndValidate: async url => navigation(url, ['93.184.216.34']),
      commit: async () => {},
    })

    const authorization = proxyAuthorization(transport, proxyPort(session))
    expect(await rawProxyRequest(proxyPort(session), authorizeRequest(request, authorization))).toContain(status)
    expect(connector).not.toHaveBeenCalled()
    await transport.dispose()
  })

  it('destroys a client that stalls before completing proxy headers during disposal', async () => {
    const session = new FakeProxySession()
    const transport = new LoopbackPinnedNavigationTransport({
      session,
      generation: 5,
      isGenerationActive: () => true,
    })
    await transport.load({
      url: 'https://example.test/',
      resolveAndValidate: async url => navigation(url, ['93.184.216.34']),
      commit: async () => {},
    })
    const socket = await openProxySocket(proxyPort(session), 'CONNECT example.test:443 HTTP/1.1\r\n')

    const disposal = transport.dispose()
    const outcome = await settlesPromptly(disposal)
    socket.destroy()
    await disposal

    expect(outcome).toBe('disposed')
  })

  it('destroys an authenticated client while CONNECT resolution is pending', async () => {
    const session = new FakeProxySession()
    const pending = new Deferred<ReturnType<typeof navigation>>()
    const connector = vi.fn(() => inertSocket())
    let resolutions = 0
    let connectSignal: AbortSignal | undefined
    const resolveAndValidate = vi.fn(async (url: string, signal?: AbortSignal) => {
      resolutions += 1
      if (resolutions === 2) connectSignal = signal
      return resolutions === 1 ? navigation(url, ['93.184.216.34']) : await pending.promise
    })
    const transport = new LoopbackPinnedNavigationTransport({
      session,
      generation: 6,
      isGenerationActive: () => true,
      connect: connector,
    })
    await transport.load({ url: 'https://example.test/', resolveAndValidate, commit: async () => {} })
    const port = proxyPort(session)
    const socket = await openProxySocket(port, authorizeRequest(
      'CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n',
      proxyAuthorization(transport, port),
    ))
    await vi.waitFor(() => { expect(resolveAndValidate).toHaveBeenCalledTimes(2) })

    const disposal = transport.dispose()
    const outcome = await settlesPromptly(disposal)
    expect(connectSignal?.aborted).toBe(true)
    socket.destroy()
    pending.resolve(navigation('https://example.test/', ['93.184.216.34']))
    await disposal

    expect(outcome).toBe('disposed')
    expect(connector).not.toHaveBeenCalled()
  })

  it('restores the owning Electron Session to its prior system proxy mode after partial apply', async () => {
    const session = new FakeProxySession()
    const setProxy = vi.spyOn(session, 'setProxy')
      .mockRejectedValueOnce(new Error('proxy apply interrupted'))
      .mockResolvedValueOnce()
    const transport = new LoopbackPinnedNavigationTransport({
      session,
      generation: 4,
      isGenerationActive: () => true,
    })

    await expect(transport.load({
      url: 'https://example.test/',
      resolveAndValidate: async url => navigation(url, ['93.184.216.34']),
      commit: async () => {},
    })).rejects.toThrow('proxy apply interrupted')
    await transport.dispose()

    expect(setProxy).toHaveBeenLastCalledWith({ mode: 'system' })
    expect(session.forceReloadProxyConfig).toHaveBeenCalledOnce()
  })
})
