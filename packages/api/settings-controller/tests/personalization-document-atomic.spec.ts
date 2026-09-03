import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const injected = vi.hoisted(() => ({
  chmodError: false,
  failBackupUnlink: false,
  malformedOnSecondRead: false,
  readCalls: 0,
  renameCalls: 0,
  renameFailures: {} as Record<number, string>,
  target: '',
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    chmod: async (...args: Parameters<typeof actual.chmod>) => {
      if (injected.chmodError) throw Object.assign(new Error('injected chmod failure'), { code: 'EPERM' })
      return actual.chmod(...args)
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (typeof args[0] === 'string' && args[0] === injected.target && injected.malformedOnSecondRead) {
        injected.readCalls += 1
        if (injected.readCalls === 2) return Buffer.from('<!-- dsh-desktop:personalization:start -->')
      }
      return actual.readFile(...args)
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      injected.renameCalls += 1
      const code = injected.renameFailures[injected.renameCalls]
      if (code !== undefined) throw Object.assign(new Error(`injected rename ${code}`), { code })
      return actual.rename(...args)
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (injected.failBackupUnlink && String(args[0]).endsWith('.bak')) {
        injected.failBackupUnlink = false
        throw Object.assign(new Error('injected unlink failure'), { code: 'EPERM' })
      }
      return actual.unlink(...args)
    },
  }
})

import {
  readPersonalizationDocument, writePersonalizationDocument,
} from '../src/personalization-document.ts'

const roots: string[] = []

async function target(initial?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personalization-atomic-'))
  roots.push(root)
  const path = join(root, 'AGENTS.md')
  if (initial !== undefined) await writeFile(path, initial)
  injected.target = path
  return path
}

afterEach(async () => {
  injected.chmodError = false
  injected.failBackupUnlink = false
  injected.malformedOnSecondRead = false
  injected.readCalls = 0
  injected.renameCalls = 0
  injected.renameFailures = {}
  injected.target = ''
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function replaceWithInjectedRename(code: 'EEXIST' | 'EPERM'): Promise<void> {
  const path = await target('# Manual')
  const before = await readPersonalizationDocument(path)
  injected.renameCalls = 0
  injected.renameFailures = { 1: code }
  injected.failBackupUnlink = true

  await expect(writePersonalizationDocument(path, {
    instructions: 'Keep the fallback safe.', style: 'professional', expectedRevision: before.revision,
  })).resolves.toMatchObject({ instructions: 'Keep the fallback safe.', style: 'professional' })
  expect(await readFile(path, 'utf8')).toContain('# Manual')
}

describe('settings-owned personalization atomic replacement fallbacks', () => {
  it.each(['EEXIST', 'EPERM'] as const)('replaces an existing document after %s', async (code) => {
    await replaceWithInjectedRename(code)
  })

  it('propagates a non-replacement rename failure and cleans temporary files', async () => {
    const path = await target()
    const before = await readPersonalizationDocument(path)
    injected.renameCalls = 0
    injected.renameFailures = { 1: 'ENOSPC' }

    await expect(writePersonalizationDocument(path, {
      instructions: 'x', style: 'default', expectedRevision: before.revision,
    })).rejects.toThrow('injected rename ENOSPC')
  })

  it('restores the previous document when publishing the replacement fails', async () => {
    const path = await target('# Original')
    const before = await readPersonalizationDocument(path)
    injected.renameCalls = 0
    injected.renameFailures = { 1: 'EEXIST', 3: 'EIO' }

    await expect(writePersonalizationDocument(path, {
      instructions: 'x', style: 'default', expectedRevision: before.revision,
    })).rejects.toThrow('injected rename EIO')
    expect(await readFile(path, 'utf8')).toBe('# Original')
  })

  it('retains the original publish failure even when restoring also fails', async () => {
    const path = await target('# Original')
    const before = await readPersonalizationDocument(path)
    injected.renameCalls = 0
    injected.renameFailures = { 1: 'EEXIST', 3: 'EIO', 4: 'EPERM' }

    await expect(writePersonalizationDocument(path, {
      instructions: 'x', style: 'default', expectedRevision: before.revision,
    })).rejects.toThrow('injected rename EIO')
  })

  it('propagates chmod failures on POSIX and tolerates them on Windows', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const posixPath = await target()
    const posixBefore = await readPersonalizationDocument(posixPath)
    injected.chmodError = true
    await expect(writePersonalizationDocument(posixPath, {
      instructions: 'x', style: 'default', expectedRevision: posixBefore.revision,
    })).rejects.toThrow('injected chmod failure')

    injected.chmodError = false
    const windowsPath = await target()
    const windowsBefore = await readPersonalizationDocument(windowsPath)
    injected.chmodError = true
    platform.mockReturnValue('win32')
    await expect(writePersonalizationDocument(windowsPath, {
      instructions: 'x', style: 'default', expectedRevision: windowsBefore.revision,
    })).resolves.toMatchObject({ instructions: 'x' })
  })

  it('fails closed if the managed document becomes malformed between reads', async () => {
    const path = await target('# Manual')
    const before = await readPersonalizationDocument(path)
    injected.readCalls = 0
    injected.malformedOnSecondRead = true

    await expect(writePersonalizationDocument(path, {
      instructions: 'x', style: 'default', expectedRevision: before.revision,
    })).rejects.toMatchObject({ code: 'read-only' })
  })
})
