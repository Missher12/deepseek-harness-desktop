/** Platform bind errors that permit the Inspector's next-port selection. */

import { describe, expect, it } from 'vitest'
import { isUnavailableInspectorPort } from '../src/worker/bridge/endpoint.ts'

describe('Inspector unavailable port errors', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('advances past EADDRINUSE on %s', (platform) => {
    expect(isUnavailableInspectorPort(Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }), platform)).toBe(true)
  })

  it('advances past Windows exclusive or reserved TCP ports', () => {
    expect(isUnavailableInspectorPort(Object.assign(new Error('unavailable'), { code: 'EACCES' }), 'win32')).toBe(true)
  })

  it.each(['darwin', 'linux'] as const)('preserves permission errors on %s', (platform) => {
    expect(isUnavailableInspectorPort(Object.assign(new Error('denied'), { code: 'EACCES' }), platform)).toBe(false)
  })

  it.each([new Error('unknown'), Object.assign(new Error('invalid'), { code: 'EINVAL' }), { code: 'EADDRINUSE' }, null])(
    'preserves other bind failures: %j', (error) => {
      expect(isUnavailableInspectorPort(error, 'win32')).toBe(false)
    },
  )
})
