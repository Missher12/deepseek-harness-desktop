import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopBaseSmokeDescriptor, desktopBaseLegacyBaseline } from '../../../scripts/desktop-base-contract.ts'
import { verifyDesktopBaseSmoke } from '../../../scripts/verify-desktop-base-smoke.ts'
import * as legacyReader from './base-legacy-fixture.ts'
import { BASE_SMOKE_EVENTS, baseSmokeFile, capturePackagedBaseIdentity, capturePackagedAppImageIdentity,
  verifyPackagedAppImageIdentity, verifyRemountedAppImageIdentity, completePackagedDesktopBaseSmokeReceipt,
  verifyPackagedDesktopBaseSmokeReceipt, type BaseSmokeCheck, type PackagedDesktopBaseSmokeReceipt } from './base-smoke-receipt.ts'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function put(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

async function fixture(platform: 'win32' | 'linux' | 'darwin' = 'win32') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-base-receipt-test-')))
  roots.push(root)
  const smokeRoot = join(root, 'smoke')
  const resources = join(root, 'installed/resources')
  const core = join(resources, 'app.asar.unpacked/official-runtime/node_modules')
  const descriptor = createDesktopBaseSmokeDescriptor('0.6.0', platform, [])
  const descriptorPath = join(root, 'base-smoke.json')
  await put(descriptorPath, JSON.stringify(descriptor))
  for (const path of descriptor.requiredPaths) await put(join(root, 'installed', path), 'Synthetic verifier file fixture; not a native artifact.\n')
  for (const name of descriptor.requiredPackages) await put(join(core, name, 'package.json'), JSON.stringify({ name, version: '0.1.5-rc.2' }))
  await put(join(core, '@deepseek-ai/dsh/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.2', dependencies: {} }))
  await put(join(resources, 'app.asar.unpacked/desktop-composition.json'), JSON.stringify({ schema: 1, kind: 'base',
    officialSha: descriptor.officialSourceSha, harnessVersion: descriptor.harnessVersion }))
  await put(join(resources, 'app.asar.unpacked/official-runtime/provenance.json'), JSON.stringify({ sourceSha: descriptor.officialSourceSha, harnessVersion: descriptor.harnessVersion }))
  await put(join(resources, 'update-metadata.json'), JSON.stringify({ desktopVersion: '0.6.0', harnessVersion: '0.1.5-rc.2', platform, arch: 'x64' }))
  const executable = join(root, 'installed/desktop.exe')
  await put(executable, 'Synthetic executable fixture; never executed.\n')
  for (const child of ['home', 'userdata', 'workspace']) await mkdir(join(smokeRoot, child), { recursive: true })
  const protectedPath = join(smokeRoot, 'workspace/protected.txt')
  await put(protectedPath, 'keep')
  const installed = await capturePackagedBaseIdentity(executable, resources, join(resources, 'app.asar'), '0.6.0', descriptor)
  const receipt: PackagedDesktopBaseSmokeReceipt = {
    schema: 1, composition: 'base', runId: 'synthetic-verifier-fixture', platform, arch: 'x64', outcome: 'partial',
    descriptor: await baseSmokeFile(descriptorPath), installed, smokeRoot, harnessHome: join(smokeRoot, 'home'),
    userData: join(smokeRoot, 'userdata'), workspacePath: join(smokeRoot, 'workspace'), activeSessionId: 'session-fixture',
    activeSessionTitle: 'Native reader presentation', protectedFiles: [await baseSmokeFile(protectedPath)],
    primaryDisplayScaleFactor: 1.25, rendererDevicePixelRatio: 1.25, checks: {},
  }
  for (const check of Object.keys(BASE_SMOKE_EVENTS) as BaseSmokeCheck[]) {
    if (platform !== 'win32' && check === 'windowsDirectoryPicker') continue
    if (check === 'legacyCompatibility' || check === 'pauseRecovery') {
      receipt.checks[check] = { status: 'not-run', reason: 'No real historical/pause scenario exists in this verifier fixture.' }
      continue
    }
    const path = join(smokeRoot, 'checks', `${check}.json`)
    const facts = { sessionId: receipt.activeSessionId, title: receipt.activeSessionTitle,
      acceptedRequests: 1, acceptedTitleRequests: 1, phase: 'completed', unexpectedRequests: [],
      reasoningVisible: true, unicodeVisible: true, markdownVisible: true,
      desktopVersion: '0.6.0', harnessVersion: '0.1.5-rc.2', platform, pids: [123], alivePids: [], ports: [12345], listeningPorts: [],
      continueHit: true, bounds: { x: 0, y: 0, width: 900, height: 600 }, workArea: { x: 0, y: 0, width: 1200, height: 800 } }
    await put(path, JSON.stringify({ schema: 1, runId: receipt.runId, check, status: 'passed', descriptorSha256: receipt.descriptor.sha256,
      executableSha256: receipt.installed.executable.sha256, events: BASE_SMOKE_EVENTS[check], facts }))
    receipt.checks[check] = { status: 'passed', evidence: await baseSmokeFile(path) }
  }
  const receiptPath = join(smokeRoot, 'base-smoke-receipt.json')
  const save = async () => { await put(receiptPath, JSON.stringify(receipt)) }
  await save()
  return { receipt, receiptPath, descriptor, descriptorPath, smokeRoot, resources, core, executable, protectedPath, save,
    options: { platform, descriptorPath, smokeRoot } }
}

