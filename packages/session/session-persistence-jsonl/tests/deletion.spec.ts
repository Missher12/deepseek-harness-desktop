import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '../src/index.ts'
import { generationLogPath, logPath } from '../src/format.ts'
import { meta } from '../../session-persistence/tests/contract.ts'

// Exercise the Windows branch on POSIX with only the foreign kernel boundary
// replaced. Native Windows runs retain the real semaphore implementation.
const windowsLock = vi.hoisted(() => ({ simulated: false, acquired: 0, released: 0 }))
vi.mock('../src/win32.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/win32.ts')>()
  return {
    ...actual,
    acquireLockHandleWin32: async (...args: Parameters<typeof actual.acquireLockHandleWin32>) => {
      if (!windowsLock.simulated) return actual.acquireLockHandleWin32(...args)
      windowsLock.acquired += 1
      return 123
    },
    releaseLockHandleWin32: (...args: Parameters<typeof actual.releaseLockHandleWin32>) => {
      if (!windowsLock.simulated) return actual.releaseLockHandleWin32(...args)
      windowsLock.released += 1
    },
  }
})

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  windowsLock.simulated = false
  windowsLock.acquired = 0
  windowsLock.released = 0
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delete-session-'))
  roots.push(root)
  const mount = async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    return ctx.sessionPersistence
  }
  return { root, first: await mount(), second: await mount() }
}

describe('permanent session deletion', () => {
  it('leaves a selected directory intact when its header no longer identifies a Session', async () => {
    const { root, first } = await setup()
    const header = meta('empty-header', '/workspace')
    const writer = await first.create(header)
    await writer.flush()
    await writer.close()
    const path = logPath(root, header.cwd, header.id, 'none')
    await writeFile(path, '')
    await expect(first.delete(header.id)).resolves.toBe(false)
    expect(await readFile(path, 'utf8')).toBe('')
  })

  it('deletes a released directory without attempting POSIX directory sync on Windows', async () => {
    const { first } = await setup()
    const header = meta('windows-delete', '/workspace')
    const writer = await first.create(header)
    await writer.flush()
    await writer.close()
    windowsLock.simulated = process.platform !== 'win32'
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    await expect(first.delete(header.id)).resolves.toBe(true)
    await expect(first.stat(header.id)).resolves.toBeUndefined()
    if (windowsLock.simulated) {
      expect(windowsLock.acquired).toBe(1)
      expect(windowsLock.released).toBe(1)
    }
  })

  it('refuses local and foreign writers, then removes only the released session', async () => {
    const { root, first, second } = await setup()
    const header = meta('archived', '/workspace')
    const writer = await first.create(header)
    await writer.flush()
    const path = logPath(root, header.cwd, header.id, 'none')
    const before = await readFile(path)
    await expect(first.delete(header.id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    await expect(second.delete(header.id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    expect(await readFile(path)).toEqual(before)
    const neighbor = await first.create(meta('neighbor', '/workspace'))
    await neighbor.flush()
    await neighbor.close()
    await writer.close()
    await expect(second.delete(header.id)).resolves.toBe(true)
    await expect(first.stat(header.id)).resolves.toBeUndefined()
    await expect(first.stat(SessionId('neighbor'))).resolves.toBeDefined()
    await expect(first.delete(header.id)).resolves.toBe(false)
  })

  it('removes predecessors with the current generation so deleted history cannot reappear', async () => {
    const { root, first } = await setup()
    const header = meta('generations', '/workspace')
    const writer = await first.create(header)
    await writer.flush()
    await writer.close()
    const oldPath = generationLogPath(root, header.cwd, header.id, 0, 'none')
    await writeFile(oldPath, JSON.stringify({ type: 'session', ...header, version: 0, delegationDepth: 0 }) + '\n')
    await expect(first.delete(header.id)).resolves.toBe(true)
    await expect(readFile(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(first.list()).resolves.toEqual([])
  })
})
