import type { Locator } from 'playwright'
import { afterEach, expect, it, vi } from 'vitest'
import { lstat, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopBaseSmokeDescriptor } from '../../../scripts/desktop-base-contract.ts'
import { baseSmokeScaleArguments, closeBaseSmokeOwnedApplication, captureNativePackagedBaseIdentity, prepareOwnedBaseSmokeDirectory, runPackagedDesktopBaseSmoke, waitForPackagedBaseReady, type PackagedBaseReadyPage } from './packaged-base-smoke.ts'

afterEach(() => { vi.unstubAllEnvs() })

it.each([true, false])('withholds confirmation when process discovery fails and root alive is %s', async (rootAlive) => {
  const recorded: number[] = []
  const first = new Error('first process table failure')
  const wait = vi.fn(async () => {})
  const quit = vi.fn(async () => { if (rootAlive) throw new Error('root did not quit') })
  await expect(closeBaseSmokeOwnedApplication({ rootPid: 42, record: (ids) => { recorded.push(...ids) },
    discover: async () => { throw first }, quit, waitForQuiescence: wait,
  })).rejects.toThrow(rootAlive ? /discovery/ : first)
  expect(recorded).toEqual([42])
  expect(quit).toHaveBeenCalledOnce()
  expect(wait).not.toHaveBeenCalled()
})

it('refuses a dead root with a still-live recorded child and confirms only a quiescent complete tree', async () => {
  for (const childAlive of [true, false]) {
    let confirmed = false
    const closing = closeBaseSmokeOwnedApplication({ rootPid: 42, record: () => {}, discover: async () => [42, 43], quit: async () => {},
      waitForQuiescence: async (ids) => { expect(ids).toEqual([42, 43]); if (childAlive) throw new Error('child remains alive') },
    }).then(() => { confirmed = true })
    if (childAlive) await expect(closing).rejects.toThrow(/child remains/)
    else await closing
    expect(confirmed).toBe(!childAlive)
  }
})

it('passes display scale directly to the unchanged native executable', () => {
  expect(baseSmokeScaleArguments()).toEqual([])
  expect(baseSmokeScaleArguments(100)).toEqual(['--force-device-scale-factor=1'])
  expect(baseSmokeScaleArguments(150)).toEqual(['--force-device-scale-factor=1.5'])
  expect(() => baseSmokeScaleArguments(50 as 100)).toThrow(/scale/)
})

it('refuses a foreign platform before starting Electron or writing fixtures', async () => {
  const platform = process.platform === 'win32' ? 'darwin' : 'win32'
  await expect(runPackagedDesktopBaseSmoke('/not-an-executable', platform)).rejects.toThrow(/matching native x64/u)
})

it('requires an actual stage descriptor before native launch', async () => {
  vi.stubEnv('DSH_DESKTOP_SMOKE_DESCRIPTOR', undefined)
  await expect(runPackagedDesktopBaseSmoke('/not-an-executable', process.platform)).rejects.toThrow(/DSH_DESKTOP_SMOKE_DESCRIPTOR/u)
})

