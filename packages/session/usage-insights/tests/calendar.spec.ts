import { describe, expect, it } from 'vitest'
import { createUsageDateFormatter } from '../src/calendar.ts'

describe('reusable usage calendar', () => {
  it('keeps local dates correct across midnight and daylight saving changes', () => {
    const date = createUsageDateFormatter('America/New_York')
    expect(date(Date.parse('2026-03-08T04:59:59Z'))).toBe('2026-03-07')
    expect(date(Date.parse('2026-03-08T05:00:00Z'))).toBe('2026-03-08')
    expect(date(Date.parse('2026-03-08T07:00:00Z'))).toBe('2026-03-08')
    expect(date(Date.parse('2026-11-01T06:00:00Z'))).toBe('2026-11-01')
    expect(date(Date.parse('2026-03-08T04:59:59Z'))).toBe('2026-03-07')
  })

  it('isolates time zones and rejects an invalid zone before any events', () => {
    const time = Date.parse('2026-09-06T18:00:00Z')
    expect(createUsageDateFormatter('Asia/Shanghai')(time)).toBe('2026-09-07')
    expect(createUsageDateFormatter('UTC')(time)).toBe('2026-09-06')
    expect(() => createUsageDateFormatter('invalid-zone')).toThrow(RangeError)
  })
})
