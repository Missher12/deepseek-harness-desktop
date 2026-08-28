import {
  BrowserRef,
  ControlLeaseId,
  RequestId,
  SessionId,
  type BrowserClickRequest,
  type BrowserScrollRequest,
  type BrowserTypeRequest,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import { describe, expect, it } from 'vitest'
import {
  ACTION_GRANT_LIFETIME_MS,
  ActionGrantAuthority,
  type ActionGrant,
  type BrowserActionGrantScope,
} from '../src/control/action-grant.ts'
import * as actionGrantModule from '../src/control/action-grant.ts'
import type {
  NativeApprovalCoordinator,
  NativeApprovalResult,
  NativeApprovalScope,
  NativeApprovalTicket,
} from '../src/control/native-approval.ts'

class FakeClock {
  value = 0

  now(): number {
    return this.value
  }
}

const SESSION_A = SessionId('session-a')
const SESSION_B = SessionId('session-b')
const LEASE = ControlLeaseId('10000000-0000-4000-8000-000000000001')
const REF_A = BrowserRef('browser:00000000000000000000000000000001')
const REF_B = BrowserRef('browser:00000000000000000000000000000002')

function click(overrides: Partial<BrowserClickRequest> = {}): BrowserClickRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'browser.click',
    requestId: RequestId('20000000-0000-4000-8000-000000000001'),
    sessionId: SESSION_A,
    deadlineUnixMs: 1_000_000,
    leaseId: LEASE,
    leaseRevision: 7,
    ref: REF_A,
    ...overrides,
  }
}

function type(overrides: Partial<BrowserTypeRequest> = {}): BrowserTypeRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'browser.type',
    requestId: RequestId('20000000-0000-4000-8000-000000000002'),
    sessionId: SESSION_A,
    deadlineUnixMs: 1_000_000,
    leaseId: LEASE,
    leaseRevision: 7,
    ref: REF_A,
    text: 'hello',
    ...overrides,
  }
}

function scroll(overrides: Partial<BrowserScrollRequest> = {}): BrowserScrollRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'browser.scroll',
    requestId: RequestId('20000000-0000-4000-8000-000000000004'),
    sessionId: SESSION_A,
    deadlineUnixMs: 1_000_000,
    leaseId: LEASE,
    leaseRevision: 7,
    deltaX: 0.5,
    deltaY: -0.25,
    ...overrides,
  }
}

function scope(
  request: BrowserActionGrantScope['request'] = click(),
  overrides: Partial<Omit<BrowserActionGrantScope, 'request'>> = {},
): BrowserActionGrantScope {
  return {
    request,
    surfaceId: 'surface-a',
    navigationRevision: 11,
    ...overrides,
  }
}

class FakeApprovalTickets {
  readonly tickets = new Set<NativeApprovalTicket>()

  issue(): NativeApprovalTicket {
    const ticket = Object.freeze({}) as NativeApprovalTicket
    this.tickets.add(ticket)
    return ticket
  }

  consumeBeforeDispatch(
    ticket: NativeApprovalResult,
    _scope: NativeApprovalScope,
    revalidate: () => boolean,
  ): boolean {
    if (typeof ticket === 'string' || !this.tickets.delete(ticket)) return false
    return revalidate()
  }
}

const approvalAuthorities = new WeakMap<ActionGrantAuthority, FakeApprovalTickets>()

function actionGrants(clock: FakeClock): ActionGrantAuthority {
  const approvals = new FakeApprovalTickets()
  const grants = new ActionGrantAuthority(
    clock,
    approvals as unknown as NativeApprovalCoordinator,
  )
  approvalAuthorities.set(grants, approvals)
  return grants
}

function approvalScopeFor(
  grants: ActionGrantAuthority,
  input: BrowserActionGrantScope,
): NativeApprovalScope {
  return grants.approvalScope(input, {
    sessionId: input.request.sessionId,
    leaseId: input.request.leaseId,
    leaseRevision: input.request.leaseRevision,
    surfaceKind: 'browser-human-persistent',
    targets: [],
    capabilities: ['observe', 'pointer', 'keyboard'],
    allowlistRevision: 3,
  })
}

function approvedIssue(
  grants: ActionGrantAuthority,
  input: BrowserActionGrantScope,
): ActionGrant {
  const approvals = approvalAuthorities.get(grants)
  if (approvals === undefined) throw new Error('missing fake approval authority')
  return grants.issueFromApproval(
    input,
    approvalScopeFor(grants, input),
    approvals.issue(),
    () => true,
  )
}

