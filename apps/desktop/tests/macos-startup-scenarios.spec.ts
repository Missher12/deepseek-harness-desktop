import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'
import { parseDesktopStartupSample } from '../../../scripts/desktop-startup-benchmark.ts'
import { summarizeMacosStartupRuns, type MacosStartupRun } from '../../../scripts/macos-desktop-startup-benchmark.ts'

const execFileAsync = promisify(execFile)
const executable = process.env.DSH_MACOS_STARTUP_EXECUTABLE
const expectedAsar = process.env.DSH_MACOS_STARTUP_ASAR_SHA256
const sourceSha = process.env.DSH_MACOS_STARTUP_SOURCE_SHA
const outputRoot = resolve(import.meta.dirname, '../../../.artifacts/desktop-057-startup')
const repetitions = Number(process.env.DSH_MACOS_STARTUP_REPETITIONS ?? '1')

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const value of createReadStream(path)) {
    const chunk: unknown = value
    if (!Buffer.isBuffer(chunk)) throw new Error('native startup: invalid file stream')
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function processRows(): Promise<{ pid: number; parent: number }[]> {
  const { stdout } = await execFileAsync('/bin/ps', ['-A', '-o', 'pid=,ppid='])
  return stdout.trim().split('\n').map((line) => {
    const [pid, parent] = line.trim().split(/\s+/u).map(Number)
    if (pid === undefined || parent === undefined || !Number.isSafeInteger(pid) || !Number.isSafeInteger(parent)) {
      throw new Error('native startup: process inspection failed')
    }
    return { pid, parent }
  })
}

async function descendants(root: number): Promise<number[]> {
  const rows = await processRows()
  const found = new Set([root])
  for (;;) {
    const before = found.size
    rows.forEach((row) => { if (found.has(row.parent)) found.add(row.pid) })
    if (before === found.size) return [...found]
  }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

async function ownedPorts(pids: readonly number[]): Promise<number[]> {
  if (pids.length === 0) return []
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', [
      '-nP', '-a', '-p', pids.join(','), '-iTCP', '-sTCP:LISTEN', '-Fn',
    ])
    return [...new Set(stdout.split('\n').flatMap((line) => {
      const match = /^n.*:([0-9]+)$/u.exec(line)
      return match?.[1] === undefined ? [] : [Number(match[1])]
    }))]
  } catch (error) {
    if ((error as { code?: number }).code === 1) return []
    throw error
  }
}

async function listenerCount(ports: readonly number[]): Promise<number> {
  if (ports.length === 0) return 0
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', [
      '-nP', '-t', ...ports.flatMap(port => ['-iTCP:' + String(port)]), '-sTCP:LISTEN',
    ])
    return new Set(stdout.trim().split(/\s+/u).filter(Boolean)).size
  } catch (error) {
    if ((error as { code?: number }).code === 1) return 0
    throw error
  }
}

