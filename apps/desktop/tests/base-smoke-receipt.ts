/** Verify native base-smoke evidence against installed bytes and isolated files. */
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createDesktopBaseSmokeDescriptor, desktopBaseLegacyBaseline, validateDesktopBaseSmokeDescriptor, type DesktopBaseSmokeDescriptor } from '../../../scripts/desktop-base-contract.ts'
import { verifyBaseLegacyFixture } from './base-legacy-fixture.ts'

/** Exact observed transitions required for each native scenario. */
export const BASE_SMOKE_EVENTS = {
  installedIdentity: ['installed-runtime-matched'],
  firstRun: ['native-window-visible', 'continue-hit-tested'],
  modelTurn: ['reasoning-visible', 'unicode-visible', 'markdown-visible', 'provider-completed'],
  title: ['automatic-title-visible'],
  reload: ['renderer-reloaded', 'same-session-visible'],
  reopen: ['new-session-opened', 'same-session-reopened'],
  restart: ['native-quit', 'processes-gone', 'port-closed', 'native-restarted', 'same-session-visible'],
  systemUpdate: ['native-version-matched', 'settings-version-visible'],
  processCleanup: ['all-owned-pids-gone'],
  portCleanup: ['all-owned-ports-closed'],
  legacyCompatibility: ['legacy-reader-verified', 'legacy-session-reopened', 'legacy-files-preserved', 'legacy-workspace-preserved'],
  pauseRecovery: ['bundle-observed', 'attributable-load-failed', 'bundle-excluded-before-parse', 'canonical-cli-reconciled',
    'paused-state-survived-restart', 'candidate-host-validated', 'bundle-restored', 'conversation-completed',
    'all-owned-pids-gone', 'ports-closed'],
  windowsDirectoryPicker: ['native-dialog-selected', 'workspace-visible'],
} as const

/** One specifically named smoke scenario. */
export type BaseSmokeCheck = keyof typeof BASE_SMOKE_EVENTS

/** Hash of an actual regular file, never a directory or an escaping symlink. */
export interface BaseSmokeFile {
  path: string
  bytes: number
  sha256: string
}

/** Installed application identity observed by Electron and bound to physical files. */
export interface BaseSmokeInstalledIdentity {
  mode: 'packaged' | 'packaged-appimage' | 'development-stage'
  executable: BaseSmokeFile
  resourcesDirectory: string
  appPath: string
  desktopVersion: string
  harnessVersion: string
  officialSourceSha: string
  files: BaseSmokeFile[]
  appImage?: BaseSmokeAppImageSnapshot
}

/** Values observed inside the actual native Linux process, before its FUSE mount disappears. */
export interface BaseSmokeAppImageObservation {
  appImage: string
  appDir: string
  executablePath: string
  resourcesDirectory: string
  appPath: string
  mountInfo: string
}

/** Required mounted bytes copied under the owned smoke root, with the original native paths retained for comparison. */
export interface BaseSmokeAppImageSnapshot {
  appDir: string
  mountedExecutable: BaseSmokeFile
  mountRecord: string
  snapshotDirectory: string
  snapshotExecutable: BaseSmokeFile
  snapshotFiles: BaseSmokeFile[]
}

/** Persisted event evidence for exactly one check and one smoke run. */
export interface BaseSmokeEvidence {
  schema: 1
  runId: string
  check: BaseSmokeCheck
  status: 'passed'
  descriptorSha256: string
  executableSha256: string
  events: string[]
  facts: Record<string, unknown>
}

/** A missing scenario stays explicit until its concrete evidence is supplied. */
export type BaseSmokeCheckResult = { status: 'passed'; evidence: BaseSmokeFile } | { status: 'not-run'; reason: string }

/** Native smoke record; partial records cannot satisfy the final verifier. */
export interface PackagedDesktopBaseSmokeReceipt {
  schema: 1
  composition: 'base'
  runId: string
  platform: NodeJS.Platform
  arch: 'x64'
  outcome: 'partial' | 'passed' | 'core-passed'
  descriptor: BaseSmokeFile
  installed: BaseSmokeInstalledIdentity
  smokeRoot: string
  harnessHome: string
  userData: string
  workspacePath: string
  activeSessionId: string
  activeSessionTitle: string
  protectedFiles: BaseSmokeFile[]
  primaryDisplayScaleFactor: number
  rendererDevicePixelRatio: number
  checks: Partial<Record<BaseSmokeCheck, BaseSmokeCheckResult>>
}

