/** Profile-backed preference for the optional reasoning-effort character thumb. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned only by this plugin. */
export const REASONING_EFFORT_SETTINGS_NAMESPACE = 'reasoning-effort'

/** The complete durable preference section. */
export interface ReasoningEffortPreference {
  /** Whether the attributed character sprite replaces the plain slider thumb. */
  chibiThumb: boolean
}

/** Fail-closed first-install and corrupt-read value. */
export const DEFAULT_REASONING_EFFORT_PREFERENCE: Readonly<ReasoningEffortPreference> = Object.freeze({
  chibiThumb: false,
})

/** One profile-scoped, defaulted boolean; no unrelated settings live here. */
export const ReasoningEffortPreferenceSchema: z<ReasoningEffortPreference> = z.object({
  chibiThumb: z.boolean().default(false),
})

/**
 * Read one untrusted standalone preference value. Absent, malformed, or
 * extended values fail closed so corrupt browser/bootstrap data never enables
 * the optional character.
 * @param value - Raw preference value from a storage or wire boundary.
 * @returns A detached valid preference, or the frozen character-off default.
 */
export function readPreference(value: unknown): Readonly<ReasoningEffortPreference> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_REASONING_EFFORT_PREFERENCE
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || typeof record.chibiThumb !== 'boolean') {
    return DEFAULT_REASONING_EFFORT_PREFERENCE
  }
  return { chibiThumb: record.chibiThumb }
}
