import * as filesystem from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chmod, link, unlink, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelAppImageReplacement, commitAppImageReplacement, prepareAppImageReplacement, recoverAppImageReplacement } from '../src/update/linux-appimage-replace.ts'
import { linuxInstallationLock, writeLinuxUpdateRecord } from '../src/update/linux-update-protocol.ts'

// Offline no-clobber fixture; native renameat2 is verified only by the Linux-native spec.
async function move(source: string, target: string): Promise<void> { await link(source, target); await unlink(source) }

vi.mock('node:fs/promises', { spy: true })
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh update with spaces ')))
  roots.push(root)
  const image = (marker: number) => {
    // Format fixtures only; these are not runnable AppImages.
    const bytes = Buffer.alloc(128, marker)
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(bytes)
    bytes.writeUInt16LE(62, 18)
    return bytes
  }
  const old = image(1), next = image(2)
  const target = join(root, 'Desktop.AppImage'), download = join(root, 'DeepSeek-Harness-0.6.0-linux-x64.AppImage')
  await writeFile(target, old, { mode: 0o700 })
  await writeFile(download, next, { mode: 0o600 })
  return { root, target, download, old, next, descriptor: {
    platform: 'linux' as const, arch: 'x64' as const, packageFormat: 'appimage' as const,
    desktopVersion: '0.6.0', assetName: 'DeepSeek-Harness-0.6.0-linux-x64.AppImage',
    filePath: download, stagingDirectory: root, bytes: next.length,
    sha256: createHash('sha256').update(next).digest('hex'),
  } }
}

describe.skipIf(process.platform === 'win32')('protected AppImage replacement', () => {
  it('retains old bytes, commits only the prepared candidate, and allows an explicitly safe rollback', async () => {
    const f = await fixture()
    const plan = await prepareAppImageReplacement(f.descriptor, f.target)
    expect(await readFile(f.target)).toEqual(f.old)
    expect(await readFile(plan.backupPath)).toEqual(f.old)
    await commitAppImageReplacement(plan, move)
    expect(await readFile(f.target)).toEqual(f.next)
    await expect(recoverAppImageReplacement(plan, false, move)).rejects.toThrow('data')
    await recoverAppImageReplacement(plan, true, move)
    expect(await readFile(f.target)).toEqual(f.old)
    expect(await readFile(f.download)).toEqual(f.next)
  })

  it('cancels before replacement and releases only its own installation lock', async () => {
    const f = await fixture()
    const plan = await prepareAppImageReplacement(f.descriptor, f.target)
    await expect(prepareAppImageReplacement(f.descriptor, f.target)).rejects.toThrow('update')
    await cancelAppImageReplacement(plan)
    expect(await readFile(f.target)).toEqual(f.old)
    const second = await prepareAppImageReplacement(f.descriptor, f.target)
    await cancelAppImageReplacement(second)
    await expect(commitAppImageReplacement(plan, move)).rejects.toThrow()
  })

  it('rejects linked or externally replaced targets without replacing user bytes', async () => {
    const f = await fixture()
    const alias = join(f.root, 'Alias.AppImage')
    await symlink(f.target, alias)
    await expect(prepareAppImageReplacement(f.descriptor, alias)).rejects.toThrow()
    const plan = await prepareAppImageReplacement(f.descriptor, f.target)
    await writeFile(f.target, 'external replacement')
    await expect(commitAppImageReplacement(plan, move)).rejects.toThrow('changed')
    expect(await readFile(f.target, 'utf8')).toBe('external replacement')
  })

  it('rejects candidate tampering and refuses rollback over a later installation', async () => {
    const f = await fixture()
    const plan = await prepareAppImageReplacement(f.descriptor, f.target)
    await writeFile(plan.candidatePath, 'tampered')
    await expect(commitAppImageReplacement(plan, move)).rejects.toThrow()
    expect(await readFile(f.target)).toEqual(f.old)
    await cancelAppImageReplacement(plan)
    const next = await prepareAppImageReplacement(f.descriptor, f.target)
    await commitAppImageReplacement(next, move)
    await writeFile(f.target, 'third-party bytes')
    await expect(recoverAppImageReplacement(next, true, move)).rejects.toThrow('changed')
    expect(await readFile(f.target, 'utf8')).toBe('third-party bytes')
  })

  it('rejects an unsafe installation directory before creating a transaction', async () => {
    const f = await fixture()
    await chmod(f.root, 0o777)
    await expect(prepareAppImageReplacement(f.descriptor, f.target)).rejects.toThrow('directory')
    expect(await readFile(f.target)).toEqual(f.old)
  })

  it('recovers a crash after commit intent but before rename without requiring a data downgrade', async () => {
    const f = await fixture()
    const plan = await prepareAppImageReplacement(f.descriptor, f.target)
    await writeLinuxUpdateRecord(join(plan.transactionDirectory, 'state.json'), { id: plan.id, nonce: plan.nonce, phase: 'committing', installed: null })
    await recoverAppImageReplacement(plan, false, move)
    expect(await readFile(f.target)).toEqual(f.old)
    const next = await prepareAppImageReplacement(f.descriptor, f.target)
    await cancelAppImageReplacement(next)
  })

  it('preserves the lock of another transaction instead of cleaning it up', async () => {
    const f = await fixture()
    const plan = await prepareAppImageReplacement(f.descriptor, f.target)
    const replacement = JSON.stringify({ id: 'external', nonce: 'external' }) + '\n'
    await writeFile(plan.lockPath, replacement)
    await expect(cancelAppImageReplacement(plan)).rejects.toThrow('lock changed')
    expect(await readFile(plan.lockPath, 'utf8')).toBe(replacement)
    expect(await readFile(f.target)).toEqual(f.old)
  })
})


