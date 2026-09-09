import { describe, expect, it, vi } from 'vitest'
import { DesktopUpdateInstaller } from '../src/update/install.ts'
import type { DesktopUpdateTarget, VerifiedDesktopUpdate } from '../src/update/release.ts'

function fixture(target: DesktopUpdateTarget) {
  const descriptor: VerifiedDesktopUpdate = {
    target, desktopVersion: '0.5.8', harnessVersion: '0.1.3-alpha.1', assetName: 'native fixture',
    localPath: 'native-owned-path', stagingDirectory: 'native-owned-stage', bytes: 1024, sha256: 'a'.repeat(64),
  }
  const owner = {
    getInstallDescriptor: () => descriptor,
    verifyInstallDescriptor: vi.fn(async () => descriptor),
    beginInstallTransaction: vi.fn(() => vi.fn()),
    beginInstall: vi.fn(() => descriptor.localPath),
    markManualInstallReady: vi.fn(), reportInstallFailure: vi.fn(),
  }
  const native = {
    isPackaged: true, confirmSetup: vi.fn(async () => true),
    launchMac: vi.fn(async () => undefined), launchWindows: vi.fn(async () => undefined),
    revealLinux: vi.fn(async () => undefined), quit: vi.fn(),
  }
  return { owner, native, installer: new DesktopUpdateInstaller(owner, native) }
}

describe('native update state transitions', () => {
  it.each(['deb', 'appimage'] as const)('reveals %s repeatedly without quitting, executing, or claiming installation', async (packageFormat) => {
    const { installer, owner, native } = fixture({ platform: 'linux', arch: 'x64', packageFormat })
    expect(await installer.install()).toEqual({ opened: true, status: 'manual-install-ready', action: 'reveal-package', packageFormat })
    await installer.install()
    expect(owner.verifyInstallDescriptor).toHaveBeenCalledTimes(2)
    expect(native.revealLinux).toHaveBeenCalledTimes(2)
    expect(owner.markManualInstallReady).toHaveBeenCalledTimes(2)
    expect(owner.beginInstall).not.toHaveBeenCalled()
    expect(native.quit).not.toHaveBeenCalled()
    expect(native.launchWindows).not.toHaveBeenCalled()
    expect(native.launchMac).not.toHaveBeenCalled()
  })

  it('coalesces repeated Windows requests into one confirmed, verified, visible wizard handoff', async () => {
    const { installer, owner, native } = fixture({ platform: 'win32', arch: 'x64', packageFormat: 'nsis' })
    const [first, second] = await Promise.all([installer.install(), installer.install()])
    expect(first).toEqual({ opened: true, status: 'handoff-requested', action: 'open-setup-wizard' })
    expect(second).toEqual(first)
    expect(native.confirmSetup).toHaveBeenCalledTimes(1)
    expect(owner.verifyInstallDescriptor).toHaveBeenCalledTimes(1)
    expect(native.launchWindows).toHaveBeenCalledTimes(1)
    expect(owner.beginInstall).toHaveBeenCalledTimes(1)
    expect(native.quit).toHaveBeenCalledTimes(1)
  })

  it('leaves Windows open and ready after an observed confirmation cancellation', async () => {
    const { installer, native, owner } = fixture({ platform: 'win32', arch: 'x64', packageFormat: 'nsis' })
    native.confirmSetup.mockResolvedValue(false)
    expect(await installer.install()).toEqual({ opened: false, status: 'cancelled', action: 'open-setup-wizard' })
    expect(owner.beginInstall).not.toHaveBeenCalled()
    expect(native.launchWindows).not.toHaveBeenCalled()
    expect(native.quit).not.toHaveBeenCalled()
  })

  it('retains the protected Mac handoff and only quits after preparation succeeds', async () => {
    const { installer, native, owner } = fixture({ platform: 'darwin', arch: 'x64', packageFormat: 'dmg' })
    expect(await installer.install()).toEqual({ opened: true, status: 'handoff-requested', action: 'protected-replace' })
    expect(native.launchMac).toHaveBeenCalledTimes(1)
    expect(owner.beginInstall).toHaveBeenCalledTimes(1)
    expect(native.quit).toHaveBeenCalledTimes(1)
  })

  it.each(['verify', 'opener'] as const)('reports %s failure without leaking native paths or claiming success', async (failure) => {
    const { installer, owner, native } = fixture({ platform: 'linux', arch: 'x64', packageFormat: 'deb' })
    if (failure === 'verify') owner.verifyInstallDescriptor.mockRejectedValue(new Error('private /home/secret'))
    else native.revealLinux.mockRejectedValue(new Error('private /home/secret'))
    const result = await installer.install()
    expect(result).toMatchObject({ opened: false, status: 'error', action: 'reveal-package' })
    expect(JSON.stringify(result)).not.toContain('/home/secret')
    expect(owner.markManualInstallReady).not.toHaveBeenCalled()
    expect(native.quit).not.toHaveBeenCalled()
  })
})
