import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { RequestId, SessionId, encodeJsonFrame } from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  HarnessProcess,
  type HarnessControlChannel,
  type HarnessControlLifecycle,
  type HarnessProcessOptions,
} from '../src/harness/process.ts'
import type { DesktopStartupMilestone } from '../src/startup-timeline.ts'

class FakeChild extends EventEmitter {
  readonly pid = 4321
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  connected = true
  readonly sent: Uint8Array[] = []

  send(message: Uint8Array, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message)
    queueMicrotask(() => { callback?.(null) })
    return false
  }

  disconnect(): void {
    this.connected = false
    this.emit('disconnect')
  }

  exit(code = 0): void {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

describe('HarnessProcess', () => {
  it('prepares the Desktop-owned module fallback before spawning the CLI', async () => {
    const order: string[] = []
    const markStartup = vi.fn<(milestone: DesktopStartupMilestone) => void>()
    const child = new FakeChild()
    const prepare = vi.fn(() => { order.push('prepare') })
    const spawn = vi.fn<NonNullable<HarnessProcessOptions['spawn']>>(() => {
      order.push('spawn')
      return child as unknown as ChildProcess
    })
    const owned = new HarnessProcess({
      cli: '/app/node_modules/@deepseek-ai/dsh/lib/bin.js',
      prepare,
      markStartup,
      spawn,
      waitForHarness: async () => undefined,
      terminateTree: vi.fn(),
    })

    const pending = owned.start('/workspace')
    await vi.waitFor(() => { expect(spawn).toHaveBeenCalledOnce() })
    child.stdout.write('dsh web: http://127.0.0.1:45678\n')

    await expect(pending).resolves.toBe('http://127.0.0.1:45678/')
    expect(order).toEqual(['prepare', 'spawn'])
    expect(markStartup.mock.calls.map(([milestone]) => milestone)).toEqual([
      'fallback-ready',
      'url-reported',
      'harness-ready',
    ])
  })

  it('starts the built CLI on loopback port zero and returns its ready URL', async () => {
    const child = new FakeChild()
    const spawn = vi.fn<NonNullable<HarnessProcessOptions['spawn']>>(
      () => child as unknown as ChildProcess,
    )
    const waitForHarness = vi.fn(async () => undefined)
    const owned = new HarnessProcess({
      spawn,
      executable: '/Electron',
      cli: '/app/node_modules/@deepseek-ai/dsh/lib/bin.js',
      patch: '/app/desktop.cordis.patch.yml',
      waitForHarness,
      platform: 'darwin',
      terminateTree: vi.fn(),
    })

    const pending = owned.start('/workspace')
    child.stdout.write('dsh web: http://127.0.0.1:45678\n')

    await expect(pending).resolves.toBe('http://127.0.0.1:45678/')
    expect(waitForHarness).toHaveBeenCalledWith('http://127.0.0.1:45678/')
    expect(spawn).toHaveBeenCalledOnce()
    const [executable, args, options] = spawn.mock.calls[0]!
    expect(executable).toBe('/Electron')
    expect(args).toEqual([
      '--expose-internals',
      '/app/node_modules/@deepseek-ai/dsh/lib/bin.js',
      'web',
      '--patch',
      '/app/desktop.cordis.patch.yml',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
    ])
    expect(options.cwd).toBe('/workspace')
    expect(options.detached).toBe(true)
    expect(options.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe', 'ipc'])
    expect(options.serialization).toBe('advanced')
    expect(options.env).not.toHaveProperty('NODE_CHANNEL_FD')
    expect(options.env).not.toHaveProperty('NODE_CHANNEL_SERIALIZATION_MODE')
  })

  it('exposes only a copied-frame IPC channel for the exact owned child', async () => {
    const child = new FakeChild()
    const attached: HarnessControlChannel[] = []
    const detached: HarnessControlChannel[] = []
    const lifecycle: HarnessControlLifecycle = {
      attach: (channel) => { attached.push(channel) },
      beforeStop: async () => undefined,
      detach: (channel) => { detached.push(channel) },
    }
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: '/Electron',
      cli: '/cli.js',
      waitForHarness: async () => undefined,
      terminateTree: () => { queueMicrotask(() => { child.exit() }) },
      controlLifecycle: lifecycle,
    })

    const pending = owned.start('/workspace')
    child.stdout.write('dsh web: http://127.0.0.1:45678\n')
    await pending
    expect(attached).toHaveLength(1)

    const channel = attached[0]!
    const source = Uint8Array.of(0x01, 0x02, 0x03)
    await new Promise<void>((resolve, reject) => {
      channel.send(source, (error) => { if (error === undefined) resolve(); else reject(error) })
      source[1] = 0xff
    })
    expect([...child.sent[0]!]).toEqual([0x01, 0x02, 0x03])

    const messages: Uint8Array[] = []
    const stopListening = channel.onMessage((frame) => { messages.push(frame) })
    const inbound = Uint8Array.of(0x01, 0x04)
    child.emit('message', inbound)
    inbound[1] = 0xee
    expect([...messages[0]!]).toEqual([0x01, 0x04])
    stopListening()

    await owned.stop()
    expect(detached).toEqual([channel])
  })

  it('round-trips one raw copied protocol frame through a real advanced-serialization child channel', async () => {
    const attached: HarnessControlChannel[] = []
    const lifecycle: HarnessControlLifecycle = {
      attach: (channel) => { attached.push(channel) },
      beforeStop: async () => undefined,
      detach: () => undefined,
    }
    const fixture = fileURLToPath(new URL('./fixtures/harness-ipc-child.mjs', import.meta.url))
    const owned = new HarnessProcess({
      executable: process.execPath,
      cli: fixture,
      platform: 'win32',
      waitForHarness: async () => undefined,
      terminateTree: (pid) => { process.kill(pid, 'SIGTERM') },
      controlLifecycle: lifecycle,
    })

    try {
      await expect(owned.start(process.cwd())).resolves.toBe('http://127.0.0.1:45678/')
      const channel = attached[0]!
      const response = new Promise<Uint8Array>((resolve) => {
        const detach = channel.onMessage((frame) => { detach(); resolve(frame) })
      })
      const source = encodeJsonFrame({
        protocolVersion: 1,
        messageKind: 'request',
        requestKind: 'desktop.status',
        requestId: RequestId('00000000-0000-4000-8000-000000000701'),
        sessionId: SessionId('spawned-ipc-session'),
        deadlineUnixMs: Date.now() + 30_000,
      })
      const expected = new Uint8Array(source)
      await new Promise<void>((resolve, reject) => {
        channel.send(source, (error) => { if (error === undefined) resolve(); else reject(error) })
        source.fill(0xff)
      })

      const echoed = await response
      expect(echoed[0]).toBe(0x01)
      expect([...echoed]).toEqual([...expected])
      channel.disconnect()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(owned.pid).toBeTypeOf('number')
    } finally {
      await owned.stop()
    }
  })

  it('awaits the control shutdown hook before terminating every owned child tree', async () => {
    const order: string[] = []
    const child = new FakeChild()
    const lifecycle: HarnessControlLifecycle = {
      attach: () => { order.push('attach') },
      beforeStop: async () => {
        order.push('before-stop:start')
        await Promise.resolve()
        order.push('before-stop:end')
      },
      detach: () => { order.push('detach') },
    }
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: '/Electron',
      cli: '/cli.js',
      waitForHarness: async () => undefined,
      terminateTree: () => {
        order.push('terminate')
        queueMicrotask(() => { child.exit() })
      },
      controlLifecycle: lifecycle,
    })
    const pending = owned.start('/workspace')
    child.stdout.write('dsh web: http://127.0.0.1:45678\n')
    await pending

    await owned.stop()

    expect(order).toEqual(['attach', 'before-stop:start', 'before-stop:end', 'detach', 'terminate'])
  })

  it('reclaims the owned child when control attach throws during startup', async () => {
    const order: string[] = []
    const child = new FakeChild()
    const lifecycle: HarnessControlLifecycle = {
      attach: () => {
        order.push('attach')
        throw new Error('control attach failed')
      },
      beforeStop: async () => { order.push('before-stop') },
      detach: () => { order.push('detach') },
    }
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: '/Electron',
      cli: '/cli.js',
      waitForHarness: async () => undefined,
      terminateTree: () => {
        order.push('terminate')
        queueMicrotask(() => { child.exit() })
      },
      controlLifecycle: lifecycle,
    })

    await expect(owned.start('/workspace')).rejects.toThrow('control attach failed')

    expect(order).toEqual(['attach', 'detach', 'terminate'])
    expect(owned.pid).toBeUndefined()
  })

  it('detaches, terminates, and awaits exit before propagating a beforeStop failure', async () => {
    const order: string[] = []
    const child = new FakeChild()
    const lifecycle: HarnessControlLifecycle = {
      attach: () => { order.push('attach') },
      beforeStop: async () => {
        order.push('before-stop')
        throw new Error('control shutdown failed')
      },
      detach: () => { order.push('detach') },
    }
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: '/Electron',
      cli: '/cli.js',
      waitForHarness: async () => undefined,
      terminateTree: () => {
        order.push('terminate')
        queueMicrotask(() => {
          order.push('exit')
          child.exit()
        })
      },
      controlLifecycle: lifecycle,
    })
    const pending = owned.start('/workspace')
    child.stdout.write('dsh web: http://127.0.0.1:45678\n')
    await pending

    await expect(owned.stop()).rejects.toThrow('control shutdown failed')

    expect(order).toEqual(['attach', 'before-stop', 'detach', 'terminate', 'exit'])
    expect(owned.pid).toBeUndefined()
  })

  it('accepts the Windows startup URL when the browser status shares its stdout chunk', async () => {
    const child = new FakeChild()
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe',
      cli: 'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
      waitForHarness: async () => undefined,
      platform: 'win32',
      terminateTree: vi.fn(),
    })

    const pending = owned.start('C:\\workspace')
    child.stdout.write([
      'dsh web: http://127.0.0.1:45678',
      'dsh web: opening the default browser; pass --no-open to disable',
      '',
    ].join('\r\n'))

    await expect(pending).resolves.toBe('http://127.0.0.1:45678/')
  })

  it('signals and awaits only its child process group during stop', async () => {
    const child = new FakeChild()
    const terminateTree = vi.fn(() => { queueMicrotask(() => { child.exit() }) })
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: '/Electron',
      cli: '/cli.js',
      waitForHarness: async () => undefined,
      platform: 'darwin',
      terminateTree,
    })
    const pending = owned.start('/workspace')
    child.stdout.write('dsh web: http://127.0.0.1:45678\n')
    await pending

    await owned.stop()

    expect(terminateTree).toHaveBeenCalledOnce()
    expect(terminateTree).toHaveBeenCalledWith(4321, 'graceful', 'darwin')
    expect(owned.pid).toBeUndefined()
  })

  it('spawns without a detached group and force-stops the owned tree on Windows', async () => {
    const child = new FakeChild()
    const spawn = vi.fn<NonNullable<HarnessProcessOptions['spawn']>>(
      () => child as unknown as ChildProcess,
    )
    const terminateTree = vi.fn(() => { queueMicrotask(() => { child.exit() }) })
    const owned = new HarnessProcess({
      spawn,
      executable: 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe',
      cli: 'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar.unpacked\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
      waitForHarness: async () => undefined,
      platform: 'win32',
      terminateTree,
    })
    const pending = owned.start('C:\\workspace')
    child.stdout.write('dsh web: http://127.0.0.1:45678\r\n')
    await pending

    expect(spawn.mock.calls[0]?.[2].detached).toBe(false)
    await owned.stop()
    expect(terminateTree).toHaveBeenCalledWith(4321, 'force', 'win32')
    expect(owned.pid).toBeUndefined()
  })

  it('rejects an early child exit and duplicate starts', async () => {
    const child = new FakeChild()
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: '/Electron',
      cli: '/cli.js',
      waitForHarness: async () => undefined,
      terminateTree: vi.fn(),
    })
    const pending = owned.start('/workspace')
    await expect(owned.start('/workspace')).rejects.toThrow(/already running/)
    child.exit(2)
    await expect(pending).rejects.toThrow(/exited before startup.*2/i)
  })

  it('reports an owned child exit to the application controller', async () => {
    const child = new FakeChild()
    const onExit = vi.fn()
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: '/Electron',
      cli: '/cli.js',
      waitForHarness: async () => undefined,
      terminateTree: vi.fn(),
      onExit,
    })
    const pending = owned.start('/workspace')
    child.stdout.write('dsh web: http://127.0.0.1:45678\n')
    await pending

    child.exit(9)
    await vi.waitFor(() => { expect(onExit).toHaveBeenCalledWith({ code: 9, signal: null }) })
  })
})