describe.skipIf(process.platform === 'win32')('displacement races and recovery interruption', () => {
  it('retains a different inode that appears immediately before displacement', async () => {
    const f = await fixture(), plan = await prepareAppImageReplacement(f.descriptor, f.target)
    let first = true
    await expect(commitAppImageReplacement(plan, async (source, target) => {
      if (first) { first = false; await unlink(f.target); await writeFile(f.target, 'external inode', { mode: 0o700 }) }
      await move(source, target)
    })).rejects.toThrow('changed at displacement')
    expect(await readFile(f.target, 'utf8')).toBe('external inode')
    expect(await readFile(plan.backupPath)).toEqual(f.old)
  })

  it('never overwrites a target recreated between the two commit moves', async () => {
    const f = await fixture(), plan = await prepareAppImageReplacement(f.descriptor, f.target)
    await expect(commitAppImageReplacement(plan, async (source, target) => {
      if (source === plan.candidatePath) await writeFile(f.target, 'external replacement', { mode: 0o700 })
      await move(source, target)
    })).rejects.toThrow()
    expect(await readFile(f.target, 'utf8')).toBe('external replacement')
    expect(await readFile(join(plan.transactionDirectory, 'displaced.AppImage'))).toEqual(f.old)
    expect(await readFile(plan.candidatePath)).toEqual(f.next)
  })

  it('restores an empty installation slot after interrupted displacement without permitting data rollback', async () => {
    const f = await fixture(), plan = await prepareAppImageReplacement(f.descriptor, f.target)
    await expect(commitAppImageReplacement(plan, async (source, target) => {
      await move(source, target); throw new Error('interrupted after displacement')
    })).rejects.toThrow('interrupted')
    await recoverAppImageReplacement(plan, false, move)
    expect(await readFile(f.target)).toEqual(f.old)
  })

  it('resumes after restoration moved the original but its terminal journal was not saved', async () => {
    const f = await fixture(), plan = await prepareAppImageReplacement(f.descriptor, f.target)
    await commitAppImageReplacement(plan, move)
    await expect(recoverAppImageReplacement(plan, true, async (source, target) => {
      await move(source, target)
      if (source.endsWith('/displaced.AppImage')) throw new Error('interrupted after restore')
    })).rejects.toThrow('interrupted')
    await recoverAppImageReplacement(plan, true, move)
    expect(await readFile(f.target)).toEqual(f.old)
    const next = await prepareAppImageReplacement(f.descriptor, f.target)
    await cancelAppImageReplacement(next)
  })

  it('resumes cancellation after terminal journal persistence but before lock removal', async () => {
    const f = await fixture(), plan = await prepareAppImageReplacement(f.descriptor, f.target)
    await writeLinuxUpdateRecord(join(plan.transactionDirectory, 'state.json'), { id: plan.id, nonce: plan.nonce, phase: 'cancelled', installed: null })
    await recoverAppImageReplacement(plan, false, move)
    const next = await prepareAppImageReplacement(f.descriptor, f.target)
    await cancelAppImageReplacement(next)
  })
})


it.skipIf(process.platform === 'win32')('resumes an interrupted empty-slot restore intent without a data downgrade', async () => {
  const f = await fixture(), plan = await prepareAppImageReplacement(f.descriptor, f.target)
  await expect(commitAppImageReplacement(plan, async (source, target) => {
    await move(source, target); throw new Error('commit interrupted')
  })).rejects.toThrow('interrupted')
  await expect(recoverAppImageReplacement(plan, false, async () => { throw new Error('restore interrupted before move') })).rejects.toThrow('interrupted')
  await recoverAppImageReplacement(plan, false, move)
  expect(await readFile(f.target)).toEqual(f.old)
})


it.skipIf(process.platform === 'win32')('retains a replacement lock when preparation fails after another owner takes its path', async () => {
  const f = await fixture()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const lockPath = linuxInstallationLock(f.target)
  const external = JSON.stringify({ id: 'external', nonce: 'different' }) + '\n'
  vi.spyOn(filesystem, 'open').mockImplementation(async (...args) => {
    if (String(args[0]).endsWith('/previous.AppImage')) {
      await actual.rename(lockPath, join(f.root, 'retained-original-lock'))
      await actual.writeFile(lockPath, external, { mode: 0o600 })
      throw new Error('forced preparation copy failure')
    }
    return await actual.open(...args)
  })
  await expect(prepareAppImageReplacement(f.descriptor, f.target)).rejects.toThrow('forced preparation')
  expect(await readFile(lockPath, 'utf8')).toBe(external)
  expect(await readFile(f.target)).toEqual(f.old)
})
