/** Pure version and release validation for the native Desktop updater. */

/** Native-selected payload variants. Renderers cannot select an install target. */
export type DesktopUpdateTarget =
  | { platform: 'darwin'; arch: 'x64'; packageFormat: 'dmg' }
  | { platform: 'win32'; arch: 'x64'; packageFormat: 'nsis' }
  | { platform: 'linux'; arch: 'x64'; packageFormat: 'deb' }
  | { platform: 'linux'; arch: 'x64'; packageFormat: 'appimage' }

interface ManifestFields {
  desktopVersion: string
  harnessVersion: string
  assetName: string
  bytes: number
  sha256: string
  releaseUrl: string
}

/** Mac keeps its released flat schema; other platforms use separate manifests. */
export type DesktopUpdateManifest = ManifestFields & (
  | { schema: 1; platform: 'darwin'; arch: 'x64' }
  | ({ schema: 2 } & Exclude<DesktopUpdateTarget, { platform: 'darwin' }>)
)

/** Service-owned verified file, never accepted from or returned to a renderer. */
export interface VerifiedDesktopUpdate {
  readonly target: DesktopUpdateTarget
  readonly desktopVersion: string
  readonly harnessVersion: string
  readonly assetName: string
  readonly localPath: string
  readonly stagingDirectory: string
  readonly bytes: number
  readonly sha256: string
}

/** Resolve supported native packaging without guessing an unknown Linux format. */
export function resolveDesktopUpdateTarget(
  platform: string, arch: string, linuxFormat: 'deb' | 'appimage' | 'unknown' = 'unknown',
): DesktopUpdateTarget | null {
  if (arch !== 'x64') return null
  if (platform === 'darwin') return { platform, arch, packageFormat: 'dmg' }
  if (platform === 'win32') return { platform, arch, packageFormat: 'nsis' }
  if (platform === 'linux' && linuxFormat !== 'unknown') return { platform, arch, packageFormat: linuxFormat }
  return null
}

/** Fixed manifest entry for a native-selected package format. */
export function desktopUpdateManifestName(target: DesktopUpdateTarget): string {
  if (target.platform === 'darwin') return 'deepseek-harness-desktop-update.json'
  if (target.platform === 'win32') return 'deepseek-harness-desktop-update-win-x64.json'
  return `deepseek-harness-desktop-update-linux-x64-${target.packageFormat}.json`
}

/** Canonical release asset basename for one Desktop version and native target. */
export function desktopUpdateAssetName(version: string, target: DesktopUpdateTarget): string {
  if (target.platform === 'darwin') return `DeepSeek-Harness-${version}-mac-x64.dmg`
  if (target.platform === 'win32') return `DeepSeek-Harness-Setup-${version}-win-x64.exe`
  return `DeepSeek-Harness-${version}-linux-x64.${target.packageFormat === 'deb' ? 'deb' : 'AppImage'}`
}

export type UpdateAvailability = 'current' | 'upstream-available' | 'desktop-available'

interface ParsedVersion {
  core: [number, number, number]
  prerelease: Array<number | string>
}

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_RE.exec(value)
  if (match === null) return null
  const prerelease = match[4] === undefined ? [] : match[4].split('.').map((part) => {
    if (/^(0|[1-9]\d*)$/.test(part)) return Number(part)
    return part
  })
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease,
  }
}

/** Compare strict semantic versions; malformed input returns null. */
export function compareVersions(left: string, right: string): -1 | 0 | 1 | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return null
  for (const index of [0, 1, 2] as const) {
    const av = a.core[index]
    const bv = b.core[index]
    if (av < bv) return -1
    if (av > bv) return 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index]
    const bv = b.prerelease[index]
    if (av === undefined) return -1
    if (bv === undefined) return 1
    if (av === bv) continue
    if (typeof av === 'number' && typeof bv === 'string') return -1
    if (typeof av === 'string' && typeof bv === 'number') return 1
    return av < bv ? -1 : 1
  }
  return 0
}

/** Parse only the official Harness tag namespace. */
export function parseOfficialHarnessTag(tag: string): string | null {
  if (!tag.startsWith('dsh-v')) return null
  const version = tag.slice('dsh-v'.length)
  return parseVersion(version) === null ? null : version
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate a payload against native packaging; omitted target preserves the legacy Mac parser. */
export function validateDesktopUpdateManifest(
  value: unknown,
  target: DesktopUpdateTarget = { platform: 'darwin', arch: 'x64', packageFormat: 'dmg' },
): DesktopUpdateManifest | null {
  if (!isRecord(value)) return null
  if (value.platform !== target.platform || value.arch !== target.arch) return null
  if (target.platform === 'darwin') {
    if (value.schema !== 1) return null
  } else if (value.schema !== 2 || value.packageFormat !== target.packageFormat) return null
  if (typeof value.desktopVersion !== 'string' || parseVersion(value.desktopVersion) === null) return null
  if (typeof value.harnessVersion !== 'string' || parseVersion(value.harnessVersion) === null) return null
  if (typeof value.assetName !== 'string'
    || value.assetName !== desktopUpdateAssetName(value.desktopVersion, target)) return null
  if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) <= 0 || Number(value.bytes) > 2_147_483_648) return null
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) return null
  if (typeof value.releaseUrl !== 'string') return null
  if (value.releaseUrl !== `https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v${value.desktopVersion}`) return null
  return value as unknown as DesktopUpdateManifest
}

/** Derive the user-visible availability without granting install authority to upstream tags. */
export function selectUpdateAvailability(input: {
  runningDesktop: string
  includedHarness: string
  latestOfficialHarness: string | null
  desktopManifest: DesktopUpdateManifest | null
}): UpdateAvailability {
  if (input.desktopManifest !== null
    && compareVersions(input.desktopManifest.desktopVersion, input.runningDesktop) === 1) {
    return 'desktop-available'
  }
  if (input.latestOfficialHarness !== null
    && compareVersions(input.latestOfficialHarness, input.includedHarness) === 1) {
    return 'upstream-available'
  }
  return 'current'
}
