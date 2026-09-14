/** Reopen verified Linux 0.5.7 history in the installed official UI and complete only core acceptance. */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron, type Locator } from 'playwright'
import { validateDesktopBaseSmokeDescriptor } from '../../../scripts/desktop-base-contract.ts'
import { verifyBaseLegacyFixture } from './base-legacy-fixture.ts'
import { BASE_SMOKE_EVENTS, baseSmokeFile, capturePackagedBaseIdentity, completePackagedDesktopBaseSmokeReceipt,
  confinedBaseSmokePath, verifyRemountedAppImageIdentity, type BaseSmokeEvidence, type PackagedDesktopBaseSmokeReceipt } from './base-smoke-receipt.ts'
import { closeBaseSmokeOwnedApplication, waitForPackagedBaseReady, type PackagedDesktopBaseSmokeResult } from './packaged-base-smoke.ts'
import { linuxDescendants, linuxDesktopEnvironment, prepareLinuxDesktopEnvironment, processAlive,
  readLinuxProcessIdentity, type LinuxProcessIdentity } from './linux-writer-fixture.ts'

/** Read the official row's drag identity without dropping or reordering it.
 * @param row Unique visible historical Session row.
 * @param expectedSessionId ID verified by the old runtime.
 * @returns After the actual row ID and current selection match.
 */
export async function verifyLinuxLegacySelection(row: Pick<Locator, 'evaluate'>, expectedSessionId: string): Promise<void> {
  const observed = await row.evaluate((element) => {
    const transfer = new DataTransfer()
    try {
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
      return { sessionId: transfer.getData('text/plain'), selected: element.getAttribute('aria-selected') }
    } finally { element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer })) }
  })
  if (observed.sessionId !== expectedSessionId || observed.selected !== 'true') throw new Error('Historical UI Session identity or selection differs.')
}

async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 30_000
  do { if (await check()) return; await delay(100) } while (Date.now() < deadline)
  throw new Error(message)
}

async function portOpen(port: number): Promise<boolean> {
  return await new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (open: boolean): void => { socket.destroy(); resolvePort(open) }
    socket.once('connect', () => { finish(true) })
    socket.once('error', (error: NodeJS.ErrnoException) => { finish(error.code !== 'ECONNREFUSED') })
    socket.setTimeout(500, () => { finish(true) })
  })
}

/** Complete a Linux core run after actual old-history UI readback; pause/recovery remains unattempted.
 * @param executable Original installed binary or external AppImage, never an evidence snapshot.
 * @param base Shared core UI result with its partial receipt.
 * @param descriptorPath Reviewed official-runtime descriptor.
 * @param legacyFixturePath Old-runtime-generated fixture receipt.
 * @returns Core receipt only after protected bytes and all observed native resources are rechecked.
 */
