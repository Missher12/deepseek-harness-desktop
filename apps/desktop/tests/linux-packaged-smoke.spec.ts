import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { assertLinuxSandbox } from '../../../scripts/linux-desktop-sandbox.ts'
import { runPackagedDesktopSmoke } from './packaged-smoke.ts'
import { linuxDescendants as descendants, linuxDesktopEnvironment, prepareLinuxDesktopEnvironment, processAlive as alive } from './linux-writer-fixture.ts'
import type {} from '../src/preload-api.ts'

const execFileAsync = promisify(execFile)
const executable = process.env.DSH_LINUX_DESKTOP_EXECUTABLE
const evidenceRoot = process.env.DSH_LINUX_EVIDENCE_ROOT
const expectedPackageFormat = process.env.DSH_LINUX_PACKAGE_FORMAT

async function verifyNativeUpdateStatus(page: Page, directory: string): Promise<void> {
  if (expectedPackageFormat !== 'deb' && expectedPackageFormat !== 'appimage') {
    throw new Error('Linux native package format expectation is required')
  }
  const metadata = JSON.parse(await readFile(new URL('../update-metadata.json', import.meta.url), 'utf8')) as {
    desktopVersion: unknown
    harnessVersion: unknown
  }
  if (typeof metadata.desktopVersion !== 'string' || typeof metadata.harnessVersion !== 'string') {
    throw new Error('Linux candidate version metadata is invalid')
  }
  const expected = {
    platform: 'linux', arch: 'x64', packageFormat: expectedPackageFormat,
    installAction: 'reveal-package', supportReason: null,
    runningDesktop: metadata.desktopVersion, includedHarness: metadata.harnessVersion,
  }
  const readStatus = async () => await page.evaluate(async () => {
    if (typeof window.dshDesktop?.getUpdateStatus !== 'function') throw new Error('Native update status bridge is missing')
    const value: unknown = await window.dshDesktop.getUpdateStatus()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Native update status is invalid')
    const status = value as Record<string, unknown>
    // Retain only these non-sensitive observations from the real, unmodified bridge.
    return {
      phase: status.phase, platform: status.platform, arch: status.arch,
      packageFormat: status.packageFormat, installAction: status.installAction,
      supportReason: status.supportReason, runningDesktop: status.runningDesktop,
      includedHarness: status.includedHarness,
    }
  })
  let observed: Awaited<ReturnType<typeof readStatus>> | undefined
  await expect.poll(async () => {
    observed = await readStatus()
    return {
      ...observed,
      detecting: observed.phase === 'detecting' || observed.supportReason === 'detecting',
    }
  }, { timeout: 30_000 }).toMatchObject({ ...expected, detecting: false })
  expect(typeof observed?.phase).toBe('string')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'system-update-native.json'), JSON.stringify({
    schemaVersion: 1, status: 'passed', observation: 'native no-argument getUpdateStatus bridge',
    expected, observed, futureUpdateDownloadOrInstall: 'not-tested',
  }, null, 2) + '\n')
}

async function command(pid: number): Promise<string[]> {
  return (await readFile(`/proc/${String(pid)}/cmdline`, 'utf8')).split('\0').filter(Boolean)
}

