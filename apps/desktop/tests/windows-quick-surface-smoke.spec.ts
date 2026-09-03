import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'
import { descendantProcessTree, parseWindowsProcessRows } from './packaged-smoke.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const execFileAsync = promisify(execFile)
const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  ?? join(repositoryRoot, 'apps/desktop/release/win-unpacked/DeepSeek Harness.exe')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`Windows quick smoke requires ${name}.`)
  return value
}

async function windowsProcessTree(rootPid: number): Promise<number[]> {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
  ])
  return descendantProcessTree(rootPid, parseWindowsProcessRows(stdout))
}

async function waitForWindowsProcessesStopped(processIds: readonly number[]): Promise<void> {
  await expect.poll(async () => {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
    ])
    const running = new Set(parseWindowsProcessRows(stdout).map(row => row.processId))
    return processIds.filter(processId => running.has(processId))
  }, { timeout: 30_000 }).toEqual([])
}

describe('packaged DeepSeek Harness quick surface on Windows', () => {
  it.skipIf(process.platform !== 'win32' || !existsSync(executable))(
    'mounts the real Desktop AppFrame and closes its complete process tree',
    async () => {
      const smokeRoot = requiredEnvironment('DSH_DESKTOP_SMOKE_ROOT')
      const harnessHome = requiredEnvironment('DSH_DESKTOP_SMOKE_DSH_HOME')
      const userData = requiredEnvironment('DSH_DESKTOP_SMOKE_USER_DATA')
      let application: ElectronApplication | undefined
      let trackedProcessIds: number[] = []
      let closed = false
      try {
        application = await electron.launch({
          executablePath: executable,
          args: [`--user-data-dir=${userData}`],
          cwd: smokeRoot,
          env: {
            ...process.env,
            DSH_HOME: harnessHome,
            DSH_DESKTOP_SMOKE_MODEL_KEY: 'desktop-quick-smoke-placeholder-key',
            DSH_TELEMETRY_DISABLED: '1',
            MISSHER_TENCENTDB_DIR: join(smokeRoot, 'memory-source-unconfigured'),
            DEEPSEEK_API_KEY: '',
          },
          timeout: 120_000,
        })
        const page = await application.firstWindow({ timeout: 120_000 })
        await expect.poll(async () => Promise.all([
          page.locator('body[data-dsh-surface="desktop"]').count(),
          page.locator('[class*="sidebarCol"]').count(),
          page.locator('[class*="centerCol"]').count(),
          page.locator('[class*="detailsCol"]').count(),
        ]), { timeout: 120_000 }).toEqual([1, 1, 1, 1])

        const mainPid = application.process().pid
        if (mainPid === undefined) throw new Error('Windows quick smoke has no Electron PID.')
        trackedProcessIds = await windowsProcessTree(mainPid)
        const close = application.waitForEvent('close')
        await application.evaluate(({ app }) => { app.quit() })
        await close
        closed = true
        await waitForWindowsProcessesStopped(trackedProcessIds)
      } finally {
        if (!closed && application !== undefined) {
          const mainPid = application.process().pid
          if (trackedProcessIds.length === 0 && mainPid !== undefined) {
            trackedProcessIds = await windowsProcessTree(mainPid)
          }
          await application.close()
          if (trackedProcessIds.length !== 0) await waitForWindowsProcessesStopped(trackedProcessIds)
        }
      }
    },
    180_000,
  )
})