/** Expected external inputs to receipt verification. */
export interface BaseSmokeReceiptVerification {
  platform: NodeJS.Platform
  descriptorPath: string
  smokeRoot: string
  /** Full remains the default; core excludes only an explicitly unattempted pause/recovery scenario. */
  scope?: 'full' | 'core'
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Fingerprint a regular file after resolving its physical location.
 * @param path - file whose actual bytes are evidence.
 * @returns normalized physical path, byte count and SHA-256.
 */
export async function baseSmokeFile(path: string): Promise<BaseSmokeFile> {
  if (!(await lstat(path)).isFile()) throw new Error(`Smoke evidence must be a regular file: ${path}`)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid smoke file chunk.')
    bytes += chunk.length; hash.update(chunk)
  }
  return { path: await realpath(path), bytes, sha256: hash.digest('hex') }
}

/**
 * Require an existing path to remain physically inside the owned smoke root.
 * @param root - caller-owned isolation directory.
 * @param path - existing child file or directory.
 * @returns physical child path.
 */
export async function confinedBaseSmokePath(root: string, path: string): Promise<string> {
  const physical = await realpath(path)
  const local = relative(await realpath(root), physical)
  if (local === '' || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error(`Smoke path is outside its isolation root: ${path}`)
  return physical
}

async function checkedFile(value: unknown, root?: string): Promise<BaseSmokeFile> {
  if (!record(value) || Object.keys(value).length !== 3 || typeof value.path !== 'string' || !isAbsolute(value.path)
    || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 0
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) throw new Error('Invalid smoke file receipt.')
  if (root !== undefined) await confinedBaseSmokePath(root, value.path)
  const actual = await baseSmokeFile(value.path)
  if (actual.path !== value.path || actual.bytes !== value.bytes || actual.sha256 !== value.sha256) throw new Error(`Smoke file hash changed: ${value.path}`)
  return actual
}

/**
 * Derive required paths from the installed CLI, not the smoke driver's package version.
 * @param executable - actual Electron executable.
 * @param resourcesDirectory - Electron's actual resources directory.
 * @param appPath - Electron's actual packaged app path.
 * @param desktopVersion - version returned by the launched native app.
 * @param descriptor - validated external stage descriptor.
 * @returns installed identity and fingerprints of every required runtime file and package manifest.
 */
export async function capturePackagedBaseIdentity(
  executable: string, resourcesDirectory: string, appPath: string, desktopVersion: string, descriptor: DesktopBaseSmokeDescriptor,
): Promise<BaseSmokeInstalledIdentity> {
  if (desktopVersion !== descriptor.desktopVersion || resolve(appPath) !== resolve(resourcesDirectory, 'app.asar')) throw new Error('Installed application identity differs from the base descriptor.')
  const physicalResources = await realpath(resourcesDirectory)
  const core = join(physicalResources, 'app.asar.unpacked/official-runtime/node_modules')
  const cli: unknown = JSON.parse(await readFile(join(core, '@deepseek-ai/dsh/package.json'), 'utf8'))
  const composition: unknown = JSON.parse(await readFile(join(physicalResources, 'app.asar.unpacked/desktop-composition.json'), 'utf8'))
  const provenance: unknown = JSON.parse(await readFile(join(physicalResources, 'app.asar.unpacked/official-runtime/provenance.json'), 'utf8'))
  const update: unknown = JSON.parse(await readFile(join(physicalResources, 'update-metadata.json'), 'utf8'))
  if (!record(cli) || cli.name !== '@deepseek-ai/dsh' || cli.version !== descriptor.harnessVersion
    || !record(cli.dependencies) || !record(composition) || Object.keys(composition).length !== 4 || composition.schema !== 1
    || composition.kind !== 'base' || composition.officialSha !== descriptor.officialSourceSha || composition.harnessVersion !== descriptor.harnessVersion
    || !record(provenance) || provenance.sourceSha !== descriptor.officialSourceSha
    || provenance.harnessVersion !== descriptor.harnessVersion
    || !record(update) || update.desktopVersion !== desktopVersion || update.harnessVersion !== descriptor.harnessVersion
    || update.platform !== descriptor.platform || update.arch !== descriptor.arch) throw new Error('Installed base runtime or native update identity is inconsistent.')
  const expected = createDesktopBaseSmokeDescriptor(desktopVersion, descriptor.platform, Object.keys(cli.dependencies))
  if (JSON.stringify(expected) !== JSON.stringify(descriptor)) {
    throw new Error('Smoke descriptor omits or replaces installed CLI dependency requirements.')
  }
  const paths = [...descriptor.requiredPaths.map(path => join(physicalResources, path.slice('resources/'.length))),
    join(physicalResources, 'update-metadata.json'), ...descriptor.requiredPackages.map(name => join(core, name, 'package.json'))]
  const files: BaseSmokeFile[] = []
  for (const path of paths) {
    await confinedBaseSmokePath(physicalResources, path)
    files.push(await baseSmokeFile(path))
  }
  return { mode: 'packaged', executable: await baseSmokeFile(executable), resourcesDirectory: physicalResources,
    appPath: await realpath(appPath), desktopVersion, harnessVersion: descriptor.harnessVersion,
    officialSourceSha: descriptor.officialSourceSha, files }
}

function insidePath(root: string, path: string): boolean {
  const local = relative(root, path)
  return local !== '' && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)
}
function mountRecordFor(appDir: string, appImage: string, mountInfo: string): string {
  const decode = (value: string) => value.replace(/\\([0-7]{3})/gu,
    (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
  const matches = mountInfo.split('\n').filter((line) => {
    const fields = line.split(' ')
    return fields[4] !== undefined && decode(fields[4]) === appDir
  })
  if (matches.length !== 1) throw new Error('Direct AppImage requires exactly one matching kernel mount record.')
  const line = matches[0]
  if (line === undefined) throw new Error('Direct AppImage mount record is missing.')
  const [mount, filesystem] = line.split(' - ')
  const fields = mount?.split(' ')
  const fs = filesystem?.split(' ')
  if (!fields || fields.length < 6 || !fs || fs.length < 3 || !/^fuse(?:\.AppImage)?$/u.test(fs[0] ?? '')
    || decode(fields[3] ?? '') !== '/' || decode(fs[1] ?? '') !== appImage
    || !(fields[5] ?? '').split(',').includes('ro')) {
    throw new Error('Direct AppImage mount source does not match the launched external image.')
  }
  return line
}
async function privateSnapshotPath(smokeRoot: string, snapshotRoot: string, path: string): Promise<void> {
  await confinedBaseSmokePath(smokeRoot, snapshotRoot)
  if (await realpath(snapshotRoot) !== snapshotRoot || !basename(snapshotRoot).startsWith('appimage-identity-')) {
    throw new Error('Invalid stable AppImage snapshot directory.')
  }
  let cursor = path
  for (;;) {
    const stat = await lstat(cursor)
    if (stat.isSymbolicLink() || (process.getuid !== undefined && stat.uid !== process.getuid())
      || (stat.isDirectory() ? (stat.mode & 0o777) !== 0o700 : !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)) {
      throw new Error('AppImage snapshot paths must be physical, private, and owned.')
    }
    if (cursor === snapshotRoot) break
    if (!insidePath(snapshotRoot, cursor)) throw new Error('Stable AppImage snapshot path escaped.')
    cursor = dirname(cursor)
  }
}

/**
 * Capture a directly launched AppImage while its native process and kernel mount still exist.
 * @param launchExecutable Exact external file passed to Electron launch, never an extracted application executable.
 * @param observed APPIMAGE, APPDIR, executable, resources, app path, and mountinfo read inside native main.
 * @param desktopVersion Actual packaged version reported by native main.
 * @param descriptor Fixed Linux stage descriptor.
 * @param smokeRoot Existing owned isolation root for exclusive stable snapshot creation.
 * @returns AppImage package hash, mounted identities, and complete private snapshots of required runtime bytes.
 */
export async function capturePackagedAppImageIdentity(
  launchExecutable: string, observed: BaseSmokeAppImageObservation, desktopVersion: string,
  descriptor: DesktopBaseSmokeDescriptor, smokeRoot: string,
): Promise<BaseSmokeInstalledIdentity> {
  if (descriptor.platform !== 'linux') throw new Error('Direct AppImage identity is Linux-only.')
  const executable = await baseSmokeFile(launchExecutable)
  const appImage = await baseSmokeFile(observed.appImage)
  const appDir = await realpath(observed.appDir)
  const nativeExecutable = await realpath(observed.executablePath)
  const resources = await realpath(observed.resourcesDirectory)
  const appPath = await realpath(observed.appPath)
  if (executable.path !== appImage.path || !executable.path.endsWith('.AppImage') || insidePath(appDir, executable.path)
    || appDir !== observed.appDir || !insidePath(appDir, nativeExecutable) || !insidePath(appDir, resources)
    || resources !== join(dirname(nativeExecutable), 'resources') || appPath !== join(resources, 'app.asar')) {
    throw new Error('Direct AppImage launch and native mounted paths differ.')
  }
  const mountRecord = mountRecordFor(appDir, executable.path, observed.mountInfo)
  const mounted = await capturePackagedBaseIdentity(nativeExecutable, resources, appPath, desktopVersion, descriptor)
  const root = await realpath(smokeRoot)
  const snapshotDirectory = await mkdtemp(join(root, 'appimage-identity-'))
  await chmod(snapshotDirectory, 0o700)
  const snapshotPaths = [join(snapshotDirectory, 'native-executable'),
    ...mounted.files.map(file => join(snapshotDirectory, 'resources', relative(resources, file.path)))]
  const sources = [mounted.executable, ...mounted.files]
  for (const [index, source] of sources.entries()) {
    const destination = snapshotPaths[index]
    if (destination === undefined) throw new Error('Missing stable snapshot destination.')
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await copyFile(source.path, destination, constants.COPYFILE_EXCL)
    await chmod(destination, 0o600)
    await privateSnapshotPath(root, snapshotDirectory, destination)
    const stable = await baseSmokeFile(destination)
    if (stable.bytes !== source.bytes || stable.sha256 !== source.sha256
      || JSON.stringify(await baseSmokeFile(source.path)) !== JSON.stringify(source)) throw new Error('AppImage bytes changed during stable capture.')
  }
  const snapshotExecutable = await baseSmokeFile(join(snapshotDirectory, 'native-executable'))
  const snapshotFiles = await Promise.all(snapshotPaths.slice(1).map(baseSmokeFile))
  if (JSON.stringify(await baseSmokeFile(executable.path)) !== JSON.stringify(executable)) throw new Error('External AppImage changed during capture.')
  return { ...mounted, mode: 'packaged-appimage', executable,
    appImage: { appDir, mountedExecutable: mounted.executable, mountRecord, snapshotDirectory, snapshotExecutable, snapshotFiles } }
}

/** Bind a later real mount of the same AppImage without copying or executing evidence snapshots.
 * @param installed Earlier direct-launch identity whose original mount may have disappeared.
 * @param observed Fresh native/kernel mount observations from the same external image.
 * @param descriptor Fixed stage requirements.
 * @returns Current mounted file locations, after comparing every required byte to the prior inventory.
 */
export async function verifyRemountedAppImageIdentity(installed: BaseSmokeInstalledIdentity,
  observed: BaseSmokeAppImageObservation, descriptor: DesktopBaseSmokeDescriptor): Promise<BaseSmokeInstalledIdentity> {
  const previous = installed.appImage
  if (installed.mode !== 'packaged-appimage' || previous === undefined || descriptor.platform !== 'linux') {
    throw new Error('AppImage continuation requires a prior direct identity.')
  }
  const image = await baseSmokeFile(observed.appImage)
  if (image.path !== installed.executable.path || image.sha256 !== installed.executable.sha256
    || image.bytes !== installed.executable.bytes) {
    throw new Error('Remounted AppImage differs from the original external package.')
  }
  const appDir = await realpath(observed.appDir)
  if (appDir !== observed.appDir || !insidePath(appDir, await realpath(observed.executablePath))
    || !insidePath(appDir, await realpath(observed.resourcesDirectory))) throw new Error('Remounted native paths escape the AppImage.')
  mountRecordFor(appDir, image.path, observed.mountInfo)
  const mounted = await capturePackagedBaseIdentity(observed.executablePath, observed.resourcesDirectory,
    observed.appPath, installed.desktopVersion, descriptor)
  if (mounted.executable.bytes !== previous.mountedExecutable.bytes || mounted.executable.sha256 !== previous.mountedExecutable.sha256
    || relative(appDir, mounted.executable.path) !== relative(previous.appDir, previous.mountedExecutable.path)
    || mounted.files.length !== installed.files.length) throw new Error('Remounted executable or required inventory changed.')
  for (const [index, file] of mounted.files.entries()) {
    const old = installed.files[index]!
    if (relative(appDir, file.path) !== relative(previous.appDir, old.path) || file.bytes !== old.bytes || file.sha256 !== old.sha256) {
      throw new Error('Remounted required bytes differ from the original AppImage.')
    }
  }
  return mounted
}

/**
 * Recheck a direct AppImage after native exit, without requiring the vanished mount or relaunching an extracted application.
 * @param installed Saved direct-AppImage identity and required-byte snapshot inventory.
 * @param descriptor Expected fixed Linux stage descriptor.
 * @param smokeRoot Owned root containing the stable private snapshot.
 * @returns Resolves only if the external image and every corresponding captured runtime byte still match.
 */
export async function verifyPackagedAppImageIdentity(
  installed: BaseSmokeInstalledIdentity, descriptor: DesktopBaseSmokeDescriptor, smokeRoot: string,
): Promise<void> {
  if (installed.mode !== 'packaged-appimage' || descriptor.platform !== 'linux' || !record(installed.appImage)) {
    throw new Error('Invalid direct AppImage receipt mode or platform.')
  }
  const snapshot = installed.appImage
  if (JSON.stringify(Object.keys(snapshot).sort()) !== JSON.stringify(['appDir', 'mountedExecutable', 'mountRecord',
    'snapshotDirectory', 'snapshotExecutable', 'snapshotFiles'].sort()) || typeof snapshot.appDir !== 'string'
    || !isAbsolute(snapshot.appDir) || typeof snapshot.mountRecord !== 'string' || typeof snapshot.snapshotDirectory !== 'string'
    || !Array.isArray(snapshot.snapshotFiles) || !record(snapshot.mountedExecutable) || typeof snapshot.mountedExecutable.path !== 'string'
    || !insidePath(snapshot.appDir, snapshot.mountedExecutable.path) || insidePath(snapshot.appDir, installed.executable.path)
    || installed.resourcesDirectory !== join(dirname(snapshot.mountedExecutable.path), 'resources')
    || installed.appPath !== join(installed.resourcesDirectory, 'app.asar')) throw new Error('Invalid AppImage mount/snapshot identity.')
  await checkedFile(installed.executable)
  if (!installed.executable.path.endsWith('.AppImage')) throw new Error('Direct AppImage receipt does not name an external image.')
  if (mountRecordFor(snapshot.appDir, installed.executable.path, snapshot.mountRecord) !== snapshot.mountRecord) throw new Error('Changed AppImage mount record.')
  for (const file of [snapshot.snapshotExecutable, ...snapshot.snapshotFiles]) {
    await checkedFile(file, smokeRoot)
    await privateSnapshotPath(smokeRoot, snapshot.snapshotDirectory, file.path)
  }
  if (snapshot.snapshotExecutable.path !== join(snapshot.snapshotDirectory, 'native-executable')) throw new Error('Unexpected stable executable filename.')
  const stable = await capturePackagedBaseIdentity(snapshot.snapshotExecutable.path, join(snapshot.snapshotDirectory, 'resources'),
    join(snapshot.snapshotDirectory, 'resources/app.asar'), installed.desktopVersion, descriptor)
  if (JSON.stringify(stable.files) !== JSON.stringify(snapshot.snapshotFiles)
    || stable.harnessVersion !== installed.harnessVersion || stable.officialSourceSha !== installed.officialSourceSha
    || snapshot.mountedExecutable.bytes !== stable.executable.bytes || snapshot.mountedExecutable.sha256 !== stable.executable.sha256) {
    throw new Error('Stable AppImage inventory or executable bytes differ.')
  }
  const mountedFiles = stable.files.map(file => ({ ...file,
    path: join(installed.resourcesDirectory, relative(join(snapshot.snapshotDirectory, 'resources'), file.path)) }))
  if (JSON.stringify(mountedFiles) !== JSON.stringify(installed.files)) throw new Error('Mounted AppImage required bytes differ from the stable snapshot.')
}

function requiredChecks(platform: NodeJS.Platform): BaseSmokeCheck[] {
  return (Object.keys(BASE_SMOKE_EVENTS) as BaseSmokeCheck[]).filter(check => check !== 'windowsDirectoryPicker' || platform === 'win32')
}

async function requireUnattemptedPause(receipt: PackagedDesktopBaseSmokeReceipt): Promise<void> {
  for (const name of ['pauseRecovery.json', 'pauseRecovery-attempt.json']) {
    try {
      await lstat(join(receipt.smokeRoot, 'checks', name))
      throw new Error('Pause/recovery was attempted; core scope cannot exclude its result or cleanup.')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
}

function coreChecksPassed(receipt: PackagedDesktopBaseSmokeReceipt): boolean {
  return receipt.installed.mode !== 'development-stage'
    && requiredChecks(receipt.platform).filter(check => check !== 'pauseRecovery').every(check => receipt.checks[check]?.status === 'passed')
}

async function checkEvidence(
  receipt: PackagedDesktopBaseSmokeReceipt, check: BaseSmokeCheck, file: unknown,
): Promise<BaseSmokeFile[]> {
  const actual = await checkedFile(file, receipt.smokeRoot)
  if (actual.path !== await realpath(join(receipt.smokeRoot, 'checks', `${check}.json`))) throw new Error('Smoke evidence uses an unexpected scenario filename.')
  const value: unknown = JSON.parse(await readFile(actual.path, 'utf8'))
  if (!record(value) || value.schema !== 1 || value.runId !== receipt.runId || value.check !== check || value.status !== 'passed'
    || value.descriptorSha256 !== receipt.descriptor.sha256 || value.executableSha256 !== receipt.installed.executable.sha256
    || JSON.stringify(value.events) !== JSON.stringify(BASE_SMOKE_EVENTS[check]) || !record(value.facts)) throw new Error(`Missing observed events for base smoke ${check}.`)
  const facts = value.facts
  if (check === 'firstRun') {
    const bounds = facts.bounds
    const area = facts.workArea
    if (facts.continueHit !== true || !record(bounds) || !record(area)
      || [bounds.x, bounds.y, bounds.width, bounds.height, area.x, area.y, area.width, area.height]
        .some(value => typeof value !== 'number' || !Number.isFinite(value))
      || Number(bounds.width) <= 0 || Number(bounds.height) <= 0
      || Number(bounds.x) < Number(area.x) || Number(bounds.y) < Number(area.y)
      || Number(bounds.x) + Number(bounds.width) > Number(area.x) + Number(area.width)
      || Number(bounds.y) + Number(bounds.height) > Number(area.y) + Number(area.height)) throw new Error('Native first-run viewport evidence is incomplete.')
  }
  if (['reload', 'reopen', 'restart', 'title'].includes(check)
    && (facts.sessionId !== receipt.activeSessionId || facts.title !== receipt.activeSessionTitle)) throw new Error('Smoke session identity changed between native scenarios.')
  if (check === 'modelTurn' && (facts.acceptedRequests !== 1 || facts.acceptedTitleRequests !== 1 || facts.phase !== 'completed'
    || JSON.stringify(facts.unexpectedRequests) !== '[]' || facts.reasoningVisible !== true || facts.unicodeVisible !== true || facts.markdownVisible !== true)) throw new Error('The native provider or reader scenario did not complete.')
  if (check === 'systemUpdate' && (facts.desktopVersion !== receipt.installed.desktopVersion || facts.harnessVersion !== receipt.installed.harnessVersion
    || facts.platform !== receipt.platform)) throw new Error('Native settings versions do not match the installed application.')
  if (check === 'processCleanup' && (!Array.isArray(facts.pids) || facts.pids.length === 0 || facts.pids.some(pid => !Number.isSafeInteger(pid) || Number(pid) <= 0)
    || JSON.stringify(facts.alivePids) !== '[]')) throw new Error('Owned native processes lack cleanup evidence.')
  if (check === 'portCleanup' && (!Array.isArray(facts.ports) || facts.ports.length === 0
    || facts.ports.some(port => !Number.isSafeInteger(port) || Number(port) <= 0 || Number(port) > 65535)
    || JSON.stringify(facts.listeningPorts) !== '[]')) throw new Error('Owned native ports lack cleanup evidence.')
  if (check === 'legacyCompatibility') {
    const baseline = desktopBaseLegacyBaseline(receipt.platform)
    if (facts.desktopVersion !== baseline.desktopVersion || facts.harnessVersion !== baseline.harnessVersion
      || facts.sourceSha !== baseline.sourceSha || !record(facts.fixtureReceipt)
      || facts.oldReaderVerified !== true || facts.oldWorkspacePreserved !== true || facts.oldSessionReopened !== true) throw new Error('Actual historical fixture evidence is incomplete.')
    const fixtureFile = await checkedFile(facts.fixtureReceipt, receipt.smokeRoot)
    const fixture = await verifyBaseLegacyFixture(fixtureFile.path, { isolationRoot: receipt.smokeRoot, platform: receipt.platform })
    if (facts.legacySessionId !== fixture.sessionId) throw new Error('Historical native evidence names another session.')
    return await Promise.all(fixture.protectedPaths.map(async (path) => {
      return await baseSmokeFile(await confinedBaseSmokePath(receipt.smokeRoot, path))
    }))
  }
  if (check === 'pauseRecovery' && ((receipt.installed.mode !== 'development-stage' && facts.confirmation !== 'native-dialog-clicked')
    || facts.activeSessionId !== receipt.activeSessionId || facts.persistedPausedState !== true
    || typeof facts.bundleName !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(facts.bundleName)
    || typeof facts.failedVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/iu.test(facts.failedVersion)
    || typeof facts.restoredVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?(?:\+[a-z0-9.-]+)?$/iu.test(facts.restoredVersion)
    || facts.restoredPluginActive !== true || facts.userChoicePreserved !== true
    || ['sessionId', 'restoredPausedState', 'resumedCompleted'].some(key => Object.hasOwn(facts, key))
    || !Array.isArray(facts.pids) || facts.pids.length === 0 || facts.pids.some(pid => !Number.isSafeInteger(pid) || Number(pid) <= 0)
    || !Array.isArray(facts.ports) || facts.ports.length === 0
    || facts.ports.some(port => !Number.isSafeInteger(port) || Number(port) <= 0 || Number(port) > 65535)
    || JSON.stringify(facts.alivePids) !== '[]' || JSON.stringify(facts.listeningPorts) !== '[]')) throw new Error('Actual pause/recovery evidence is incomplete.')
  return []
}

async function verifyNativeCleanup(receipt: PackagedDesktopBaseSmokeReceipt, scope: 'full' | 'core' = 'full'): Promise<void> {
  if (receipt.platform !== process.platform) throw new Error('Final native smoke verification requires its actual host platform.')
  const pids = new Set<number>()
  const ports = new Set<number>()
  for (const check of ['processCleanup', 'portCleanup', 'pauseRecovery'] as const) {
    const result = receipt.checks[check]
    if (check === 'pauseRecovery' && scope === 'core' && result?.status === 'not-run') {
      await requireUnattemptedPause(receipt)
      continue
    }
    if (result?.status !== 'passed') throw new Error('Missing final native cleanup evidence.')
    const evidence = JSON.parse(await readFile(result.evidence.path, 'utf8')) as BaseSmokeEvidence
    if (Array.isArray(evidence.facts.pids)) for (const pid of evidence.facts.pids) pids.add(Number(pid))
    if (Array.isArray(evidence.facts.ports)) for (const port of evidence.facts.ports) ports.add(Number(port))
  }
  for (const pid of pids) {
    try { process.kill(pid, 0) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') continue
      throw error
    }
    throw new Error(`Recorded native smoke process is still alive: ${String(pid)}`)
  }
  for (const port of ports) {
    const listening = await new Promise<boolean>((resolvePort) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      const finish = (open: boolean): void => { socket.destroy(); resolvePort(open) }
      socket.once('connect', () => { finish(true) })
      socket.once('error', () => { finish(false) })
      socket.setTimeout(500, () => { finish(false) })
    })
    if (listening) throw new Error(`Recorded native smoke port is still listening: ${String(port)}`)
  }
}

async function loadReceipt(
  path: string, options: BaseSmokeReceiptVerification, complete: boolean,
): Promise<PackagedDesktopBaseSmokeReceipt> {
  const scope = options.scope ?? 'full'
  if (scope !== 'full' && scope !== 'core') throw new Error('Unknown base smoke acceptance scope.')
  const root = await realpath(options.smokeRoot)
  const physical = await confinedBaseSmokePath(root, path)
  if (physical !== join(root, 'base-smoke-receipt.json')) throw new Error('The base smoke receipt must use its fixed filename.')
  const value: unknown = JSON.parse(await readFile(physical, 'utf8'))
  if (!record(value) || value.schema !== 1 || value.composition !== 'base' || value.platform !== options.platform || value.arch !== 'x64'
    || value.smokeRoot !== root || typeof value.runId !== 'string' || value.runId.length === 0 || !record(value.installed)
    || !record(value.checks) || !Array.isArray(value.protectedFiles) || value.protectedFiles.length === 0
    || typeof value.activeSessionId !== 'string' || value.activeSessionId.length === 0 || typeof value.activeSessionTitle !== 'string' || value.activeSessionTitle.length === 0
    || typeof value.primaryDisplayScaleFactor !== 'number' || !Number.isFinite(value.primaryDisplayScaleFactor) || value.primaryDisplayScaleFactor <= 0
    || typeof value.rendererDevicePixelRatio !== 'number' || !Number.isFinite(value.rendererDevicePixelRatio) || value.rendererDevicePixelRatio <= 0) throw new Error('Invalid base smoke receipt identity.')
  const receipt = value as unknown as PackagedDesktopBaseSmokeReceipt
  for (const pathValue of [receipt.harnessHome, receipt.userData, receipt.workspacePath]) {
    if (typeof pathValue !== 'string') throw new Error('Missing smoke isolation path.')
    await confinedBaseSmokePath(root, pathValue)
  }
  const descriptorFile = await checkedFile(receipt.descriptor)
  if (descriptorFile.path !== await realpath(options.descriptorPath)) throw new Error('Smoke descriptor is not the expected stage input.')
  const descriptor = validateDesktopBaseSmokeDescriptor(JSON.parse(await readFile(descriptorFile.path, 'utf8')) as unknown)
  if (descriptor.platform !== options.platform) throw new Error('Smoke descriptor targets another platform.')
  const protectedPaths = new Set<string>()
  for (const file of receipt.protectedFiles) {
    const checked = await checkedFile(file, root)
    if (protectedPaths.has(checked.path)) throw new Error('Duplicate protected smoke file.')
    protectedPaths.add(checked.path)
  }
  await checkedFile(receipt.installed.executable)
  if (receipt.installed.mode === 'packaged') {
    const actual = await capturePackagedBaseIdentity(receipt.installed.executable.path, receipt.installed.resourcesDirectory,
      receipt.installed.appPath, receipt.installed.desktopVersion, descriptor)
    if (JSON.stringify(actual) !== JSON.stringify(receipt.installed)) throw new Error('Installed smoke application bytes changed.')
  } else if (receipt.installed.mode === 'packaged-appimage') {
    await verifyPackagedAppImageIdentity(receipt.installed, descriptor, root)
  } else if (receipt.installed.mode !== 'development-stage' || complete) throw new Error('Development-stage evidence is not packaged native acceptance.')
  const checks = requiredChecks(options.platform)
  if (Object.keys(receipt.checks).some(check => !checks.includes(check as BaseSmokeCheck))) throw new Error('Unknown base smoke scenario.')
  for (const check of checks) {
    const result = receipt.checks[check]
    if (result?.status === 'passed') {
      const historicalFiles = await checkEvidence(receipt, check, result.evidence)
      const missingHistoricalFile = historicalFiles.some(file =>
        !receipt.protectedFiles.some(protectedFile => JSON.stringify(file) === JSON.stringify(protectedFile)))
      if (missingHistoricalFile) {
        throw new Error('Historical files are missing from the final protected inventory.')
      }
    }
    else if ((complete && !(scope === 'core' && check === 'pauseRecovery'))
      || result?.status !== 'not-run' || typeof result.reason !== 'string' || result.reason.length === 0) {
      throw new Error(`Required base smoke scenario is not complete: ${check}`)
    }
  }
  const passed = receipt.installed.mode !== 'development-stage' && checks.every(check => receipt.checks[check]?.status === 'passed')
  const corePassed = coreChecksPassed(receipt) && receipt.checks.pauseRecovery?.status === 'not-run'
  if (receipt.outcome !== (passed ? 'passed' : 'partial') && !(receipt.outcome === 'core-passed' && corePassed)) {
    throw new Error('Smoke outcome does not match the required native scenarios.')
  }
  if (complete) {
    await verifyNativeCleanup(receipt, scope)
    if (scope === 'core' && !passed) return { ...receipt, outcome: 'core-passed' }
  }
  return receipt
}

/**
 * Require packaged evidence for the explicit scope; full includes pause/recovery by default.
 * @param path - fixed base-smoke-receipt.json in the owned smoke root.
 * @param options - exact platform, descriptor and isolation directory supplied by the native driver.
 * @returns Verified receipt; core-passed explicitly leaves pause/recovery unverified. Development stages are rejected.
 */
export async function verifyPackagedDesktopBaseSmokeReceipt(
  path: string, options: BaseSmokeReceiptVerification,
): Promise<PackagedDesktopBaseSmokeReceipt> {
  return await loadReceipt(path, options, true)
}

/**
 * Add only the two separately owned continuation scenarios from concrete named event files.
 * @param path - existing fixed partial receipt.
 * @param evidence - specifically named legacy and/or pause/recovery evidence files.
 * @param options - expected platform, descriptor and isolation root.
 * @returns Updated receipt marked passed, core-passed or partial for the requested scope.
 */
export async function completePackagedDesktopBaseSmokeReceipt(
  path: string, evidence: { legacyCompatibility?: string; pauseRecovery?: string }, options: BaseSmokeReceiptVerification,
): Promise<PackagedDesktopBaseSmokeReceipt> {
  const receipt = await loadReceipt(path, options, false)
  if (Object.keys(evidence).length === 0 || Object.keys(evidence).some(key => key !== 'legacyCompatibility' && key !== 'pauseRecovery')) throw new Error('Continuation requires named legacy or pause/recovery evidence.')
  for (const check of ['legacyCompatibility', 'pauseRecovery'] as const) {
    const evidencePath = evidence[check]
    if (evidencePath === undefined) continue
    const file = await baseSmokeFile(await confinedBaseSmokePath(options.smokeRoot, evidencePath))
    const historicalFiles = await checkEvidence(receipt, check, file)
    for (const historicalFile of historicalFiles) {
      if (!receipt.protectedFiles.some(protectedFile => protectedFile.path === historicalFile.path)) {
        receipt.protectedFiles.push(historicalFile)
      }
    }
    receipt.checks[check] = { status: 'passed', evidence: file }
  }
  receipt.outcome = receipt.installed.mode !== 'development-stage' && requiredChecks(receipt.platform).every(check => receipt.checks[check]?.status === 'passed')
    ? 'passed' : options.scope === 'core' && coreChecksPassed(receipt) && receipt.checks.pauseRecovery?.status === 'not-run' ? 'core-passed' : 'partial'
  if (receipt.outcome !== 'partial') await verifyNativeCleanup(receipt, options.scope)
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}
