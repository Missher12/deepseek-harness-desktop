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

  it('returns the loopback URL carrying the alpha.5 process launch token', () => {
    expect(readHarnessUrl('booting\ndsh web: http://127.0.0.1:54321/?token=AbCdEf-9_8\n'))
      .toBe('http://127.0.0.1:54321/?token=AbCdEf-9_8')
  })

  it('returns the loopback URL and ignores a LAN handoff suffix', () => {
    expect(readHarnessUrl([
      'dsh web: http://127.0.0.1:54321/?token=AbCdEf-9_8 (LAN: http://192.168.1.10:54321/?token=XyZ)',
      '',
    ].join('\n'))).toBe('http://127.0.0.1:54321/?token=AbCdEf-9_8')
  })

  it.each([
    'dsh web: http://0.0.0.0:54321',
    'dsh web: http://localhost:54321',
    'dsh web: https://127.0.0.1:54321',
    'dsh web: http://127.0.0.1:0',
    'dsh web: http://127.0.0.1:54321/path',
    'dsh web: not-a-url',
    'open http://127.0.0.1:54321',
    'dsh web: http://127.0.0.1:54321/?token=',
    'dsh web: http://127.0.0.1:54321/?token=a&token=b',
    'dsh web: http://127.0.0.1:54321/?token=ab&mode=1',
    'dsh web: http://127.0.0.1:54321/?token=a+b',
    'dsh web: http://127.0.0.1:54321/?token=ab#frag',
    'dsh web: http://192.168.1.10:54321/?token=ab (LAN: http://127.0.0.1:54321/?token=cd)',
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