// Only the historical-reader seam is substituted for scope unit tests; its real verifier tests remain above and below.
async function coreFixture() {
  if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('Native fixture platform required')
  const f = await fixture(process.platform)
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await once(child, 'close')
  if (child.pid === undefined) throw new Error('Owned fixture process did not start')
  const server = createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Owned fixture port missing')
  await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  for (const check of ['processCleanup', 'portCleanup'] as const) {
    const path = join(f.smokeRoot, 'checks', `${check}.json`)
    const evidence = JSON.parse(await readFile(path, 'utf8')) as { facts: Record<string, unknown> }
    evidence.facts.pids = [child.pid]; evidence.facts.ports = [address.port]
    await put(path, JSON.stringify(evidence))
    f.receipt.checks[check] = { status: 'passed', evidence: await baseSmokeFile(path) }
  }
  const baseline = desktopBaseLegacyBaseline(process.platform)
  const fixtureReceiptPath = join(f.smokeRoot, 'synthetic-history-reader.json')
  await put(fixtureReceiptPath, JSON.stringify({ unitTestOnly: true }))
  vi.spyOn(legacyReader, 'verifyBaseLegacyFixture').mockResolvedValue({ oldVersion: baseline.desktopVersion,
    harnessVersion: baseline.harnessVersion, sourceSha: baseline.sourceSha, sessionId: 'old-session', title: 'Old session',
    workspacePath: f.receipt.workspacePath, protectedPaths: [f.protectedPath], fixtureReceiptPath,
    dshHome: f.receipt.harnessHome, protectedFiles: [] })
  const history = join(f.smokeRoot, 'checks/legacyCompatibility.json')
  await put(history, JSON.stringify({ schema: 1, runId: f.receipt.runId, check: 'legacyCompatibility', status: 'passed',
    descriptorSha256: f.receipt.descriptor.sha256, executableSha256: f.receipt.installed.executable.sha256,
    events: BASE_SMOKE_EVENTS.legacyCompatibility, facts: { ...baseline, fixtureReceipt: await baseSmokeFile(fixtureReceiptPath),
      oldReaderVerified: true, oldWorkspacePreserved: true, oldSessionReopened: true, legacySessionId: 'old-session' } }))
  f.receipt.checks.legacyCompatibility = { status: 'passed', evidence: await baseSmokeFile(history) }
  await f.save()
  return { ...f, history, deadPid: child.pid, closedPort: address.port, coreOptions: { ...f.options, scope: 'core' as const } }
}

