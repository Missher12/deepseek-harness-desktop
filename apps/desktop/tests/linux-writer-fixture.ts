import { fork } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** An isolated simulated writer, not a running Harness Web service. */
export interface LinuxWriterFixture {
  root: string
  home: string
  sentinel: string
  pid: number
}

/** Keep Linux display access while isolating account state, providers and injected runtime flags. */
export function linuxDesktopEnvironment(
  inherited: NodeJS.ProcessEnv,
  root: string,
  harnessHome: string,
): Record<string, string> {
  const forwarded: Record<string, string> = {}
  for (const key of ['PATH', 'DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL', 'TZ']) {
    const value = inherited[key]
    if (value !== undefined) forwarded[key] = value
  }
  const temporary = join(root, 'tmp')
  return {
    ...forwarded,
    HOME: join(root, 'user-home'), USERPROFILE: join(root, 'user-home'),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'),
    TMPDIR: temporary, TMP: temporary, TEMP: temporary,
    DSH_HOME: harnessHome, DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_BASE_URL: 'http://127.0.0.1:1/v1',
  }
}

/** Check a PID without masking permission errors. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** Read the supported launch-process identity, which can be an AppImage wrapper, without inspector evaluation. */
export function linuxLaunchRootPid(
  application: { process(): { pid?: number | undefined; exitCode: number | null; signalCode: NodeJS.Signals | null } },
  isAlive: (pid: number) => boolean = processAlive,
): number {
  const child = application.process()
  if (child.pid === undefined || !Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error('Linux launch process PID is missing or invalid')
  }
  if (child.exitCode !== null || child.signalCode !== null || !isAlive(child.pid)) {
    throw new Error('Linux launch process exited before the native scenario completed')
  }
  return child.pid
}

