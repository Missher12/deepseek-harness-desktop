import { describe, expect, it, vi } from 'vitest'
import { createDesktopProfileBootTiming } from '../src/profile-boot.ts'

describe('Desktop profile boot timing', () => {
  it('is disabled for normal CLI launches and every value except the explicit Desktop switch', () => {
    const write = vi.fn<(line: string) => void>()

    expect(createDesktopProfileBootTiming(undefined, write)).toBeUndefined()
    expect(createDesktopProfileBootTiming('0', write)).toBeUndefined()
    expect(createDesktopProfileBootTiming('true', write)).toBeUndefined()
    expect(write).not.toHaveBeenCalled()
  })

  it('prints only fixed phase names and non-negative finite elapsed milliseconds', () => {
    const write = vi.fn<(line: string) => void>()
    const values = [100, 112.4, 127.8, 143.1, 150.9]
    const timing = createDesktopProfileBootTiming('1', write, () => values.shift() ?? 0)
    expect(timing).toBeDefined()

    timing?.mark('profile-compose')
    timing?.mark('loader-mount')
    timing?.mark('loader-settle')
    timing?.mark('activation-audit')

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      'dsh desktop-startup profile-compose: 12ms\n',
      'dsh desktop-startup loader-mount: 28ms\n',
      'dsh desktop-startup loader-settle: 43ms\n',
      'dsh desktop-startup activation-audit: 51ms\n',
    ])
  })
})
