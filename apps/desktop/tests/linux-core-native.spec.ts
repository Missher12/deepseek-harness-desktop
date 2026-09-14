/** Offline consumer/lifecycle checks; mocked Electron is never native acceptance. */
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { _electron as electron, type Locator } from 'playwright'
import { createDesktopBaseSmokeDescriptor } from '../../../scripts/desktop-base-contract.ts'
import { verifyBaseLegacyFixture } from './base-legacy-fixture.ts'
import { BASE_SMOKE_EVENTS, baseSmokeFile, capturePackagedBaseIdentity, completePackagedDesktopBaseSmokeReceipt,
  verifyRemountedAppImageIdentity, type BaseSmokeEvidence, type PackagedDesktopBaseSmokeReceipt } from './base-smoke-receipt.ts'
import { linuxDescendants, processAlive, readLinuxProcessIdentity } from './linux-writer-fixture.ts'
import { completeLinuxCoreNative, verifyLinuxLegacySelection } from './linux-core-native.ts'

const launch = vi.hoisted(() => vi.fn<typeof electron.launch>())
vi.mock('playwright', () => ({ _electron: { launch } }))
vi.mock('./base-legacy-fixture.ts', () => ({ verifyBaseLegacyFixture: vi.fn() }))
vi.mock('./base-smoke-receipt.ts', async original => ({
  ...await original<typeof import('./base-smoke-receipt.ts')>(),
  capturePackagedBaseIdentity: vi.fn(), verifyRemountedAppImageIdentity: vi.fn(), completePackagedDesktopBaseSmokeReceipt: vi.fn(),
}))
vi.mock('./linux-writer-fixture.ts', async original => ({
  ...await original<typeof import('./linux-writer-fixture.ts')>(),
  linuxDescendants: vi.fn(), processAlive: vi.fn(), readLinuxProcessIdentity: vi.fn(),
}))
vi.mock('node:net', () => ({ createConnection: () => {
  const socket = Object.assign(new EventEmitter(), { destroy: vi.fn(), setTimeout: vi.fn() })
  queueMicrotask(() => socket.emit('error', Object.assign(new Error('offline closed port'), { code: 'ECONNREFUSED' })))
  return socket
} }))

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(appImage = false) {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('DSH_DESKTOP_SMOKE_STAGE', undefined)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'linux-core-consumer-')))
  roots.push(root)
  for (const path of ['checks', 'home/.dsh', 'electron-data', 'workspace']) await mkdir(join(root, path), { recursive: true })
  const descriptor = createDesktopBaseSmokeDescriptor('0.6.0', 'linux', [])
  const descriptorPath = join(root, 'descriptor.json')
  const executable = join(root, appImage ? 'Desktop.AppImage' : 'deepseek-harness')
  const legacyPath = join(root, 'legacy-fixture.json')
  const sentinel = join(root, 'protected')
  for (const path of [executable, legacyPath, sentinel]) await writeFile(path, 'offline fixture bytes\n')
  await writeFile(descriptorPath, JSON.stringify(descriptor))
  const receipt: PackagedDesktopBaseSmokeReceipt = { schema: 1, composition: 'base', runId: 'offline-linux', platform: 'linux', arch: 'x64',
    outcome: 'partial', descriptor: await baseSmokeFile(descriptorPath), installed: {
      mode: appImage ? 'packaged-appimage' : 'packaged', executable: await baseSmokeFile(executable),
      resourcesDirectory: '/old-mount/resources', appPath: '/old-mount/resources/app.asar', desktopVersion: '0.6.0',
      harnessVersion: descriptor.harnessVersion, officialSourceSha: descriptor.officialSourceSha, files: [],
    }, smokeRoot: root, harnessHome: join(root, 'home/.dsh'), userData: join(root, 'electron-data'), workspacePath: join(root, 'workspace'),
    activeSessionId: 'session-new', activeSessionTitle: 'New title', protectedFiles: [await baseSmokeFile(sentinel)],
    primaryDisplayScaleFactor: 1, rendererDevicePixelRatio: 1, checks: { pauseRecovery: { status: 'not-run', reason: 'Unattempted.' } },
  }
  for (const check of ['processCleanup', 'portCleanup'] as const) {
    const path = join(root, `checks/${check}.json`)
    const evidence: BaseSmokeEvidence = { schema: 1, runId: receipt.runId, check, status: 'passed',
      descriptorSha256: receipt.descriptor.sha256, executableSha256: receipt.installed.executable.sha256,
      events: [...BASE_SMOKE_EVENTS[check]], facts: check === 'processCleanup' ? { pids: [98761], alivePids: [] } : { ports: [41321], listeningPorts: [] } }
    await writeFile(path, JSON.stringify(evidence))
    receipt.checks[check] = { status: 'passed', evidence: await baseSmokeFile(path) }
  }
  const receiptPath = join(root, 'base-smoke-receipt.json')
  await writeFile(receiptPath, JSON.stringify(receipt))
  const base = { ...receipt, receiptPath, protectedPaths: [sentinel] }
  vi.mocked(verifyBaseLegacyFixture).mockResolvedValue({ oldVersion: '0.5.7', harnessVersion: '0.1.3-alpha.1',
    sourceSha: descriptor.baseline.sourceSha, sessionId: 'session-old', title: 'Historical title', workspacePath: receipt.workspacePath,
    dshHome: receipt.harnessHome, fixtureReceiptPath: legacyPath, protectedPaths: [sentinel], protectedFiles: [] })
  let running = true
  let onboardingStep: 'welcome' | 'credential' | 'done' = 'welcome'
  const onboardingEvents: string[] = []
  function onboardingDialog(step: 'welcome' | 'credential', buttonName: string) {
    let clicked = false
    const button = {
      scrollIntoViewIfNeeded: vi.fn(async (options: { timeout: number }) => {
        expect(options).toEqual({ timeout: 60_000 }); expect(onboardingStep).toBe(step)
        onboardingEvents.push(`${step}-scroll`)
      }),
      evaluate: vi.fn(async () => {
        expect(onboardingStep).toBe(step); onboardingEvents.push(`${step}-hit`)
        return true // This offline fixture models a reachable button; the actual helper must still hit-test it.
      }),
      click: vi.fn(async (options: { timeout: number }) => {
        expect(options).toEqual({ timeout: 60_000 }); expect(onboardingStep).toBe(step)
        clicked = true; onboardingEvents.push(`${step}-click`)
      }),
    }
    return {
      waitFor: vi.fn(async (options: { state: 'visible' | 'detached'; timeout: number }) => {
        expect(options.timeout).toBe(60_000); expect(onboardingStep).toBe(step)
        if (options.state === 'detached') {
          expect(clicked).toBe(true)
          onboardingStep = step === 'welcome' ? 'credential' : 'done'
        } else expect(options.state).toBe('visible')
        onboardingEvents.push(`${step}-${options.state}`)
      }),
      isVisible: vi.fn(async () => onboardingStep === step),
      getByRole: (role: string, options: { name: RegExp }) => {
        expect(role).toBe('button'); expect(options.name.test(buttonName)).toBe(true)
        return button
      },
    }
  }
  const welcome = onboardingDialog('welcome', '继续')
  const credential = onboardingDialog('credential', '稍后配置')
  const composer = {
    waitFor: vi.fn(async (options: { state: string; timeout: number }) => {
      expect(options).toEqual({ state: 'visible', timeout: 60_000 }); expect(onboardingStep).toBe('done')
      onboardingEvents.push('composer-visible')
    }),
    click: vi.fn(async (options: { trial: boolean; timeout: number }) => {
      expect(options).toEqual({ trial: true, timeout: 60_000 }); expect(onboardingStep).toBe('done')
      onboardingEvents.push('composer-trial')
    }),
  }
  const row = { waitFor: vi.fn(), count: vi.fn().mockResolvedValue(1),
    click: vi.fn(async () => { expect(onboardingStep).toBe('done') }),
    getAttribute: vi.fn().mockResolvedValue('true'), evaluate: vi.fn().mockResolvedValue({ sessionId: 'session-old', selected: 'true' }) }
  const workspace = { ...row, getAttribute: vi.fn().mockResolvedValue('false') }
  const body = { waitFor: vi.fn() }
  const page = { waitForURL: vi.fn(), url: () => 'http://127.0.0.1:41322/',
    getByRole: (role: string, options?: { name: RegExp }) => {
      expect(role).toBe('dialog')
      if (options === undefined) return { waitFor: vi.fn(async (wait: { state: string; timeout: number }) => {
        expect(wait).toEqual({ state: 'hidden', timeout: 60_000 }); expect(onboardingStep).toBe('done')
        onboardingEvents.push('dialogs-hidden')
      }) }
      if (options.name.test('内测声明')) return welcome
      expect(options.name.test('添加一个 API Key 开始使用')).toBe(true)
      return credential
    },
    locator: (selector: string) => selector.includes('aria-expanded') ? { filter: () => workspace }
      : selector.includes('aria-selected') ? { filter: () => row }
        : selector.includes('data-composer-input') ? composer : body,
    getByText: () => body, screenshot: vi.fn(async ({ path }: { path: string }) => { await writeFile(path, 'offline image') }),
  }
  const native = { packaged: true, platform: 'linux', arch: 'x64', home: receipt.harnessHome, userData: receipt.userData,
    executablePath: appImage ? '/new-mount/deepseek-harness' : executable, resourcesDirectory: '/new-mount/resources',
    appPath: '/new-mount/resources/app.asar', desktopVersion: '0.6.0', appImage: appImage ? executable : undefined,
    appDir: appImage ? join(root, 'vanished-mount') : undefined, mountInfo: 'offline mount observation' }
  const application = { process: () => ({ pid: 98762 }), firstWindow: vi.fn().mockResolvedValue(page),
    evaluate: vi.fn().mockResolvedValue(native), close: vi.fn(async () => { running = false }) }
  launch.mockResolvedValue(application as unknown as Awaited<ReturnType<typeof electron.launch>>)
  vi.mocked(linuxDescendants).mockResolvedValue([98763])
  vi.mocked(readLinuxProcessIdentity).mockImplementation(async pid => running ? {
    pid, parentPid: pid === 98762 ? 1 : 98762, processGroupId: 98762, startTime: '1000', cgroup: 'offline',
  } : undefined)
  vi.mocked(processAlive).mockImplementation(() => running)
  vi.mocked(capturePackagedBaseIdentity).mockResolvedValue(receipt.installed)
  vi.mocked(verifyRemountedAppImageIdentity).mockResolvedValue(receipt.installed)
  vi.mocked(completePackagedDesktopBaseSmokeReceipt).mockImplementation(async (path) => {
    return { ...JSON.parse(await readFile(path, 'utf8')) as PackagedDesktopBaseSmokeReceipt, outcome: 'core-passed' }
  })
  return { root, descriptorPath, executable, legacyPath, sentinel, base, receipt, row, body, application, native,
    onboardingEvents, credential, composer,
    run: () => completeLinuxCoreNative(executable, base, descriptorPath, legacyPath) }
}