describe('explicit core acceptance scope with a substituted historical reader', () => {
  it('reports core-passed and unverified recovery without upgrading the default full gate', async () => {
    const f = await coreFixture()
    const completed = await completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { legacyCompatibility: f.history }, f.coreOptions)
    expect(completed.outcome).toBe('core-passed')
    expect(completed.checks.pauseRecovery?.status).toBe('not-run')
    expect((await verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.coreOptions)).outcome).toBe('core-passed')
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/pauseRecovery/)
    expect(await verifyDesktopBaseSmoke(['--receipt', f.receiptPath, '--descriptor', f.descriptorPath,
      '--smoke-root', f.smokeRoot, '--platform', process.platform, '--scope', 'core']))
      .toEqual({ scope: 'core', outcome: 'core-passed', unverifiedChecks: ['pauseRecovery'] })
  })

  it.each(['legacyCompatibility', 'modelTurn', 'restart', 'processCleanup', 'portCleanup'] as const)('still requires %s', async (check) => {
    const f = await coreFixture()
    f.receipt.checks[check] = { status: 'not-run', reason: 'Required scenario was not executed' }; await f.save()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.coreOptions)).rejects.toThrow(new RegExp(check))
  })

  it.each(['pauseRecovery.json', 'pauseRecovery-attempt.json'])('cannot hide an attempted recovery behind not-run: %s', async (name) => {
    const f = await coreFixture()
    await put(join(f.smokeRoot, 'checks', name), JSON.stringify({ status: 'failed' }))
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.coreOptions)).rejects.toThrow(/attempted/)
  })

  it('rejects a failed recovery result, development stage, or changed preserved data in core scope', async () => {
    const f = await coreFixture()
    Object.assign(f.receipt.checks, { pauseRecovery: { status: 'failed', reason: 'actual failure' } }); await f.save()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.coreOptions)).rejects.toThrow(/pauseRecovery/)
    f.receipt.checks.pauseRecovery = { status: 'not-run', reason: 'not attempted' }
    f.receipt.installed.mode = 'development-stage'; await f.save()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.coreOptions)).rejects.toThrow(/Development-stage/)
    f.receipt.installed.mode = 'packaged'; await f.save(); await writeFile(f.protectedPath, 'changed')
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.coreOptions)).rejects.toThrow(/hash changed/)
  })

  it('checks recovery cleanup even when core scope was explicitly requested', async () => {
    const f = await coreFixture()
    const path = join(f.smokeRoot, 'checks/pauseRecovery.json')
    await put(path, JSON.stringify({ schema: 1, runId: f.receipt.runId, check: 'pauseRecovery', status: 'passed',
      descriptorSha256: f.receipt.descriptor.sha256, executableSha256: f.receipt.installed.executable.sha256,
      events: BASE_SMOKE_EVENTS.pauseRecovery, facts: { activeSessionId: f.receipt.activeSessionId,
        bundleName: 'probe', failedVersion: '1.0.0', restoredVersion: '1.0.1', persistedPausedState: true,
        restoredPluginActive: true, userChoicePreserved: true, confirmation: 'native-dialog-clicked',
        pids: [process.pid], ports: [f.closedPort], alivePids: [], listeningPorts: [] } }))
    const result = completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { pauseRecovery: path }, f.coreOptions)
    await expect(result).rejects.toThrow(/still alive/)
  })

  it('does not treat an unknown process-inspection result as clean', async () => {
    const f = await coreFixture()
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('Inspection denied'), { code: 'EPERM' }) })
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.coreOptions)).rejects.toThrow(/Inspection denied/)
  })
})

