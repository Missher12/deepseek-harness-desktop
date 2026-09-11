import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'
import { redactLogText } from '../src/logging.ts'
import { classifyLinuxManagedRange, linuxDescendants, linuxDesktopEnvironment, linuxInstalledProbeSource, linuxLaunchRootPid, parseLinuxProcessStat, prepareLinuxDesktopEnvironment, processAlive, readLinuxProcessIdentity, startLinuxInstalledProbe, withLinuxWriterFixture } from './linux-writer-fixture.ts'
import type { LinuxInstalledProbe, LinuxProcessIdentity } from './linux-writer-fixture.ts'

const execFileAsync = promisify(execFile)
const executable = process.env.DSH_LINUX_DESKTOP_EXECUTABLE
const evidenceRoot = process.env.DSH_LINUX_EVIDENCE_ROOT
const diagnosticLimit = 64 * 1024

async function lifecycleTail(userData: string): Promise<string> {
  try {
    const file = await open(join(userData, 'logs/lifecycle.log'), 'r')
    try {
      const size = (await file.stat()).size
      const buffer = Buffer.alloc(Math.min(size, diagnosticLimit))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length))
      return redactLogText(buffer.subarray(0, bytesRead).toString('utf8'))
    } finally {
      await file.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[lifecycle not created]'
    throw error
  }
}

async function writerDescendants(pid: number): Promise<number[]> {
  const candidates = await linuxDescendants(pid)
  const writers = await Promise.all(candidates.map(async (candidate) => {
    try {
      const command = (await readFile(`/proc/${String(candidate)}/cmdline`, 'utf8')).split('\0')
      return command.includes('web') ? candidate : undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }))
  return writers.filter((pid): pid is number => pid !== undefined)
}

async function withDesktop(
  target: string,
  home: string,
  userData: string,
  diagnostics: string,
  run: (application: ElectronApplication, launchRootPid: number) => Promise<void>,
): Promise<void> {
  const env = linuxDesktopEnvironment(process.env, join(userData, 'isolated-host'), home)
  await prepareLinuxDesktopEnvironment(env)
  await mkdir(diagnostics, { recursive: true })
  let application: ElectronApplication
  try {
    application = await electron.launch({
      executablePath: target, chromiumSandbox: true,
      args: [`--user-data-dir=${userData}`, '--ozone-platform=x11'],
      cwd: home,
      env,
      timeout: 120_000,
    })
  } catch (error) {
    await writeFile(join(diagnostics, 'launch-failure.json'), JSON.stringify({
      error: redactLogText(String(error)).slice(-diagnosticLimit),
      lifecycleTail: await lifecycleTail(userData),
    }) + '\n')
    throw error
  }
  const child = application.process()
  const tracked = new Set<number>()
  if (child.pid !== undefined) tracked.add(child.pid)
  let stderr = ''
  const events: Array<{ event: string; code?: number | null; signal?: NodeJS.Signals | null }> = []
  const onStderr = (chunk: Buffer | string) => { stderr = (stderr + chunk.toString()).slice(-diagnosticLimit) }
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => { events.push({ event: 'exit', code, signal }) }
  const onClose = (code: number | null, signal: NodeJS.Signals | null) => { events.push({ event: 'close', code, signal }) }
  child.stderr?.on('data', onStderr)
  child.once('exit', onExit)
  child.once('close', onClose)
  const observeTree = async () => {
    for (const rootPid of [...tracked]) {
      for (const pid of await linuxDescendants(rootPid)) tracked.add(pid)
    }
  }
  const saveDiagnostics = async (stage: string) => {
    await writeFile(join(diagnostics, `${stage}.json`), JSON.stringify({
      launchRootPid: child.pid, rootIdentity: 'launched process tree root; may be an AppImage wrapper',
      exitCode: child.exitCode, signalCode: child.signalCode, events,
      ownedProcesses: [...tracked].map(pid => ({ pid, alive: processAlive(pid) })),
      stderrScope: 'after electron.launch returned', stderrTail: redactLogText(stderr),
      lifecycleTail: await lifecycleTail(userData),
    }, null, 2) + '\n')
  }
  try {
    const rootPid = linuxLaunchRootPid(application)
    await run(application, rootPid)
    linuxLaunchRootPid(application)
  } catch (error) {
    await observeTree()
    await saveDiagnostics('failure-before-cleanup')
    throw error
  } finally {
    try {
      await observeTree()
      await application.close()
      await expect.poll(() => [...tracked].filter(processAlive), { timeout: 20_000 }).toEqual([])
      expect(child.exitCode).toBe(0)
      expect(child.signalCode).toBeNull()
    } finally {
      try {
        // Record spontaneous exit/remaining processes before any failure cleanup signals.
        try {
          await saveDiagnostics('before-forced-cleanup')
        } finally {
          for (const pid of [...tracked].filter(processAlive)) {
            try { process.kill(pid, 'SIGKILL') } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
            }
          }
          await expect.poll(() => [...tracked].filter(processAlive), { timeout: 10_000 }).toEqual([])
          await saveDiagnostics('after-cleanup')
        }
      } finally {
        child.stderr?.off('data', onStderr)
        child.off('exit', onExit)
        child.off('close', onClose)
      }
    }
  }
}