describe('Linux core native consumer with offline Electron observations', () => {
  it('merges actual continuation resources, protects evidence and requests only core completion', async () => {
    const f = await fixture()
    const result = await f.run()
    expect(result.checks.pauseRecovery?.status).toBe('not-run')
    expect(completePackagedDesktopBaseSmokeReceipt).toHaveBeenCalledWith(f.base.receiptPath,
      { legacyCompatibility: join(f.root, 'checks/legacyCompatibility.json') },
      { platform: 'linux', descriptorPath: f.descriptorPath, smokeRoot: f.root, scope: 'core' })
    const cleanup = JSON.parse(await readFile(join(f.root, 'checks/processCleanup.json'), 'utf8')) as BaseSmokeEvidence
    expect(cleanup.facts.pids).toEqual([98761, 98762, 98763])
    const ports = JSON.parse(await readFile(join(f.root, 'checks/portCleanup.json'), 'utf8')) as BaseSmokeEvidence
    expect(ports.facts.ports).toEqual([41321, 41322])
    expect(result.protectedFiles.map(file => file.path)).toEqual(expect.arrayContaining([
      f.sentinel, join(f.root, 'checks/linux-continuation.json'), join(f.root, 'checks/linux-legacy-reader.png'),
    ]))
    expect(f.application.close).toHaveBeenCalledOnce()
    expect(f.onboardingEvents).toEqual([
      'welcome-visible', 'welcome-scroll', 'welcome-hit', 'welcome-click', 'welcome-detached',
      'credential-visible', 'credential-scroll', 'credential-hit', 'credential-click', 'credential-detached',
      'dialogs-hidden', 'composer-visible', 'composer-trial',
    ])
    const continuation = JSON.parse(await readFile(join(f.root, 'checks/linux-continuation.json'), 'utf8')) as { onboarding: unknown }
    expect(continuation.onboarding).toEqual({ continueHit: true, configureLaterHit: true })
  })
  it.each(['credential-detach', 'composer-trial'])('keeps %s failure from completing native evidence', async (kind) => {
    const f = await fixture()
    if (kind === 'credential-detach') {
      const normalWait = f.credential.waitFor.getMockImplementation()
      if (normalWait === undefined) throw new Error('Missing fixture dialog wait')
      f.credential.waitFor.mockImplementation(async (options) => {
        if (options.state === 'detached') throw new Error('credential did not settle')
        await normalWait(options)
      })
    } else f.composer.click.mockRejectedValueOnce(new Error('composer trial blocked'))
    await expect(f.run()).rejects.toThrow(kind === 'credential-detach' ? 'credential did not settle' : 'composer trial blocked')
    expect(f.application.close).toHaveBeenCalledOnce()
    expect(completePackagedDesktopBaseSmokeReceipt).not.toHaveBeenCalled()
  })
  it('passes the original AppImage to launch and current mounted observations to shared byte verification', async () => {
    const f = await fixture(true)
    await f.run()
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ executablePath: f.executable, chromiumSandbox: true }))
    expect(verifyRemountedAppImageIdentity).toHaveBeenCalledWith(f.receipt.installed, expect.objectContaining({
      appImage: f.executable, appDir: f.native.appDir, executablePath: '/new-mount/deepseek-harness',
    }), expect.objectContaining({ officialSourceSha: f.receipt.installed.officialSourceSha }))
    expect(capturePackagedBaseIdentity).not.toHaveBeenCalled()
  })
  it('rejects changed remounted bytes and still closes the UI without completing a receipt', async () => {
    const f = await fixture(true)
    vi.mocked(verifyRemountedAppImageIdentity).mockRejectedValue(new Error('remounted bytes changed'))
    await expect(f.run()).rejects.toThrow('remounted bytes changed')
    expect(f.application.close).toHaveBeenCalledOnce()
    expect(completePackagedDesktopBaseSmokeReceipt).not.toHaveBeenCalled()
  })
  it.each(['identity', 'body', 'protected', 'inventory'])('rejects a failed %s observation and closes owned processes', async (kind) => {
    const f = await fixture()
    if (kind === 'identity') f.row.evaluate.mockResolvedValue({ sessionId: 'session-other', selected: 'true' })
    if (kind === 'body') f.body.waitFor.mockRejectedValue(new Error('body absent'))
    if (kind === 'protected') f.application.close.mockImplementation(async () => {
      vi.mocked(processAlive).mockReturnValue(false)
      await writeFile(f.sentinel, 'changed')
    })
    if (kind === 'inventory') vi.mocked(readLinuxProcessIdentity).mockRejectedValueOnce(new Error('inventory unavailable'))
    await expect(f.run()).rejects.toThrow()
    expect(f.application.close).toHaveBeenCalledOnce()
    expect(completePackagedDesktopBaseSmokeReceipt).not.toHaveBeenCalled()
  })
  it('rejects tampered original cleanup evidence before launching', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'checks/processCleanup.json'), '{}')
    await expect(f.run()).rejects.toThrow('Protected core smoke file changed')
    expect(launch).not.toHaveBeenCalled()
  })
  it('does not signal reused PIDs or accept failed native close', async () => {
    const f = await fixture()
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    f.application.close.mockImplementation(async () => {
      vi.mocked(readLinuxProcessIdentity).mockImplementation(async pid => ({ pid, parentPid: 1, processGroupId: pid, startTime: '2000', cgroup: 'unrelated' }))
      vi.mocked(processAlive).mockReturnValue(false)
      throw new Error('close failed')
    })
    await expect(f.run()).rejects.toThrow('close failed')
    expect(kill).not.toHaveBeenCalled()
    expect(completePackagedDesktopBaseSmokeReceipt).not.toHaveBeenCalled()
  })
  it('requires core verification before either package removal', async () => {
    const source = await readFile(resolve(import.meta.dirname, '../../../scripts/linux-desktop-native-smoke.sh'), 'utf8')
    const gate = source.slice(source.indexOf('run_linux_native_checks()'), source.indexOf('\n[[ "$(dpkg-deb'))
    expect(gate).toContain('--platform linux --scope core')
    expect(gate).toContain('core-verification.json')
    expect(source.indexOf('\nrun_linux_native_checks\n')).toBeLessThan(source.indexOf('\nsudo apt-get purge'))
    expect(source.lastIndexOf('\nrun_linux_native_checks\n')).toBeLessThan(source.indexOf('\nrm -- "$appimage"'))
    expect(source).toContain("receipt.outcome !== 'core-passed'")
    expect(source).toContain("receipt.checks.pauseRecovery?.status !== 'not-run'")
  })
})

it('observes the official drag identity and always emits dragend without requiring data-session-id', async () => {
  class Transfer {
    value = ''
    getData() { return this.value }
    setData(_format: string, value: string) { this.value = value }
  }
  class Drag extends Event {
    dataTransfer: Transfer | undefined
    constructor(name: string, options: { dataTransfer?: Transfer }) { super(name); this.dataTransfer = options.dataTransfer }
  }
  vi.stubGlobal('DataTransfer', Transfer); vi.stubGlobal('DragEvent', Drag)
  const element = Object.assign(new EventTarget(), { getAttribute: () => 'true' })
  element.addEventListener('dragstart', (event) => { (event as Drag).dataTransfer?.setData('text/plain', 'session-old') })
  const end = vi.fn()
  element.addEventListener('dragend', end)
  const row = { evaluate: async (callback: (node: typeof element) => unknown) => callback(element) } as unknown as Pick<Locator, 'evaluate'>
  await verifyLinuxLegacySelection(row, 'session-old')
  await expect(verifyLinuxLegacySelection(row, 'session-other')).rejects.toThrow('identity or selection')
  expect(end).toHaveBeenCalledTimes(2)
})
