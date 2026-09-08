import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'
import { assertLinuxSandbox } from '../../../scripts/linux-desktop-sandbox.ts'
import { runPackagedDesktopSmoke } from './packaged-smoke.ts'

const execFileAsync = promisify(execFile)
const executable = process.env.DSH_LINUX_DESKTOP_EXECUTABLE
const evidenceRoot = process.env.DSH_LINUX_EVIDENCE_ROOT

async function command(pid: number): Promise<string[]> {
  return (await readFile(`/proc/${String(pid)}/cmdline`, 'utf8')).split('\0').filter(Boolean)
}

async function descendants(pid: number): Promise<number[]> {
  let children: string
  try {
    children = await readFile(`/proc/${String(pid)}/task/${String(pid)}/children`, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const direct = children.trim().split(/\s+/u).filter(Boolean).map(Number)
  return [...direct, ...(await Promise.all(direct.map(descendants))).flat()]
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

async function verifyNativeSandbox(target: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-linux-sandbox-'))
  let application: ElectronApplication | undefined
  let tracked: number[] = []
  try {
    application = await electron.launch({
      executablePath: target,
      chromiumSandbox: true,
      args: [`--user-data-dir=${join(root, 'electron')}`, '--ozone-platform=x11'],
      cwd: root,
      env: {
        ...process.env,
        DSH_HOME: join(root, 'harness'),
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: '',
        DEEPSEEK_BASE_URL: 'http://127.0.0.1:1/v1',
      },
      timeout: 120_000,
    })
    const mainPid = application.process().pid
    if (mainPid === undefined) throw new Error('Linux native process PID is missing')
    tracked = [mainPid]
    const page = await application.firstWindow()
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 120_000 })
    const observed = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const preferences = window.webContents.getLastWebPreferences()
      return {
        pid: process.pid,
        rendererPid: window.webContents.getOSProcessId(),
        handle: window.getNativeWindowHandle().readUInt32LE(0),
        sandbox: preferences.sandbox === true,
        contextIsolation: preferences.contextIsolation === true,
        nodeIntegration: preferences.nodeIntegration === true,
      }
    })
    tracked = [observed.pid, ...await descendants(observed.pid)]
    const mainCommand = await command(observed.pid)
    const rendererCommand = await command(observed.rendererPid)
    assertLinuxSandbox({
      ...observed, mainCommand, rendererCommand,
      rendererStatus: await readFile(`/proc/${String(observed.rendererPid)}/status`, 'utf8'),
      mainUserNamespace: (await execFileAsync('sudo', ['readlink', `/proc/${String(observed.pid)}/ns/user`])).stdout.trim(),
      rendererUserNamespace: (await execFileAsync('sudo', ['readlink', `/proc/${String(observed.rendererPid)}/ns/user`])).stdout.trim(),
    })
    const { stdout } = await execFileAsync('xprop', ['-id', String(observed.handle), 'WM_CLASS'])
    expect(stdout).toContain('deepseek-harness')
    if (evidenceRoot === undefined) throw new Error('Linux evidence root is required')
    await mkdir(evidenceRoot, { recursive: true })
    await page.screenshot({ path: join(evidenceRoot, 'sandbox-window.png') })
    await writeFile(join(evidenceRoot, 'sandbox.json'), JSON.stringify({
      schemaVersion: 1, platform: 'linux-x64', display: 'X11/Xvfb',
      rendererSandbox: true, rendererSeccomp: 2, rendererNoNewPrivs: 1,
      separateUserNamespace: true, desktopWindowClass: 'deepseek-harness',
    }, null, 2) + '\n')
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