describe('Ubuntu packaged ownership with a simulated existing writer', () => {
  it.skipIf(process.platform !== 'linux' || executable === undefined)(
    'uses real process/FD discovery, rejects the same home and allows a separate home',
    async () => {
      if (executable === undefined || evidenceRoot === undefined) throw new Error('Linux native inputs are missing')
      expect(process.getuid?.()).not.toBe(0)
      const output = join(evidenceRoot, 'ownership')
      await mkdir(output, { recursive: true })
      let phase = 'fixture-readiness'
      try {
        await withLinuxWriterFixture(async (fixture) => {
          const unchanged = await readFile(fixture.sentinel)
          const assertWriterPreserved = async () => {
            expect(processAlive(fixture.pid)).toBe(true)
            const { stdout } = await execFileAsync('/usr/bin/lsof', ['-Fn', '-p', String(fixture.pid)])
            expect(stdout.split('\n')).toContain(`n${fixture.sentinel}`)
            expect(await readFile(fixture.sentinel)).toEqual(unchanged)
          }
          await assertWriterPreserved()
          phase = 'same-home'
          await withDesktop(executable, fixture.home, join(fixture.root, 'same-electron'), join(output, 'same-home'), async (application, pid) => {
            const page = await application.firstWindow()
            await page.waitForURL(url => url.protocol === 'file:'
              && url.searchParams.get('reason') === 'runtime-conflict', { timeout: 30_000 })
            expect(await page.locator('#reason').innerText()).toContain('同一数据目录')
            expect(await writerDescendants(pid)).toEqual([])
            const lifecycle = await readFile(join(fixture.root, 'same-electron/logs/lifecycle.log'), 'utf8')
            expect(lifecycle).toContain(`runtime conflict pid=${String(fixture.pid)}`)
            expect(lifecycle).not.toContain('startup fallback-ready:')
            await page.screenshot({ path: join(output, 'same-home.png') })
          })
          await assertWriterPreserved()
          phase = 'separate-home'
          const separateHome = join(fixture.root, 'separate-home')
          await mkdir(separateHome)
          await withDesktop(executable, separateHome, join(fixture.root, 'separate-electron'), join(output, 'separate-home'), async (application, pid) => {
            const page = await application.firstWindow()
            await page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 120_000 })
            expect((await writerDescendants(pid)).length).toBeGreaterThan(0)
            await page.screenshot({ path: join(output, 'separate-home.png') })
          })
          await assertWriterPreserved()
          phase = 'fixture-cleanup'
        })
        await writeFile(join(output, 'native.json'), JSON.stringify({
          schemaVersion: 1, candidateRevision: process.env.CANDIDATE_SHA,
          scope: 'real kernel and packaged Desktop with simulated existing writer',
          realExternalWebService: 'not-tested', sameHomeConflict: 'passed',
          noAdditionalWriterOnConflict: true, separateHomeStartup: 'passed',
          existingWriterPreserved: true, sentinelUnchanged: true,
          ownedProcessTreeRemaining: 0, fixtureCleanup: 'passed', display: 'X11/Xvfb',
        }, null, 2) + '\n')
      } catch (error) {
        await writeFile(join(output, 'failure.json'), JSON.stringify({
          phase, errorName: error instanceof Error ? error.name : 'UnknownError',
        }) + '\n')
        throw error
      }
    // Two bounded launches/readiness waits plus quiescent teardown fit inside this budget.
    }, 480_000,
  )
})

async function ownedIdentity(pid: number): Promise<LinuxProcessIdentity> {
  const identity = await readLinuxProcessIdentity(pid)
  if (identity === undefined) throw new Error('Managed process exited before ownership observation')
  return identity
}

