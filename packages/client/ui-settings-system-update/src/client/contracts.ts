/** Closed renderer-facing lifecycle for a Desktop update operation. */
export type DesktopUpdatePhase =
  | 'idle' | 'checking' | 'current' | 'upstream-available' | 'desktop-available'
  | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'
  | 'manual-install-ready'

/** Sanitized versions and actual download observations from the native updater. */
export interface DesktopUpdateSnapshotFields {
  phase: DesktopUpdatePhase
  runningDesktop: string
  includedHarness: string
  latestOfficialHarness: string | null
  latestDesktop: string | null
  lastCheckedAt: number | null
  downloadProgress: number | null
  message: string | null
  assetName: string | null
  downloadedBytes: number | null
  downloadTotalBytes: number | null
}

/** Native actions; requesting a handoff never proves installation completed. */
export type DesktopInstallAction =
  | 'protected-replace' | 'open-setup-wizard' | 'reveal-package'

/** Closed native platform and package combinations accepted by the preload. */
export type DesktopUpdatePresentation =
  | { platform: 'darwin'; arch: 'x64'; packageFormat: 'dmg'; installAction: 'protected-replace'; supportReason: null }
  | { platform: 'win32'; arch: 'x64'; packageFormat: 'nsis'; installAction: 'open-setup-wizard'; supportReason: null }
  | { platform: 'linux'; arch: 'x64'; packageFormat: 'deb' | 'appimage'; installAction: 'reveal-package'; supportReason: null }
  | { platform: 'linux'; arch: 'x64'; packageFormat: 'unknown'; installAction: null; supportReason: 'detecting' | 'unknown-package' }
  | { platform: 'darwin' | 'win32' | 'linux' | 'unsupported'; arch: 'x64' | 'unsupported'; packageFormat: 'unknown'; installAction: null; supportReason: 'unsupported-runtime' }

/** Flat sanitized status delivered across the context-isolated bridge. */
export type DesktopUpdateSnapshot = DesktopUpdateSnapshotFields & DesktopUpdatePresentation

/** Observed native action result, not the outcome of an external installer. */
export type DesktopInstallResult =
  | { opened: true; status: 'handoff-requested'; action: 'protected-replace' | 'open-setup-wizard' }
  | { opened: true; status: 'manual-install-ready'; action: 'reveal-package'; packageFormat: 'deb' | 'appimage' }
  | { opened: false; status: 'cancelled'; action: DesktopInstallAction }
  | { opened: false; status: 'error'; action: DesktopInstallAction | null; message: string }

/** Fixed update operations exposed by the Electron preload bridge. */
export interface DesktopUpdateBridge {
  getUpdateStatus(): Promise<DesktopUpdateSnapshot>
  checkForUpdates(): Promise<DesktopUpdateSnapshot>
  downloadUpdate(): Promise<DesktopUpdateSnapshot>
  cancelUpdateDownload(): Promise<DesktopUpdateSnapshot>
  installUpdate(): Promise<DesktopInstallResult>
  onUpdateStatus(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void
}

declare global {
  interface Window {
    dshDesktop?: {
      onCommand(listener: (command: unknown) => void): () => void
    } & DesktopUpdateBridge
  }
}
