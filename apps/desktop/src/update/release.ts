/** Pure version and release validation for the native Desktop updater. */

export interface DesktopUpdateManifest {
  schema: 1
  desktopVersion: string
  harnessVersion: string
  platform: 'darwin'
  arch: 'x64'
  assetName: string
  bytes: number
  sha256: string
  releaseUrl: string
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

/** Validate the only manifest shape that may authorize an Intel macOS download. */
export function validateDesktopUpdateManifest(value: unknown): DesktopUpdateManifest | null {
  if (!isRecord(value)) return null
  if (value.schema !== 1 || value.platform !== 'darwin' || value.arch !== 'x64') return null
  if (typeof value.desktopVersion !== 'string' || parseVersion(value.desktopVersion) === null) return null
  if (typeof value.harnessVersion !== 'string' || parseVersion(value.harnessVersion) === null) return null
  if (typeof value.assetName !== 'string'
    || value.assetName !== `DeepSeek-Harness-${value.desktopVersion}-mac-x64.dmg`) return null
  if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) <= 0 || Number(value.bytes) > 2_147_483_648) return null
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) return null
  if (typeof value.releaseUrl !== 'string') return null
  let releaseUrl: URL
  try { releaseUrl = new URL(value.releaseUrl) } catch { return null }
  if (releaseUrl.protocol !== 'https:' || releaseUrl.hostname !== 'github.com') return null
  if (!releaseUrl.pathname.startsWith('/Missher12/deepseek-harness-desktop/releases/')) return null
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
