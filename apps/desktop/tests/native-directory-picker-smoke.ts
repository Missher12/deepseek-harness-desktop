/** Exercise the Windows native folder dialog with one owned PowerShell process. */
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { terminateProcessTree } from '../src/harness/process-tree.ts'
import type { Page } from 'playwright'

/** Own a picker automation process until actual close, including when its UI action fails.
 * @param executable Native-selected executable (test fixtures may select their owned Node process).
 * @param args Fixed automation arguments.
 * @param action UI action performed while the picker automation is running.
 * @param deadlines Bounded execution and post-termination close waits.
 * @returns After action and successful automation exit, or rejects after bounded cleanup retaining the first error.
 */
export async function withOwnedPickerAutomation(executable: string, args: readonly string[], action: () => Promise<void>,
  deadlines = { executionMs: 90_000, drainMs: 5_000 }): Promise<void> {
  const child = spawn(executable, [...args], { shell: false, stdio: 'ignore', detached: process.platform !== 'win32' })
  let closed = false
  let firstError: unknown
  let closeResolve!: () => void
  const close = new Promise<void>((resolve) => { closeResolve = resolve })
  child.once('error', (error) => { firstError ??= error })
  child.once('close', (code, signal) => {
    closed = true
    if (code !== 0 || signal !== null) firstError ??= new Error('Picker automation exited unsuccessfully.')
    closeResolve()
  })
  const stop = (): void => {
    if (!closed && child.pid !== undefined) terminateProcessTree(child.pid, 'force', process.platform)
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { reject(new Error('Picker automation timed out.')) }, deadlines.executionMs)
  })
  let drainTimer: ReturnType<typeof setTimeout> | undefined
  try {
    try {
      await Promise.race([action(), deadline])
      await Promise.race([close, deadline])
    } catch (error) { firstError ??= error; stop() }
    if (!closed) {
      await Promise.race([close, new Promise<never>((_, reject) => {
        drainTimer = setTimeout(() => { reject(new Error('Picker automation close is unconfirmed.', { cause: firstError })) }, deadlines.drainMs)
      })])
    }
    if (firstError !== undefined) throw firstError
  } finally { clearTimeout(timeout); clearTimeout(drainTimer) }

}

/**
 * Select a real folder and verify its official workspace row without private layout selectors.
 * @param page - native app renderer.
 * @param harnessHome - owned temporary Harness home.
 * @param userData - owned Electron data directory containing lifecycle logs.
 * @returns after the automation process settles and the selected workspace is visible.
 */
export async function exerciseWindowsDirectoryPicker(page: Page, harnessHome: string, userData: string): Promise<void> {
  const selectedDirectory = join(harnessHome, 'native-picker-selected')
  await mkdir(selectedDirectory, { recursive: true })
  const addWorkspace = page.getByRole('button', { name: /^(?:Add workspace|添加工作区)$/u })
  await addWorkspace.waitFor({ state: 'visible', timeout: 30_000 })
  await withOwnedPickerAutomation('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    resolve(import.meta.dirname, '../../../scripts/windows-directory-picker-ui-smoke.ps1'), '-FolderPath', selectedDirectory,
  ], async () => { await addWorkspace.click() })
  const workspace = page.locator('[role="treeitem"][aria-expanded]').filter({ has: page.getByText(basename(selectedDirectory), { exact: true }) })
  await workspace.waitFor({ state: 'visible', timeout: 30_000 })
  if (await workspace.count() !== 1) throw new Error('Native folder selection did not produce one workspace row.')
  const blank = page.locator('[role="treeitem"][aria-selected="true"]').filter({ has: page.getByText(/^(?:New Session|新会话)$/u, { exact: true }) })
  await blank.waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ state: 'visible', timeout: 30_000 })
  if ((await readFile(join(userData, 'logs/lifecycle.log'), 'utf8')).includes('FATAL ERROR')) throw new Error('Native directory picker encountered a fatal lifecycle error.')
}