async function quitOwned(app: ElectronApplication | undefined, tracked: Set<number>): Promise<void> {
  if (app !== undefined) {
    const pid = app.process().pid
    if (pid !== undefined) tracked.add(pid)
    const closed = app.waitForEvent('close', { timeout: 15_000 })
    try {
      await app.evaluate(({ app: native }) => { native.quit() })
      await closed
    } catch {
      await closed.catch(() => undefined)
      await app.close().catch(() => undefined)
    }
  }
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    const alive = [...tracked].filter(isAlive)
    if (alive.length === 0) return
    for (const pid of alive) {
      try { process.kill(pid, signal) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    const deadline = Date.now() + 3000
    while ([...tracked].some(isAlive) && Date.now() < deadline) await delay(50)
  }
  expect([...tracked].filter(isAlive)).toEqual([])
}

async function measure(
  root: string, scenario: string, index: number, outputDirectory: string, cleanup: { verified: boolean },
): Promise<MacosStartupRun> {
  if (executable === undefined || expectedAsar === undefined || sourceSha === undefined) {
    throw new Error('native startup: missing artifact identity')
  }
  const home = join(root, 'home')
  const harnessHome = join(home, '.dsh')
  const userData = join(root, 'electron-data')
  const workspace = join(root, 'workspace')
  const temporary = join(root, 'tmp')
  await Promise.all([home, harnessHome, userData, workspace, temporary].map(path => mkdir(path, { recursive: true, mode: 0o700 })))
  const protectedPath = join(workspace, 'untouched.txt')
  await writeFile(protectedPath, 'owned-startup-fixture-preserve-me\n', 'utf8')
  const protectedBefore = await hashFile(protectedPath)
  const fixtureSha256 = createHash('sha256').update(`empty-profile-no-project-v1:${protectedBefore}`).digest('hex')
  const lifecyclePath = join(userData, 'logs', 'lifecycle.log')
  let logOffset = 0
  try { logOffset = (await readFile(lifecyclePath, 'utf8')).length } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const readStartup = async () => parseDesktopStartupSample((await readFile(lifecyclePath, 'utf8')).slice(logOffset))
  let stage = 'launch'
  let app: ElectronApplication | undefined
  const tracked = new Set<number>()
  const ports = new Set<number>()
  const before = new Set(await descendants(process.pid))
  let windowObservedMs = 0
  let composerReadyMs = 0
  let keyboardReadyMs = 0
  let onboardingMs = 0
  const start = performance.now()
  try {
    cleanup.verified = false
    app = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${userData}`], cwd: workspace,
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, DSH_HOME: harnessHome,
        TMPDIR: `${temporary}/`, XDG_CONFIG_HOME: join(home, '.config'),
        XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'),
        LANG: 'en_US.UTF-8', TZ: 'UTC', DSH_TELEMETRY_DISABLED: '1',
        MISSHER_TENCENTDB_DIR: join(root, 'unconfigured-memory'),
      }, timeout: 60_000,
    })
    const appPid = app.process().pid
    if (appPid === undefined) throw new Error('native startup: missing app PID')
    tracked.add(appPid)
    const page = await app.firstWindow({ timeout: 30_000 })
    windowObservedMs = Math.round(performance.now() - start)
    stage = 'onboarding'
    const notice = page.getByRole('dialog', { name: /^(?:Internal Testing Notice|内测声明)$/u })
    const configureLater = page.getByRole('button', { name: /^(?:Configure later|稍后配置)$/u })
    if (scenario === 'fresh' || index === 0) {
      await notice.waitFor({ state: 'visible', timeout: 30_000 })
      const began = performance.now()
      await notice.getByRole('button', { name: /^(?:Continue|继续)$/u }).click()
      await notice.waitFor({ state: 'detached', timeout: 15_000 })
      await configureLater.waitFor({ state: 'visible', timeout: 30_000 })
      await configureLater.click()
      await configureLater.waitFor({ state: 'detached', timeout: 15_000 })
      onboardingMs += performance.now() - began
    }
    const chooseTarget = page.getByRole('textbox', { name: /^(?:Choose workspace|选择工作区)$/u })
    const composer = page.locator('[data-composer-input][contenteditable="true"]:not([aria-disabled="true"])').last()
    const readyDeadline = Date.now() + 45_000
    for (;;) {
      if (Date.now() >= readyDeadline) throw new Error('native startup: input readiness deadline')
      const began = performance.now()
      if (await notice.isVisible()) {
        await notice.getByRole('button', { name: /^(?:Continue|继续)$/u }).click()
        await notice.waitFor({ state: 'detached', timeout: 15_000 })
      } else if (await configureLater.isVisible()) {
        await configureLater.click()
        await configureLater.waitFor({ state: 'detached', timeout: 15_000 })
      } else if (await chooseTarget.isVisible()) {
        await chooseTarget.click()
        await page.getByRole('menuitem', { name: /^(?:No project|不在项目中)$/u }).click()
        await chooseTarget.waitFor({ state: 'detached', timeout: 15_000 })
      } else if (await composer.isVisible() && await page.getByRole('dialog').count() === 0) {
        break
      } else {
        await delay(50)
        continue
      }
      onboardingMs += performance.now() - began
    }
    stage = 'composer'
    await composer.click()
    composerReadyMs = Math.round(performance.now() - start)
    stage = 'keyboard'
    await page.keyboard.type('mac-startup-local-probe')
    await expect.poll(() => composer.innerText()).toContain('mac-startup-local-probe')
    await page.evaluate(() => new Promise<void>((resolveFrame) => {
      requestAnimationFrame(() => { requestAnimationFrame(() => { resolveFrame() }) })
    }))
    keyboardReadyMs = Math.round(performance.now() - start)
    await page.keyboard.press('Meta+A')
    await page.keyboard.press('Backspace')
    await expect.poll(() => composer.textContent()).toBe('')
    stage = 'ready'
    const pid = app.process().pid
    if (pid === undefined) throw new Error('native startup: missing app PID')
    ;(await descendants(pid)).forEach(value => tracked.add(value))
    ;(await ownedPorts([...tracked])).forEach(value => ports.add(value))
  } catch (error) {
    console.info(JSON.stringify({ event: 'native-startup-failed', scenario, index, stage, kind: error instanceof Error ? error.name : 'unknown' }))
    const startup = await readStartup().catch(() => null)
    await writeFile(join(outputDirectory, `${scenario}-${String(index)}-failure.json`), `${JSON.stringify({
      event: 'native-startup-failed', scenario, index, stage, startup,
      windowObservedMs, composerReadyMs, keyboardReadyMs, onboardingMs: Math.round(onboardingMs),
    }, null, 2)}\n`, 'utf8')
    throw new Error(`native startup: failed at ${stage}`, { cause: error })
  } finally {
    try {
      ;(await descendants(process.pid)).filter(pid => !before.has(pid)).forEach(pid => tracked.add(pid))
      ;(await ownedPorts([...tracked])).forEach(port => ports.add(port))
    } finally {
      await quitOwned(app, tracked)
    }
    await expect.poll(() => [...tracked].filter(isAlive), { timeout: 15_000 }).toEqual([])
    await expect.poll(() => listenerCount([...ports]), { timeout: 15_000 }).toBe(0)
    expect(await hashFile(protectedPath)).toBe(protectedBefore)
    cleanup.verified = true
    console.info(JSON.stringify({ event: 'native-startup-cleanup', scenario, index, remainingProcesses: 0, remainingListeners: 0 }))
  }
  const startup = await readStartup()
  return {
    sourceSha, appSha256: expectedAsar, scenario, fixtureSha256, startup,
    windowObservedMs, composerReadyMs, keyboardReadyMs, onboardingMs: Math.round(onboardingMs),
    remainingProcesses: 0, remainingListeners: 0, protectedDataUnchanged: true,
  }
}

describe.skipIf(process.platform !== 'darwin' || executable === undefined)('macOS packaged startup scenarios', () => {
  it('measures input and keyboard readiness on a pristine isolated profile', async () => {
    expect(sourceSha).toMatch(/^[0-9a-f]{40}$/u)
    expect(expectedAsar).toMatch(/^[0-9a-f]{64}$/u)
    expect([1, 10]).toContain(repetitions)
    const binary = await realpath(executable!)
    expect(binary.startsWith('/private/tmp/dsh-macos-startup-mount-')).toBe(true)
    const asar = resolve(binary, '../../Resources/app.asar')
    expect(await hashFile(asar)).toBe(expectedAsar)
    await mkdir(outputRoot, { recursive: true })
    const outputDirectory = await mkdtemp(join(outputRoot, 'fresh-'))
    console.info(JSON.stringify({ event: 'native-startup-output', directory: relative(outputRoot, outputDirectory) }))
    const samples: MacosStartupRun[] = []
    for (let index = 0; index < repetitions; index += 1) {
      const root = await mkdtemp(join(tmpdir(), 'dsh-macos-startup-fixture-'))
      const cleanup = { verified: true }
      try {
        const sample = await measure(root, 'fresh', index, outputDirectory, cleanup)
        samples.push(sample)
        await writeFile(join(outputDirectory, `fresh-${String(index)}.json`), `${JSON.stringify(sample, null, 2)}\n`, 'utf8')
        console.info(JSON.stringify({ event: 'native-startup-sample', index, composerReadyMs: sample.composerReadyMs, keyboardReadyMs: sample.keyboardReadyMs, desktopRunningMs: sample.startup['desktop-running'] }))
      } finally {
        if (cleanup.verified) await rm(root, { recursive: true, force: true })
      }
    }
    if (samples.length === 10) {
      await writeFile(join(outputDirectory, 'fresh-summary.json'), `${JSON.stringify(summarizeMacosStartupRuns(samples), null, 2)}\n`, 'utf8')
    }
  }, 600_000)
})