describe('strict receipt rejection with synthetic filesystem fixtures', () => {
  it('rejects core-only evidence until actual historical and pause/recovery checks exist', async () => {
    const f = await fixture()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/legacyCompatibility/u)
  })

  it('rejects a caller relabeling a partial receipt as passed', async () => {
    const f = await fixture()
    f.receipt.outcome = 'passed'
    await f.save()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow()
  })

  it('rehashes protected bytes instead of trusting saved successful checks', async () => {
    const f = await fixture()
    await writeFile(f.protectedPath, 'changed')
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/hash changed/u)
  })

  it('rejects a protected file replaced by an external symlink', async () => {
    const f = await fixture()
    const external = join(dirname(f.smokeRoot), 'external.txt')
    await writeFile(external, 'keep')
    await rm(f.protectedPath)
    await symlink(external, f.protectedPath)
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/outside|regular file/u)
  })

  it('binds receipt evidence to the exact descriptor file', async () => {
    const f = await fixture()
    const another = join(dirname(f.descriptorPath), 'another-descriptor.json')
    await writeFile(another, await readFile(f.descriptorPath))
    const options = { ...f.options, descriptorPath: another }
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, options)).rejects.toThrow(/expected stage input/u)
  })

  it('rejects changed installed executable bytes', async () => {
    const f = await fixture()
    await writeFile(f.executable, 'another executable')
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/hash changed/u)
  })

  it('derives descriptor requirements from actual installed CLI dependencies', async () => {
    const f = await fixture()
    await put(join(f.core, '@deepseek-ai/dsh/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.2', dependencies: { '@deepseek-ai/dsh-base': '0.1.5-rc.2' } }))
    await expect(capturePackagedBaseIdentity(f.executable, f.resources, join(f.resources, 'app.asar'), '0.6.0', f.descriptor)).rejects.toThrow(/dependency requirements/u)
  })

  it('rejects development-stage evidence at the final packaged verifier', async () => {
    const f = await fixture()
    f.receipt.installed.mode = 'development-stage'
    await f.save()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/Development-stage/u)
  })

  it('requires the fixed receipt filename inside the isolation root', async () => {
    const f = await fixture()
    const other = join(f.smokeRoot, 'other.json')
    await writeFile(other, await readFile(f.receiptPath))
    await expect(verifyPackagedDesktopBaseSmokeReceipt(other, f.options)).rejects.toThrow(/fixed filename/u)
  })

  it('rejects empty or invented observed event sequences', async () => {
    const f = await fixture()
    const path = join(f.smokeRoot, 'checks/modelTurn.json')
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    value.events = ['passed']
    await writeFile(path, JSON.stringify(value))
    f.receipt.checks.modelTurn = { status: 'passed', evidence: await baseSmokeFile(path) }
    await f.save()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/observed events/u)
  })

  it('requires an actual reachable first-run Continue control', async () => {
    const f = await fixture()
    const path = join(f.smokeRoot, 'checks/firstRun.json')
    const value = JSON.parse(await readFile(path, 'utf8')) as { facts: Record<string, unknown> }
    value.facts.continueHit = false
    await writeFile(path, JSON.stringify(value))
    f.receipt.checks.firstRun = { status: 'passed', evidence: await baseSmokeFile(path) }
    await f.save()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/first-run/u)
  })

  it('does not accept an arbitrary filename as a successful continuation', async () => {
    const f = await fixture()
    const path = join(f.smokeRoot, 'arbitrary.json')
    await writeFile(path, '{}')
    await expect(completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { legacyCompatibility: path }, f.options)).rejects.toThrow()
    expect(JSON.parse(await readFile(f.receiptPath, 'utf8'))).toEqual(f.receipt)
  })

  it('refuses plugin-restoration assertions without actual continuation cleanup observations', async () => {
    const f = await fixture()
    const path = join(f.smokeRoot, 'checks/pauseRecovery.json')
    await put(path, JSON.stringify({ schema: 1, runId: f.receipt.runId, check: 'pauseRecovery', status: 'passed',
      descriptorSha256: f.receipt.descriptor.sha256, executableSha256: f.receipt.installed.executable.sha256,
      events: BASE_SMOKE_EVENTS.pauseRecovery, facts: { bundleName: 'fixture-evolution', failedVersion: '0.7.0',
        restoredVersion: '0.7.1', activeSessionId: f.receipt.activeSessionId,
        persistedPausedState: true, restoredPluginActive: true, userChoicePreserved: true } }))
    const completed = completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { pauseRecovery: path }, f.options)
    await expect(completed).rejects.toThrow(/pause\/recovery/u)
  })

  it('accepts the concrete Bundle pause and validated restoration chain without completing unrelated scenarios', async () => {
    const f = await fixture()
    const path = join(f.smokeRoot, 'checks/pauseRecovery.json')
    await put(path, JSON.stringify({ schema: 1, runId: f.receipt.runId, check: 'pauseRecovery', status: 'passed',
      descriptorSha256: f.receipt.descriptor.sha256, executableSha256: f.receipt.installed.executable.sha256,
      events: ['bundle-observed', 'attributable-load-failed', 'bundle-excluded-before-parse', 'canonical-cli-reconciled',
        'paused-state-survived-restart', 'candidate-host-validated', 'bundle-restored', 'conversation-completed',
        'all-owned-pids-gone', 'ports-closed'],
      facts: { bundleName: 'fixture-evolution', failedVersion: '0.7.0', restoredVersion: '0.7.1',
        activeSessionId: f.receipt.activeSessionId, persistedPausedState: true, restoredPluginActive: true,
        userChoicePreserved: true, confirmation: 'native-dialog-clicked', pids: [123], ports: [12345], alivePids: [], listeningPorts: [] } }))
    const receipt = await completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { pauseRecovery: path }, f.options)
    expect(receipt.outcome).toBe('partial')
    expect(receipt.checks.pauseRecovery?.status).toBe('passed')
    expect(receipt.checks.legacyCompatibility?.status).toBe('not-run')
  })

  it.each(['bundleName', 'failedVersion', 'restoredVersion', 'activeSessionId',
    'userChoicePreserved', 'confirmation', 'session-pause'])(
    'rejects an incomplete or substituted Bundle recovery field: %s', async (field) => {
      const f = await fixture()
      const facts: Record<string, unknown> = { bundleName: 'fixture-evolution', failedVersion: '0.7.0', restoredVersion: '0.7.1',
        activeSessionId: f.receipt.activeSessionId, persistedPausedState: true, restoredPluginActive: true,
        userChoicePreserved: true, confirmation: 'native-dialog-clicked', pids: [123], ports: [12345], alivePids: [], listeningPorts: [] }
      if (field === 'session-pause') Object.assign(facts, { restoredPausedState: true, resumedCompleted: true })
      else facts[field] = field === 'userChoicePreserved' ? false : ''
      const path = join(f.smokeRoot, 'checks/pauseRecovery.json')
      await put(path, JSON.stringify({ schema: 1, runId: f.receipt.runId, check: 'pauseRecovery', status: 'passed',
        descriptorSha256: f.receipt.descriptor.sha256, executableSha256: f.receipt.installed.executable.sha256,
        events: BASE_SMOKE_EVENTS.pauseRecovery, facts }))
      await expect(completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { pauseRecovery: path }, f.options)).rejects.toThrow()
    },
  )

  it('keeps development dialog interception partial and rejects it for packaged evidence', async () => {
    const f = await fixture()
    const path = join(f.smokeRoot, 'checks/pauseRecovery.json')
    await put(path, JSON.stringify({ schema: 1, runId: f.receipt.runId, check: 'pauseRecovery', status: 'passed',
      descriptorSha256: f.receipt.descriptor.sha256, executableSha256: f.receipt.installed.executable.sha256,
      events: BASE_SMOKE_EVENTS.pauseRecovery, facts: { bundleName: 'fixture-evolution', failedVersion: '0.7.0', restoredVersion: '0.7.1',
        activeSessionId: f.receipt.activeSessionId, persistedPausedState: true, restoredPluginActive: true,
        userChoicePreserved: true, confirmation: 'development-intercepted', pids: [123], ports: [12345], alivePids: [], listeningPorts: [] } }))
    const packaged = completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { pauseRecovery: path }, f.options)
    await expect(packaged).rejects.toThrow(/pause\/recovery/u)
    f.receipt.installed.mode = 'development-stage'; await f.save()
    const completed = await completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { pauseRecovery: path }, f.options)
    expect(completed.outcome).toBe('partial')
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/Development-stage/u)
  })

  it('does not let a marker file stand in for a real historical runtime fixture', async () => {
    const f = await fixture()
    const marker = join(f.smokeRoot, 'legacy-fixture.json')
    await put(marker, JSON.stringify({ oldReaderPassed: true }))
    const path = join(f.smokeRoot, 'checks/legacyCompatibility.json')
    await put(path, JSON.stringify({ schema: 1, runId: f.receipt.runId, check: 'legacyCompatibility', status: 'passed',
      descriptorSha256: f.receipt.descriptor.sha256, executableSha256: f.receipt.installed.executable.sha256,
      events: BASE_SMOKE_EVENTS.legacyCompatibility, facts: { desktopVersion: '0.5.5', harnessVersion: '0.1.3-alpha.1',
        sourceSha: 'c0b92b1fcc5a6481eb219a8b5e5510980e99bf78', fixtureReceipt: await baseSmokeFile(marker),
        oldReaderVerified: true, oldWorkspacePreserved: true, oldSessionReopened: true, legacySessionId: 'made-up' } }))
    await expect(completePackagedDesktopBaseSmokeReceipt(f.receiptPath, { legacyCompatibility: path }, f.options)).rejects.toThrow()
    expect(JSON.parse(await readFile(f.receiptPath, 'utf8'))).toEqual(f.receipt)
  })
})


