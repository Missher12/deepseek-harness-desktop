/** Profile-backed preferences owned by the reasoning-effort control. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned only by this plugin. */
export const REASONING_EFFORT_SETTINGS_NAMESPACE = 'reasoning-effort'

/** The complete durable preference section. */
export interface ReasoningEffortPreference {
  /** Whether the attributed character sprite replaces the plain slider thumb. */
  chibiThumb: boolean
  /** Visual ladder positions keyed by session, provider, and model. */
  visualEfforts: Readonly<Record<string, number>>
}

/** Maximum durable route entries retained by the removable plugin. */
export const MAX_VISUAL_EFFORT_PREFERENCES = 64

/** Maximum serialized route-key length accepted at the settings boundary. */
export const MAX_VISUAL_EFFORT_ROUTE_LENGTH = 512

const EMPTY_VISUAL_EFFORTS = Object.freeze({}) as Readonly<Record<string, number>>

/** Fail-closed first-install and corrupt-read value. */
export const DEFAULT_REASONING_EFFORT_PREFERENCE: Readonly<ReasoningEffortPreference> = Object.freeze({
  chibiThumb: false,
  visualEfforts: EMPTY_VISUAL_EFFORTS,
})

function readVisualEfforts(value: unknown): Readonly<Record<string, number>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > MAX_VISUAL_EFFORT_PREFERENCES) return undefined
  const accepted: Record<string, number> = {}
  for (const [route, index] of entries) {
    if (route.length === 0
      || route.length > MAX_VISUAL_EFFORT_ROUTE_LENGTH
      || !Number.isInteger(index)
      || Number(index) < 0
      || Number(index) > 5) return undefined
    accepted[route] = Number(index)
  }
  return accepted
}

/**
 * Read one untrusted standalone preference value. Absent, malformed, or
 * extended values fail closed so corrupt browser/bootstrap data never enables
 * the optional character or restores an invalid visual effort.
 * @param value - Raw preference value from a storage or wire boundary.
 * @returns A detached valid preference, or the frozen character-off default.
 */
export function readPreference(value: unknown): Readonly<ReasoningEffortPreference> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_REASONING_EFFORT_PREFERENCE
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if ((keys.length !== 1 && keys.length !== 2)
    || !keys.includes('chibiThumb')
    || keys.some(key => key !== 'chibiThumb' && key !== 'visualEfforts')
    || typeof record.chibiThumb !== 'boolean') {
    return DEFAULT_REASONING_EFFORT_PREFERENCE
  }
  if (!keys.includes('visualEfforts')) {
    return { chibiThumb: record.chibiThumb, visualEfforts: {} }
  }
  const visualEfforts = readVisualEfforts(record.visualEfforts)
  if (visualEfforts === undefined) return DEFAULT_REASONING_EFFORT_PREFERENCE
  return { chibiThumb: record.chibiThumb, visualEfforts }
}

/** Normalize persisted input and migrate the former character-only section. */
function normalizePersistedPreference(value: unknown): ReasoningEffortPreference {
  const preference = readPreference(value)
  return {
    chibiThumb: preference.chibiThumb,
    visualEfforts: { ...preference.visualEfforts },
  }
}

/**
 * Profile schema with character-off and no remembered visual effort defaults. The transform deliberately
 * receives the untrusted object before an object schema could discard extra
 * keys, so corrupt or extended stored values fail closed instead of blocking
 * plugin activation. The exact PUT patch parser remains the strict write boundary.
 */
export const ReasoningEffortPreferenceSchema = z.transform(
  z.any<unknown>(),
  normalizePersistedPreference,
).default(DEFAULT_REASONING_EFFORT_PREFERENCE)
