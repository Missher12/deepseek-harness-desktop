import { describe, expect, it } from 'vitest'
import {
  BrowserRef,
  ControlLeaseId,
  RequestId,
  SessionId,
  type BridgeRequest,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  adapterPolicyFacts,
  classifyAuthorityRequest,
  controlRequestRule,
} from '../src/control/policy.ts'

const sessionId = SessionId('session-policy')
const leaseId = ControlLeaseId('10000000-0000-4000-8000-000000000001')

function base<K extends BridgeRequest['requestKind']>(requestKind: K) {
  return {
    protocolVersion: 1 as const,
    messageKind: 'request' as const,
    requestKind,
    requestId: RequestId('20000000-0000-4000-8000-000000000001'),
    sessionId,
    deadlineUnixMs: 1,
  }
}

describe('Electron control policy mapping', () => {
  it('maps request kinds to the exact capability and quota category', () => {
    const snapshot = {
      ...base('browser.snapshot'), leaseId, leaseRevision: 1, includeImage: false,
    } as const
    const click = {
      ...base('browser.click'), leaseId, leaseRevision: 1,
      ref: BrowserRef('browser:00000000000000000000000000000001'),
    } as const
    const type = {
      ...base('browser.type'), leaseId, leaseRevision: 1,
      ref: BrowserRef('browser:00000000000000000000000000000001'), text: 'é',
    } as const
    expect(controlRequestRule(snapshot)).toEqual({ leaseScoped: true, capability: 'observe', quota: 'snapshots', amount: 1 })
    expect(controlRequestRule(click)).toEqual({ leaseScoped: true, capability: 'pointer', quota: 'pointerActions', amount: 1 })
    expect(controlRequestRule(type)).toEqual({ leaseScoped: true, capability: 'keyboard', quota: 'textBytes', amount: 2 })
    expect(controlRequestRule({ ...base('computer.list') })).toEqual({ leaseScoped: false })
  })

  it('reuses the shared classifier and accepts sensitivity/effect only as adapter facts', () => {
    const request = {
      ...base('browser.click'), leaseId, leaseRevision: 1,
      ref: BrowserRef('browser:00000000000000000000000000000001'),
    } as const
    expect(classifyAuthorityRequest(
      request,
      'browser-ephemeral',
      adapterPolicyFacts('ordinary', 'local-interaction'),
    )).toBe('ALLOW')
    expect(classifyAuthorityRequest(
      request,
      'browser-ephemeral',
      adapterPolicyFacts('unknown', 'local-interaction'),
    )).toBe('DENY')
    const withExtraArgument = adapterPolicyFacts as unknown as (
      sensitivity: string,
      effect: string,
      extra: unknown,
    ) => unknown
    expect(() => withExtraArgument(
      'ordinary', 'local-interaction', { sensitivity: 'ordinary' },
    )).toThrow()
  })
})
