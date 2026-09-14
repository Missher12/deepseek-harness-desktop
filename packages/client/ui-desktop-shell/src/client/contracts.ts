/** Renderer-facing subset of the context-isolated native preload. */
import type { DesktopPresentation } from './bridge.ts'

/** Native lifecycle when the last window closes. */
export type DesktopCloseBehavior = 'keep-running' | 'quit'

/** This plugin can read native preferences but can mutate only closeBehavior. */
export interface DesktopShellBridge {
  openCompatibility?(): Promise<void>
  readonly presentation: DesktopPresentation
  onCommand(listener: (command: unknown) => void): () => void
  getDesktopPreferences(): Promise<unknown>
  setDesktopPreference(mutation: { key: 'closeBehavior'; value: DesktopCloseBehavior }): Promise<unknown>
  onDesktopPreferences(listener: (snapshot: unknown) => void): () => void
}

/**
 * Validate the capabilities and presentation consumed by this plugin.
 * @param value - optional global preload value.
 * @returns whether the restricted native shell face is complete.
 */
export function isDesktopShellBridge(value: unknown): value is DesktopShellBridge {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const presentation = candidate.presentation
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) return false
  const titlebar = (presentation as Record<string, unknown>).titlebar
  return (candidate.openCompatibility === undefined || typeof candidate.openCompatibility === 'function')
    && Object.keys(presentation).length === 1 && (titlebar === 'native' || titlebar === 'hidden-inset')
    && ['onCommand', 'getDesktopPreferences', 'setDesktopPreference', 'onDesktopPreferences']
      .every(key => typeof candidate[key] === 'function')
}
