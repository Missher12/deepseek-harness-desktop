import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectLinuxFile } from '../src/update/linux-update-protocol.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareLinuxInstall, probeLinuxInstallCapabilities } from '../src/update/linux-install-backend.ts'
import type { LinuxInstallRequest } from '../src/update/linux-install-backend.ts'

describe('Linux installation platform selection', () => {
  it.skipIf(process.platform === 'linux')('reports unsupported on a non-Linux host without invoking a package service', async () => {
    const request: LinuxInstallRequest = {
      download: { platform: 'linux', arch: 'x64', packageFormat: 'deb', desktopVersion: '0.6.0', assetName: 'DeepSeek-Harness-0.6.0-linux-x64.deb', filePath: '/unused/update.deb', stagingDirectory: '/unused', bytes: 128, sha256: 'a'.repeat(64) },
      installationPath: '/unused/Desktop.AppImage', parent: { pid: 23, startTime: '123' },
      helperRuntime: { node: { path: '/unused/node', bytes: 128, sha256: 'b'.repeat(64) }, helper: { path: '/unused/helper.mjs', bytes: 128, sha256: 'c'.repeat(64) } },
      deadlines: { readyMs: 1000, commandMs: 1000, parentExitMs: 1000, resultMs: 1000, pollMs: 5 }, restartEnvironment: {},
    }
    let probed = false
    const result = await probeLinuxInstallCapabilities(request, {
      async available() { probed = true; return true }, async createTransaction() { throw new Error('must not install') }, async verifyInstalled() { return false },
    })
    expect(result).toEqual({ supported: false, format: 'deb', reason: 'native-linux-required' })
    expect(probed).toBe(false)
  })
})

// These tests force only backend routing; PackageKit and package verification remain explicit fixtures.
const packageVerification = vi.hoisted(() => vi.fn(async () => ({ path: '/fixture/update.deb', directory: '/fixture' })))
vi.mock('../src/update/linux-installer.ts', () => ({ verifyLinuxUpdatePackage: packageVerification }))
const ownedChildren = vi.hoisted(() => [] as Array<{ child: import('node:child_process').ChildProcess; done: Promise<void> }>)
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, spawn: (...args: Parameters<typeof original.spawn>) => {
    // This is a process-ownership fixture. Native Linux acceptance must launch the staged runtime unchanged.
    if (args[0].endsWith('/node')) args[0] = process.execPath
    const child = original.spawn(...args)
    ownedChildren.push({ child, done: new Promise<void>(resolve => child.once('close', () => { resolve() })) })
    return child
  } }
})
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform); vi.clearAllMocks()
  for (const owned of ownedChildren.splice(0)) {
    if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill('SIGKILL')
    await owned.done
  }
})

function debRequest(): LinuxInstallRequest {
  return {
    download: { platform: 'linux', arch: 'x64', packageFormat: 'deb', desktopVersion: '0.6.0', assetName: 'DeepSeek-Harness-0.6.0-linux-x64.deb', filePath: '/fixture/update.deb', stagingDirectory: '/fixture', bytes: 128, sha256: 'a'.repeat(64) },
    installationPath: '/unused', parent: { pid: 23, startTime: '123' },
    helperRuntime: { node: { path: '/unused', bytes: 1, sha256: 'b'.repeat(64) }, helper: { path: '/unused', bytes: 1, sha256: 'c'.repeat(64) } },
    deadlines: { readyMs: 100, commandMs: 100, parentExitMs: 100, resultMs: 100, pollMs: 5 }, restartEnvironment: {},
  }
}

describe('prepared deb ownership', () => {
  it('settles cancellation even when closing a prepared system transaction fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const handle = await prepareLinuxInstall(debRequest(), {
      async available() { return true }, async verifyInstalled() { return false },
      async createTransaction() { return { subscribe() { return () => {} }, async installFile() { throw new Error('must not install') }, async cancel() {}, async close() { throw new Error('close failed') } } },
    })
    await expect(handle.cancel()).resolves.toBe('failed')
    await expect(handle.completion).resolves.toMatchObject({ status: 'recovery-required' })
  })

  it('reverifies the selected download at commit and settles a changed file without installation', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const install = vi.fn(), close = vi.fn(async () => {})
    const handle = await prepareLinuxInstall(debRequest(), {
      async available() { return true }, async verifyInstalled() { return false },
      async createTransaction() { return { subscribe() { return () => {} }, installFile: install, async cancel() {}, close } },
    })
    packageVerification.mockRejectedValueOnce(new Error('download changed'))
    await expect(handle.commit()).rejects.toThrow('download changed')
    await expect(handle.completion).resolves.toMatchObject({ status: 'failed' })
    expect(install).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce()
  })
})

vi.mock('../src/update/linux-appimage-replace.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/update/linux-appimage-replace.ts')>(),
  // The macOS process smoke exercises ownership, not the Linux syscall.
  probeLinuxNoReplace: async () => {},
}))

it.skipIf(process.platform === 'win32')('joins an owned helper that never sends ready before releasing its preparation lock', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-helper-owner-')))
  try {
    const bytes = Buffer.alloc(128, 1), target = join(root, 'Desktop.AppImage'), downloaded = join(root, 'next.AppImage')
    await writeFile(target, bytes, { mode: 0o700 }); await writeFile(downloaded, bytes, { mode: 0o600 })
    const helper = join(root, 'source-helper.mjs')
    await writeFile(helper, "import { writeFileSync } from 'node:fs'; writeFileSync('owned-pid', String(process.pid)); setInterval(() => {}, 1000)\n", { mode: 0o600 })
    const nodePath = await realpath(process.execPath)
    const nodeIdentity = await inspectLinuxFile(nodePath, 2_000_000_000, true)
    const helperIdentity = await inspectLinuxFile(helper)
    const request = debRequest()
    request.download = { ...request.download, packageFormat: 'appimage', filePath: downloaded, stagingDirectory: root, sha256: createHash('sha256').update(bytes).digest('hex') }
    request.installationPath = target
    request.helperRuntime = { node: { path: nodePath, ...nodeIdentity }, helper: { path: helper, ...helperIdentity } }
    request.deadlines = { readyMs: 1000, commandMs: 1000, parentExitMs: 1000, resultMs: 500, pollMs: 10 }
    packageVerification.mockResolvedValue({ path: downloaded, directory: root })
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await expect(prepareLinuxInstall(request)).rejects.toThrow('ready deadline')
    const directory = (await readdir(root)).find(name => name.startsWith('.dsh-update-'))!
    expect(directory).toBeDefined()
    const pid = ownedChildren.at(-1)!.child.pid!
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
    expect(await readFile(target)).toEqual(bytes)
    expect((await readdir(root)).some(name => name.endsWith('.lock'))).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15_000)
