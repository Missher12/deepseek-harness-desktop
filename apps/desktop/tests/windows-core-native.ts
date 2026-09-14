/** Windows consumers of the official base history and native receipt APIs. */
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'playwright'
import { prepareBaseLegacyFixture, verifyBaseLegacyFixture, type BaseLegacyRuntimeInput, type VerifiedBaseLegacyFixture } from './base-legacy-fixture.ts'
import { BASE_SMOKE_EVENTS, baseSmokeFile, completePackagedDesktopBaseSmokeReceipt, confinedBaseSmokePath,
  type BaseSmokeEvidence, type PackagedDesktopBaseSmokeReceipt } from './base-smoke-receipt.ts'

/** @param output Native CIM JSON stdout. @returns The complete observed process rows. */
export function windowsCoreProcessSnapshot(output: string): { processId: number; parentProcessId: number }[] {
  if (output.trim() === '') throw new Error('Native process snapshot is empty.')
  const value: unknown = JSON.parse(output)
  const rows: unknown[] = Array.isArray(value) ? value : [value]
  if (rows.length === 0) throw new Error('Native process snapshot contains no system processes.')
  const ids = new Set<number>()
  return rows.map((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid native process row.')
    const { ProcessId: processId, ParentProcessId: parentProcessId } = row as Record<string, unknown>
    // Win32_Process uses uint32 IDs; PID 0 is the legitimate System Idle Process.
    if (typeof processId !== 'number' || !Number.isSafeInteger(processId) || processId < 0 || processId > 0xffff_ffff
      || typeof parentProcessId !== 'number' || !Number.isSafeInteger(parentProcessId)
      || parentProcessId < 0 || parentProcessId > 0xffff_ffff || ids.has(processId)) {
      throw new Error('Native process row has invalid or duplicate IDs.')
    }
    ids.add(processId)
    return { processId, parentProcessId }
  })
}

/** @param rootPid Owned live launcher or main. @param output Native CIM JSON stdout. @returns The observed root and descendants. */
export function windowsCoreProcessTree(rootPid: number, output: string): number[] {
  const rows = windowsCoreProcessSnapshot(output)
  if (rootPid <= 0 || !rows.some(row => row.processId === rootPid)) throw new Error('Native process snapshot is missing the owned root.')
  const tree = new Set([rootPid])
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) {
      if (!tree.has(row.processId) && tree.has(row.parentProcessId)) { tree.add(row.processId); changed = true }
    }
  }
  return [...tree]
}

/**
 * @param pids Previously observed native processes.
 * @param query Complete native CIM stdout; command failures must reject.
 * @returns When all known processes have exited; malformed or failed observations abort immediately.
 */
export async function waitForWindowsCoreProcessesStopped(pids: readonly number[], query: () => Promise<string>): Promise<void> {
  if (pids.length === 0) throw new Error('Native process ownership is unknown.')
  const deadline = Date.now() + 30_000
  for (;;) {
    const current = new Set(windowsCoreProcessSnapshot(await query()).map(row => row.processId))
    if (pids.every(pid => !current.has(pid))) return
    if (Date.now() >= deadline) throw new Error('Observed native processes did not stop.')
    await delay(100)
  }
}

/**
 * @param observed Actual official row observations.
 * @param expectedId Old-reader-confirmed ID.
 * @returns After identity and selection match.
 */
export function assertWindowsCoreSelection(observed: { sessionId: string; selected: string | null }, expectedId: string): void {
  if (observed.sessionId !== expectedId) throw new Error('Historical UI reopened a different Session.')
  if (observed.selected !== 'true') throw new Error('Historical Session is not selected.')
}

/**
 * @param page Real official renderer.
 * @param legacy Actual old-reader-confirmed fixture.
 * @returns After the selected ID and historical body are visible.
 */
export async function reopenWindowsCoreHistory(page: Page, legacy: VerifiedBaseLegacyFixture): Promise<void> {
  const workspace = page.locator('[role="treeitem"][aria-expanded]')
    .filter({ has: page.getByText('R7 legacy workspace', { exact: true }) })
  await workspace.waitFor({ state: 'visible', timeout: 30_000 })
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
  const row = page.locator('[role="treeitem"][aria-selected]').filter({ has: page.getByText(legacy.title, { exact: true }) })
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  if (await row.count() !== 1) throw new Error('Historical title must identify one official Session row.')
  await row.click()
  await page.getByText('Legacy fixture complete: R7_LEGACY_TOOL_OK', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  const observed = await row.evaluate((element) => {
    const transfer = new DataTransfer()
    try {
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
      return { sessionId: transfer.getData('text/plain'), selected: element.getAttribute('aria-selected') }
    } finally {
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
    }
  })
  assertWindowsCoreSelection(observed, legacy.sessionId)
}

/**
 * @param inputPath Platform-owned verified old runtime description.
 * @param root Absent isolated root.
 * @returns After the shared old producer and old reader succeed.
 */
export async function prepareWindowsCoreHistory(inputPath: string, root: string): Promise<void> {
  const info = await lstat(inputPath)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Old runtime input must be a physical file.')
  const input = JSON.parse(await readFile(inputPath, 'utf8')) as BaseLegacyRuntimeInput
  if (input.platform !== 'win32' || input.executableKind !== 'electron') throw new Error('A real released Windows Electron runtime is required.')
  if (input.sourceSha !== 'c0b92b1fcc5a6481eb219a8b5e5510980e99bf78' || input.desktopVersion !== '0.5.5'
    || input.harnessVersion !== '0.1.3-alpha.1'
    || input.releaseUrl !== 'https://github.com/Missher12/deepseek-harness-desktop/releases/download/desktop-v0.5.5/DeepSeek-Harness-Setup-0.5.5-win-x64.exe'
    || input.artifactSha256 !== '9d5f01a40b3fa70af31e49ffc50ce16b8ef6c86a3f2c221ae41fa5b6fb05f5ee') {
    throw new Error('Old runtime must come from the published Windows 0.5.5 Setup.')
  }
  if ((await lstat(input.artifactPath)).size !== 146631832) throw new Error('Published Windows 0.5.5 Setup byte count differs.')
  await prepareBaseLegacyFixture({ isolationRoot: resolve(root), legacy: input })
}

/** @param port Observed owned loopback port. @returns Whether a real listener still accepts connections. */
export async function windowsCorePortListening(port: number): Promise<boolean> {
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid observed Harness port.')
  return await new Promise<boolean>((done, fail) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); done(true) })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED') done(false)
      else fail(error)
    })
    socket.setTimeout(1000, () => { socket.destroy(); fail(new Error('Owned port cleanup observation timed out.')) })
  })
}

