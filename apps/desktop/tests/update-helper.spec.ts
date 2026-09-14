import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runUpdateTransaction, validateUpdateHelperConfig, restartEnvironment, type UpdateHelperConfig, type UpdateHelperDependencies } from '../src/update/update-helper.ts'
import { bytesSha256, publishPrivateRecord, readRestartRequest, writeRestartReady } from '../src/update/restart-receipt.ts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'dsh-helper-test-')); roots.push(root)
  const download = join(root, 'download'); mkdirSync(download, { mode: 0o700 })
  const tx = mkdtempSync(join(download, 'desktop-update-'))
  const app = join(root, 'DeepSeek Harness.app'); mkdirSync(app); writeFileSync(join(app, 'old-sentinel'), 'old application')
  const home = join(root, 'home'); mkdirSync(home); const dshHome = join(home, '.dsh'); mkdirSync(dshHome)
  const userData = join(root, 'userData'); mkdirSync(userData)
  const dmgPath = join(download, 'DeepSeek-Harness-0.6.0-mac-x64.dmg')
  const dmg = Buffer.alloc(1024); dmg.write('koly', 512); writeFileSync(dmgPath, dmg, { mode: 0o600 })
  const config: UpdateHelperConfig = { schema: 2, attemptId: 'a'.repeat(32), nonce: 'b'.repeat(64), transactionDirectory: tx,
    parentPid: 123, currentAppPath: app, dmgPath, verifiedDownloadDirectory: download,
    expectedDesktopVersion: '0.6.0', expectedHarnessVersion: '0.1.5-rc.2', expectedSha256: bytesSha256(dmg), expectedBytes: dmg.length,
    restart: { home, dshHome, userData }, files: { node: 'c'.repeat(64), helper: 'd'.repeat(64), source: 'e'.repeat(64), license: 'f'.repeat(64) } }
  const approve = () => publishPrivateRecord(tx, 'handoff-approved.json', { schema: 1, attemptId: config.attemptId, nonce: config.nonce })
  const commands: string[] = []
  const dependencies: UpdateHelperDependencies = { parentAlive: () => false, canWrite: () => true, timeoutMs: 1000,
    run: async (command, args) => {
      commands.push(`${command} ${args.join(' ')}`)
      if (command.endsWith('hdiutil') && args[0] === 'attach') {
        const candidate = join(tx, 'mount', 'DeepSeek Harness.app')
        mkdirSync(join(candidate, 'Contents', 'MacOS'), { recursive: true }); mkdirSync(join(candidate, 'Contents', 'Resources'))
        writeFileSync(join(candidate, 'Contents', 'Info.plist'), 'fixture-plist')
        writeFileSync(join(candidate, 'Contents', 'MacOS', 'DeepSeek Harness'), 'new application')
        writeFileSync(join(candidate, 'Contents', 'Resources', 'update-metadata.json'), JSON.stringify({ schema: 1,
          desktopVersion: '0.6.0', harnessVersion: '0.1.5-rc.2', platform: 'darwin', arch: 'x64' }))
      }
      if (command.endsWith('plutil')) return args[1] === 'CFBundleIdentifier' ? 'ai.deepseek.harness.desktop'
        : args[1] === 'CFBundleExecutable' ? 'DeepSeek Harness' : '0.6.0'
      if (command.endsWith('lipo')) return 'x86_64'
      if (command.endsWith('ditto')) cpSync(args[1]!, args[2]!, { recursive: true })
      return ''
    },
    spawnApp: async (executablePath, args, env) => {
      expect(args).toEqual([`--user-data-dir=${userData}`])
      expect(env.HOME).toBe(home); expect(env.DSH_HOME).toBe(dshHome)
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined(); expect(env.APPDIR).toBeUndefined()
      const facts = { executablePath, ...config.restart, desktopVersion: '0.6.0', harnessVersion: '0.1.5-rc.2' }
      const handle = await readRestartRequest(env.DSH_DESKTOP_RESTART_REQUEST, facts)
      await writeRestartReady(handle!, { ...facts, ownedHostPid: process.pid + 100 })
      return { pid: process.pid, hasExited: () => false }
    } }
  return { config, approve, dependencies, commands, app, tx }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function parserFixture(): UpdateHelperConfig {
  return { schema: 2, attemptId: 'a'.repeat(32), nonce: 'b'.repeat(64),
    transactionDirectory: '/private/tmp/download/desktop-update-fixture', parentPid: 123,
    currentAppPath: '/Applications/DeepSeek Harness.app', verifiedDownloadDirectory: '/private/tmp/download',
    dmgPath: '/private/tmp/download/DeepSeek-Harness-0.6.0-mac-x64.dmg', expectedDesktopVersion: '0.6.0',
    expectedHarnessVersion: '0.1.5-rc.2', expectedSha256: 'c'.repeat(64), expectedBytes: 1024,
    restart: { home: '/Users/fixture', dshHome: '/Users/fixture/.dsh', userData: '/Users/fixture/appdata' },
    files: { node: 'c'.repeat(64), helper: 'd'.repeat(64), source: 'e'.repeat(64), license: 'f'.repeat(64) } }
}
describe('Mac helper request validation', () => {
  it('accepts only the closed independent-runtime schema', () => {
    const config = parserFixture(); expect(validateUpdateHelperConfig(config)).toEqual(config)
    for (const change of [{ schema: 1 }, { extra: true }, { currentAppPath: '/Applications/Other.app' }, { parentPid: -1 },
      { dmgPath: '/tmp/../../bad.dmg' }, { expectedSha256: 'bad' }, { nonce: 'bad' }, { restart: { ...config.restart, argv: ['--unsafe'] } },
      { files: { ...config.files, node: 'bad' } }, { transactionDirectory: '/tmp/desktop-update-elsewhere' }]) {
      expect(validateUpdateHelperConfig({ ...config, ...change })).toBeNull()
    }
  })
  it('refuses a caller-selected restart request filename', () => {
    const config = parserFixture(); expect(() => restartEnvironment(config, '/tmp/untrusted')).toThrow()
  })
})
describe.skipIf(process.platform === 'win32')('bounded offline installation transactions', () => {
  it('requires correlated Host readiness and retains the old backup', async () => {
    const f = fixture(); f.approve()
    const outcome = await runUpdateTransaction(f.config, f.dependencies)
    expect(outcome.status).toBe('installed-host-ready'); expect(outcome.firstError).toBeNull()
    expect(existsSync(join(outcome.backupPath!, 'old-sentinel'))).toBe(true)
    expect(f.commands.some(command => command.startsWith('/usr/bin/open'))).toBe(false)
    expect(JSON.parse(readFileSync(join(f.tx, 'outcome.json'), 'utf8'))).toEqual(outcome)
    await expect(runUpdateTransaction(f.config, f.dependencies)).rejects.toThrow()
    expect(JSON.parse(readFileSync(join(f.tx, 'outcome.json'), 'utf8'))).toEqual(outcome)
  })
  it('times out before handoff without touching the application', async () => {
    const f = fixture()
    const outcome = await runUpdateTransaction(f.config, { ...f.dependencies, timeoutMs: 10 })
    expect(outcome.status).toBe('failed-before-launch'); expect(outcome.phase).toBe('handoff')
    expect(existsSync(join(f.app, 'old-sentinel'))).toBe(true); expect(f.commands).toEqual([])
  })
  it('bounds parent exit and does not confuse permission denial with exit', async () => {
    for (const parentAlive of [() => true, () => { throw new Error('EPERM first failure') }]) {
      const f = fixture(); f.approve()
      const outcome = await runUpdateTransaction(f.config, { ...f.dependencies, timeoutMs: 10, parentAlive })
      expect(outcome.status).toBe('failed-before-launch'); expect(outcome.phase).toBe('parent-exit')
      expect(f.commands).toEqual([])
    }
  })
  it('rejects a changed payload before any installation tool runs', async () => {
    const f = fixture(); f.approve(); writeFileSync(f.config.dmgPath, 'tampered')
    const outcome = await runUpdateTransaction(f.config, f.dependencies)
    expect(outcome.status).toBe('failed-before-launch'); expect(outcome.firstError).toMatch(/verification failed/)
    expect(f.commands).toEqual([])
  })
  it('opens the verified DMG for manual installation when the app parent is not writable', async () => {
    const f = fixture(); f.approve()
    const outcome = await runUpdateTransaction(f.config, { ...f.dependencies, canWrite: () => false })
    expect(outcome.status).toBe('manual-install-required'); expect(outcome.newAppMayHaveStarted).toBe(false)
    expect(f.commands).toEqual([`/usr/bin/open ${f.config.dmgPath}`])
  })
  it('restores the old app after final bundle verification fails before launch', async () => {
    const f = fixture(); f.approve()
    const outcome = await runUpdateTransaction(f.config, { ...f.dependencies, run: async (command, args, timeout) => {
      if (command.endsWith('plutil') && args.at(-1)!.startsWith(f.app)) throw new Error('final verification rejected')
      return f.dependencies.run!(command, args, timeout)
    } })
    expect(outcome.status).toBe('failed-before-launch'); expect(outcome.newAppMayHaveStarted).toBe(false)
    expect(existsSync(join(f.app, 'old-sentinel'))).toBe(true)
    expect(outcome.firstError).toBe('final verification rejected')
  })
  it.each(['spawn-error', 'hung-spawn', 'no-ready', 'wrong-pid', 'exited'] as const)('retains both binaries after %s', async (mode) => {
    const f = fixture(); f.approve()
    const outcome = await runUpdateTransaction(f.config, { ...f.dependencies, timeoutMs: 500,
      spawnApp: async (...args) => {
        if (mode === 'spawn-error') throw new Error('spawn first error')
        if (mode === 'hung-spawn') return new Promise(() => {})
        if (mode === 'wrong-pid') { await f.dependencies.spawnApp!(...args); return { pid: process.pid + 1, hasExited: () => false } }
        return { pid: process.pid, hasExited: () => mode === 'exited' }
      } })
    expect(outcome.status).toBe('recovery-required'); expect(outcome.newAppMayHaveStarted).toBe(true)
    expect(existsSync(join(f.app, 'Contents', 'MacOS', 'DeepSeek Harness'))).toBe(true)
    expect(existsSync(join(outcome.backupPath!, 'old-sentinel'))).toBe(true)
    expect(f.commands.some(command => command.startsWith('/usr/bin/open'))).toBe(false)
  })
  it('honors cancellation before replacing files and preserves first errors during detach failure', async () => {
    const f = fixture(); f.approve(); const abort = new AbortController()
    const outcome = await runUpdateTransaction(f.config, { ...f.dependencies, signal: abort.signal, run: async (command, args, timeout) => {
      if (command.endsWith('ditto')) abort.abort(new Error('cancel requested'))
      if (args[0] === 'detach') throw new Error('detach later error')
      return f.dependencies.run!(command, args, timeout)
    } })
    expect(outcome.status).toBe('failed-before-launch'); expect(outcome.firstError).toBe('cancel requested')
    expect(outcome.recoveryError).toBe('detach later error'); expect(existsSync(join(f.app, 'old-sentinel'))).toBe(true)
  })
  it.each(['bundle-id', 'bundle-version', 'executable-name', 'architecture', 'metadata'] as const)('rejects candidate %s before app replacement', async (mode) => {
    const f = fixture(); f.approve()
    const outcome = await runUpdateTransaction(f.config, { ...f.dependencies, run: async (command, args, timeout) => {
      const result = await f.dependencies.run!(command, args, timeout)
      if (mode === 'bundle-id' && args[1] === 'CFBundleIdentifier') return 'untrusted.bundle'
      if (mode === 'bundle-version' && args[1] === 'CFBundleShortVersionString') return '9.0.0'
      if (mode === 'executable-name' && args[1] === 'CFBundleExecutable') return '../../unsafe'
      if (mode === 'architecture' && command.endsWith('lipo')) return 'arm64'
      if (mode === 'metadata' && command.endsWith('hdiutil') && args[0] === 'attach') {
        writeFileSync(join(f.tx, 'mount', 'DeepSeek Harness.app', 'Contents', 'Resources', 'update-metadata.json'), '{}')
      }
      return result
    } })
    expect(outcome.status).toBe('failed-before-launch'); expect(outcome.newAppMayHaveStarted).toBe(false)
    expect(existsSync(join(f.app, 'old-sentinel'))).toBe(true)
    expect(f.commands.some(command => command.startsWith('/usr/bin/ditto'))).toBe(false)
  })
  it('keeps the first running transaction outcome exclusive when a duplicate helper starts', async () => {
    const f = fixture(); f.approve()
    let release: (() => void) | undefined
    const waiting = new Promise<void>((accept) => { release = accept })
    const first = runUpdateTransaction(f.config, { ...f.dependencies, spawnApp: async (...args) => {
      await waiting; return f.dependencies.spawnApp!(...args)
    } })
    await expect(runUpdateTransaction(f.config, f.dependencies)).rejects.toThrow()
    expect(existsSync(join(f.tx, 'outcome.json'))).toBe(false)
    release!()
    expect((await first).status).toBe('installed-host-ready')
  })

  it('requires recovery after cancellation when the new app may already have written data', async () => {
    const f = fixture(); f.approve(); const abort = new AbortController()
    const outcome = await runUpdateTransaction(f.config, { ...f.dependencies, signal: abort.signal, spawnApp: async () => {
      writeFileSync(join(f.config.restart.dshHome, 'new-generation-sentinel'), 'new data')
      abort.abort(new Error('cancel after spawn'))
      return { pid: process.pid, hasExited: () => false }
    } })
    expect(outcome.status).toBe('recovery-required'); expect(outcome.firstError).toBe('cancel after spawn')
    expect(existsSync(join(f.app, 'Contents', 'MacOS', 'DeepSeek Harness'))).toBe(true)
    expect(existsSync(join(outcome.backupPath!, 'old-sentinel'))).toBe(true)
    expect(readFileSync(join(f.config.restart.dshHome, 'new-generation-sentinel'), 'utf8')).toBe('new data')
  })

})
