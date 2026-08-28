import { describe, expect, it } from 'vitest'
import {
  BrowserRef,
  ControlLeaseId,
  RequestId,
  SessionId,
  type BridgeRequest,
  type ControlLeaseAcquireRequest,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  CONTROL_LEASE_HARD_MS,
  CONTROL_LEASE_IDLE_MS,
  ControlAuthorityError,
  ControlLeaseAuthority,
  effectiveHelperTimeoutMs,
} from '../src/control/control-lease.ts'
import { adapterPolicyFacts } from '../src/control/policy.ts'
import { FakeMonotonicClock } from './control-testkit.ts'

const sessionA = SessionId('session-a')
const sessionB = SessionId('session-b')
const leaseUuid = '10000000-0000-4000-8000-000000000001'

class FailingTimerClock extends FakeMonotonicClock {
  failTimerRegistration = false

  override setTimeout(callback: () => void, delayMs: number): number {
    if (this.failTimerRegistration) throw new Error('timer registration failed')
    return super.setTimeout(callback, delayMs)
  }
}

function acquireRequest(
  sessionId = sessionA,
  surfaceKind: ControlLeaseAcquireRequest['surfaceKind'] = 'browser-ephemeral',
): ControlLeaseAcquireRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'control.lease.acquire',
    requestId: RequestId('20000000-0000-4000-8000-000000000001'),
    sessionId,
    deadlineUnixMs: 1,
    surfaceKind,
    targets: surfaceKind === 'native-application'
      ? [{ appId: 'app.one', windowIds: ['window-a', 'window-b'] }]
      : [],
    capabilities: ['observe', 'pointer', 'keyboard'],
  }
}

function acquireFacts(
  sessionId = sessionA,
  surfaceKind: ControlLeaseAcquireRequest['surfaceKind'] = 'browser-ephemeral',
) {
  return {
    officialSessionId: sessionId,
    surfaceKind,
    targets: surfaceKind === 'native-application'
      ? [{ appId: 'app.one', windowIds: ['window-a', 'window-b'] }]
      : [],
    capabilities: ['observe', 'pointer', 'keyboard'] as const,
    policyAllowed: true,
  }
}

function requestBase<K extends BridgeRequest['requestKind']>(requestKind: K, sessionId = sessionA) {
  return {
    protocolVersion: 1 as const,
    messageKind: 'request' as const,
    requestKind,
    requestId: RequestId('30000000-0000-4000-8000-000000000001'),
    sessionId,
    deadlineUnixMs: 1,
  }
}

function browserSnapshot(sessionId = sessionA) {
  return {
    ...requestBase('browser.snapshot', sessionId),
    leaseId: ControlLeaseId(leaseUuid),
    leaseRevision: 1,
    includeImage: false,
  } as const
}

function browserClick(sessionId = sessionA) {
  return {
    ...requestBase('browser.click', sessionId),
    leaseId: ControlLeaseId(leaseUuid),
    leaseRevision: 1,
    ref: BrowserRef('browser:00000000000000000000000000000001'),
  } as const
}

function operationFacts(
  sessionId = sessionA,
  effect: 'read-only' | 'local-interaction' = 'local-interaction',
) {
  return {
    officialSessionId: sessionId,
    surfaceKind: 'browser-ephemeral' as const,
    targets: [],
    capabilities: ['observe', 'pointer', 'keyboard'] as const,
    policy: adapterPolicyFacts('ordinary', effect),
    nativeGrantValidated: false,
  }
}

function authority(clock = new FakeMonotonicClock(), options: { initialRevision?: number } = {}) {
  return new ControlLeaseAuthority({
    clock,
    mintLeaseId: () => leaseUuid,
    ...options,
  })
}

