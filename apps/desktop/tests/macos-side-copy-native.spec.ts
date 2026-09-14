/** Offline checks of Mac native input binding; these tests never launch an application. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopBaseSmokeDescriptor } from '../../../scripts/desktop-base-contract.ts'
import { loadMacBaseSmokeInputs, macBaseSmokeRequestFromEnvironment, runMacBaseCore, verifyMacBaseRun, decodeMacStartupFixtures, macOwnedProcesses, verifyMacLegacySelection, findMacPickerProcess, macPickerPolicyFromEnvironment, decodeMacWorkspaceRecords, waitForMacWorkspaceSelection, runMacPickerInteraction } from './macos-side-copy-native-adapter.ts'

vi.mock('./packaged-base-smoke.ts', async importOriginal => ({ ...await importOriginal<typeof import('./packaged-base-smoke.ts')>(), runPackagedDesktopBaseSmoke: vi.fn() }))
vi.mock('playwright', async importOriginal => ({ ...await importOriginal<typeof import('playwright')>(), _electron: { launch: vi.fn() } }))
vi.mock('./native-directory-picker-smoke.ts', async importOriginal => ({ ...await importOriginal<typeof import('./native-directory-picker-smoke.ts')>(), withOwnedPickerAutomation: vi.fn() }))
vi.mock('./base-legacy-fixture.ts', () => ({ verifyBaseLegacyFixture: vi.fn() }))

const owned: string[] = []
const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex')

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-mac-consumer-test-')))
  owned.push(root)
  const application = join(root, 'DeepSeek Harness.app')
  const resources = join(application, 'Contents/Resources')
  const descriptor = createDesktopBaseSmokeDescriptor('0.6.0', 'darwin', [])
  for (const required of descriptor.requiredPaths) {
    const path = join(resources, required.slice('resources/'.length))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'synthetic-artifact')
  }
  const executable = join(application, 'Contents/MacOS/DeepSeek Harness')
  await mkdir(dirname(executable), { recursive: true })
  await writeFile(executable, 'synthetic-nonexecuted-program', { mode: 0o700 })
  await writeFile(join(resources, 'update-metadata.json'), JSON.stringify({
    schema: 1, desktopVersion: '0.6.0', harnessVersion: '0.1.5-rc.2', platform: 'darwin', arch: 'x64', channel: 'release',
  }))
  const descriptorPath = join(root, 'base-smoke.json')
  const text = JSON.stringify(descriptor)
  await writeFile(descriptorPath, text)
  return { root, resources, descriptor, request: {
    application, descriptorPath, descriptorSha256: digest(text), asarSha256: digest('synthetic-artifact'),
    sourceSha: 'a'.repeat(40), expectedDesktopVersion: '0.6.0',
  } }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('Mac native input binding (offline)', () => {
  it('maps the shared resource paths to the physical Mac official runtime', async () => {
    const { request, resources, descriptor } = await fixture()
    const input = await loadMacBaseSmokeInputs(request)
    expect(input.coreRoot).toBe(join(resources, 'app.asar.unpacked/official-runtime/node_modules'))
    expect(input.descriptor.effectiveProfile).toBe('desktop-base')
    expect(input.requiredFiles).toHaveLength(descriptor.requiredPaths.length)
    expect(input.sourceSha).toBe('a'.repeat(40))
  })

  it('rejects a descriptor whose bytes differ from the trusted digest', async () => {
    const { request } = await fixture()
    await writeFile(request.descriptorPath, '{}')
    await expect(loadMacBaseSmokeInputs(request)).rejects.toThrow('descriptor SHA-256')
  })

  it('rejects a reduced descriptor even with a matching digest', async () => {
    const { request, descriptor } = await fixture()
    const text = JSON.stringify({ ...descriptor, requiredPaths: [] })
    await writeFile(request.descriptorPath, text)
    await expect(loadMacBaseSmokeInputs({ ...request, descriptorSha256: digest(text) }))
      .rejects.toThrow('required runtime')
  })

  it('rejects changed application bytes and mismatched packaged versions', async () => {
    const { request, resources } = await fixture()
    await writeFile(join(resources, 'app.asar'), 'wrong')
    await expect(loadMacBaseSmokeInputs(request)).rejects.toThrow('app.asar SHA-256')
    await writeFile(join(resources, 'app.asar'), 'synthetic-artifact')
    await writeFile(join(resources, 'update-metadata.json'), JSON.stringify({
      schema: 1, desktopVersion: '0.5.5', harnessVersion: '0.1.3-alpha.1', platform: 'darwin', arch: 'x64',
    }))
    await expect(loadMacBaseSmokeInputs(request)).rejects.toThrow('Packaged Mac metadata')
  })

  it('refuses a required file redirected outside the application resources', async () => {
    const { root, request, resources } = await fixture()
    const path = join(resources, 'desktop-helper/source.json')
    await rm(path)
    const outside = join(root, 'outside.json')
    await writeFile(outside, 'outside')
    await symlink(outside, path)
    await expect(loadMacBaseSmokeInputs(request)).rejects.toThrow('outside Mac resources')
    expect(await readFile(outside, 'utf8')).toBe('outside')
  })

  it('rejects a different platform before interpreting its native file paths', async () => {
    const { request } = await fixture()
    const text = JSON.stringify(createDesktopBaseSmokeDescriptor('0.6.0', 'win32', []))
    await writeFile(request.descriptorPath, text)
    await expect(loadMacBaseSmokeInputs({ ...request, descriptorSha256: digest(text) })).rejects.toThrow('darwin/x64')
  })

  it('requires a historical fixture before invoking the packaged base smoke', async () => {
    const { request, root } = await fixture()
    await expect(runMacBaseCore(request, { smokeRoot: root, legacyFixturePath: undefined }))
      .rejects.toThrow('legacy fixture')
  })

  it.skipIf(process.platform !== 'darwin' || process.arch !== 'x64')('restores exact environment state when the real-core dependency fails', async () => {
    const { request, root } = await fixture()
    const { verifyBaseLegacyFixture } = await import('./base-legacy-fixture.ts')
    const { runPackagedDesktopBaseSmoke } = await import('./packaged-base-smoke.ts')
    vi.stubEnv('DSH_DESKTOP_SMOKE_ROOT', 'prior-owned-value')
    vi.stubEnv('DSH_DESKTOP_SMOKE_STAGE', undefined)
    vi.mocked(verifyBaseLegacyFixture).mockResolvedValue({
      oldVersion: '0.5.5', harnessVersion: '0.1.3-alpha.1', sourceSha: 'b'.repeat(40),
      sessionId: 'offline', title: 'offline', workspacePath: join(root, 'workspace'),
      protectedPaths: [], protectedFiles: [], dshHome: join(root, 'home/.dsh'), fixtureReceiptPath: join(root, 'legacy.json'),
    })
    vi.mocked(runPackagedDesktopBaseSmoke).mockImplementation(async (executable, platform, options) => {
      expect(executable).toBe(join(request.application, 'Contents/MacOS/DeepSeek Harness'))
      expect(platform).toBe('darwin')
      expect(options).toEqual({ scalePercent: 150 })
      expect(process.env.DSH_DESKTOP_SMOKE_ROOT).toBe(root)
      expect(process.env.DSH_DESKTOP_SMOKE_DESCRIPTOR).toBe(request.descriptorPath)
      throw new Error('offline core dependency failure')
    })
    await expect(runMacBaseCore(request, { smokeRoot: root, legacyFixturePath: join(root, 'legacy.json'), scalePercent: 150 }))
      .rejects.toThrow('offline core dependency failure')
    expect(process.env.DSH_DESKTOP_SMOKE_ROOT).toBe('prior-owned-value')
  })

  it.skipIf(process.platform !== 'darwin' || process.arch !== 'x64').each(['automatic', 'manual'] as const)(
    'drains an owned native child and rechecks protected data after UI failure in %s mode', async (mode) => {
      const { request, root } = await fixture()
      const { verifyBaseLegacyFixture } = await import('./base-legacy-fixture.ts')
      const { runPackagedDesktopBaseSmoke } = await import('./packaged-base-smoke.ts')
      const receiptPath = join(root, 'base-smoke-receipt.json')
      await writeFile(receiptPath, '{}')
      vi.stubEnv('DSH_DESKTOP_SMOKE_STAGE', undefined)
      vi.mocked(verifyBaseLegacyFixture).mockResolvedValue({
        oldVersion: '0.5.5', harnessVersion: '0.1.3-alpha.1', sourceSha: 'b'.repeat(40),
        sessionId: 'offline', title: 'offline', workspacePath: root, protectedPaths: [], protectedFiles: [],
        dshHome: join(root, 'home/.dsh'), fixtureReceiptPath: join(root, 'legacy.json'),
      })
      vi.mocked(runPackagedDesktopBaseSmoke).mockResolvedValue({ composition: 'base', activeSessionId: 'offline',
        activeSessionTitle: 'offline', protectedPaths: [], primaryDisplayScaleFactor: 1, rendererDevicePixelRatio: 1,
        harnessHome: join(root, 'home/.dsh'), userData: join(root, 'electron-data'), workspacePath: root, receiptPath })
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      const closed = once(child, 'close')
      await once(child, 'spawn')
      // This test substitutes only Electron's control surface; the process lifetime and ps inventory are real.
      vi.spyOn(electron, 'launch').mockResolvedValue({ process: () => child,
        firstWindow: async () => { throw new Error('offline renderer failure') },
        evaluate: async () => { child.kill('SIGTERM') },
        waitForEvent: async () => { await closed }, close: async () => { child.kill('SIGKILL'); await closed },
      } as unknown as ElectronApplication)
      try {
        await expect(runMacBaseCore(request, { smokeRoot: root, legacyFixturePath: join(root, 'legacy.json'),
          picker: mode === 'manual' ? { mode, timeoutMs: 1000 } : { mode } }))
          .rejects.toThrow('offline renderer failure')
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
        expect(verifyBaseLegacyFixture).toHaveBeenCalledTimes(3)
        await expect(readFile(join(root, 'checks/mac-continuation.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      } finally { child.kill('SIGKILL'); await closed }
    })

  it('does not turn a partial receipt into native acceptance', async () => {
    const { request, root } = await fixture()
    const inputs = await loadMacBaseSmokeInputs(request)
    const receiptPath = join(root, 'base-smoke-receipt.json')
    await writeFile(receiptPath, JSON.stringify({ schema: 1, composition: 'base', outcome: 'partial' }))
    await expect(verifyMacBaseRun({ inputs, smokeRoot: root, result: {
      composition: 'base', activeSessionId: 'offline', activeSessionTitle: 'offline', protectedPaths: [],
      primaryDisplayScaleFactor: 1, rendererDevicePixelRatio: 1, harnessHome: join(root, 'home/.dsh'),
      userData: join(root, 'electron-data'), workspacePath: join(root, 'workspace'), receiptPath,
    } })).rejects.toThrow(/Invalid base smoke receipt|requires Intel macOS/u)
  })

  it('rejects a selected different Session even when the historical title and body match', async () => {
    const row = { evaluate: vi.fn().mockResolvedValue({ sessionId: 'other-session', selected: 'true' }) }
    await expect(verifyMacLegacySelection(row, 'legacy-session')).rejects.toThrow('different Session')
    row.evaluate.mockResolvedValue({ sessionId: 'legacy-session', selected: 'false' })
    await expect(verifyMacLegacySelection(row, 'legacy-session')).rejects.toThrow('not selected')
    row.evaluate.mockResolvedValue({ sessionId: 'legacy-session', selected: 'true' })
    await expect(verifyMacLegacySelection(row, 'legacy-session')).resolves.toBeUndefined()
  })

  it('parses explicit manual picker mode with a bounded wait and no fallback', () => {
    expect(macPickerPolicyFromEnvironment({})).toEqual({ mode: 'automatic' })
    expect(macPickerPolicyFromEnvironment({ DSH_MACOS_PICKER_MODE: 'manual' })).toEqual({ mode: 'manual', timeoutMs: 600_000 })
    expect(macPickerPolicyFromEnvironment({ DSH_MACOS_PICKER_MODE: 'manual', DSH_MACOS_PICKER_TIMEOUT_MS: '1000' }))
      .toEqual({ mode: 'manual', timeoutMs: 1000 })
    for (const env of [{ DSH_MACOS_PICKER_MODE: 'auto' }, { DSH_MACOS_PICKER_TIMEOUT_MS: '1000' },
      { DSH_MACOS_PICKER_MODE: 'manual', DSH_MACOS_PICKER_TIMEOUT_MS: '600001' },
      { DSH_MACOS_PICKER_MODE: 'manual', DSH_MACOS_PICKER_TIMEOUT_MS: 'NaN' }]) {
      expect(() => macPickerPolicyFromEnvironment(env)).toThrow()
    }
  })

  it('waits for manual observation without starting automatic input', async () => {
    const { withOwnedPickerAutomation } = await import('./native-directory-picker-smoke.ts')
    const selected = { id: 'new', title: 'workspace', path: '/private/tmp/owned/workspace' }
    await expect(runMacPickerInteraction({ mode: 'manual', timeoutMs: 1000 }, 12, selected.path, async () => selected))
      .resolves.toEqual(selected)
    expect(withOwnedPickerAutomation).not.toHaveBeenCalled()
    vi.mocked(withOwnedPickerAutomation).mockRejectedValue(new Error('automatic input failed'))
    const observe = vi.fn()
    await expect(runMacPickerInteraction({ mode: 'automatic' }, 12, selected.path, observe)).rejects.toThrow('automatic input failed')
    expect(observe).not.toHaveBeenCalled()
  })

  it('accepts only a new official workspace with the complete requested path after picker exit', async () => {
    const expected = '/private/tmp/owned/workspace'
    const old = { id: 'old', path: '/private/tmp/old', title: 'old' }
    const requested = { id: 'new', path: expected, title: 'workspace' }
    const read = vi.fn().mockResolvedValue([old, requested])
    await expect(waitForMacWorkspaceSelection(read, new Set(['old']), expected, () => false, Date.now() + 1000))
      .resolves.toEqual(requested)
    read.mockResolvedValue([old, { ...requested, path: '/private/tmp/wrong/workspace' }])
    await expect(waitForMacWorkspaceSelection(read, new Set(['old']), expected, () => false, Date.now() + 1000))
      .rejects.toThrow('different full path')
  })

  it('rejects manual cancellation, an old matching workspace, and timeout with a live picker', async () => {
    const expected = '/private/tmp/owned/workspace'
    await expect(waitForMacWorkspaceSelection(async () => [], new Set(), expected, () => false, Date.now() + 10))
      .rejects.toThrow('cancelled or adoption failed')
    await expect(waitForMacWorkspaceSelection(async () => [{ id: 'old', title: 'workspace', path: expected }],
      new Set(['old']), expected, () => false, Date.now() + 10)).rejects.toThrow('cancelled or adoption failed')
    await expect(waitForMacWorkspaceSelection(async () => [{ id: 'new', title: 'workspace', path: expected }],
      new Set(), expected, () => true, Date.now() + 10)).rejects.toThrow('timed out')
    await expect(waitForMacWorkspaceSelection(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      return [{ id: 'late', title: 'workspace', path: expected }]
    }, new Set(), expected, () => false, Date.now() + 5)).rejects.toThrow('timed out')
  })

  it('reads the official workspace table by authoritative IDs without accepting basename-only data', () => {
    expect(decodeMacWorkspaceRecords({ global: { workspaceIds: ['new'] }, tables: { workspaces: {
      new: { path: '/private/tmp/owned/workspace', title: 'workspace' },
    } } })).toEqual([{ id: 'new', path: '/private/tmp/owned/workspace', title: 'workspace' }])
    expect(() => decodeMacWorkspaceRecords({ global: { workspaceIds: ['new'] }, tables: { workspaces: {
      new: { path: 'workspace', title: 'workspace' },
    } } })).toThrow('workspace record')
    expect(() => decodeMacWorkspaceRecords({ global: { workspaceIds: ['missing'] }, tables: { workspaces: {} } }))
      .toThrow('workspace record')
  })

  it('accepts an owned new command-name picker only with its exact system image', async () => {
    const owned = macOwnedProcesses('10 1 /app/Electron\n11 10 osascript\n12 10 osascript\n20 1 osascript', 10)
    const inspect = vi.fn().mockResolvedValue('p12\nftxt\nn/usr/bin/osascript\nn/System/library\n')
    expect(await findMacPickerProcess(owned, new Set([10, 11]), inspect)).toBe(12)
    expect(inspect).toHaveBeenCalledExactlyOnceWith(12)
    inspect.mockResolvedValue('p12\nftxt\nn/tmp/osascript\n')
    await expect(findMacPickerProcess(owned, new Set([10, 11]), inspect)).rejects.toThrow('system image')
    inspect.mockResolvedValue('p20\nftxt\nn/usr/bin/osascript\n')
    await expect(findMacPickerProcess(owned, new Set([10, 11]), inspect)).rejects.toThrow('system image')
  })

  it('rejects multiple new owned picker candidates before native UI automation', async () => {
    const inspect = vi.fn()
    await expect(findMacPickerProcess([{ pid: 11, command: 'osascript' }, { pid: 12, command: '/usr/bin/osascript' }],
      new Set(), inspect)).rejects.toThrow('More than one')
    expect(inspect).not.toHaveBeenCalled()
    expect(await findMacPickerProcess([{ pid: 13, command: '/tmp/osascript' }], new Set(), inspect)).toBeUndefined()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('does not hide a picker image inspection failure', async () => {
    const inspect = vi.fn().mockRejectedValue(new Error('lsof denied'))
    await expect(findMacPickerProcess([{ pid: 12, command: 'osascript' }], new Set(), inspect)).rejects.toThrow('lsof denied')
  })

  it('limits picker targets to descendants of the owned application', () => {
    const inventory = '10 1 /app/Electron\n11 10 /app/Helper\n12 11 /usr/bin/osascript\n20 1 /usr/bin/osascript\n'
    expect(macOwnedProcesses(inventory, 10)).toEqual([
      { pid: 10, command: '/app/Electron' }, { pid: 11, command: '/app/Helper' }, { pid: 12, command: '/usr/bin/osascript' },
    ])
    expect(() => macOwnedProcesses(inventory, 30)).toThrow('root')
    expect(() => macOwnedProcesses('invalid process output', 10)).toThrow('inventory')
  })

  it('requires separate explicit startup fixtures instead of recycling one mutated home', () => {
    expect(decodeMacStartupFixtures([{ smokeRoot: '/private/tmp/one', legacyFixturePath: '/private/tmp/one/legacy.json' }]))
      .toHaveLength(1)
    const repeated = Array.from({ length: 10 }, () => ({ smokeRoot: '/private/tmp/one', legacyFixturePath: '/private/tmp/one/legacy.json' }))
    expect(() => decodeMacStartupFixtures(repeated)).toThrow('distinct')
    expect(() => decodeMacStartupFixtures([])).toThrow('one or ten')
  })

  it('rejects misspelled native-required flags instead of silently skipping', () => {
    expect(() => macBaseSmokeRequestFromEnvironment({ DSH_MACOS_REQUIRE_NATIVE: 'true' }, '/tmp/artifact.app', '0.6.0'))
      .toThrow('0 or 1')
  })

  it('allows an ordinary offline invocation but fails partial or required native inputs', () => {
    expect(macBaseSmokeRequestFromEnvironment({}, '/tmp/artifact.app', '0.6.0')).toBeUndefined()
    expect(() => macBaseSmokeRequestFromEnvironment({ DSH_MACOS_REQUIRE_NATIVE: '1' }, '/tmp/artifact.app', '0.6.0'))
      .toThrow('requires all')
    expect(() => macBaseSmokeRequestFromEnvironment({ DSH_DESKTOP_SMOKE_DESCRIPTOR: '/tmp/base.json' }, '/tmp/artifact.app', '0.6.0'))
      .toThrow('requires all')
  })
})
