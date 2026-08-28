import { createServer, type Server } from 'node:http'
import { connect as connectSocket, isIP, type SocketConnectOpts } from 'node:net'
import type { Duplex } from 'node:stream'
import { AgentBrowserError } from './contracts.ts'
import type {
  AgentBrowserPinnedNavigationRequest,
  AgentBrowserPinnedNavigationTransport,
} from './cdp-adapter.ts'
import { isBlockedAgentBrowserAddress } from './policy.ts'

/** Narrow Electron Session proxy surface used by the main-owned tunnel. */
export interface PinnedNavigationProxySession {
  setProxy(configuration: {
    readonly mode: 'direct' | 'fixed_servers'
    readonly proxyRules?: string
    readonly proxyBypassRules?: string
  }): Promise<void>
  forceReloadProxyConfig(): Promise<void>
}

/** Injectable socket dialer; production always receives an already-validated IP literal. */
export type PinnedNavigationConnect = (options: SocketConnectOpts) => Duplex

export interface LoopbackPinnedNavigationTransportOptions {
  readonly session: PinnedNavigationProxySession
  readonly generation: number
  readonly isGenerationActive: (generation: number) => boolean
  readonly connect?: PinnedNavigationConnect
}

type Resolver = AgentBrowserPinnedNavigationRequest['resolveAndValidate']

function assertHttpsTarget(value: string): URL {
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new AgentBrowserError('POLICY_DENIED', 'browser proxy destination is not allowed')
  }
  if (target.protocol !== 'https:' || target.username !== '' || target.password !== ''
    || target.hostname === '' || target.port !== '') {
    throw new AgentBrowserError('POLICY_DENIED', 'browser proxy destination is not allowed')
  }
  return target
}

function parseConnectAuthority(authority: string | undefined, hostHeader: string | string[] | undefined): URL | undefined {
  if (authority === undefined || typeof hostHeader !== 'string'
    || authority.toLowerCase() !== hostHeader.toLowerCase()
    || authority.includes('@')
    || !/^(?:[a-z\d.-]+|\[[a-f\d:.]+\]):443$/iu.test(authority)) return undefined
  try {
    const target = new URL(`https://${authority}/`)
    return target.username === '' && target.password === '' && target.hostname !== '' ? target : undefined
  } catch {
    return undefined
  }
}

