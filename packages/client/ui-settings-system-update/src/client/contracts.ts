/** Closed native Desktop update lifecycle. */
export type DesktopUpdatePhase =
  | 'idle' | 'checking' | 'current' | 'upstream-available' | 'desktop-available'
  | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'

/** Validated update state shared by preload and settings UI. */
export interface DesktopUpdateSnapshot {
  phase: DesktopUpdatePhase
  runningDesktop: string
  includedHarness: string
  latestOfficialHarness: string | null
  latestDesktop: string | null
  lastCheckedAt: number | null
  downloadProgress: number | null
  message: string | null
}

/** Narrow native updater bridge exposed by the Desktop preload. */
export interface DesktopUpdateBridge {
  getUpdateStatus(): Promise<DesktopUpdateSnapshot>
  checkForUpdates(): Promise<DesktopUpdateSnapshot>
  downloadUpdate(): Promise<DesktopUpdateSnapshot>
  installUpdate(): Promise<{ opened: boolean; message?: string }>
  onUpdateStatus(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void
}

declare global {
  interface Window {
    dshDesktop?: {
      onCommand(listener: (command: unknown) => void): () => void
    } & DesktopUpdateBridge
  }
}
