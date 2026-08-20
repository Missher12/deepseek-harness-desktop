import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { MAX_TERMINAL_INPUT_BYTES } from '../src/protocol.ts'
import { WorkbenchTerminalRegistry } from '../src/terminal.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('WorkbenchTerminalRegistry', () => {
  it('owns terminals, bounds input, output and teardown', async () => {
    const output = new PassThrough()
    const done = deferred<SubprocessOutcome>()
    const terminate = vi.fn(async () => {})
    const write = vi.fn(async () => {})
    const handle: SubprocessTerminalHandle = {
      pid: 42, output, done: done.promise, write, terminate,
      inspectForeground: async () => undefined, signalForeground: async () => 42,
    }
    const registry = new WorkbenchTerminalRegistry(async () => handle, async () => '/bin/zsh')
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
    }, async () => '/bin/zsh')
    for (let index = 0; index < 4; index += 1) await registry.open('owner', '/workspace')
    await expect(registry.open('owner', '/workspace')).rejects.toThrow(/at most 4/)
    await registry.closeAll()
  })
})
