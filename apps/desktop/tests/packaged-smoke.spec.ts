import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const application = join(repositoryRoot, 'apps/desktop/release/mac/DeepSeek Harness.app')
const executable = join(application, 'Contents/MacOS/DeepSeek Harness')

async function processTree(rootPid: number): Promise<number[]> {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid='])
  const children = new Map<number, number[]>()
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const parent = Number(match[2])
    const list = children.get(parent) ?? []
    list.push(pid)
    children.set(parent, list)
  }
  const found = [rootPid]
  for (let index = 0; index < found.length; index += 1) {
    found.push(...children.get(found[index]!) ?? [])
  }
  return found
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

async function listenerPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', [
      '-nP', '-t', `-iTCP:${String(port)}`, '-sTCP:LISTEN',
    ])
    return stdout.split(/\s+/u).filter(Boolean).map(Number).filter(Number.isSafeInteger)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 1) return []
    throw error
  }
}

async function quitThroughApplicationMenu(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ app, Menu }) => {
    const appMenu = Menu.getApplicationMenu()
    const quit = appMenu?.items
      .flatMap(item => item.submenu?.items ?? [])
      .find(item => item.role === 'quit')
    if (quit === undefined) throw new Error('Packaged smoke: native Quit menu item is missing.')
    app.quit()
  })
}

describe('packaged DeepSeek Harness desktop', () => {
  it.skipIf(!existsSync(executable))('boots isolated data, renders the desktop shell, and shuts down its process tree', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
    const harnessHome = join(temporaryRoot, 'dsh-home')
    const userData = join(temporaryRoot, 'electron-data')
    await Promise.all([mkdir(harnessHome), mkdir(userData)])

    let nativeApp: ElectronApplication | undefined
    let quitCompleted = false
    try {
      nativeApp = await electron.launch({
        executablePath: executable,
        args: [`--user-data-dir=${userData}`],
        cwd: temporaryRoot,
        env: { ...process.env, DSH_HOME: harnessHome },
        timeout: 120_000,
      })
      const page = await nativeApp.firstWindow({ timeout: 120_000 })
      await page.locator('body[data-dsh-surface="desktop"]').waitFor({ timeout: 120_000 })

      expect(await page.evaluate(() => (
        typeof window.dshDesktop?.onCommand === 'function'
        && typeof window.dshDesktop.recover === 'function'
      ))).toBe(true)

      const url = new URL(page.url())
      expect(url.hostname).toBe('127.0.0.1')
      expect(url.searchParams.get('surface')).toBe('desktop')
      const port = Number(url.port)
      expect(port).toBeGreaterThan(0)
      expect(await listenerPids(port)).not.toEqual([])

      expect(await page.locator('[class*="sidebarCol"]').count()).toBe(1)
      expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
      expect(await page.locator('[class*="detailsCol"]').count()).toBe(1)
      expect(await page.locator('[data-dsh-desktop-command="new-session"]').count()).toBe(1)
      expect(await page.locator('[data-dsh-desktop-command="open-command-menu"]').count()).toBe(1)
      expect(await page.locator('[data-dsh-desktop-command="open-settings"]').count()).toBe(1)

      const continueButton = page.getByRole('button', { name: /^(?:Continue|继续)$/u })
      await continueButton.waitFor({ state: 'visible', timeout: 30_000 })
      await continueButton.click()
      const configureLaterButton = page.getByRole('button', {
        name: /^(?:Configure later|稍后配置)$/u,
      })
      await configureLaterButton.waitFor({ state: 'visible', timeout: 30_000 })
      await configureLaterButton.click()
      await configureLaterButton.waitFor({ state: 'detached', timeout: 15_000 })
      await expect.poll(
        async () => page.locator('#root').evaluate((element: HTMLElement) => !element.inert),
        { timeout: 15_000 },
      ).toBe(true)

      await page.waitForTimeout(15_000)
      expect(await page.locator('body').innerText()).not.toContain('Failed to load plugins')
      expect(await page.locator('[class*="centerCol"]').count()).toBe(1)
      await page.screenshot({
        path: join(repositoryRoot, 'apps/desktop/release/desktop-smoke.png'),
      })

      await page.locator('[data-dsh-desktop-command="open-settings"]').click()
      const settingsDialog = page.getByRole('dialog')
      await settingsDialog.waitFor({ state: 'visible' })
      expect(await settingsDialog.isVisible()).toBe(true)
      await page.keyboard.press('Escape')
      await settingsDialog.waitFor({ state: 'detached' })
      expect(await settingsDialog.count()).toBe(0)

      const mainPid = nativeApp.process().pid
      if (mainPid === undefined) throw new Error('Packaged smoke: Electron main PID is unavailable.')
      const trackedPids = [...new Set([
        ...await processTree(mainPid),
        ...await listenerPids(port),
      ])]

      const closed = nativeApp.waitForEvent('close')
      await quitThroughApplicationMenu(nativeApp)
      await closed
      quitCompleted = true

      await expect.poll(() => trackedPids.filter(processExists), { timeout: 15_000 }).toEqual([])
      await expect.poll(() => listenerPids(port), { timeout: 15_000 }).toEqual([])
    } finally {
      if (!quitCompleted && nativeApp !== undefined) await nativeApp.close()
    }
  }, 180_000)
})
