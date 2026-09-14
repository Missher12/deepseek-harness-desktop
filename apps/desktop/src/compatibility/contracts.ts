/** Closed native compatibility IPC vocabulary; package paths and validators remain private. */
export interface DesktopPluginMutation {
  name: string
  revision: number
  action: 'enable' | 'disable' | 'restore'
}
/** Safe native plugin and configuration recovery state. */
export interface DesktopCompatibilitySnapshot {
  schemaVersion: 1
  revision: number
  canonicalProfile: 'web'
  effectiveProfile: 'desktop-base'
  restartRequired: true
  originalPatchReload: 'live' | 'startup' | null
  recoveryCode: string | null
  entries: Array<{
    name: string
    version: string
    enabled: boolean
    health: 'unverified' | 'healthy' | 'suspected' | 'paused'
    reason: string | null
    requiredBundles: string[]
  }>
}
const packageName = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** @param value Untrusted renderer input. @returns Whether the exact choice message is permitted. */
export function isDesktopPluginMutation(value: unknown): value is DesktopPluginMutation {
  return record(value) && Object.keys(value).length === 3 && packageName(value.name) && revision(value.revision)
    && (value.action === 'enable' || value.action === 'disable' || value.action === 'restore')
}

/** @param value Native IPC result. @returns Whether it contains only the safe recovery projection. */
export function isDesktopCompatibilitySnapshot(value: unknown): value is DesktopCompatibilitySnapshot {
  return record(value) && Object.keys(value).length === 8 && value.schemaVersion === 1 && revision(value.revision)
    && value.canonicalProfile === 'web' && value.effectiveProfile === 'desktop-base' && value.restartRequired === true
    && (value.originalPatchReload === null || value.originalPatchReload === 'live' || value.originalPatchReload === 'startup')
    && (value.recoveryCode === null || (typeof value.recoveryCode === 'string' && /^[a-z-]{1,80}$/.test(value.recoveryCode)))
    && Array.isArray(value.entries) && value.entries.length <= 512 && value.entries.every(entry => record(entry)
      && Object.keys(entry).length === 6 && packageName(entry.name) && typeof entry.version === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/.test(entry.version) && typeof entry.enabled === 'boolean'
      && ['unverified', 'healthy', 'suspected', 'paused'].includes(String(entry.health))
      && (entry.reason === null || (typeof entry.reason === 'string' && /^[a-z-]{1,80}$/.test(entry.reason)))
      && Array.isArray(entry.requiredBundles) && entry.requiredBundles.every(packageName))
}