async function groupMembers(processGroupId: number): Promise<number[]> {
  const members: number[] = []
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/u.test(name)) continue
    try {
      const value = await readFile(`/proc/${name}/stat`, 'utf8')
      if (parseLinuxProcessStat(Number(name), value, '').processGroupId === processGroupId) members.push(Number(name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return members
}

interface ObservedManagedRange {
  identities: [LinuxProcessIdentity, LinuxProcessIdentity]
  range: ReturnType<typeof classifyLinuxManagedRange>
}

async function observeManagedRange(path: string, ownerPid: number): Promise<ObservedManagedRange> {
  let tree: { root: number; descendant: number } | undefined
  await expect.poll(async () => {
    const value = JSON.parse(await readFile(path, 'utf8')) as { root: number; descendant: number }
    if (![value.root, value.descendant].every(pid => Number.isSafeInteger(pid) && pid > 0)) return false
    tree = value
    return true
  }, { timeout: 30_000 }).toBe(true)
  if (tree === undefined) throw new Error('Managed tree was not observed')
  const identities: [LinuxProcessIdentity, LinuxProcessIdentity] = [await ownedIdentity(tree.root), await ownedIdentity(tree.descendant)]
  return { identities, range: classifyLinuxManagedRange(identities[0], identities[1], ownerPid) }
}

async function assertRangeEmpty(observed: ObservedManagedRange): Promise<'empty' | 'removed'> {
  await expect.poll(
    async () => (await Promise.all(observed.identities.map(identity => readLinuxProcessIdentity(identity.pid)))).filter(Boolean),
    { timeout: 15_000 },
  ).toEqual([])
  if (observed.range.mode === 'pgid-fallback') {
    await expect.poll(() => groupMembers(observed.identities[0].processGroupId), { timeout: 15_000 }).toEqual([])
    return 'empty'
  }
  const unified = observed.identities[0].cgroup.split('\n').find(line => line.startsWith('0::'))?.slice(3)
  if (unified === undefined) throw new Error('Native scope lacks unified cgroup evidence')
  try {
    expect((await readFile(join('/sys/fs/cgroup', unified, 'cgroup.procs'), 'utf8')).trim()).toBe('')
    return 'empty'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return 'removed'
  }
}

function rangeReceipt(observed: ObservedManagedRange, kernelRangeAfter: string): Record<string, unknown> {
  return {
    ...observed.range, observed: observed.identities, kernelRangeAfter,
    nativeScope: observed.range.mode === 'systemd-user' ? 'passed' : 'not-exercised',
    fallbackLimitation: observed.range.mode === 'pgid-fallback'
      ? 'descendants escaping the process group are outside this guarantee' : null,
  }
}

describe('Ubuntu installed Session lock and managed subprocess ownership', () => {
  it.skipIf(process.platform !== 'linux' || executable === undefined)(
    'contends on the actual Session lease and empties the observed native scope or fallback group',
    async () => {
      if (executable === undefined || evidenceRoot === undefined) throw new Error('Linux native inputs are missing')
      const root = await mkdtemp(join(tmpdir(), 'dsh-linux-installed-ownership-'))
      const output = join(evidenceRoot, 'kernel-ownership')
      await mkdir(output, { recursive: true })
      const home = join(root, 'desktop-home')
      const sessions = join(root, 'session-store')
      await mkdir(home)
      await mkdir(sessions)
      let phase = 'installed-desktop'
      try {
        let receipt: Record<string, unknown> | undefined
        await withDesktop(executable, home, join(root, 'electron'), join(output, 'desktop'), async (application) => {
          const page = await application.firstWindow()
          await page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 120_000 })
          const runtime = await application.evaluate(({ app }) => ({
            executable: process.execPath, appPath: app.getAppPath(), electron: process.versions.electron,
            home: process.env.HOME, userProfile: process.env.USERPROFILE,
          }))
          expect(runtime.appPath.endsWith('.asar')).toBe(true)
          expect(runtime.home).toBe(join(root, 'electron', 'isolated-host', 'user-home'))
          expect(runtime.userProfile).toBe(runtime.home)
          const modules = join(`${runtime.appPath}.unpacked`, 'node_modules')
          const probes: LinuxInstalledProbe[] = []
          const identities: LinuxProcessIdentity[] = []
          let failure: unknown
          try {
            phase = 'installed-runtime-probes'
            const holder = await startLinuxInstalledProbe(runtime.executable, modules, join(root, 'holder'), sessions)
            probes.push(holder)
            const contender = await startLinuxInstalledProbe(runtime.executable, modules, join(root, 'contender'), sessions)
            probes.push(contender)
            expect(holder.ready.electron).toBe(runtime.electron)
            expect(contender.ready.electron).toBe(runtime.electron)
            expect(holder.ready.home).toBe(join(root, 'holder', 'user-home'))
            expect(holder.ready.userProfile).toBe(holder.ready.home)
            expect(contender.ready.home).toBe(join(root, 'contender', 'user-home'))
            expect(contender.ready.userProfile).toBe(contender.ready.home)
            const sourceSha256 = createHash('sha256').update(linuxInstalledProbeSource).digest('hex')
            expect(holder.ready.sourceSha256).toBe(sourceSha256)
            expect(contender.ready.sourceSha256).toBe(sourceSha256)
            expect(holder.ready.installedRunner).toBe('present')
            expect(contender.ready.installedRunner).toBe('present')
            expect(holder.pid).not.toBe(contender.pid)
            phase = 'session-lock-contention'
            expect(await holder.request('hold')).toEqual({ holding: true })
            const files = await readdir(sessions, { recursive: true })
            const lockFiles = files.filter(file => file.endsWith('session.lock'))
            const logs = files.filter(file => file.endsWith(`session.v${String(holder.ready.sessionFormat)}.jsonl`))
            expect(lockFiles).toHaveLength(1)
            expect(logs).toHaveLength(1)
            const lockPath = join(sessions, lockFiles[0]!)
            const logPath = join(sessions, logs[0]!)
            const before = await readFile(logPath)
            const lockBefore = await stat(lockPath)
            expect(await contender.request('contend')).toEqual({ blocked: true, sequences: [0, 1] })
            expect(await readFile(logPath)).toEqual(before)
            phase = 'session-lock-release'
            expect(await holder.request('release')).toEqual({ released: true })
            expect(await contender.request('takeover')).toEqual({ sequences: [0, 1, 2] })
            expect((await readFile(logPath)).subarray(0, before.length)).toEqual(before)
            const lockAfter = await stat(lockPath)
            expect([lockAfter.dev, lockAfter.ino]).toEqual([lockBefore.dev, lockBefore.ino])

            phase = 'managed-range-observation'
            const treePath = join(root, 'managed-tree.json')
            expect(await holder.request('spawn-managed', treePath)).toEqual({ started: true })
            const terminatedRange = await observeManagedRange(treePath, holder.pid)
            identities.push(...terminatedRange.identities)
            phase = 'managed-range-termination'
            const stopped = await holder.request('stop-managed')
            expect(stopped.empty).toBe(true)
            const terminatedAfter = await assertRangeEmpty(terminatedRange)

            phase = 'managed-range-host-disposal'
            const exitTree = join(root, 'managed-exit-tree.json')
            expect(await holder.request('spawn-managed', exitTree)).toEqual({ started: true })
            const exitRange = await observeManagedRange(exitTree, holder.pid)
            identities.push(...exitRange.identities)
            expect(await holder.close()).toMatchObject({ exitCode: 0, signalCode: null })
            const exitedAfter = await assertRangeEmpty(exitRange)
            receipt = {
              schemaVersion: 1, candidateRevision: process.env.CANDIDATE_SHA,
              runtime: {
                electron: holder.ready.electron, node: holder.ready.node,
                sessionFormat: holder.ready.sessionFormat, homeIsolated: true, probeSourceSha256: sourceSha256,
                installedRunner: holder.ready.installedRunner,
              },
              scope: 'actual installed Electron and runtime packages',
              sessionLease: { contention: 'passed', concurrentRead: 'passed', releaseAndTakeover: 'passed', originalBytesPreserved: true, lockInodePreserved: true },
              managedRanges: [
                { trigger: 'terminate', ...rangeReceipt(terminatedRange, terminatedAfter), stopped },
                { trigger: 'host-disposal', ...rangeReceipt(exitRange, exitedAfter) },
              ],
              ownedProcessesRemaining: 0,
            }
          } catch (error) {
            failure = error
            await writeFile(join(output, 'failure-before-cleanup.json'), JSON.stringify({ phase, error: redactLogText(String(error)), identities }, null, 2) + '\n')
          } finally {
            const closed = await Promise.allSettled(probes.map(probe => probe.close()))
            for (const identity of identities) {
              const current = await readLinuxProcessIdentity(identity.pid)
              if (current?.startTime === identity.startTime) {
                try { process.kill(identity.pid, 'SIGKILL') } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
                }
              }
            }
            await expect.poll(
              async () => (await Promise.all(identities.map(identity => readLinuxProcessIdentity(identity.pid)))).filter(Boolean),
              { timeout: 15_000 },
            ).toEqual([])
            await writeFile(join(output, 'probe-cleanup.json'), JSON.stringify(closed.map(result => result.status === 'fulfilled'
              ? { status: result.status, ...result.value, stderr: redactLogText(result.value.stderr) }
              : { status: result.status, error: redactLogText(String(result.reason)) }), null, 2) + '\n')
            if (failure === undefined) {
              expect(closed).toHaveLength(2)
              for (const result of closed) {
                expect(result.status).toBe('fulfilled')
                if (result.status === 'fulfilled') expect(result.value).toMatchObject({ exitCode: 0, signalCode: null })
              }
            }
          }
          if (failure !== undefined) throw failure
        })
        if (receipt === undefined) throw new Error('Installed runtime receipt is missing')
        await writeFile(join(output, 'native.json'), JSON.stringify(receipt, null, 2) + '\n')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }, 360_000,
  )
})