/** Read descendants of an owned Linux process; exited processes have no children. */
export async function linuxDescendants(pid: number): Promise<number[]> {
  let children: string
  try {
    children = await readFile(`/proc/${String(pid)}/task/${String(pid)}/children`, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const direct = children.trim().split(/\s+/u).filter(Boolean).map(Number)
  return [...direct, ...(await Promise.all(direct.map(linuxDescendants))).flat()]
}

/** Own a real process and open FD through readiness, callback failure and quiescent cleanup. */
export async function withLinuxWriterFixture<T>(run: (fixture: LinuxWriterFixture) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-linux-writer-'))
  try {
    const home = join(root, 'held-home')
    const sentinel = join(home, 'writer-sentinel')
    const entry = join(root, 'dsh')
    await mkdir(home)
    await writeFile(sentinel, 'owned writer data\n')
    // The exact executable name and web argument exercise production process recognition.
    await writeFile(entry, `
const fs = require('node:fs')
const descriptor = fs.openSync(process.argv[3], 'r')
function stop() {
  fs.closeSync(descriptor)
  process.disconnect()
}
process.once('SIGTERM', stop)
process.once('message', stop)
process.send({ ready: true })
`)
    const child = fork(entry, ['web', sentinel], {
      execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { PATH: process.env.PATH },
    })
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('close', (code, signal) => { resolve({ code, signal }) })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { finish(new Error('Simulated writer readiness timed out')) }, 10_000)
        const onError = (error: Error) => { finish(error) }
        const onExit = () => { finish(new Error('Simulated writer exited before readiness')) }
        const onMessage = (message: unknown) => {
          if (typeof message === 'object' && message !== null && 'ready' in message && message.ready === true) finish()
        }
        function finish(error?: Error): void {
          clearTimeout(timer)
          child.off('error', onError)
          child.off('exit', onExit)
          child.off('message', onMessage)
          if (error !== undefined) reject(error)
          else resolve()
        }
        child.once('error', onError)
        child.once('exit', onExit)
        child.on('message', onMessage)
      })
      if (child.pid === undefined) throw new Error('Simulated writer PID is missing')
      return await run({ root, home, sentinel, pid: child.pid })
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      const deadline = setTimeout(() => { child.kill('SIGKILL') }, 5_000)
      try {
        const result = await closed
        if (result.code !== 0 || result.signal !== null) throw new Error('Simulated writer did not exit cleanly')
      } finally {
        clearTimeout(deadline)
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Create account directories before an isolated native launch. @param env - Account paths owned by this fixture. */
export async function prepareLinuxDesktopEnvironment(env: Readonly<Record<string, string>>): Promise<void> {
  for (const key of ['HOME', 'USERPROFILE', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
    const directory = env[key]
    if (directory === undefined) throw new Error(`Missing isolated Linux environment path: ${key}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }
}

/** Kernel identity retained before teardown to avoid signalling a reused PID. */
export interface LinuxProcessIdentity {
  pid: number
  parentPid: number
  processGroupId: number
  startTime: string
  cgroup: string
}

/**
 * Parse an observed kernel identity.
 * @param pid - Expected process ID.
 * @param value - Its /proc stat row.
 * @param cgroup - Its observed cgroup membership.
 * @returns Identity retained for ownership checks and safe failure cleanup.
 */
export function parseLinuxProcessStat(pid: number, value: string, cgroup: string): LinuxProcessIdentity {
  const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/u)
  const parentPid = Number(fields[1])
  const processGroupId = Number(fields[2])
  const startTime = fields[19]
  if (!Number.isSafeInteger(pid) || pid <= 0 || !value.startsWith(`${String(pid)} (`)
    || !Number.isSafeInteger(parentPid) || parentPid < 0 || !Number.isSafeInteger(processGroupId) || processGroupId <= 0
    || startTime === undefined || !/^\d+$/u.test(startTime)) throw new Error('Invalid owned Linux process identity')
  return { pid, parentPid, processGroupId, startTime, cgroup }
}

/**
 * Read a kernel identity; only an exited process may be absent.
 * @param pid - Owned process to inspect.
 * @returns The observed identity, or undefined after exit.
 */
export async function readLinuxProcessIdentity(pid: number): Promise<LinuxProcessIdentity | undefined> {
  try {
    return parseLinuxProcessStat(pid, await readFile(`/proc/${String(pid)}/stat`, 'utf8'), await readFile(`/proc/${String(pid)}/cgroup`, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Classify an actual owned range; reject unrelated scopes and escaped fallback children.
 * @param root - Managed command identity.
 * @param descendant - Its observed child identity.
 * @param ownerPid - Installed runtime that created the scope.
 * @returns The observed native scope or PGID fallback, without claiming unsupported scope coverage.
 */
export function classifyLinuxManagedRange(
  root: LinuxProcessIdentity, descendant: LinuxProcessIdentity, ownerPid: number,
): { mode: 'systemd-user' | 'pgid-fallback'; unit: string | null } {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0 || descendant.parentPid !== root.pid) {
    throw new Error('Managed descendant is not owned by the observed root')
  }
  const scope = new RegExp(`/(dsh-subprocess-${String(ownerPid)}-[a-f0-9]{12}\\.scope)(?:/|$)`, 'u')
  const unit = scope.exec(root.cgroup.trim())?.[1]
  if (unit !== undefined) {
    if (scope.exec(descendant.cgroup.trim())?.[1] !== unit || descendant.processGroupId === root.processGroupId) {
      throw new Error('Native scope did not retain the detached descendant')
    }
    return { mode: 'systemd-user', unit }
  }
  if (root.cgroup.includes('/dsh-subprocess-') || root.processGroupId !== root.pid || descendant.processGroupId !== root.pid) {
    throw new Error('PGID fallback did not retain its owned descendant')
  }
  return { mode: 'pgid-fallback', unit: null }
}

/** Installed-runtime fixture: no source imports, profile changes, or test overrides of the provider. */
export const linuxInstalledProbeSource = String.raw`
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const entry = fileURLToPath(import.meta.url)
const [role, modules, root, sessionId] = process.argv.slice(2)
if (role === 'leaf') {
  process.on('SIGTERM', () => {})
  process.on('SIGHUP', () => {})
  setInterval(() => {}, 60_000)
  process.send({ ready: true })
} else if (role === 'target') {
  const cgroup = await readFile('/proc/self/cgroup', 'utf8')
  const detached = cgroup.includes('/dsh-subprocess-' + root + '-')
  process.on('SIGTERM', () => {})
  process.on('SIGHUP', () => {})
  const child = fork(entry, ['leaf'], { execArgv: [], detached, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  child.once('error', error => { throw error })
  child.once('message', async () => {
    const pending = modules + '.pending'
    await writeFile(pending, JSON.stringify({ root: process.pid, descendant: child.pid }), { mode: 0o600 })
    await rename(pending, modules)
  })
  setInterval(() => {}, 60_000)
} else {
  if (!(await lstat(modules)).isDirectory()) throw new Error('Installed modules must be a physical directory')
  const physicalModules = await realpath(modules)
  const require = createRequire(join(physicalModules, '__linux-native-probe__.cjs'))
  async function installedPath(name) {
    const path = await realpath(require.resolve(name))
    if (!path.startsWith(physicalModules + sep)) throw new Error('Probe resolved outside installed modules: ' + name)
    return path
  }
  async function load(name) { return import(pathToFileURL(await installedPath(name)).href) }
  const { Context } = await load('@deepseek-ai/cordis')
  const { SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session')
  const { SessionAlreadyOwnedError } = await load('@deepseek-ai/dsh-session-persistence')
  const { default: JsonlSessionPersistence } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const { default: LocalSubprocessRuntime } = await load('@deepseek-ai/dsh-subprocess-local')
  await readFile(await installedPath('@deepseek-ai/dsh-subprocess-local/runner'))
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  let held
  let managed
  let runtimeLoaded = false
  async function stopManaged() {
    if (!managed) return { empty: true }
    managed.terminate()
    const [outcome, empty] = await Promise.all([managed.done, managed.waitForExit(AbortSignal.timeout(15_000))])
    if (!empty) throw new Error('Managed range did not become empty')
    return { empty, outcome }
  }
  process.on('message', async ({ id, operation, path }) => {
    try {
      let result = {}
      if (operation === 'hold') {
        held = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1000, cwd: root, isSeeded: false, delegationDepth: 0 }, { inheritedEventCount: 0 })
        await held.append([{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }, { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } }])
        result = { holding: true }
      } else if (operation === 'contend') {
        let blocked = false
        try { const unexpected = await ctx.sessionPersistence.open(sessionId, 'write'); await unexpected.close() }
        catch (error) { if (!(error instanceof SessionAlreadyOwnedError)) throw error; blocked = true }
        const reader = await ctx.sessionPersistence.open(sessionId, 'read')
        try { result = { blocked, sequences: (await reader.read()).events.map(event => event.seq) } }
        finally { await reader.close() }
      } else if (operation === 'release') {
        await held.close(); held = undefined; result = { released: true }
      } else if (operation === 'takeover') {
        const writer = await ctx.sessionPersistence.open(sessionId, 'write')
        try { await writer.append([{ type: 'turn/start', seq: 2, time: 3, data: { turn: 2 } }]); result = { sequences: (await writer.read()).events.map(event => event.seq) } }
        finally { await writer.close() }
      } else if (operation === 'spawn-managed') {
        if (!runtimeLoaded) { await ctx.plugin(LocalSubprocessRuntime); runtimeLoaded = true }
        managed = ctx.subprocess.spawn({ argv: [process.execPath, entry, 'target', path, String(process.pid)], cwd: root, env: { ELECTRON_RUN_AS_NODE: '1' }, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 100 })
        void managed.done.catch(() => {}) // stop-managed reports the original provider failure.
        result = { started: true }
      } else if (operation === 'stop-managed') result = await stopManaged()
      else if (operation === 'stop') {
        if (held) await held.close()
        // Normal host disposal must terminate and join live managed ranges itself.
        await ctx.fiber.dispose()
      } else throw new Error('Unknown native probe operation')
      process.send({ id, result })
      if (operation === 'stop') process.disconnect()
    } catch (error) {
      process.send({ id, error: (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 4000) })
    }
  })
  const sourceSha256 = createHash('sha256').update(await readFile(entry)).digest('hex')
  process.send({ id: 0, result: { ready: true, electron: process.versions.electron, node: process.versions.node, sessionFormat: SESSION_FORMAT_VERSION, home: process.env.HOME, userProfile: process.env.USERPROFILE, sourceSha256, installedRunner: 'present' } })
}
`

/** One independently running fixture using the installed Electron and runtime packages. */
export interface LinuxInstalledProbe {
  pid: number
  ready: Record<string, unknown>
  request(operation: 'hold' | 'contend' | 'release' | 'takeover' | 'spawn-managed' | 'stop-managed', path?: string): Promise<Record<string, unknown>>
  close(): Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null; stderr: string }>
}

/**
 * Start an installed-package fixture and retain ownership through its close event.
 * @param executable - Electron executable observed in the running packaged app.
 * @param modules - That app's physical unpacked node_modules directory.
 * @param root - Private fixture directory.
 * @param sessionRoot - Shared temporary Session root for lock contention.
 * @returns A ready IPC controller whose close awaits the owned process.
 */
export async function startLinuxInstalledProbe(
  executable: string, modules: string, root: string, sessionRoot: string,
): Promise<LinuxInstalledProbe> {
  const env = linuxDesktopEnvironment(process.env, root, join(root, 'harness'))
  await prepareLinuxDesktopEnvironment(env)
  const entry = join(root, 'installed-probe.mjs')
  await writeFile(entry, linuxInstalledProbeSource, { mode: 0o600 })
  const child = fork(entry, ['probe', modules, sessionRoot, 'linux-native-lease'], {
    execPath: executable, execArgv: ['--expose-internals'],
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, cwd: root,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-64 * 1024) })
  const pending = new Map<number, {
    resolve(value: Record<string, unknown>): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  }>()
  let sequence = 0
  let closeResult: { exitCode: number | null; signalCode: NodeJS.Signals | null } | undefined
  const closed = new Promise<void>((resolve) => {
    child.once('close', (exitCode, signalCode) => {
      closeResult = { exitCode, signalCode }
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Installed probe exited before response')) }
      pending.clear()
      resolve()
    })
  })
  child.on('error', (error) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear()
  })
  child.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('id' in message) || typeof message.id !== 'number') return
    const item = pending.get(message.id)
    if (item === undefined) return
    clearTimeout(item.timer); pending.delete(message.id)
    if ('error' in message) item.reject(new Error(String(message.error)))
    else if ('result' in message && typeof message.result === 'object' && message.result !== null) item.resolve(message.result as Record<string, unknown>)
    else item.reject(new Error('Invalid native probe response'))
  })
  const response = (id: number): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Installed probe response timed out')) }, 30_000)
    pending.set(id, { resolve, reject, timer })
  })
  const request = (operation: string, path?: string) => {
    const id = ++sequence
    const result = response(id)
    child.send({ id, operation, path }, (error) => {
      if (error === null) return
      const item = pending.get(id)
      if (item !== undefined) { clearTimeout(item.timer); pending.delete(id); item.reject(error) }
    })
    return result
  }
  const forceClose = async () => {
    if (closeResult === undefined) child.kill('SIGKILL')
    await closed
  }
  try {
    const ready = await response(0)
    if (child.pid === undefined || ready.ready !== true) throw new Error('Installed probe readiness is invalid')
    return {
      pid: child.pid, ready, request,
      async close() {
        try {
          if (closeResult === undefined) {
            await request('stop')
            const timer = setTimeout(() => { child.kill('SIGKILL') }, 10_000)
            try { await closed } finally { clearTimeout(timer) }
          }
        } finally { await forceClose() }
        if (closeResult === undefined) throw new Error('Installed probe close event is missing')
        return { ...closeResult, stderr }
      },
    }
  } catch (error) {
    await forceClose()
    throw new Error(`Installed probe failed before readiness: ${String(error)}\n${stderr}`, { cause: error })
  }
}
