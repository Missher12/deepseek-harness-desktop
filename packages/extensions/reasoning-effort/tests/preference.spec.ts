import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REASONING_EFFORT_PREFERENCE,
  ReasoningEffortPreferenceSchema,
  readPreference,
} from '../src/preference.ts'

describe('reasoning-effort character preference', () => {
  it('defaults an absent setting to a frozen character-off value', () => {
    expect(readPreference(undefined)).toEqual({ chibiThumb: false })
    expect(readPreference(null)).toEqual({ chibiThumb: false })
    expect(readPreference({})).toEqual({ chibiThumb: false })
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
    expect(readPreference(enabled)).toEqual({ chibiThumb: true })
    expect(readPreference(enabled)).not.toBe(enabled)
    expect(readPreference({ chibiThumb: false })).toEqual({ chibiThumb: false })
  })

  it('declares one defaulted boolean in the durable settings schema', () => {
    expect(ReasoningEffortPreferenceSchema({})).toEqual({ chibiThumb: false })
    expect(ReasoningEffortPreferenceSchema({ chibiThumb: true })).toEqual({ chibiThumb: true })
    expect(() => ReasoningEffortPreferenceSchema({ chibiThumb: 'true' })).toThrow()
  })
})