async function verifyNativeSandbox(target: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-linux-sandbox-'))
  let application: ElectronApplication | undefined
  let page: Page | undefined
  let phase = 'electron-launch'
  let tracked: number[] = []
  try {
    // This selects the test assertion only; it must not reach product detection.
    const applicationEnvironment = linuxDesktopEnvironment(process.env, root, join(root, 'harness'))
    await prepareLinuxDesktopEnvironment(applicationEnvironment)
    application = await electron.launch({
      executablePath: target,
      chromiumSandbox: true,
      args: [`--user-data-dir=${join(root, 'electron')}`, '--ozone-platform=x11'],
      cwd: root,
      env: applicationEnvironment,
      timeout: 120_000,
    })
    const mainPid = application.process().pid
    if (mainPid === undefined) throw new Error('Linux native process PID is missing')
    tracked = [mainPid]
    phase = 'first-window'
    page = await application.firstWindow()
    phase = 'backend-ready'
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 120_000 })
    phase = 'system-update-native'
    if (evidenceRoot === undefined) throw new Error('Linux evidence root is required')
    await verifyNativeUpdateStatus(page, evidenceRoot)
    const observed = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        pid: process.pid,
        home: process.env.HOME, userProfile: process.env.USERPROFILE,
        rendererPid: window.webContents.getOSProcessId(),
        handle: window.getNativeWindowHandle().readUInt32LE(0),
      }
    })
    expect(observed.home).toBe(applicationEnvironment.HOME)
    expect(observed.userProfile).toBe(applicationEnvironment.USERPROFILE)
    expect(await page.evaluate(() => typeof process === 'undefined' && typeof require === 'undefined')).toBe(true)
    tracked = [observed.pid, ...await descendants(observed.pid)]
    const mainCommand = await command(observed.pid)
    const rendererCommand = await command(observed.rendererPid)
    phase = 'kernel-sandbox'
    const sandboxObservation = {
      ...observed, mainCommand, rendererCommand,
      rendererStatus: await readFile(`/proc/${String(observed.rendererPid)}/status`, 'utf8'),
      mainUserNamespace: (await execFileAsync('sudo', ['readlink', `/proc/${String(observed.pid)}/ns/user`])).stdout.trim(),
      rendererUserNamespace: (await execFileAsync('sudo', ['readlink', `/proc/${String(observed.rendererPid)}/ns/user`])).stdout.trim(),
    }
    if (evidenceRoot === undefined) throw new Error('Linux evidence root is required')
    await mkdir(evidenceRoot, { recursive: true })
    // Persist only process shape and kernel fields, never arbitrary argument values.
    await writeFile(join(evidenceRoot, 'kernel-observation.json'), JSON.stringify({
      mainPid: observed.pid, rendererPid: observed.rendererPid,
      rendererCommandSegments: rendererCommand.length,
      rendererProcessTypeTokens: rendererCommand.flatMap(argument => argument.split(/\s+/u))
        .filter(argument => /^--type=[a-z-]+$/u.test(argument)),
      rendererKernelFields: sandboxObservation.rendererStatus.split('\n')
        .filter(line => /^(?:NoNewPrivs|Seccomp|Seccomp_filters|NSpid):/u.test(line)),
      mainUserNamespace: sandboxObservation.mainUserNamespace,
      rendererUserNamespace: sandboxObservation.rendererUserNamespace,
    }, null, 2) + '\n')
    assertLinuxSandbox(sandboxObservation)
    const { stdout } = await execFileAsync('xprop', ['-id', String(observed.handle), 'WM_CLASS'])
    phase = 'window-class'
    expect(stdout).toContain('"deepseek-harness"')
    if (evidenceRoot === undefined) throw new Error('Linux evidence root is required')
    await mkdir(evidenceRoot, { recursive: true })
    await page.screenshot({ path: join(evidenceRoot, 'sandbox-window.png') })
    await writeFile(join(evidenceRoot, 'sandbox.json'), JSON.stringify({
      schemaVersion: 1, platform: 'linux-x64', display: 'X11/Xvfb',
      rendererSandbox: true, rendererSeccomp: 2, rendererNoNewPrivs: 1,
      separateUserNamespace: true, desktopWindowClass: 'deepseek-harness',
    }, null, 2) + '\n')
  } catch (error) {
    if (evidenceRoot !== undefined) {
      await mkdir(evidenceRoot, { recursive: true })
      await writeFile(join(evidenceRoot, 'native-failure.json'), JSON.stringify({
        phase, errorName: error instanceof Error ? error.name : 'UnknownError',
      }) + '\n')
      // The page is an isolated, keyless fixture; never retain raw backend logs.
      if (page !== undefined && !page.isClosed()) {
        await page.screenshot({ path: join(evidenceRoot, 'native-failure.png') }).catch(() => undefined)
      }
    }
    throw error
  } finally {
    if (application !== undefined) {
      const closed = application.waitForEvent('close', { timeout: 20_000 })
      await application.evaluate(({ app }) => { app.quit() })
      await closed
      await expect.poll(() => tracked.filter(alive), { timeout: 20_000 }).toEqual([])
    }
    await rm(root, { recursive: true, force: true })
  }
}

describe('Ubuntu packaged application', () => {
  it.skipIf(process.platform !== 'linux' || executable === undefined)(
    'keeps kernel sandboxing and passes controlled-model desktop lifecycle',
    async () => {
      if (executable === undefined || evidenceRoot === undefined) throw new Error('Linux native inputs are missing')
      if (expectedPackageFormat !== 'deb' && expectedPackageFormat !== 'appimage') throw new Error('Linux native package format expectation is required')
      expect(process.getuid?.()).not.toBe(0)
      await verifyNativeSandbox(executable)
      await runPackagedDesktopSmoke(executable, 'linux')
      await writeFile(join(evidenceRoot, 'native.json'), JSON.stringify({
        schemaVersion: 1, platform: 'linux-x64', display: 'X11/Xvfb',
        controlledProvider: 'loopback fixture', sharedFeatureSmoke: 'passed',
        processTreeRemaining: 0, wayland: 'not-tested',
      }, null, 2) + '\n')
    },
    360_000,
  )
})
