import { Duplex } from 'node:stream'
import { connect } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserError } from '../src/browser/contracts.ts'
import { LoopbackPinnedNavigationTransport } from '../src/browser/pinned-transport.ts'

class FakeProxySession {
  readonly configurations: Record<string, unknown>[] = []
  readonly forceReloadProxyConfig = vi.fn(async () => {})

  async setProxy(configuration: Record<string, unknown>): Promise<void> {
    this.configurations.push(configuration)
  }
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

function navigation(url: string, addresses: readonly string[]) {
  return Object.freeze({ url: new URL(url).href, hostname: new URL(url).hostname, addresses })
}

describe('loopback pinned HTTPS CONNECT transport', () => {
  it('pins an accepted CONNECT socket to the resolver-selected public IP', async () => {
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
    const response = await rawProxyRequest(
      proxyPort(session),
      'CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n',
    )

    expect(response).toContain('200 Connection Established')
    expect(connector).toHaveBeenCalledWith(expect.objectContaining({ host: '93.184.216.34', port: 443 }))
    expect(resolveAndValidate).toHaveBeenLastCalledWith('https://example.test/', undefined)
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
    const response = await rawProxyRequest(
      proxyPort(session),
      'CONNECT rebind.test:443 HTTP/1.1\r\nHost: rebind.test:443\r\n\r\n',
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

    expect(await rawProxyRequest(proxyPort(session), request)).toContain(status)
    expect(connector).not.toHaveBeenCalled()
    await transport.dispose()
  })

  it('restores direct mode when Electron partially applies a rejected proxy configuration', async () => {
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

    expect(setProxy).toHaveBeenLastCalledWith({ mode: 'direct' })
    expect(session.forceReloadProxyConfig).toHaveBeenCalledOnce()
  })
})