async function appImageFixture() {
  const f = await fixture('linux')
  const image = join(dirname(f.smokeRoot), 'DeepSeek-Harness-0.6.0-linux-x64.AppImage')
  await writeFile(image, 'Synthetic AppImage fixture; never launched or mounted.')
  const appDir = dirname(f.resources)
  const escape = (value: string) => value.replaceAll(' ', '\\040')
  const observed = { appImage: image, appDir, executablePath: f.executable, resourcesDirectory: f.resources,
    appPath: join(f.resources, 'app.asar'), mountInfo: `91 20 0:75 / ${escape(appDir)} ro,nosuid,nodev - fuse.AppImage ${escape(image)} ro,user_id=1000` }
  return { ...f, image, appDir, observed }
}

describe('direct AppImage stable identities with synthetic filesystem fixtures', () => {
  it('binds a fresh mount after the old mount vanishes and refuses changed required bytes', async () => {
    const f = await appImageFixture()
    const installed = await capturePackagedAppImageIdentity(f.image, f.observed, '0.6.0', f.descriptor, f.smokeRoot)
    const next = join(dirname(f.appDir), 'remounted')
    await rename(f.appDir, next)
    const mapped = (path: string) => join(next, relative(f.appDir, path))
    const observed = { ...f.observed, appDir: next, executablePath: mapped(f.executable),
      resourcesDirectory: mapped(f.resources), appPath: mapped(f.observed.appPath),
      mountInfo: f.observed.mountInfo.replace(f.appDir, next) }
    const current = await verifyRemountedAppImageIdentity(installed, observed, f.descriptor)
    expect(current.appPath).toBe(mapped(f.observed.appPath))
    expect(current.executable.path).toBe(mapped(f.executable))
    await writeFile(current.files.at(-1)!.path, 'changed')
    await expect(verifyRemountedAppImageIdentity(installed, observed, f.descriptor)).rejects.toThrow()
  })
  it('rechecks the external package and complete private required-byte snapshot after the mount disappears', async () => {
    const f = await appImageFixture()
    const installed = await capturePackagedAppImageIdentity(f.image, f.observed, '0.6.0', f.descriptor, f.smokeRoot)
    expect(installed.mode).toBe('packaged-appimage')
    expect(installed.executable.path).toBe(f.image)
    expect(installed.appImage?.snapshotFiles.length).toBe(f.receipt.installed.files.length)
    await rm(f.appDir, { recursive: true })
    await expect(verifyPackagedAppImageIdentity(installed, f.descriptor, f.smokeRoot)).resolves.toBeUndefined()
    f.receipt.installed = installed
    // Existing scenario evidence used the synthetic mounted executable hash; bind it to the direct external image instead.
    for (const result of Object.values(f.receipt.checks)) {
      if (result.status !== 'passed') continue
      const evidence = JSON.parse(await readFile(result.evidence.path, 'utf8')) as Record<string, unknown>
      evidence.executableSha256 = installed.executable.sha256
      await writeFile(result.evidence.path, JSON.stringify(evidence))
      result.evidence = await baseSmokeFile(result.evidence.path)
    }
    await f.save()
    await expect(verifyPackagedDesktopBaseSmokeReceipt(f.receiptPath, f.options)).rejects.toThrow(/legacyCompatibility/u)
  })
  it.each(['launch-image', 'mount-source', 'mount-path', 'resources-path', 'missing-mount'] as const)('rejects mismatched direct %s', async (mode) => {
    const f = await appImageFixture()
    const other = join(dirname(f.image), 'wrong.AppImage'); await writeFile(other, 'wrong external image')
    const observed = { ...f.observed }
    if (mode === 'mount-source') observed.mountInfo = observed.mountInfo.replace(f.image, other)
    if (mode === 'mount-path') observed.appDir = f.smokeRoot
    if (mode === 'resources-path') observed.resourcesDirectory = f.smokeRoot
    if (mode === 'missing-mount') observed.mountInfo = ''
    await expect(capturePackagedAppImageIdentity(mode === 'launch-image' ? other : f.image, observed, '0.6.0', f.descriptor, f.smokeRoot)).rejects.toThrow()
  })
  it.each(['external', 'snapshot', 'missing', 'inventory', 'mount-record', 'symlink'] as const)('rejects changed retained %s after exit', async (mode) => {
    const f = await appImageFixture()
    const installed = await capturePackagedAppImageIdentity(f.image, f.observed, '0.6.0', f.descriptor, f.smokeRoot)
    await rm(f.appDir, { recursive: true })
    const snapshot = installed.appImage!
    const stableFile = snapshot.snapshotFiles[0]!
    if (mode === 'external') await writeFile(f.image, 'changed external package')
    if (mode === 'snapshot') await writeFile(stableFile.path, 'changed stable bytes')
    if (mode === 'missing') await rm(stableFile.path)
    if (mode === 'inventory') snapshot.snapshotFiles = []
    if (mode === 'mount-record') snapshot.mountRecord = snapshot.mountRecord.replace(f.image, '/wrong/image.AppImage')
    if (mode === 'symlink') { await rm(stableFile.path); await symlink(f.image, stableFile.path) }
    await expect(verifyPackagedAppImageIdentity(installed, f.descriptor, f.smokeRoot)).rejects.toThrow()
  })
  it('never accepts direct-AppImage evidence as a Mac or Windows package', async () => {
    const f = await appImageFixture()
    const installed = await capturePackagedAppImageIdentity(f.image, f.observed, '0.6.0', f.descriptor, f.smokeRoot)
    await expect(verifyPackagedAppImageIdentity(installed, createDesktopBaseSmokeDescriptor('0.6.0', 'win32', []), f.smokeRoot)).rejects.toThrow(/Linux|platform/u)
  })
})