it('rejects a symlinked parent before creating a fixture directory outside isolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-base-smoke-path-'))
  try {
    const isolation = join(root, 'owned')
    const outside = join(root, 'outside')
    await mkdir(isolation)
    await mkdir(outside)
    await symlink(outside, join(isolation, 'home'), 'dir')
    await expect(prepareOwnedBaseSmokeDirectory(isolation, join(isolation, 'home/new-home'))).rejects.toThrow(/physical directory/u)
    await expect(lstat(join(outside, 'new-home'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('does not silently fall back to extracted identity when a direct AppImage lacks native mount observations', async () => {
  const descriptor = createDesktopBaseSmokeDescriptor('0.6.0', 'linux', [])
  await expect(captureNativePackagedBaseIdentity('/fixture/desktop.AppImage', {
    executablePath: '/tmp/.mount_fixture/desktop', appImage: null, appDir: null, mountInfo: null,
    resources: '/tmp/.mount_fixture/resources', appPath: '/tmp/.mount_fixture/resources/app.asar', desktopVersion: '0.6.0',
  }, descriptor, '/fixture/smoke')).rejects.toThrow(/native mount observations/u)
})


function startupPage() {
  function modal() {
    let visible = false
    const button = {
      scrollIntoViewIfNeeded: vi.fn<Locator['scrollIntoViewIfNeeded']>().mockResolvedValue(undefined),
      evaluate: vi.fn<Locator['evaluate']>().mockResolvedValue(true),
      click: vi.fn<Locator['click']>().mockResolvedValue(undefined),
    }
    const dialog = {
      waitFor: vi.fn<Locator['waitFor']>().mockImplementation(async (options) => { visible = options?.state === 'visible' }),
      isVisible: vi.fn<Locator['isVisible']>().mockImplementation(async () => visible),
      getByRole: vi.fn(() => button),
    }
    return { button, dialog, show: () => { visible = true } }
  }
  const welcome = modal(), credential = modal(), unknown = modal()
  const composer = { waitFor: vi.fn<Locator['waitFor']>().mockResolvedValue(undefined), click: vi.fn<Locator['click']>().mockResolvedValue(undefined) }
  const page: PackagedBaseReadyPage = {
    getByRole: (_role, options) => options === undefined ? unknown.dialog
      : options.name.test('内测声明') ? welcome.dialog : credential.dialog,
    locator: () => composer,
  }
  return { page, welcome, credential, unknown, composer }
}

it.each(['welcome', 'credential'] as const)('waits for delayed expected %s even with a visible composer', async (phase) => {
  const f = startupPage()
  let show!: () => void
  const appeared = new Promise<void>((resolve) => { show = resolve })
  const delayed = f[phase]
  delayed.dialog.waitFor.mockImplementation(async (options) => {
    if (options?.state === 'visible') { await appeared; delayed.show() }
  })
  const readiness = waitForPackagedBaseReady(f.page, {
    welcome: 'expected', credentials: phase === 'credential' ? 'missing' : 'configured', timeoutMs: 500,
  })
  try {
    await vi.waitFor(() => { expect(delayed.dialog.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 500 }) })
    expect(f.composer.waitFor).not.toHaveBeenCalled()
    expect(delayed.button.click).not.toHaveBeenCalled()
  } finally { show() }
  expect(await readiness).toEqual({ continueHit: true, configureLaterHit: phase === 'credential' })
  expect(f.welcome.dialog.getByRole).toHaveBeenCalledWith('button', { name: /^(?:Continue|继续)$/u })
  if (phase === 'credential') {
    expect(f.credential.dialog.getByRole).toHaveBeenCalledWith('button', { name: /^(?:Configure later|稍后配置)$/u })
  }
  expect(delayed.button.click).toHaveBeenCalledWith({ timeout: 500 })
  expect(delayed.dialog.waitFor).toHaveBeenCalledWith({ state: 'detached', timeout: 500 })
  expect(f.composer.click).toHaveBeenCalledWith({ trial: true, timeout: 500 })
})

it.each(['unreachable', 'click-blocked', 'not-detached', 'unknown-dialog', 'masked-composer'] as const)(
  'refuses startup readiness for %s without forcing or dismissing unknown UI', async (failure) => {
    const f = startupPage()
    if (failure === 'unreachable') f.welcome.button.evaluate.mockResolvedValue(false)
    if (failure === 'click-blocked') f.welcome.button.click.mockRejectedValue(new Error('click blocked'))
    if (failure === 'not-detached') f.welcome.dialog.waitFor.mockImplementation(async (options) => {
      if (options?.state === 'detached') throw new Error('notice did not detach')
      f.welcome.show()
    })
    if (failure === 'unknown-dialog') f.unknown.dialog.waitFor.mockRejectedValue(new Error('unknown dialog remains'))
    if (failure === 'masked-composer') f.composer.click.mockRejectedValue(new Error('composer masked'))
    await expect(waitForPackagedBaseReady(f.page, { welcome: 'expected', credentials: 'configured', timeoutMs: 50 })).rejects.toThrow()
    expect(f.unknown.button.click).not.toHaveBeenCalled()
    if (failure === 'unreachable') expect(f.welcome.button.click).not.toHaveBeenCalled()
    else expect(f.welcome.button.click).toHaveBeenCalledWith({ timeout: 50 })
  },
)

it('admits the already acknowledged configured-provider fixture without inventing prompt clicks', async () => {
  const f = startupPage()
  expect(await waitForPackagedBaseReady(f.page, { welcome: 'acknowledged', credentials: 'configured', timeoutMs: 50 }))
    .toEqual({ continueHit: false, configureLaterHit: false })
  expect(f.welcome.button.click).not.toHaveBeenCalled()
  expect(f.credential.button.click).not.toHaveBeenCalled()
  expect(f.composer.click).toHaveBeenCalledWith({ trial: true, timeout: 50 })
})
