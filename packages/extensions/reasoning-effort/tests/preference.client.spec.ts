import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REASONING_EFFORT_PREFERENCE,
  ReasoningEffortPreferenceSchema,
  readPreference,
} from '../src/preference.ts'

describe('reasoning-effort character preference', () => {
  it('defaults an absent setting to a frozen character-off value', () => {
    expect(readPreference(undefined)).toEqual({ chibiThumb: false, visualEfforts: {} })
    expect(readPreference(null)).toEqual({ chibiThumb: false, visualEfforts: {} })
    expect(readPreference({})).toEqual({ chibiThumb: false, visualEfforts: {} })
    expect(readPreference(undefined)).toBe(DEFAULT_REASONING_EFFORT_PREFERENCE)
    expect(Object.isFrozen(DEFAULT_REASONING_EFFORT_PREFERENCE)).toBe(true)
  })

  it.each([
    { chibiThumb: 'true' },
    { chibiThumb: 1 },
    { chibiThumb: null },
    { chibiThumb: true, extra: true },
    [],
    'true',
  ])('fails closed when the standalone read sees corrupt data: %j', (value) => {
    expect(readPreference(value)).toBe(DEFAULT_REASONING_EFFORT_PREFERENCE)
  })

  it('accepts either boolean and returns a detached preference', () => {
    const enabled = { chibiThumb: true }
    expect(readPreference(enabled)).toEqual({ chibiThumb: true, visualEfforts: {} })
    expect(readPreference(enabled)).not.toBe(enabled)
    expect(readPreference({ chibiThumb: false })).toEqual({ chibiThumb: false, visualEfforts: {} })
    const stored = { chibiThumb: false, visualEfforts: { '["session","provider","model"]': 5 } }
    expect(readPreference(stored)).toEqual(stored)
    expect(readPreference(stored)).not.toBe(stored)
  })

  it('normalizes persisted data to one detached defaulted boolean', () => {
    expect(ReasoningEffortPreferenceSchema({})).toEqual({ chibiThumb: false, visualEfforts: {} })
    const valid = { chibiThumb: true }
    expect(ReasoningEffortPreferenceSchema(valid)).toEqual({ chibiThumb: true, visualEfforts: {} })
    expect(ReasoningEffortPreferenceSchema(valid)).not.toBe(valid)
    expect(ReasoningEffortPreferenceSchema({ chibiThumb: 'true' }))
      .toEqual({ chibiThumb: false, visualEfforts: {} })
    expect(ReasoningEffortPreferenceSchema({ chibiThumb: true, extra: true }))
      .toEqual({ chibiThumb: false, visualEfforts: {} })
  })
})
