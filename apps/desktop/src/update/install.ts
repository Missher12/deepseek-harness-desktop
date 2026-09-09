import type { DesktopInstallAction, DesktopInstallResult } from './contracts.ts'
import type { VerifiedDesktopUpdate } from './release.ts'

interface UpdateOwner {
  getInstallDescriptor(): VerifiedDesktopUpdate | null
  verifyInstallDescriptor(): Promise<VerifiedDesktopUpdate>
  beginInstallTransaction(): () => void
  beginInstall(): string
  markManualInstallReady(): void
  reportInstallFailure(): void
}

interface NativeUpdateActions {
  isPackaged: boolean
  confirmSetup(descriptor: VerifiedDesktopUpdate): Promise<boolean>
  launchMac(descriptor: VerifiedDesktopUpdate): void | Promise<void>
  launchWindows(descriptor: VerifiedDesktopUpdate): Promise<void>
  revealLinux(descriptor: VerifiedDesktopUpdate): Promise<void>
  quit(): void
}

/** Serialize native handoffs while keeping platform-specific installation semantics separate. */
export class DesktopUpdateInstaller {
  #active: Promise<DesktopInstallResult> | null = null

  constructor(private readonly owner: UpdateOwner, private readonly native: NativeUpdateActions) {}

  async install(): Promise<DesktopInstallResult> {
    if (this.#active !== null) return await this.#active
    const task = this.#install()
    this.#active = task
    try {
      return await task
    } finally {
      if (this.#active === task) this.#active = null
    }
  }

  async #install(): Promise<DesktopInstallResult> {
    const candidate = this.owner.getInstallDescriptor()
    const action: DesktopInstallAction | null = candidate === null ? null
      : candidate.target.platform === 'darwin' ? 'protected-replace'
        : candidate.target.platform === 'win32' ? 'open-setup-wizard' : 'reveal-package'
    if (candidate === null || !this.native.isPackaged) {
      return { opened: false, status: 'error', action, message: 'No verified update is ready in an installed Desktop application.' }
    }
    let release: (() => void) | undefined
    try {
      release = this.owner.beginInstallTransaction()
      if (candidate.target.platform === 'win32' && !await this.native.confirmSetup(candidate)) {
        return { opened: false, status: 'cancelled', action: 'open-setup-wizard' }
      }
      const descriptor = await this.owner.verifyInstallDescriptor()
      if (descriptor.localPath !== candidate.localPath || descriptor.sha256 !== candidate.sha256) throw new Error('Update selection changed.')
      if (descriptor.target.platform === 'linux') {
        await this.native.revealLinux(descriptor)
        this.owner.markManualInstallReady()
        return { opened: true, status: 'manual-install-ready', action: 'reveal-package', packageFormat: descriptor.target.packageFormat }
      }
      if (descriptor.target.platform === 'darwin') await this.native.launchMac(descriptor)
      else await this.native.launchWindows(descriptor)
      this.owner.beginInstall()
      this.native.quit()
      return { opened: true, status: 'handoff-requested', action: descriptor.target.platform === 'darwin' ? 'protected-replace' : 'open-setup-wizard' }
    } catch {
      this.owner.reportInstallFailure()
      return { opened: false, status: 'error', action, message: 'Could not verify or open the installation package. The application has not been closed. Try again.' }
    } finally {
      release?.()
    }
  }
}