function endProxyRequest(socket: Duplex, status: string): void {
  if (socket.destroyed) return
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/**
 * Generation-owned loopback CONNECT proxy. Chromium retains the destination hostname for TLS,
 * while the proxy independently resolves every CONNECT and dials only the validated IP literal.
 */
export class LoopbackPinnedNavigationTransport implements AgentBrowserPinnedNavigationTransport {
  private readonly session: PinnedNavigationProxySession
  private readonly generation: number
  private readonly isGenerationActive: (generation: number) => boolean
  private readonly connect: PinnedNavigationConnect
  private readonly sockets = new Set<Duplex>()
  private server: Server | undefined
  private resolver: Resolver | undefined
  private disposed = false
  private proxyConfigured = false

  constructor(options: LoopbackPinnedNavigationTransportOptions) {
    this.session = options.session
    this.generation = options.generation
    this.isGenerationActive = options.isGenerationActive
    this.connect = options.connect ?? (options => connectSocket(options))
  }

  /** Configure the owning Electron Session and commit one hostname navigation through the tunnel. */
  async load(request: AgentBrowserPinnedNavigationRequest): Promise<void> {
    this.assertActive()
    const target = assertHttpsTarget(request.url)
    const binding = await request.resolveAndValidate(target.href, request.signal)
    this.assertActive()
    if (binding.url !== target.href || binding.hostname !== target.hostname || !this.validAddresses(binding.addresses)) {
      throw new AgentBrowserError('POLICY_DENIED', 'browser proxy binding is not allowed')
    }
    this.resolver = request.resolveAndValidate
    const port = await this.ensureListening()
    this.assertActive()
    // Treat setProxy as committed before awaiting it: Electron may apply the
    // configuration even when the promise rejects, so disposal must restore
    // direct mode on every partial-failure path.
    this.proxyConfigured = true
    await this.session.setProxy({
      mode: 'fixed_servers',
      proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
      // Chromium implicitly bypasses proxies for loopback destinations unless
      // <-loopback> subtracts that rule. Every destination must reach the
      // request-time policy check, including localhost and single-label names.
      proxyBypassRules: '<-loopback>',
    })
    await this.session.forceReloadProxyConfig()
    this.assertActive()
    await request.commit()
  }

  /** Close every tunnel and return only this surface Session to direct networking. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.resolver = undefined
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    const failures: unknown[] = []
    if (server !== undefined) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => { if (error === undefined) resolve(); else reject(error) })
        })
        if (this.server === server) this.server = undefined
      } catch (error) {
        if (!server.listening && this.server === server) this.server = undefined
        else failures.push(error)
      }
    }
    if (this.proxyConfigured) {
      try {
        await this.session.setProxy({ mode: 'direct' })
        await this.session.forceReloadProxyConfig()
        this.proxyConfigured = false
      } catch (error) { failures.push(error) }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'browser pinned transport cleanup failed')
  }

  private assertActive(): void {
    if (!this.generationActive()) {
      throw new AgentBrowserError('CANCELLED', 'browser proxy generation is not active')
    }
  }

  private generationActive(): boolean {
    return !this.disposed && this.isGenerationActive(this.generation)
  }

  private validAddresses(addresses: readonly string[]): boolean {
    return addresses.length > 0 && addresses.every(address => isIP(address) !== 0
      && !isBlockedAgentBrowserAddress(address))
  }

  private async ensureListening(): Promise<number> {
    const current = this.server?.address()
    if (typeof current === 'object' && current !== null) return current.port
    const server = createServer((_request, response) => {
      response.writeHead(405, { Connection: 'close', 'Content-Length': '0' })
      response.end()
    })
    server.on('connect', (request, client, head) => {
      void this.handleConnect(request.url, request.headers.host, client, head)
    })
    server.on('clientError', (_error, socket) => { endProxyRequest(socket, '400 Bad Request') })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { server.removeListener('listening', ready); reject(error) }
      const ready = () => { server.removeListener('error', failed); resolve() }
      server.once('error', failed)
      server.once('listening', ready)
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true })
    })
    const address = server.address()
    if (typeof address !== 'object' || address === null) {
      throw new AgentBrowserError('INTERNAL', 'browser proxy did not bind a loopback port')
    }
    return address.port
  }

  private async handleConnect(
    authority: string | undefined,
    hostHeader: string | string[] | undefined,
    client: Duplex,
    head: Buffer,
  ): Promise<void> {
    const target = parseConnectAuthority(authority, hostHeader)
    const resolver = this.resolver
    if (target === undefined || resolver === undefined || !this.generationActive()) {
      endProxyRequest(client, '403 Forbidden')
      return
    }
    try {
      const binding = await resolver(target.href, undefined)
      if (!this.generationActive()
        || binding.url !== target.href || binding.hostname !== target.hostname
        || !this.validAddresses(binding.addresses)) {
        endProxyRequest(client, '403 Forbidden')
        return
      }
      const address = binding.addresses[0]
      const upstream = this.connect({ host: address, port: 443 })
      this.trackSocket(client)
      this.trackSocket(upstream)
      let established = false
      upstream.once('connect', () => {
        if (!this.generationActive()) {
          upstream.destroy()
          client.destroy()
          return
        }
        established = true
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      upstream.once('error', () => {
        if (!established) endProxyRequest(client, '502 Bad Gateway')
        else client.destroy()
      })
      client.once('error', () => { upstream.destroy() })
      client.once('close', () => { upstream.destroy() })
    } catch {
      endProxyRequest(client, '403 Forbidden')
    }
  }

  private trackSocket(socket: Duplex): void {
    this.sockets.add(socket)
    socket.once('close', () => { this.sockets.delete(socket) })
  }
}
