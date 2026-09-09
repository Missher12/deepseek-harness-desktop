import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { SessionId } from '@deepseek-ai/dsh-session'
import { logPath } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { _electron as electron, type ElectronApplication, type JSHandle } from 'playwright'
import { describe, expect, it } from 'vitest'
import { desktopUpdateAssetName, type VerifiedDesktopUpdate } from '../src/update/release.ts'
import { verifyDesktopUpdateFile } from '../src/update/verification.ts'
import { createWindowsUpdateCommand, stopWindowsUpdateWorker } from '../src/update/windows-installer.ts'
import { createWindowsUpdateSignal, decideWindowsUpdateSignal, readWindowsUpdateSignal, type WindowsUpdateWorker } from '../src/update/windows-signal.ts'
import { bootstrapProgress } from './windows-update-preflight.ts'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const enabled = process.env.DSH_WINDOWS_UPDATE_HANDOFF === '1'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing isolated handoff input: ${name}.`)
  return value
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function physicalChild(root: string, path: string): Promise<void> {
  const relativePath = relative(root, path)
  if (!relativePath || relativePath.startsWith('..') || resolve(root, relativePath) !== path
    || resolve(await realpath(path)) !== path || (await lstat(path)).isSymbolicLink()) {
    throw new Error('Handoff input is not an owned physical child.')
  }
}

interface ObservedChild {
  child: ChildProcess
  closed: boolean
  failed: boolean
  output: string
}

// Self-contained: Playwright serializes this function into the installed main.
function spawnInstalledBootstrap(_electron: unknown, plan: { executable: string; args: readonly string[]; env: NodeJS.ProcessEnv }) {
  const native = process.getBuiltinModule('node:child_process')
  const child = native.spawn(plan.executable, plan.args, {
    detached: false, windowsHide: true, shell: false, env: plan.env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const state = { child, closed: false, failed: false, output: '', stderr: Buffer.alloc(0), stderrOverflow: false }
  child.once('error', () => { state.failed = true })
  child.once('close', () => { state.closed = true })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (state.output.length + chunk.length > 128) state.failed = true
    else state.output += chunk
  })
  // Drain into a private byte cap; parse only at close so split frames are safe.
  child.stderr.on('data', (chunk: Buffer) => {
    const remaining = 128 - state.stderr.length
    if (chunk.length > remaining) state.stderrOverflow = true
    state.stderr = Buffer.concat([state.stderr, chunk.subarray(0, remaining)])
  })
  return state
}

function observeChild(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): ObservedChild {
  const child = spawn(executable, args, { env, shell: false, windowsHide: true, detached: false, stdio: ['ignore', 'pipe', 'pipe'] })
  const result: ObservedChild = { child, closed: false, failed: false, output: '' }
  child.once('error', () => { result.failed = true })
  child.once('close', () => { result.closed = true })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (result.output.length + chunk.length > 16_384) result.failed = true
    else result.output += chunk
  })
  // Drain but never print native errors, which can contain local UI text/paths.
  child.stderr.on('data', () => { result.failed = true })
  return result
}

async function waitForReady(child: ObservedChild, token: string): Promise<void> {
  await expect.poll(() => {
    if (child.failed || child.closed) throw new Error('Owned handoff process stopped before readiness.')
    return child.output.split(/\r?\n/u).includes(token)
  }, { timeout: 30_000 }).toBe(true)
}

interface ProcessIdentity {
  ProcessId: number
  ParentProcessId: number
  ExecutablePath: string
  Created: string
}

function verifyInstalledMain(
  rows: readonly ProcessIdentity[], launcher: ProcessIdentity, mainPid: number, executable: string,
): ProcessIdentity {
  const liveLauncher = rows.find(row => row.ProcessId === launcher.ProcessId)
  if (liveLauncher?.Created !== launcher.Created || liveLauncher.ExecutablePath !== launcher.ExecutablePath) {
    throw new Error('Installed main identity has no matching live launcher.')
  }
  const tree = collectOwnedProcesses(rows, new Set([launcher.ProcessId]), new Map([[launcher.ProcessId, launcher]]))
  const main = tree.find(row => row.ProcessId === mainPid && row.ExecutablePath.toLowerCase() === executable.toLowerCase())
  if (main === undefined) throw new Error('Installed main identity mismatch.')
  return main
}

function collectOwnedProcesses(
  rows: readonly ProcessIdentity[], roots: ReadonlySet<number>, owned: Map<number, ProcessIdentity>,
): ProcessIdentity[] {
  const currentByPid = new Map(rows.map(row => [row.ProcessId, row]))
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) {
      if (owned.has(row.ProcessId)) continue
      const parent = owned.get(row.ParentProcessId)
      const currentParent = currentByPid.get(row.ParentProcessId)
      // A historical PPID alone cannot establish new ownership once that
      // parent exits. Already recorded orphans remain in owned below.
      const parentMatches = currentParent !== undefined && currentParent.Created === parent?.Created
      if (roots.has(row.ProcessId) || (parent !== undefined && parentMatches && row.Created >= parent.Created)) {
        owned.set(row.ProcessId, row)
        changed = true
      }
    }
  }
  return rows.filter(row => owned.get(row.ProcessId)?.Created === row.Created)
}

describe('handoff process ownership', () => {
  it('binds the installed main to this live launcher tree rather than equating shell and main PIDs', () => {
    const launcher = { ProcessId: 10, ParentProcessId: 1, Created: '01', ExecutablePath: 'cmd.exe' }
    const main = { ProcessId: 20, ParentProcessId: 10, Created: '02', ExecutablePath: 'C:\\App\\DeepSeek Harness.exe' }
    const expected = main.ExecutablePath
    expect(verifyInstalledMain([launcher, main], launcher, 20, expected).ProcessId).toBe(20)
    for (const rows of [
      [launcher, { ...main, ParentProcessId: 99 }],
      [launcher, { ...main, Created: '00' }],
      [{ ...launcher, Created: '03' }, main],
      [main], [launcher, { ...main, ExecutablePath: 'C:\\Other\\DeepSeek Harness.exe' }],
    ]) expect(() => verifyInstalledMain(rows, launcher, 20, expected)).toThrow('Installed main identity')
  })
  it('accepts chunked bootstrap progress only after close and rejects unknown or overflowing stderr', async () => {
    for (const [stderr, allowed] of [
      ['DSHB:E\nDSHB:U\nDSHB:V\nDSHB:J\nDSHB:I\nDSHB:P\nDSHB:M\nDSHB:N\nDSHB:S\nDSHB:W\nDSHB:R\n', true], ['', true], ['DSHB:F\n', false],
      ['unknown\n', false], ['DSHB:E', false], ['x'.repeat(129), false],
    ] as const) {
      const state = spawnInstalledBootstrap(null, {
        executable: process.execPath, env: {}, args: ['-e',
          `process.stderr.write(${JSON.stringify(stderr.slice(0, 3))}); setTimeout(() => { process.stderr.write(${JSON.stringify(stderr.slice(3))}); process.stdout.write('DSH_UPDATE_READY\\n') }, 20)`],
      })
      try {
        await expect.poll(() => state.closed, { timeout: 5_000 }).toBe(true)
        expect(state.failed).toBe(false)
        expect(state.stderr.length).toBeLessThanOrEqual(128)
        expect(!state.stderrOverflow && bootstrapProgress(state.stderr.toString('utf8')).stderrAllowed).toBe(allowed)
        expect(state.output).toBe('DSH_UPDATE_READY\n')
      } finally {
        if (!state.closed) {
          state.child.kill()
          await expect.poll(() => state.closed, { timeout: 5_000 }).toBe(true)
        }
      }
    }
  })
  const row = (id: number, parent: number, created: string): ProcessIdentity => ({
    ProcessId: id, ParentProcessId: parent, Created: created, ExecutablePath: 'fixture.exe',
  })
  it('collects the actual tree regardless of inventory order', () => {
    const owned = new Map<number, ProcessIdentity>()
    expect(collectOwnedProcesses([row(3, 2, '03'), row(2, 1, '02'), row(1, 0, '01')], new Set([1]), owned)
      .map(process => process.ProcessId)).toEqual([3, 2, 1])
  })
  it('rejects children of a reused parent PID before granting cleanup authority', () => {
    const owned = new Map([[1, row(1, 0, '01')]])
    expect(collectOwnedProcesses([row(1, 0, '04'), row(2, 1, '05')], new Set([1]), owned)).toEqual([])
    expect([...owned.keys()]).toEqual([1])
  })
  it('retains previously owned orphan cleanup without granting new ownership', () => {
    const owned = new Map([[1, row(1, 0, '02')], [2, row(2, 1, '03')]])
    expect(collectOwnedProcesses([row(2, 1, '03'), row(3, 1, '01')], new Set([1]), owned)
      .map(process => process.ProcessId)).toEqual([2])
  })
  it('never claims an unobserved orphan from a historical parent PID alone', () => {
    const owned = new Map([[1, row(1, 0, '01')]])
    expect(collectOwnedProcesses([row(2, 1, '03')], new Set([1]), owned)).toEqual([])
  })
  it('does not regain authority when a reused parent disappears in the next inventory', () => {
    const owned = new Map([[1, row(1, 0, '01')]])
    expect(collectOwnedProcesses([row(1, 0, '04'), row(2, 1, '05')], new Set([1]), owned)).toEqual([])
    expect(collectOwnedProcesses([row(2, 1, '05')], new Set([1]), owned)).toEqual([])
    expect([...owned.keys()]).toEqual([1])
  })
})

describe('real installed Windows native-command update handoff', () => {
  it.skipIf(process.platform !== 'win32' || !enabled)('waits for the real app to quit, opens the same-build Setup and cancels without changing protected bytes', async () => {
    const smokeRoot = resolve(requiredEnvironment('DSH_DESKTOP_SMOKE_ROOT'))
    const executable = resolve(requiredEnvironment('DSH_WINDOWS_DESKTOP_EXECUTABLE'))
    const harnessHome = resolve(requiredEnvironment('DSH_DESKTOP_SMOKE_DSH_HOME'))
    const userData = resolve(requiredEnvironment('DSH_DESKTOP_SMOKE_USER_DATA'))
    const setupPath = resolve(requiredEnvironment('DSH_WINDOWS_UPDATE_SETUP'))
    const expectedSha256 = requiredEnvironment('DSH_WINDOWS_UPDATE_SETUP_SHA256')
    for (const path of [executable, harnessHome, userData]) await physicalChild(smokeRoot, path)
    expect(basename(executable)).toBe('DeepSeek Harness.exe')
    expect(/^[a-f0-9]{64}$/u.test(expectedSha256)).toBe(true)
    const desktop = JSON.parse(await readFile(join(repositoryRoot, 'apps/desktop/package.json'), 'utf8')) as { version: string }
    const harness = JSON.parse(await readFile(join(repositoryRoot, 'apps/cli/package.json'), 'utf8')) as { version: string }
    const target = { platform: 'win32', arch: 'x64', packageFormat: 'nsis' } as const
    expect(basename(setupPath)).toBe(desktopUpdateAssetName(desktop.version, target))
    expect(await digest(setupPath)).toBe(expectedSha256)
    const evidenceRoot = join(repositoryRoot, 'apps/desktop/release/windows-update-handoff-evidence')
    await mkdir(evidenceRoot, { recursive: true })
    const stagingDirectory = await mkdtemp(join(smokeRoot, 'handoff-'))
    const signal = await createWindowsUpdateSignal(stagingDirectory)
    let application: ElectronApplication | undefined
    let applicationClosed = false
    let bootstrap: JSHandle<ReturnType<typeof spawnInstalledBootstrap>> | undefined
    let bootstrapPid: number | undefined
    let observer: ObservedChild | undefined
    let worker: WindowsUpdateWorker | undefined
    const owned = new Map<number, ProcessIdentity>()
    const roots = new Set<number>()
    let handedOffSetupPath: string | undefined
    const safeEnv = Object.fromEntries(Object.entries(process.env)
      .filter(([key, value]) => value !== undefined && !/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^NODE_PATH$/iu.test(key)))
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
    const powershell = join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    async function bootstrapState() {
      if (bootstrap === undefined) throw new Error('The installed main has not created a bootstrap.')
      const snapshot = await bootstrap.evaluate(state => ({
        pid: state.child.pid, closed: state.closed, failed: state.failed, output: state.output,
        exitCode: state.child.exitCode, signal: state.child.signalCode,
        stderr: state.stderr.toString('utf8'), stderrOverflow: state.stderrOverflow,
      }))
      const { stderr, stderrOverflow, ...facts } = snapshot
      return { ...facts, stderrAllowed: facts.closed && !stderrOverflow && bootstrapProgress(stderr).stderrAllowed }
    }
    async function processes(): Promise<ProcessIdentity[]> {
      const { stdout } = await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        "@(Get-CimInstance Win32_Process | Where-Object { $null -ne $_.CreationDate } | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}}) | ConvertTo-Json -Compress",
      ], { env: safeEnv, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 })
      return JSON.parse(stdout) as ProcessIdentity[]
    }
    async function captureOwned(): Promise<ProcessIdentity[]> {
      if (observer !== undefined && handedOffSetupPath !== undefined) {
        const identities = observer.output.split(/\r?\n/u).slice(0, -1).filter(line => line.startsWith('DSH_HANDOFF_SETUP '))
        if (identities.length > 1) throw new Error('Observer reported duplicate Setup identities.')
        for (const line of identities) {
          const identity = JSON.parse(line.slice('DSH_HANDOFF_SETUP '.length)) as Omit<ProcessIdentity, 'ExecutablePath'>
          if (!Number.isSafeInteger(identity.ProcessId) || identity.ProcessId <= 0
            || identity.ParentProcessId !== worker?.pid || !Number.isFinite(Date.parse(identity.Created))) {
            throw new Error('Observer reported an invalid owned Setup identity.')
          }
          const previous = owned.get(identity.ProcessId)
          if (previous !== undefined && previous.Created !== identity.Created) throw new Error('Setup PID identity changed.')
          owned.set(identity.ProcessId, { ...identity, ExecutablePath: handedOffSetupPath })
        }
      }
      const rows = await processes()
      return collectOwnedProcesses(rows, roots, owned)
    }
    async function waitForStopped(): Promise<void> {
      await expect.poll(async () => (await captureOwned()).length, { timeout: 30_000 }).toBe(0)
    }
    async function stopChild(child: ObservedChild | undefined): Promise<void> {
      if (child === undefined || child.closed) return
      child.child.kill()
      await expect.poll(() => child.closed, { timeout: 15_000 }).toBe(true)
    }
    try {
      const localPath = join(stagingDirectory, basename(setupPath))
      handedOffSetupPath = localPath
      await copyFile(setupPath, localPath)
      const descriptor: VerifiedDesktopUpdate = {
        target, desktopVersion: desktop.version, harnessVersion: harness.version,
        assetName: basename(setupPath), localPath, stagingDirectory,
        bytes: (await lstat(setupPath)).size, sha256: expectedSha256,
      }
      await verifyDesktopUpdateFile(descriptor)
      const recoveryRoot = join(harnessHome, 'recovery/legacy-module-fallback')
      const recovery = (await readdir(recoveryRoot, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort()
      expect(recovery.length).toBeGreaterThan(0)
      // Exact existing cold business fixtures only; Electron caches, active
      // session replay, window placement and preferences are allowed to settle.
      const protectedPaths = [
        executable, join(dirname(executable), 'resources/app.asar'),
        join(harnessHome, 'preserve-after-uninstall.txt'), join(userData, 'preserve-after-uninstall.txt'),
        join(harnessHome, 'profiles/ordinary-upgrade-sentinel/package.json'),
        join(harnessHome, 'profiles/ordinary-upgrade-sentinel/cordis.patch.yml'),
        logPath(join(harnessHome, 'sessions'), join(harnessHome, 'desktop-smoke-archived-workspace'),
          SessionId('desktop-smoke-archived-session-id'), 'zstd'),
        ...recovery,
      ]
      const snapshot = async (): Promise<string[]> => await Promise.all(protectedPaths.map(digest))
      const protectedBefore = await snapshot()
      application = await electron.launch({
        executablePath: executable, args: [`--user-data-dir=${userData}`], cwd: smokeRoot,
        env: { ...safeEnv, DSH_HOME: harnessHome, DSH_TELEMETRY_DISABLED: '1',
          DSH_DESKTOP_SMOKE_MODEL_KEY: 'desktop-smoke-placeholder-key',
          MISSHER_TENCENTDB_DIR: join(smokeRoot, 'memory-source-unconfigured'), DEEPSEEK_API_KEY: '' },
        timeout: 120_000,
      })
      // On Windows Playwright launches through a shell; its retained process is
      // the launcher, not necessarily the inspector-connected Electron main.
      const launcherPid = application.process().pid
      if (launcherPid === undefined) throw new Error('Installed handoff application has no launcher PID.')
      roots.add(launcherPid)
      const launcher = (await captureOwned()).find(row => row.ProcessId === launcherPid)
      if (launcher === undefined) throw new Error('Installed handoff launcher identity was not observed.')
      const page = await application.firstWindow({ timeout: 120_000 })
      await expect.poll(() => page.locator('body[data-dsh-surface="desktop"]').count(), { timeout: 120_000 }).toBe(1)
      await expect.poll(async () => Promise.all([
        page.locator('[class*="sidebarCol"]').count(), page.locator('[class*="centerCol"]').count(),
        page.locator('[class*="detailsCol"]').count(),
      ]), { timeout: 120_000 }).toEqual([1, 1, 1])
      const identity = await application.evaluate(({ app }) => ({
        pid: process.pid, executable: process.execPath, version: app.getVersion(),
        harnessHome: process.env.DSH_HOME, userData: app.getPath('userData'),
      }))
      const main = verifyInstalledMain(await captureOwned(), launcher, identity.pid, executable)
      const mainPid = main.ProcessId
      expect(resolve(identity.executable) === executable).toBe(true)
      expect(identity.harnessHome === harnessHome && resolve(identity.userData) === userData).toBe(true)
      expect(identity.version).toBe(desktop.version)
      const command = createWindowsUpdateCommand(descriptor, {
        parentPid: identity.pid, parentExecutable: identity.executable,
        systemRoot, environment: safeEnv, signal,
      })
      // Create the real command INSIDE the installed Electron main so app.quit
      // closes the actual creator's libuv job, not only a separately watched PID.
      bootstrap = await application.evaluateHandle(spawnInstalledBootstrap, command)
      bootstrapPid = (await bootstrapState()).pid
      if (bootstrapPid === undefined) throw new Error('Update bootstrap has no PID.')
      roots.add(bootstrapPid)
      await expect.poll(async () => {
        const state = await bootstrapState()
        if (state.closed || state.failed) throw new Error('Installed bootstrap stopped before readiness.')
        return state.output === 'DSH_UPDATE_READY\r\n' || state.output === 'DSH_UPDATE_READY\n'
      }, { timeout: 20_000 }).toBe(true)
      worker = await readWindowsUpdateSignal(signal)
      const tree = await captureOwned()
      const creator = tree.find(row => row.ProcessId === bootstrapPid)
      expect(creator?.ParentProcessId).toBe(mainPid)
      const waiting = tree.find(row => row.ProcessId === worker!.pid)
      if (waiting === undefined || waiting.ParentProcessId !== bootstrapPid
        || waiting.ExecutablePath.toLowerCase() !== powershell.toLowerCase()) throw new Error('Independent worker identity was not observed.')
      await decideWindowsUpdateSignal(signal, true)
      await expect.poll(async () => (await bootstrapState()).closed, { timeout: 20_000 }).toBe(true)
      expect(await bootstrapState()).toMatchObject({ exitCode: 0, signal: null, failed: false, stderrAllowed: true })
      expect((await captureOwned()).some(row => row.ProcessId === worker!.pid && row.Created === waiting.Created)).toBe(true)
      // Attach to the helper's future child. No /S, /D, fake bridge, future
      // release metadata, replacement fetch, or direct Setup spawn is involved.
      observer = observeChild('pwsh', ['-NoLogo', '-NoProfile', '-File',
        join(repositoryRoot, 'scripts/windows-desktop-installer-ui-smoke.ps1'),
        '-SetupPath', localPath, '-EvidenceRoot', evidenceRoot,
        '-HandoffHelperId', String(worker.pid), '-HandoffParentId', String(mainPid),
        '-HandoffBootstrapId', String(bootstrapPid), '-HandoffWorkerCreated', waiting.Created,
      ], safeEnv)
      if (observer.child.pid === undefined) throw new Error('Handoff observer has no PID.')
      roots.add(observer.child.pid)
      await waitForReady(observer, 'DSH_HANDOFF_OBSERVER_READY')
      await captureOwned()
      expect((await processes()).filter(row => row.ParentProcessId === worker!.pid
        && row.ExecutablePath?.toLowerCase() === localPath.toLowerCase())).toHaveLength(0)
      const closed = application.waitForEvent('close', { timeout: 120_000 })
      await application.evaluate(({ app }) => { app.quit() })
      await closed
      applicationClosed = true
      const activeObserver = observer
      await expect.poll(async () => { await captureOwned(); return activeObserver.closed }, { timeout: 150_000 }).toBe(true)
      const failedStage = /^DSH_HANDOFF_FAILED (waiting-for-setup|waiting-for-welcome|capturing-welcome|controlled-cancel)\r?$/mu
        .exec(activeObserver.output)?.[1]
      if (failedStage !== undefined) throw new Error(`Native handoff failed at ${failedStage}.`)
      expect(activeObserver.failed).toBe(false)
      expect(activeObserver.child.exitCode).toBe(0)
      expect(activeObserver.child.signalCode).toBeNull()
      expect(activeObserver.output.split(/\r?\n/u)).toContain('DSH_HANDOFF_CANCELLED')
      expect(activeObserver.output.split(/\r?\n/u).filter(line => line.startsWith('DSH_HANDOFF_SETUP '))).toHaveLength(1)
      await waitForStopped()
      expect(await snapshot()).toEqual(protectedBefore)
      expect(await digest(localPath)).toBe(expectedSha256)
      expect((await lstat(join(evidenceRoot, 'handoff-welcome.png'))).size).toBeGreaterThan(0)
      // Portable evidence contains no identities, machine paths, UI text or
      // credentials. Cancellation is observed by this driver, NOT by the app.
      await writeFile(join(evidenceRoot, 'handoff.json'), JSON.stringify({
        schemaVersion: 1, entrance: 'native-command', payload: 'same-build-setup',
        desktopVersion: desktop.version, setupBytes: descriptor.bytes, setupSha256: expectedSha256,
        desktopSurfaceReady: true, parentIdentityMatched: true, helperAcknowledged: true,
        bootstrapCreatedByInstalledMain: true, bootstrapExitedBeforeParent: true, independentWorkerIdentityMatched: true,
        setupStartedAfterParentExit: true, setupOwnedByHelper: true, welcomeVisible: true,
        cancellationObservedBy: 'native-test-driver', cancellationCompleted: true,
        protectedFileCount: protectedPaths.length, protectedBytesUnchanged: true, remainingOwnedProcesses: 0,
      }, null, 2) + '\n', { flag: 'wx' })
    } finally {
      // Stop the waiting helper FIRST so failure cleanup cannot accidentally
      // launch Setup when the still-running installed app subsequently exits.
      let cleanupFailed = false
      const clean = async (action: () => Promise<unknown>): Promise<void> => {
        try { await action() } catch { cleanupFailed = true }
      }
      await clean(async () => { await decideWindowsUpdateSignal(signal, false) })
      await clean(captureOwned)
      await clean(async () => {
        if (worker === undefined) return
        const current = (await captureOwned()).find(row => row.ProcessId === worker!.pid)
        if (current === undefined) return
        await stopWindowsUpdateWorker(worker, systemRoot)
      })
      await clean(async () => {
        if (bootstrap === undefined || applicationClosed) return
        await expect.poll(async () => (await bootstrapState()).closed, { timeout: 20_000 }).toBe(true)
      })
      await clean(captureOwned)
      await clean(async () => { if (!applicationClosed && application !== undefined) await application.close() })
      await clean(captureOwned)
      await clean(async () => { await stopChild(observer) })
      await clean(async () => {
        const remaining = await captureOwned()
        if (remaining.length === 0) return
        // PID plus creation time prevents cleanup from touching a reused PID.
        await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
          '$owned = $env:DSH_HANDOFF_OWNED | ConvertFrom-Json; foreach($entry in $owned) { $p=Get-CimInstance Win32_Process -Filter ("ProcessId = " + $entry.ProcessId); if($null -ne $p -and $p.CreationDate.ToUniversalTime().ToString("o") -ceq $entry.Created) { Stop-Process -Id $entry.ProcessId -Force -ErrorAction Stop } }',
        ], { env: { ...safeEnv, DSH_HANDOFF_OWNED: JSON.stringify(remaining) }, timeout: 20_000 })
      })
      await clean(waitForStopped)
      if (cleanupFailed) throw new Error('Owned handoff cleanup failed; isolated files were retained.')
      await rm(stagingDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    }
  }, 360_000)
})
