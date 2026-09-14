import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { launchDesktopInstaller, type DesktopInstallerLaunchOptions } from '../src/update/installer.ts'
import { bytesSha256, publishPrivateRecord } from '../src/update/restart-receipt.ts'
import type { UpdateHelperConfig } from '../src/update/update-helper.ts'
const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'dsh-installer-test-')); roots.push(root)
  const download = join(root, 'download'); mkdirSync(download, { mode: 0o700 })
  const app = join(root, 'DeepSeek Harness.app'); mkdirSync(app)
  const home = join(root, 'home'); mkdirSync(home); const dshHome = join(home, '.dsh'); mkdirSync(dshHome)
  const userData = join(root, 'userData'); mkdirSync(userData)
  const source = join(root, 'helper-runtime'); mkdirSync(source)
  const node = Buffer.from('synthetic Node; never executed'); const license = Buffer.from('test license')
  writeFileSync(join(source, 'node'), node, { mode: 0o755 }); writeFileSync(join(source, 'LICENSE'), license)
  // Synthetic manifest field exercises admission only; spawn is substituted and proves no native execution.
  const manifest = { schema: 1, platform: 'darwin', arch: 'x64', nodeVersion: '24.17.0',
    releaseUrl: 'https://nodejs.org/download/release/v24.17.0', archiveName: 'node-v24.17.0-darwin-x64.tar.gz',
    archiveSha256: 'a'.repeat(64), shasumsSha256: 'b'.repeat(64), inputKind: 'files', execution: 'native-verified',
    files: [{ path: 'node', bytes: node.length, sha256: bytesSha256(node) }, { path: 'LICENSE', bytes: license.length, sha256: bytesSha256(license) }] }
  writeFileSync(join(source, 'source.json'), JSON.stringify(manifest))
  const helperSource = join(root, 'update-helper.js'); writeFileSync(helperSource, 'synthetic helper; never executed')
  const dmgPath = join(download, 'DeepSeek-Harness-0.6.0-mac-x64.dmg'); writeFileSync(dmgPath, 'fixture')
  const options: DesktopInstallerLaunchOptions = { helperSource, helperNodePath: join(source, 'node'), helperSourceManifest: join(source, 'source.json'),
    currentAppPath: app, dmgPath, verifiedDownloadDirectory: download, expectedDesktopVersion: '0.6.0', expectedHarnessVersion: '0.1.5-rc.2',
    expectedSha256: 'c'.repeat(64), restart: { home, dshHome, userData }, parentPid: 123 }
  const child = Object.assign(new EventEmitter(), { pid: 456, kill: vi.fn(() => true), unref: vi.fn() })
  const acknowledge = (args: readonly string[], change: Record<string, unknown> = {}) => {
    const config = JSON.parse(readFileSync(args[1]!, 'utf8')) as UpdateHelperConfig
    publishPrivateRecord(config.transactionDirectory, 'helper-ready.json', { schema: 1, attemptId: config.attemptId, nonce: config.nonce,
      pid: child.pid, nodeVersion: '24.17.0', nodeSha256: config.files.node, helperSha256: config.files.helper, requestSha256: bytesSha256(readFileSync(args[1]!)), ...change })
    return config
  }
  return { root, download, source, manifest, options, child, acknowledge }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('independent helper preparation and acknowledgement', () => {
  it.each(['injected-runner-verified', 'cross-target-unverified'])('rejects %s runtime provenance before spawning', async (execution) => {
    const f = fixture()
    const path = join(f.source, 'source.json')
    writeFileSync(path, JSON.stringify({ ...f.manifest, execution }))
    const spawnHelper = vi.fn()
    await expect(launchDesktopInstaller(f.options, { spawnHelper })).rejects.toThrow()
    expect(spawnHelper).not.toHaveBeenCalled()
  })
  it('copies immutable source bytes to a private random transaction before acknowledgement', async () => {
    const f = fixture(); const original = readdirSync(f.source).sort()
    const receipt = await launchDesktopInstaller(f.options, { spawnHelper: (executable, args, env) => {
      const config = f.acknowledge(args)
      expect(executable).toBe(join(config.transactionDirectory, 'node'))
      expect(args[0]).toBe(join(config.transactionDirectory, 'update-helper.mjs'))
      expect((lstatSync(config.transactionDirectory).mode & 0o777)).toBe(0o700)
      expect(env).toEqual({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: f.options.restart.home, DSH_HOME: f.options.restart.dshHome })
      expect(readdirSync(f.source).sort()).toEqual(original)
      // Delete only this test's synthetic original resources: the transaction remains independently usable.
      rmSync(f.source, { recursive: true }); rmSync(f.options.helperSource)
      return f.child as unknown as ChildProcess
    } })
    expect(receipt.pid).toBe(456); expect(dirname(receipt.transactionDirectory)).toBe(f.download)
    expect(existsSync(join(receipt.transactionDirectory, 'handoff-approved.json'))).toBe(true)
    expect(readFileSync(join(receipt.transactionDirectory, 'node'), 'utf8')).toBe('synthetic Node; never executed')
    expect(f.child.unref).toHaveBeenCalledOnce(); expect(f.child.kill).not.toHaveBeenCalled()
  })
  it.each([{ nonce: '0'.repeat(64) }, { nodeVersion: '24.18.1' }, { nodeSha256: '0'.repeat(64) }, { pid: 999 }, { requestSha256: '0'.repeat(64) }, { extra: true }])('rejects wrong handshake %j before main may quit', async (change) => {
    const f = fixture(); let transaction = ''
    await expect(launchDesktopInstaller(f.options, { spawnHelper: (_exe, args) => {
      transaction = f.acknowledge(args, change).transactionDirectory; return f.child as unknown as ChildProcess
    } })).rejects.toThrow(/acknowledgement/)
    expect(existsSync(join(transaction, 'handoff-approved.json'))).toBe(false)
    expect(existsSync(join(transaction, 'cancel.json'))).toBe(true); expect(f.child.kill).toHaveBeenCalledWith('SIGTERM')
  })
  it('bounds a hung handshake and preserves the first asynchronous spawn error', async () => {
    for (const fail of [false, true]) {
      const f = fixture()
      await expect(launchDesktopInstaller(f.options, { handshakeTimeoutMs: 15, spawnHelper: () => {
        if (fail) queueMicrotask(() => f.child.emit('error', new Error('first spawn failure')))
        return f.child as unknown as ChildProcess
      } })).rejects.toThrow(fail ? 'first spawn failure' : /timed out/)
      expect(f.child.kill).toHaveBeenCalledOnce()
    }
  })
  it('cancels a pending handshake without publishing approval', async () => {
    const f = fixture(); const abort = new AbortController()
    await expect(launchDesktopInstaller(f.options, { signal: abort.signal, spawnHelper: () => {
      queueMicrotask(() => { abort.abort(new Error('cancel handshake')) }); return f.child as unknown as ChildProcess
    } })).rejects.toThrow('cancel handshake')
    const transaction = join(f.download, readdirSync(f.download).find(name => name.startsWith('desktop-update-'))!)
    expect(existsSync(join(transaction, 'handoff-approved.json'))).toBe(false)
  })
  it.each(['node-hash', 'version', 'extra-file', 'linked-node', 'escaped-dmg'] as const)('rejects unsafe source %s without spawning', async (mode) => {
    const f = fixture(); const spawnHelper = vi.fn()
    if (mode === 'node-hash') writeFileSync(f.options.helperNodePath, 'changed')
    if (mode === 'version') {
      const manifest = JSON.parse(readFileSync(f.options.helperSourceManifest, 'utf8')) as Record<string, unknown>; manifest.nodeVersion = '24.18.1'
      writeFileSync(f.options.helperSourceManifest, JSON.stringify(manifest))
    }
    if (mode === 'extra-file') writeFileSync(join(f.source, 'update-helper.js'), 'must not be here')
    if (mode === 'linked-node') { rmSync(f.options.helperNodePath); symlinkSync(f.options.helperSource, f.options.helperNodePath) }
    if (mode === 'escaped-dmg') f.options.verifiedDownloadDirectory = f.root
    await expect(launchDesktopInstaller(f.options, { spawnHelper })).rejects.toThrow()
    expect(spawnHelper).not.toHaveBeenCalled()
  })
  it('rejects copied helper tampering even after a matching acknowledgement', async () => {
    const f = fixture()
    await expect(launchDesktopInstaller(f.options, { spawnHelper: (_exe, args) => {
      const config = f.acknowledge(args)
      writeFileSync(join(config.transactionDirectory, 'update-helper.mjs'), 'changed after acknowledgement')
      return f.child as unknown as ChildProcess
    } })).rejects.toThrow(/checksum mismatch/)
    expect(f.child.kill).toHaveBeenCalledOnce()
  })

})