export async function completeLinuxCoreNative(executable: string, base: PackagedDesktopBaseSmokeResult,
  descriptorPath: string, legacyFixturePath: string): Promise<PackagedDesktopBaseSmokeReceipt> {
  if (process.platform !== 'linux' || process.env.DSH_DESKTOP_SMOKE_STAGE !== undefined) throw new Error('Linux core completion requires an installed native application.')
  const receipt = JSON.parse(await readFile(base.receiptPath, 'utf8')) as PackagedDesktopBaseSmokeReceipt
  const root = await realpath(receipt.smokeRoot)
  const descriptor = validateDesktopBaseSmokeDescriptor(JSON.parse(await readFile(descriptorPath, 'utf8')) as unknown)
  const legacy = await verifyBaseLegacyFixture(legacyFixturePath, { isolationRoot: root, platform: 'linux' })
  if (receipt.platform !== 'linux' || descriptor.platform !== 'linux' || receipt.outcome !== 'partial'
    || receipt.installed.mode === 'development-stage' || receipt.checks.pauseRecovery?.status !== 'not-run'
    || await realpath(executable) !== receipt.installed.executable.path
    || await confinedBaseSmokePath(root, base.receiptPath) !== join(root, 'base-smoke-receipt.json')
    || await realpath(base.userData) !== receipt.userData || await realpath(legacy.dshHome) !== receipt.harnessHome) {
    throw new Error('Linux core continuation inputs differ from the original run.')
  }
  for (const file of receipt.protectedFiles) await confinedBaseSmokePath(root, file.path)
  for (const [check, result] of Object.entries(receipt.checks)) {
    if (result.status === 'passed'
      && await confinedBaseSmokePath(root, result.evidence.path) !== join(root, 'checks', `${check}.json`)) {
      throw new Error('Original core evidence is outside its owned scenario path.')
    }
  }
  const preserved = [receipt.descriptor, receipt.installed.executable, ...receipt.protectedFiles,
    ...Object.values(receipt.checks).flatMap(check => check.status === 'passed' ? [check.evidence] : [])]
  const verifyProtected = async (): Promise<void> => {
    for (const file of preserved) {
      if (JSON.stringify(await baseSmokeFile(file.path)) !== JSON.stringify(file)) throw new Error('Protected core smoke file changed.')
    }
  }
  await verifyProtected()
  if (await realpath(descriptorPath) !== receipt.descriptor.path) throw new Error('Linux continuation descriptor changed.')
  const env = linuxDesktopEnvironment(process.env, join(root, 'linux-continuation'), legacy.dshHome)
  // Preserve the shared run's home paths while isolating Linux caches and temporary files.
  env.HOME = join(root, 'home'); env.USERPROFILE = env.HOME; env.CODEX_HOME = join(root, 'home/codex')
  await prepareLinuxDesktopEnvironment(env)
  const application = await electron.launch({ executablePath: executable, chromiumSandbox: true,
    args: [`--user-data-dir=${base.userData}`, '--ozone-platform=x11'], cwd: legacy.workspacePath, env, timeout: 90_000 })
  const child = application.process()
  const pids = new Set<number>()
  const identities = new Map<number, LinuxProcessIdentity>()
  const ports = new Set<number>()
  let appDir: string | undefined
  let failure: unknown
  let onboarding: Awaited<ReturnType<typeof waitForPackagedBaseReady>> | undefined
  const inventory = async (): Promise<number[]> => {
    if (child.pid === undefined) throw new Error('Linux continuation PID is missing.')
    const owner = await readLinuxProcessIdentity(child.pid)
    if (owner === undefined) throw new Error('Linux continuation exited before process inventory.')
    const prior = identities.get(owner.pid)
    if (prior !== undefined && prior.startTime !== owner.startTime) throw new Error('Linux continuation PID was reused.')
    for (const pid of [owner.pid, ...await linuxDescendants(owner.pid)]) {
      const identity = await readLinuxProcessIdentity(pid)
      if (identity === undefined) continue
      const previous = identities.get(pid)
      if (previous !== undefined && previous.startTime !== identity.startTime) throw new Error('Owned Linux descendant PID was reused.')
      identities.set(pid, identity); pids.add(pid)
    }
    const current = await readLinuxProcessIdentity(owner.pid)
    if (current?.startTime !== owner.startTime) throw new Error('Linux process inventory lost its owner.')
    return [...pids]
  }
  try {
    await inventory()
    const page = await application.firstWindow({ timeout: 90_000 })
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:/u, { timeout: 90_000 })
    const port = Number(new URL(page.url()).port)
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error('Linux continuation Harness port is invalid.')
    ports.add(port)
    const native = await application.evaluate(({ app }) => {
      const resources = Reflect.get(process, 'resourcesPath') as unknown
      if (typeof resources !== 'string') throw new Error('Native resources path is missing.')
      return { packaged: app.isPackaged, platform: process.platform, arch: process.arch, home: process.env.DSH_HOME,
        userData: app.getPath('userData'), executablePath: process.execPath, resourcesDirectory: resources,
        appPath: app.getAppPath(), desktopVersion: app.getVersion(), appImage: process.env.APPIMAGE, appDir: process.env.APPDIR,
        mountInfo: process.getBuiltinModule('node:fs').readFileSync('/proc/self/mountinfo', 'utf8') }
    })
    if (!native.packaged || native.platform !== 'linux' || native.arch !== 'x64' || native.home !== legacy.dshHome
      || await realpath(native.userData) !== receipt.userData || native.desktopVersion !== descriptor.desktopVersion) throw new Error('Linux continuation native identity differs.')
    if (receipt.installed.mode === 'packaged-appimage') {
      if (native.appImage === undefined || native.appDir === undefined) throw new Error('Linux continuation lacks a real AppImage mount.')
      await verifyRemountedAppImageIdentity(receipt.installed, { ...native, appImage: native.appImage, appDir: native.appDir }, descriptor)
      appDir = native.appDir
    } else {
      const current = await capturePackagedBaseIdentity(native.executablePath, native.resourcesDirectory,
        native.appPath, native.desktopVersion, descriptor)
      if (JSON.stringify(current) !== JSON.stringify(receipt.installed)) throw new Error('Installed Linux continuation bytes changed.')
    }
    onboarding = await waitForPackagedBaseReady(page, { welcome: 'expected', credentials: 'missing' })
    const workspace = page.locator('[role="treeitem"][aria-expanded]').filter({ has: page.getByText('R7 legacy workspace', { exact: true }) })
    await workspace.waitFor({ state: 'visible', timeout: 30_000 })
    if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
    const row = page.locator('[role="treeitem"][aria-selected]').filter({ has: page.getByText(legacy.title, { exact: true }) })
    await row.waitFor({ state: 'visible', timeout: 30_000 })
    if (await row.count() !== 1) throw new Error('Historical title does not identify one Session.')
    await row.click()
    await until(async () => await row.getAttribute('aria-selected') === 'true', 'Historical Session was not selected.')
    await verifyLinuxLegacySelection(row, legacy.sessionId)
    await page.getByText('Legacy fixture complete: R7_LEGACY_TOOL_OK', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    await verifyLinuxLegacySelection(row, legacy.sessionId)
    await inventory()
    await page.screenshot({ path: join(root, 'checks/linux-legacy-reader.png') })
  } catch (error) { failure = error } finally {
    try {
      if (child.pid === undefined) { await application.close(); throw new Error('Linux continuation PID remains unknown.') }
      await closeBaseSmokeOwnedApplication({ rootPid: child.pid, record: (tree) => { for (const pid of tree) pids.add(pid) },
        discover: inventory, quit: async () => { await application.close() },
        waitForQuiescence: async () => { await until(async () => [...pids].every(pid => !processAlive(pid)), 'Linux continuation processes remain.') },
      })
      await until(async () => (await Promise.all([...ports].map(portOpen))).every(open => !open), 'Linux continuation ports remain open.')
      if (appDir !== undefined) {
        const mount = appDir
        await until(async () => {
          try { await realpath(mount); return false } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
            throw error
          }
        }, 'Linux continuation AppImage mount remains.')
      }
    } catch (error) {
      failure = failure === undefined ? error : new AggregateError([failure, error], 'Linux continuation and cleanup failed.')
      try {
        for (const identity of identities.values()) {
          if ((await readLinuxProcessIdentity(identity.pid))?.startTime !== identity.startTime) continue
          try { process.kill(identity.pid, 'SIGKILL') } catch (signalError) {
            if ((signalError as NodeJS.ErrnoException).code !== 'ESRCH') throw signalError
          }
        }
        await until(async () => [...pids].every(pid => !processAlive(pid)), 'Linux failure cleanup did not settle.')
      } catch (cleanupError) { failure = new AggregateError([failure, cleanupError], 'Linux cleanup remains unconfirmed.') }
    }
  }
  if (failure !== undefined) throw failure
  await verifyProtected()
  await verifyBaseLegacyFixture(legacyFixturePath, { isolationRoot: root, platform: 'linux' })
  const continuationPath = join(root, 'checks/linux-continuation.json')
  await writeFile(continuationPath, `${JSON.stringify({ schema: 1, runId: receipt.runId,
    executableSha256: receipt.installed.executable.sha256, legacySessionId: legacy.sessionId,
    selected: true, originalBodyVisible: true, onboarding, appDir: appDir ?? null,
    pids: [...pids], ports: [...ports], alivePids: [], listeningPorts: [] }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  // The final shared verifier must inspect continuation resources as well as the original core run.
  for (const check of ['processCleanup', 'portCleanup'] as const) {
    const previous = receipt.checks[check]
    if (previous?.status !== 'passed') throw new Error('Original core cleanup evidence is missing.')
    const evidence = JSON.parse(await readFile(previous.evidence.path, 'utf8')) as BaseSmokeEvidence
    if (check === 'processCleanup') evidence.facts.pids = [...new Set([...(evidence.facts.pids as number[]), ...pids])]
    else evidence.facts.ports = [...new Set([...(evidence.facts.ports as number[]), ...ports])]
    await writeFile(previous.evidence.path, `${JSON.stringify(evidence, null, 2)}\n`)
    previous.evidence = await baseSmokeFile(previous.evidence.path)
  }
  receipt.protectedFiles.push(await baseSmokeFile(continuationPath), await baseSmokeFile(join(root, 'checks/linux-legacy-reader.png')))
  await writeFile(base.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  const evidence: BaseSmokeEvidence = { schema: 1, runId: receipt.runId, check: 'legacyCompatibility', status: 'passed',
    descriptorSha256: receipt.descriptor.sha256, executableSha256: receipt.installed.executable.sha256,
    events: [...BASE_SMOKE_EVENTS.legacyCompatibility], facts: { desktopVersion: legacy.oldVersion, harnessVersion: legacy.harnessVersion,
      sourceSha: legacy.sourceSha, fixtureReceipt: await baseSmokeFile(legacyFixturePath), oldReaderVerified: true,
      oldWorkspacePreserved: true, oldSessionReopened: true, legacySessionId: legacy.sessionId,
      continuation: await baseSmokeFile(continuationPath) } }
  const evidencePath = join(root, 'checks/legacyCompatibility.json')
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return await completePackagedDesktopBaseSmokeReceipt(base.receiptPath, { legacyCompatibility: evidencePath }, {
    platform: 'linux', descriptorPath, smokeRoot: root, scope: 'core',
  })
}