describe('persistent browser action grants', () => {
  it('does not expose a recomputable digest as an authorization API', () => {
    expect(actionGrantModule).not.toHaveProperty('actionDigest')
  })

  it('will not mint a grant without the exact digest returned from the native challenge flow', () => {
    const grants = actionGrants(new FakeClock())
    const approvals = approvalAuthorities.get(grants)!
    expect(() => grants.issueFromApproval(
      scope(), approvalScopeFor(grants, scope()), {} as NativeApprovalTicket, () => true,
    )).toThrow(/ticket/i)
    expect(() => grants.issueFromApproval(
      scope(), approvalScopeFor(grants, scope(click({ ref: REF_B }))), approvals.issue(), () => true,
    )).toThrow(/exact action/i)
  })

  it('is valid before 30 seconds and expires at the exact monotonic boundary', () => {
    const clock = new FakeClock()
    const grants = actionGrants(clock)
    const beforeBoundary = approvedIssue(grants, scope())
    clock.value = ACTION_GRANT_LIFETIME_MS - 1
    expect(grants.consumeBeforeDispatch(beforeBoundary, scope(), () => true)).toBe(true)

    const atBoundary = approvedIssue(grants, scope())
    clock.value += ACTION_GRANT_LIFETIME_MS
    expect(grants.consumeBeforeDispatch(atBoundary, scope(), () => true)).toBe(false)
  })

  it('deletes before revalidation and cannot be replayed or consumed twice', () => {
    const grants = actionGrants(new FakeClock())
    const grant = approvedIssue(grants, scope())
    let observedPending = -1

    expect(grants.consumeBeforeDispatch(grant, scope(), () => {
      observedPending = grants.size
      return true
    })).toBe(true)
    expect(observedPending).toBe(0)
    expect(grants.consumeBeforeDispatch(grant, scope(), () => true)).toBe(false)
  })

  it('burns the one-shot grant before rejecting a changed action or failed current-state check', () => {
    const grants = actionGrants(new FakeClock())
    const changedAction = approvedIssue(grants, scope())
    expect(grants.consumeBeforeDispatch(changedAction, scope(click({ ref: REF_B })), () => true)).toBe(false)
    expect(grants.consumeBeforeDispatch(changedAction, scope(), () => true)).toBe(false)

    const staleState = approvedIssue(grants, scope())
    expect(grants.consumeBeforeDispatch(staleState, scope(), () => false)).toBe(false)
    expect(grants.consumeBeforeDispatch(staleState, scope(), () => true)).toBe(false)
  })

  it('uses canonical length-delimited hashing instead of ambiguous concatenation', () => {
    const grants = actionGrants(new FakeClock())
    const original = scope(type({ text: 'bc' }), { surfaceId: 'a' })
    const ambiguousIfConcatenated = scope(type({ text: 'c' }), { surfaceId: 'ab' })
    const grant = approvedIssue(grants, original)

    expect(grants.consumeBeforeDispatch(grant, ambiguousIfConcatenated, () => true)).toBe(false)
  })

  it('canonicalizes every finite protocol-valid scroll delta without integer coercion', () => {
    const grants = actionGrants(new FakeClock())
    const input = scope(scroll())
    const grant = approvedIssue(grants, input)
    expect(grants.consumeBeforeDispatch(grant, input, () => true)).toBe(true)
  })

  it('keeps the grant opaque and rejects forged or boundary-supplied authority', () => {
    const grants = actionGrants(new FakeClock())
    const grant = approvedIssue(grants, scope())
    expect(Reflect.ownKeys(grant)).toEqual([])
    expect(JSON.stringify(grant)).toBe('{}')
    expect(grants.consumeBeforeDispatch({} as ActionGrant, scope(), () => true)).toBe(false)

    const injected = { ...click(), actionDigest: 'forged', approved: true }
    expect(() => approvedIssue(grants, scope(injected as BrowserClickRequest))).toThrow(TypeError)
    expect(grants.size).toBe(1)
  })

  it('clears exact navigation and reference grants without widening to unrelated scopes', () => {
    const grants = actionGrants(new FakeClock())
    const oldNavigation = approvedIssue(grants, scope(click(), { surfaceId: 'surface-old' }))
    const currentNavigation = approvedIssue(grants, scope(click({ ref: REF_B })))

    expect(grants.clearNavigation(SESSION_A, 'surface-old')).toBe(1)
    expect(grants.consumeBeforeDispatch(oldNavigation, scope(click(), { surfaceId: 'surface-old' }), () => true)).toBe(false)
    expect(grants.clearReference(SESSION_A, REF_A)).toBe(0)
    expect(grants.clearReference(SESSION_A, REF_B)).toBe(1)
    expect(grants.consumeBeforeDispatch(currentNavigation, scope(click({ ref: REF_B })), () => true)).toBe(false)
  })

  it('clears exact session and lease revisions on revocation', () => {
    const grants = actionGrants(new FakeClock())
    const sessionARevision7 = approvedIssue(grants, scope())
    const sessionARevision8 = approvedIssue(grants, scope(click({ leaseRevision: 8 })))
    const sessionB = approvedIssue(grants, scope(click({
      sessionId: SESSION_B,
      requestId: RequestId('20000000-0000-4000-8000-000000000003'),
    })))

    expect(grants.revokeLease(SESSION_A, LEASE, 7)).toBe(1)
    expect(grants.consumeBeforeDispatch(sessionARevision7, scope(), () => true)).toBe(false)
    expect(grants.consumeBeforeDispatch(
      sessionARevision8,
      scope(click({ leaseRevision: 8 })),
      () => true,
    )).toBe(true)
    expect(grants.clearSession(SESSION_B)).toBe(1)
    expect(grants.consumeBeforeDispatch(sessionB, scope(click({
      sessionId: SESSION_B,
      requestId: RequestId('20000000-0000-4000-8000-000000000003'),
    })), () => true)).toBe(false)
  })

  it('snapshots cleanup identity so later caller mutation cannot evade revocation', () => {
    const grants = actionGrants(new FakeClock())
    const mutableRequest = click()
    const grant = approvedIssue(grants, scope(mutableRequest))
    Object.assign(mutableRequest as unknown as Record<string, unknown>, {
      sessionId: SESSION_B,
      leaseRevision: 99,
      ref: REF_B,
    })

    expect(grants.revokeLease(SESSION_A, LEASE, 7)).toBe(1)
    expect(grants.consumeBeforeDispatch(grant, scope(click()), () => true)).toBe(false)
  })
})
