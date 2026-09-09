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
