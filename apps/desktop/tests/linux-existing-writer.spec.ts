import { execFile } from 'node:child_process'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'
import { redactLogText } from '../src/logging.ts'
import { linuxDescendants, linuxDesktopEnvironment, linuxLaunchRootPid, processAlive, withLinuxWriterFixture } from './linux-writer-fixture.ts'

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
  for (const key of ['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
    const directory = env[key]
    if (directory === undefined) throw new Error(`Missing isolated Linux environment path: ${key}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }
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
