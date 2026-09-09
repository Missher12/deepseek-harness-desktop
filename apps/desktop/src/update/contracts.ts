import { compareVersions, desktopUpdateAssetName, resolveDesktopUpdateTarget } from './release.ts'

export type DesktopUpdatePhase =
  | 'idle' | 'checking' | 'current' | 'upstream-available' | 'desktop-available'
  | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error' | 'manual-install-ready'

export type DesktopInstallAction = 'protected-replace' | 'open-setup-wizard' | 'reveal-package'

export type DesktopUpdatePresentation =
  | { platform: 'darwin'; arch: 'x64'; packageFormat: 'dmg'; installAction: 'protected-replace'; supportReason: null }
  | { platform: 'win32'; arch: 'x64'; packageFormat: 'nsis'; installAction: 'open-setup-wizard'; supportReason: null }
  | { platform: 'linux'; arch: 'x64'; packageFormat: 'deb' | 'appimage'; installAction: 'reveal-package'; supportReason: null }
  | { platform: 'linux'; arch: 'x64'; packageFormat: 'unknown'; installAction: null; supportReason: 'detecting' | 'unknown-package' }
  | { platform: 'darwin' | 'win32' | 'linux' | 'unsupported'; arch: 'x64' | 'unsupported'; packageFormat: 'unknown'; installAction: null; supportReason: 'unsupported-runtime' }

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

export type DesktopUpdateSnapshot = DesktopUpdateSnapshotFields & DesktopUpdatePresentation

export type DesktopInstallResult =
  | { opened: true; status: 'handoff-requested'; action: 'protected-replace' | 'open-setup-wizard' }
  | { opened: true; status: 'manual-install-ready'; action: 'reveal-package'; packageFormat: 'deb' | 'appimage' }
  | { opened: false; status: 'cancelled'; action: DesktopInstallAction }
  | { opened: false; status: 'error'; action: DesktopInstallAction | null; message: string }

/** Runtime facts only; an unresolved Linux package never defaults to deb. */
export function createDesktopUpdatePresentation(
  platform: string, arch: string, linuxFormat?: 'deb' | 'appimage' | 'unknown',
): DesktopUpdatePresentation {
  if (arch === 'x64') {
    if (platform === 'darwin') return { platform, arch, packageFormat: 'dmg', installAction: 'protected-replace', supportReason: null }
    if (platform === 'win32') return { platform, arch, packageFormat: 'nsis', installAction: 'open-setup-wizard', supportReason: null }
    if (platform === 'linux') {
      if (linuxFormat === 'deb' || linuxFormat === 'appimage') {
        return { platform, arch, packageFormat: linuxFormat, installAction: 'reveal-package', supportReason: null }
      }
      return { platform, arch, packageFormat: 'unknown', installAction: null, supportReason: linuxFormat === undefined ? 'detecting' : 'unknown-package' }
    }
  }
  return {
    platform: platform === 'darwin' || platform === 'win32' || platform === 'linux' ? platform : 'unsupported',
    arch: arch === 'x64' ? 'x64' : 'unsupported', packageFormat: 'unknown', installAction: null, supportReason: 'unsupported-runtime',
  }
}

const PHASES: readonly string[] = [
  'idle', 'checking', 'current', 'upstream-available', 'desktop-available',
  'downloading', 'verifying', 'ready', 'installing', 'error', 'manual-install-ready',
]
const SNAPSHOT_KEYS = [
  'phase', 'runningDesktop', 'includedHarness', 'latestOfficialHarness', 'latestDesktop',
  'lastCheckedAt', 'downloadProgress', 'message', 'assetName', 'downloadedBytes', 'downloadTotalBytes',
  'platform', 'arch', 'packageFormat', 'installAction', 'supportReason',
]

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function version(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && compareVersions(value, value) === 0
}

function nullableBytes(value: unknown): boolean {
  return value === null || Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_648
}

/** Reject extra authority and inconsistent native/progress states at the IPC boundary. */
export function isDesktopUpdateSnapshot(value: unknown): value is DesktopUpdateSnapshot {
  if (!record(value) || !exactKeys(value, SNAPSHOT_KEYS)) return false
  if (typeof value.phase !== 'string' || !PHASES.includes(value.phase)
    || !version(value.runningDesktop) || !version(value.includedHarness)
    || value.latestOfficialHarness !== null && !version(value.latestOfficialHarness)
    || value.latestDesktop !== null && !version(value.latestDesktop)
    || value.lastCheckedAt !== null && (!Number.isSafeInteger(value.lastCheckedAt) || Number(value.lastCheckedAt) < 0)
    || value.message !== null && (typeof value.message !== 'string' || value.message.length > 300)
    || !nullableBytes(value.downloadedBytes) || !nullableBytes(value.downloadTotalBytes)
    || value.downloadProgress !== null && (typeof value.downloadProgress !== 'number'
      || !Number.isFinite(value.downloadProgress) || value.downloadProgress < 0 || value.downloadProgress > 1)) return false
  if (value.downloadedBytes !== null && (value.downloadTotalBytes === null
    || Number(value.downloadedBytes) > Number(value.downloadTotalBytes))) return false
  if (value.downloadProgress !== null && (value.downloadedBytes === null || !(Number(value.downloadTotalBytes) > 0)
    || value.downloadProgress !== Number(value.downloadedBytes) / Number(value.downloadTotalBytes))) return false
  if (typeof value.platform !== 'string' || typeof value.arch !== 'string') return false
  const format = value.packageFormat === 'deb' || value.packageFormat === 'appimage' ? value.packageFormat : undefined
  const expected = createDesktopUpdatePresentation(value.platform, value.arch,
    value.supportReason === 'unknown-package' ? 'unknown' : format)
  if (expected.platform !== value.platform || expected.arch !== value.arch || expected.packageFormat !== value.packageFormat
    || expected.installAction !== value.installAction || expected.supportReason !== value.supportReason) return false
  const target = resolveDesktopUpdateTarget(value.platform, value.arch, format ?? 'unknown')
  if (target === null && ['desktop-available', 'downloading', 'verifying', 'ready', 'manual-install-ready', 'installing'].includes(value.phase)) return false
  if (value.phase === 'manual-install-ready' && value.platform !== 'linux') return false
  if (value.phase === 'installing' && value.installAction === 'reveal-package') return false
  if (value.assetName !== null && (target === null || !version(value.latestDesktop)
    || value.assetName !== desktopUpdateAssetName(value.latestDesktop, target))) return false
  return true
}

/** A native handoff is not evidence of an external installation completing. */
export function isDesktopInstallResult(value: unknown): value is DesktopInstallResult {
  if (!record(value)) return false
  const action = value.action === 'protected-replace' || value.action === 'open-setup-wizard' || value.action === 'reveal-package'
  if (value.opened === true && value.status === 'handoff-requested') {
    return exactKeys(value, ['opened', 'status', 'action']) && (value.action === 'protected-replace' || value.action === 'open-setup-wizard')
  }
  if (value.opened === true && value.status === 'manual-install-ready') {
    return exactKeys(value, ['opened', 'status', 'action', 'packageFormat']) && value.action === 'reveal-package'
      && (value.packageFormat === 'deb' || value.packageFormat === 'appimage')
  }
  if (value.opened === false && value.status === 'cancelled') return exactKeys(value, ['opened', 'status', 'action']) && action
  return value.opened === false && value.status === 'error' && exactKeys(value, ['opened', 'status', 'action', 'message'])
    && (action || value.action === null) && typeof value.message === 'string' && value.message.length <= 300
}