describe('ControlLeaseAuthority', () => {
  it('derives a positive bounded helper timeout without lengthening either deadline', () => {
    expect(effectiveHelperTimeoutMs(30_001, 60_000)).toBe(30_000)
    expect(effectiveHelperTimeoutMs(12_345, 60_000)).toBe(12_345)
    expect(effectiveHelperTimeoutMs(12_345, 1)).toBe(1)
    expect(() => effectiveHelperTimeoutMs(0, 10)).toThrow(
      expect.objectContaining({ code: 'TIMEOUT' }),
    )
  })

  it('expires at the exact idle boundary using only monotonic time', () => {
    const clock = new FakeMonotonicClock()
    let wallClock = 1_000
    const leases = authority(clock)
    leases.acquire(acquireRequest(), acquireFacts(), 'Agent')
    wallClock = -99_000
    clock.advanceTo(CONTROL_LEASE_IDLE_MS - 1)
    expect(leases.activeSnapshot()).not.toBeNull()
    wallClock = Number.MAX_SAFE_INTEGER
    clock.advanceTo(CONTROL_LEASE_IDLE_MS)
    expect(leases.activeSnapshot()).toBeNull()
    expect(wallClock).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('never extends the exact hard boundary when accepted work refreshes idle', () => {
    const clock = new FakeMonotonicClock()
    const leases = authority(clock)
    leases.acquire(acquireRequest(), acquireFacts(), 'Agent')
    for (const time of [299_999, 599_998, 899_997, 1_199_996, CONTROL_LEASE_HARD_MS - 1]) {
      clock.advanceTo(time)
      leases.prepareDispatch(browserSnapshot(), operationFacts(sessionA, 'read-only'))
    }
    expect(leases.activeSnapshot()).not.toBeNull()
    clock.advanceTo(CONTROL_LEASE_HARD_MS)
    expect(leases.activeSnapshot()).toBeNull()
  })

  it('does not refresh idle for status, list, or a rejected request', () => {
    const clock = new FakeMonotonicClock()
    const leases = authority(clock)
    leases.acquire(acquireRequest(), acquireFacts(), 'Agent')
    clock.advanceTo(CONTROL_LEASE_IDLE_MS - 1)
    leases.prepareDispatch({ ...requestBase('computer.list') }, {
      ...operationFacts(),
      surfaceKind: 'native-application',
      policy: adapterPolicyFacts('not-applicable', 'read-only'),
    })
    expect(() => {
      leases.prepareDispatch(browserClick(), {
        ...operationFacts(), policy: adapterPolicyFacts('unknown', 'unknown'),
      })
    }).toThrow(ControlAuthorityError)
    clock.advanceTo(CONTROL_LEASE_IDLE_MS)
    expect(leases.activeSnapshot()).toBeNull()
  })

  it('mints one UUID lease, freezes pair-preserving targets, and rejects a second active lease', () => {
    const clock = new FakeMonotonicClock()
    const leases = authority(clock)
    const request = acquireRequest(sessionA, 'native-application')
    const facts = acquireFacts(sessionA, 'native-application')
    const result = leases.acquire(request, facts, 'Agent')
    expect(result.leaseId).toBe(leaseUuid)
    expect(result.targets).toEqual([{ appId: 'app.one', windowIds: ['window-a', 'window-b'] }])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.targets)).toBe(true)
    expect(Object.isFrozen(result.targets[0]?.windowIds)).toBe(true)
    expect(() => (facts.targets[0]?.windowIds as string[]).push('window-c')).not.toThrow()
    expect(result.targets[0]?.windowIds).toEqual(['window-a', 'window-b'])
    expect(() => leases.acquire(acquireRequest(sessionB), acquireFacts(sessionB), 'Other'))
      .toThrow(expect.objectContaining({ code: 'BUSY' }))
  })

  it('narrows desired targets and capabilities to current Electron facts', () => {
    const leases = authority()
    const result = leases.acquire(acquireRequest(sessionA, 'native-application'), {
      ...acquireFacts(sessionA, 'native-application'),
      targets: [{ appId: 'app.one', windowIds: ['window-a'] }],
      capabilities: ['observe', 'pointer'],
    }, 'display only')
    expect(result.targets).toEqual([{ appId: 'app.one', windowIds: ['window-a'] }])
    expect(result.capabilities).toEqual(['observe', 'pointer'])
  })

  it('fails closed when the safe lease revision would overflow', () => {
    const clock = new FakeMonotonicClock()
    const leases = authority(clock, { initialRevision: Number.MAX_SAFE_INTEGER })
    const first = leases.acquire(acquireRequest(), acquireFacts(), 'Agent')
    expect(first.leaseRevision).toBe(Number.MAX_SAFE_INTEGER)
    leases.revoke('test')
    expect(() => leases.acquire(acquireRequest(), acquireFacts(), 'Agent'))
      .toThrow(expect.objectContaining({ code: 'INTERNAL' }))
    expect(leases.activeSnapshot()).toBeNull()
  })

  it('ignores a cancelled timer captured by an older lease generation', () => {
    const clock = new FakeMonotonicClock()
    const replacementId = '10000000-0000-4000-8000-000000000002'
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      replacementId,
    ]
    const leases = new ControlLeaseAuthority({ clock, mintLeaseId: () => ids.shift()! })
    leases.acquire(acquireRequest(), acquireFacts(), 'Agent')
    clock.advanceTo(1)
    leases.revoke('replacement')
    leases.acquire(acquireRequest(), acquireFacts(), 'Agent')
    clock.advanceTo(CONTROL_LEASE_IDLE_MS)
    clock.flush({ includeCancelled: true })
    expect(leases.activeSnapshot()?.leaseId).toBe(replacementId)
    clock.advanceTo(CONTROL_LEASE_IDLE_MS + 1)
    expect(leases.activeSnapshot()).toBeNull()
  })

  it('fails the lease closed when its monotonic expiry timer cannot be armed or rearmed', () => {
    const acquireClock = new FailingTimerClock()
    acquireClock.failTimerRegistration = true
    const acquireAuthority = authority(acquireClock)
    expect(() => acquireAuthority.acquire(acquireRequest(), acquireFacts(), 'Agent'))
      .toThrow(expect.objectContaining({ code: 'INTERNAL' }))
    expect(acquireAuthority.activeSnapshot()).toBeNull()

    const dispatchClock = new FailingTimerClock()
    const dispatchAuthority = authority(dispatchClock)
    dispatchAuthority.acquire(acquireRequest(), acquireFacts(), 'Agent')
    dispatchClock.failTimerRegistration = true
    expect(() => {
      dispatchAuthority.prepareDispatch(
        browserSnapshot(), operationFacts(sessionA, 'read-only'),
      )
    }).toThrow(expect.objectContaining({ code: 'INTERNAL' }))
    expect(dispatchAuthority.activeSnapshot()).toBeNull()
  })

  it('returns UNAUTHORIZED for every foreign-session probe before lease, revision, target, policy, or quota checks', () => {
    const leases = authority()
    leases.acquire(acquireRequest(), acquireFacts(), 'Agent')
    const probes = [
      { ...browserSnapshot(sessionB), leaseId: ControlLeaseId('10000000-0000-4000-8000-000000000099') },
      { ...browserSnapshot(sessionB), leaseRevision: 999 },
      browserClick(sessionB),
    ]
    for (const request of probes) {
      expect(() => {
        leases.prepareDispatch(request, {
          ...operationFacts(sessionB),
          policy: adapterPolicyFacts('unknown', 'unknown'),
        })
      }).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }))
    }
  })

  it('charges total and category quotas synchronously before dispatch and never refunds a failed dispatch', async () => {
    const clock = new FakeMonotonicClock()
    const leases = new ControlLeaseAuthority({
      clock,
      mintLeaseId: () => leaseUuid,
      quotas: { operations: 2, snapshots: 1, pointerActions: 1, keyActions: 0, textBytes: 0 },
    })
    leases.acquire(acquireRequest(), acquireFacts(), 'Agent')
    const dispatch = async (request: ReturnType<typeof browserSnapshot> | ReturnType<typeof browserClick>) => {
      leases.prepareDispatch(request, request.requestKind === 'browser.snapshot'
        ? operationFacts(sessionA, 'read-only')
        : operationFacts())
      throw new Error('downstream failed')
    }
    const outcomes = await Promise.allSettled([dispatch(browserSnapshot()), dispatch(browserSnapshot())])
    expect(outcomes.map(outcome => outcome.status)).toEqual(['rejected', 'rejected'])
    if (outcomes[0]?.status !== 'rejected') throw new Error('first dispatch unexpectedly succeeded')
    expect(outcomes[0].reason).toMatchObject({ message: 'downstream failed' })
    expect((outcomes[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'QUOTA_EXCEEDED' })
    await expect(dispatch(browserClick())).rejects.toThrow('downstream failed')
    expect(leases.activeSnapshot()?.remaining).toEqual({
      operations: 0, snapshots: 0, pointerActions: 0, keyActions: 0, textBytes: 0,
    })
  })
})
