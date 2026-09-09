import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { SessionId } from '@deepseek-ai/dsh-session'
import { logPath } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'
import { desktopUpdateAssetName, type VerifiedDesktopUpdate } from '../src/update/release.ts'
import { verifyDesktopUpdateFile } from '../src/update/verification.ts'
import { createWindowsUpdateCommand } from '../src/update/windows-installer.ts'

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

function observeChild(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): ObservedChild {
  const child = spawn(executable, args, { env, shell: false, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
    let application: ElectronApplication | undefined
    let applicationClosed = false
    let helper: ObservedChild | undefined
    let observer: ObservedChild | undefined
    const owned = new Map<number, ProcessIdentity>()
    const roots = new Set<number>()
    let handedOffSetupPath: string | undefined
    const safeEnv = Object.fromEntries(Object.entries(process.env)
      .filter(([key, value]) => value !== undefined && !/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^NODE_PATH$/iu.test(key)))
    const powershell = join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
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
            || identity.ParentProcessId !== helper?.child.pid || !Number.isFinite(Date.parse(identity.Created))) {
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
      const mainPid = application.process().pid
      if (mainPid === undefined) throw new Error('Installed handoff application has no main PID.')
      roots.add(mainPid)
      await captureOwned()
      const page = await application.firstWindow({ timeout: 120_000 })
      await expect.poll(() => page.locator('body[data-dsh-surface="desktop"]').count(), { timeout: 120_000 }).toBe(1)
      await expect.poll(async () => Promise.all([
        page.locator('[class*="sidebarCol"]').count(), page.locator('[class*="centerCol"]').count(),
        page.locator('[class*="detailsCol"]').count(),
      ]), { timeout: 120_000 }).toEqual([1, 1, 1])
      const identity = await application.evaluate(({ app }) => ({
        pid: process.pid, executable: process.execPath, version: app.getVersion(),
      }))
      expect(identity.pid).toBe(mainPid)
      expect(resolve(identity.executable) === executable).toBe(true)
      expect(identity.version).toBe(desktop.version)
      const command = createWindowsUpdateCommand(descriptor, {
        parentPid: identity.pid, parentExecutable: identity.executable,
        systemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', environment: safeEnv,
      })
      helper = observeChild(command.executable, command.args, command.env)
      if (helper.child.pid === undefined) throw new Error('Update helper has no PID.')
      roots.add(helper.child.pid)
      await waitForReady(helper, 'DSH_UPDATE_READY')
      // Attach to the helper's future child. No /S, /D, fake bridge, future
      // release metadata, replacement fetch, or direct Setup spawn is involved.
      observer = observeChild('pwsh', ['-NoLogo', '-NoProfile', '-File',
        join(repositoryRoot, 'scripts/windows-desktop-installer-ui-smoke.ps1'),
        '-SetupPath', localPath, '-EvidenceRoot', evidenceRoot,
        '-HandoffHelperId', String(helper.child.pid), '-HandoffParentId', String(mainPid),
      ], safeEnv)
      if (observer.child.pid === undefined) throw new Error('Handoff observer has no PID.')
      roots.add(observer.child.pid)
      await waitForReady(observer, 'DSH_HANDOFF_OBSERVER_READY')
      await captureOwned()
      expect((await processes()).filter(row => row.ParentProcessId === helper!.child.pid
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
      await expect.poll(() => helper!.closed, { timeout: 15_000 }).toBe(true)
      expect(helper.failed).toBe(false)
      expect(helper.child.exitCode).toBe(0)
      expect(helper.child.signalCode).toBeNull()
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
      await clean(captureOwned)
      await clean(async () => { await stopChild(helper) })
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
