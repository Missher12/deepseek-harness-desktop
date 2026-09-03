import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { MAX_TERMINAL_INPUT_BYTES } from '../src/protocol.ts'
import { defaultShell, WorkbenchTerminalRegistry } from '../src/terminal.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('WorkbenchTerminalRegistry', () => {
  it('selects the native platform shell command', async () => {
    await expect(defaultShell('win32')).resolves.toEqual(['powershell.exe', '-NoLogo', '-NoProfile'])
    const accessed: string[] = []
    await expect(defaultShell('darwin', async (path) => {
      accessed.push(path)
      if (path === '/bin/zsh') throw new Error('missing zsh')
    })).resolves.toEqual(['/bin/bash', '-l'])
    expect(accessed).toEqual(['/bin/zsh', '/bin/bash'])
  })

  it('passes the complete resolved shell command to the terminal owner', async () => {
    const handle: SubprocessTerminalHandle = {
      pid: 42, output: new PassThrough(), done: new Promise(() => {}), write: async () => {}, terminate: async () => {},
      inspectForeground: async () => undefined, signalForeground: async () => 42,
    }
    const spawn = vi.fn(async () => handle)
    const registry = new WorkbenchTerminalRegistry(
      spawn,
      async () => ['powershell.exe', '-NoLogo', '-NoProfile'] as const,
    )

    await registry.open('owner-a', 'C:\\workspace')

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      argv: ['powershell.exe', '-NoLogo', '-NoProfile'],
      cwd: 'C:\\workspace',
    }))
    await registry.closeAll()
  })

  it('owns terminals, bounds input, output and teardown', async () => {
    const output = new PassThrough()
    const done = deferred<SubprocessOutcome>()
    const terminate = vi.fn(async () => {})
    const write = vi.fn(async () => {})
    const handle: SubprocessTerminalHandle = {
      pid: 42, output, done: done.promise, write, terminate,
      inspectForeground: async () => undefined, signalForeground: async () => 42,
    }
    const registry = new WorkbenchTerminalRegistry(async () => handle, async () => ['/bin/zsh', '-l'])
    const opened = await registry.open('owner-a', '/workspace')
    expect(opened.cwd).toBe('/workspace')
    await expect(registry.write('owner-b', opened.id, 'pwd\n')).rejects.toThrow(/foreign terminal/)
    await expect(registry.write('owner-a', opened.id, 'x'.repeat(MAX_TERMINAL_INPUT_BYTES + 1))).rejects.toThrow(/too large/)
    await registry.write('owner-a', opened.id, 'pwd\n')
    expect(write).toHaveBeenCalledWith('pwd\n')
    await registry.closeOwner('owner-a')
    expect(terminate).toHaveBeenCalledOnce()
    done.resolve({ exitCode: 0, signal: null })
  })

  it('caps one owner at four terminals', async () => {
    const handles: SubprocessTerminalHandle[] = []
    const registry = new WorkbenchTerminalRegistry(async () => {
      const handle: SubprocessTerminalHandle = {
        pid: handles.length + 1, output: new PassThrough(), done: new Promise(() => {}), write: async () => {},
        terminate: async () => {}, inspectForeground: async () => undefined, signalForeground: async () => 1,
      }
      handles.push(handle)
      return handle
    }, async () => ['/bin/zsh', '-l'])
    for (let index = 0; index < 4; index += 1) await registry.open('owner', '/workspace')
    // A rapid close/reopen mount races the fire-and-forget cleanup closes;
    // the fifth open supersedes the oldest record instead of failing.
    const fifth = await registry.open('owner', '/workspace')
    expect(fifth.cwd).toBe('/workspace')
    expect((await registry.list('owner')).map(item => item.id)).toHaveLength(4)
    await registry.closeAll()
  })

  it('treats write and signal on a closed terminal as idempotent teardown', async () => {
    const registry = new WorkbenchTerminalRegistry(async () => ({
      pid: 42, output: new PassThrough(), done: new Promise(() => {}), write: async () => {},
      terminate: async () => {}, inspectForeground: async () => undefined, signalForeground: async () => 1,
    }), async () => ['/bin/zsh', '-l'])
    const opened = await registry.open('owner-a', '/workspace')
    await registry.close('owner-a', opened.id)
    await expect(registry.write('owner-a', opened.id, 'pwd\n')).resolves.toBeUndefined()
    await expect(registry.signal('owner-a', opened.id, 'SIGINT')).resolves.toBeUndefined()
    await expect(registry.write('owner-b', opened.id, 'pwd\n')).resolves.toBeUndefined()
    await registry.closeAll()
  })

  it('treats a repeated close as an idempotent UI teardown', async () => {
    const terminate = vi.fn(async () => {})
    const handle: SubprocessTerminalHandle = {
      pid: 42, output: new PassThrough(), done: new Promise(() => {}), write: async () => {}, terminate,
      inspectForeground: async () => undefined, signalForeground: async () => 42,
    }
    const registry = new WorkbenchTerminalRegistry(async () => handle, async () => ['/bin/zsh', '-l'])
    const opened = await registry.open('owner-a', '/workspace')
    await expect(registry.close('owner-b', opened.id)).rejects.toThrow(/foreign terminal/)
    await registry.close('owner-a', opened.id)
    await expect(registry.close('owner-a', opened.id)).resolves.toBeUndefined()
    expect(terminate).toHaveBeenCalledOnce()
  })
})