/** @param pids Observed native children. @param ports Observed Harness listeners. @returns Only after every observed resource is gone. */
export async function assertWindowsCoreStopped(pids: readonly number[], ports: readonly number[]): Promise<void> {
  if (pids.length === 0 || ports.length === 0) throw new Error('Core continuation has incomplete resource observations.')
  for (const pid of pids) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid observed native PID.')
    try { process.kill(pid, 0) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') continue
      throw error
    }
    throw new Error('Core continuation left a native process alive.')
  }
  for (const port of ports) if (await windowsCorePortListening(port)) throw new Error('Core continuation left a Harness listener alive.')
}

/**
 * Bind real historical UI observation and continued resource cleanup to the shared core receipt.
 * @param root Exclusive smoke root, containing the original historical producer receipt.
 * @param descriptorPath Fixed stage descriptor.
 * @param pids All processes observed during the native historical continuation.
 * @param ports All Harness ports observed during that continuation.
 * @returns After core verification, with pause/recovery still explicitly unrun.
 */
export async function completeWindowsCoreHistory(
  root: string, descriptorPath: string, pids: readonly number[], ports: readonly number[],
): Promise<void> {
  await assertWindowsCoreStopped(pids, ports)
  const fixturePath = join(root, 'legacy-fixture.json')
  const legacy = await verifyBaseLegacyFixture(fixturePath, { isolationRoot: root, platform: 'win32' })
  const receiptPath = await confinedBaseSmokePath(root, join(root, 'base-smoke-receipt.json'))
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as PackagedDesktopBaseSmokeReceipt
  for (const [check, key, values] of [['processCleanup', 'pids', pids], ['portCleanup', 'ports', ports]] as const) {
    const result = receipt.checks[check]
    if (result?.status !== 'passed') throw new Error('The base driver has not released its native resources.')
    const file = await confinedBaseSmokePath(root, join(root, 'checks', `${check}.json`))
    const original = await baseSmokeFile(file)
    if (original.sha256 !== result.evidence.sha256 || original.bytes !== result.evidence.bytes) throw new Error('Original cleanup evidence changed.')
    const evidence = JSON.parse(await readFile(file, 'utf8')) as BaseSmokeEvidence
    const previous: unknown = evidence.facts[key]
    if (!Array.isArray(previous) || previous.some(value => !Number.isSafeInteger(value))) throw new Error('Original cleanup observations are invalid.')
    evidence.facts[key] = [...new Set([...previous as number[], ...values])]
    await writeFile(file, `${JSON.stringify(evidence)}\n`)
    receipt.checks[check] = { status: 'passed', evidence: await baseSmokeFile(file) }
  }
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`)
  const evidence: BaseSmokeEvidence = { schema: 1, runId: receipt.runId, check: 'legacyCompatibility', status: 'passed',
    descriptorSha256: receipt.descriptor.sha256, executableSha256: receipt.installed.executable.sha256,
    events: [...BASE_SMOKE_EVENTS.legacyCompatibility], facts: { desktopVersion: legacy.oldVersion, harnessVersion: legacy.harnessVersion,
      sourceSha: legacy.sourceSha, fixtureReceipt: await baseSmokeFile(fixturePath), oldReaderVerified: true,
      oldWorkspacePreserved: true, oldSessionReopened: true, legacySessionId: legacy.sessionId } }
  const path = join(root, 'checks/legacyCompatibility.json')
  await writeFile(path, `${JSON.stringify(evidence)}\n`, { flag: 'wx', mode: 0o600 })
  await completePackagedDesktopBaseSmokeReceipt(receiptPath, { legacyCompatibility: path }, {
    platform: 'win32', descriptorPath, smokeRoot: root, scope: 'core',
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, input, root, extra] = process.argv.slice(2)
  if (mode !== 'prepare' || input === undefined || root === undefined || extra !== undefined) {
    throw new Error('Use Windows core prepare with an explicit old runtime input and absent isolation root.')
  }
  await prepareWindowsCoreHistory(resolve(input), resolve(root))
  process.stdout.write('Windows old production history generated and independently read back.\n')
}