function statFixture(pid: number, parent: number, group: number, name = 'process with ) spaces'): string {
  const fields = ['S', String(parent), String(group), ...Array<string>(16).fill('0'), '123456']
  return `${String(pid)} (${name}) ${fields.join(' ')}`
}

describe('Linux kernel ownership classification', () => {
  it.skipIf(process.platform === 'win32')('keeps IPC errors recoverable and reaps a source-only probe controller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-linux-probe-protocol-'))
    let probe: LinuxInstalledProbe | undefined
    try {
      const modules = join(root, 'node_modules')
      // Only the IPC/resource owner is tested here; these are not native runtime substitutes.
      const fixtures: Record<string, string> = {
        cordis: 'export class Context { fiber = { dispose: async () => {} }; sessionPersistence = { create: async () => { throw new Error("source fixture refusal") } }; async plugin() {} }',
        'dsh-session': 'export const SESSION_FORMAT_VERSION = 3',
        'dsh-session-persistence': 'export class SessionAlreadyOwnedError extends Error {}',
        'dsh-session-persistence-jsonl': 'export default class {}',
        'dsh-subprocess-local': 'export default class {}',
      }
      for (const [name, source] of Object.entries(fixtures)) {
        const directory = join(modules, '@deepseek-ai', name)
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }))
        await writeFile(join(directory, 'index.js'), source)
        if (name === 'dsh-subprocess-local') await writeFile(join(directory, 'runner.js'), '// source-only path fixture\n')
      }
      probe = await startLinuxInstalledProbe(process.execPath, modules, join(root, 'probe'), join(root, 'sessions'))
      await expect(probe.request('hold')).rejects.toThrow('source fixture refusal')
      expect(processAlive(probe.pid)).toBe(true)
      expect(await probe.close()).toMatchObject({ exitCode: 0, signalCode: null })
      expect(processAlive(probe.pid)).toBe(false)
    } finally {
      await probe?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
  it('parses the generated installed-runtime fixture without executing it', () => {
    execFileSync(process.execPath, ['--check', '--input-type=module'], {
      input: linuxInstalledProbeSource, env: { PATH: process.env.PATH }, timeout: 10_000,
    })
  })
  it('parses a kernel start identity independently of spaces and parentheses in the command name', () => {
    expect(parseLinuxProcessStat(23, statFixture(23, 12, 23), '0::/group')).toMatchObject({ pid: 23, parentPid: 12, processGroupId: 23, startTime: '123456' })
    expect(() => parseLinuxProcessStat(24, statFixture(23, 12, 23), '')).toThrow('identity')
    expect(() => parseLinuxProcessStat(23, '23 (truncated) S', '')).toThrow('identity')
  })
  it('reports PGID fallback separately and rejects a child outside its group', () => {
    const root = parseLinuxProcessStat(23, statFixture(23, 12, 23), '0::/user.slice')
    const child = parseLinuxProcessStat(24, statFixture(24, 23, 23), '0::/user.slice')
    expect(classifyLinuxManagedRange(root, child, 12)).toEqual({ mode: 'pgid-fallback', unit: null })
    expect(() => classifyLinuxManagedRange(root, { ...child, processGroupId: 24 }, 12)).toThrow('fallback')
  })
  it('requires the observed owner scope to retain a detached descendant', () => {
    const cgroup = '0::/user.slice/dsh-subprocess-12-abcdef123456.scope\n'
    const root = parseLinuxProcessStat(23, statFixture(23, 12, 23), cgroup)
    const child = parseLinuxProcessStat(24, statFixture(24, 23, 24), cgroup)
    expect(classifyLinuxManagedRange(root, child, 12)).toEqual({ mode: 'systemd-user', unit: 'dsh-subprocess-12-abcdef123456.scope' })
    expect(() => classifyLinuxManagedRange(root, { ...child, cgroup: '0::/unrelated' }, 12)).toThrow('scope')
    expect(() => classifyLinuxManagedRange(root, child, 99)).toThrow('fallback')
  })
})
