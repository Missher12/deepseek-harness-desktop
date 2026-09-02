import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { HarnessProcess, type HarnessProcessOptions } from '../src/harness/process.ts'
import type { DesktopStartupMilestone } from '../src/startup-timeline.ts'

class FakeChild extends EventEmitter {
  readonly pid = 4321
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null

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
    expect(options.env?.DSH_DESKTOP_STARTUP_TIMING).toBe('1')
  })

  it('decodes only fixed child startup phases across stdout chunks', async () => {
    const child = new FakeChild()
    const onStartupTiming = vi.fn()
    const owned = new HarnessProcess({
      spawn: () => child as unknown as ChildProcess,
      executable: '/Electron',
      cli: '/cli.js',
      waitForHarness: async () => undefined,
      terminateTree: vi.fn(),
      onStartupTiming,
    })

    const pending = owned.start('/workspace')
    child.stdout.write('dsh desktop-startup profile-compose: 12ms\ndsh desktop-startup loader-')
    child.stdout.write('mount: 28ms\ndsh web: http://127.0.0.1:45678\n')
    await pending

    expect(onStartupTiming.mock.calls).toEqual([
      ['profile-compose', 12],
      ['loader-mount', 28],
    ])
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
