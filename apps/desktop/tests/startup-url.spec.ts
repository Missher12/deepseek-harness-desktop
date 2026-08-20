import { describe, expect, it } from 'vitest'
import { readHarnessUrl } from '../src/harness/startup-url.ts'

describe('readHarnessUrl', () => {
  it('returns the exact loopback URL printed by dsh', () => {
    expect(readHarnessUrl('booting\ndsh web: http://127.0.0.1:54321\n'))
      .toBe('http://127.0.0.1:54321/')
  })

  it('ignores non-URL dsh status lines printed after the startup URL', () => {
    expect(readHarnessUrl([
      'dsh web: http://127.0.0.1:54321',
      'dsh web: opening the default browser; pass --no-open to disable',
      '',
    ].join('\n'))).toBe('http://127.0.0.1:54321/')
  })

  it.each([
    'dsh web: http://0.0.0.0:54321',
    'dsh web: http://localhost:54321',
    'dsh web: https://127.0.0.1:54321',
    'dsh web: http://127.0.0.1:0',
    'dsh web: http://127.0.0.1:54321/path',
    'dsh web: not-a-url',
    'open http://127.0.0.1:54321',
  ])('rejects %s', (line) => {
    expect(() => readHarnessUrl(line)).toThrow(/valid loopback startup URL/)
  })

  it('rejects ambiguous startup output', () => {
    expect(() => readHarnessUrl([
      'dsh web: http://127.0.0.1:54321',
      'dsh web: http://127.0.0.1:54322',
    ].join('\n'))).toThrow(/valid loopback startup URL/)
  })
})
