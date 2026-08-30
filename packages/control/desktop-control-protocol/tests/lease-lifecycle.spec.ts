import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  BRIDGE_REQUEST_KINDS,
  CONTROL_KINDS,
  CONTROL_LEASE_CAPABILITIES,
  CONTROL_LEASE_QUOTA_FIELDS,
  CONTROL_LEASE_SURFACE_KINDS,
  CONTROL_LEASE_TARGET_FIELDS,
  ControlLeaseId,
  decodeJsonFrame,
  encodeJsonFrame,
  HELPER_REQUEST_KINDS,
  PROTOCOL_LIMITS,
  PROTOCOL_MANIFEST,
  RequestId,
  SessionId,
  validateProtocolManifest,
  type BridgeRequest,
  type ControlLeaseAcquireRequest,
  type ControlLeaseAcquireResult,
  type ControlLeaseCapability,
  type ControlLeaseReleaseRequest,
  type ControlLeaseReleaseResult,
  type ControlLeaseSurfaceKind,
  type ControlLeaseTarget,
  type HelperLeaseInstallRequest,
} from '../src/index.ts'

const REQUEST_ID = RequestId('20000000-0000-4000-8000-000000000001')
const RELEASE_REQUEST_ID = RequestId('20000000-0000-4000-8000-000000000002')
const LEASE_ID = ControlLeaseId('20000000-0000-4000-8000-000000000003')
const SESSION_ID = SessionId('lease-lifecycle-session')

const TARGETS = Object.freeze([
  Object.freeze({ appId: 'com.example.editor', windowIds: Object.freeze(['window-1', 'window-2']) }),
  Object.freeze({ appId: 'com.example.browser', windowIds: Object.freeze(['window-3']) }),
]) satisfies readonly ControlLeaseTarget[]

const CAPABILITIES = Object.freeze([
  'observe', 'pointer', 'keyboard',
]) satisfies readonly ControlLeaseCapability[]

function acquire(overrides: object = {}): ControlLeaseAcquireRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'control.lease.acquire',
    requestId: REQUEST_ID,
    sessionId: SESSION_ID,
    deadlineUnixMs: 20_000,
    surfaceKind: 'native-application',
    targets: TARGETS,
    capabilities: CAPABILITIES,
    ...overrides,
  }
}

function release(overrides: object = {}): ControlLeaseReleaseRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'control.lease.release',
    requestId: RELEASE_REQUEST_ID,
    sessionId: SESSION_ID,
    deadlineUnixMs: 20_000,
    leaseId: LEASE_ID,
    leaseRevision: 4,
    ...overrides,
  }
}

function install(overrides: object = {}): HelperLeaseInstallRequest {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind: 'lease.install',
    requestId: REQUEST_ID,
    sessionId: SESSION_ID,
    timeoutMs: 1_000,
    leaseId: LEASE_ID,
    leaseRevision: 4,
    agentId: 'display-only-agent',
    targets: TARGETS,
    capabilities: CAPABILITIES,
    quotas: {
      operations: 100,
      snapshots: 20,
      pointerActions: 30,
      keyActions: 40,
      textBytes: 8_192,
    },
    idleExpiresAfterMs: 300_000,
    hardExpiresAfterMs: 1_200_000,
    ...overrides,
  }
}

describe('closed lease lifecycle roster and types', () => {
  it('adds exactly two internal bridge requests without changing helper or control rosters', () => {
    expect(BRIDGE_REQUEST_KINDS).toHaveLength(27)
    expect(BRIDGE_REQUEST_KINDS.slice(0, 2)).toEqual([
      'control.lease.acquire',
      'control.lease.release',
    ])
    expect(HELPER_REQUEST_KINDS).toHaveLength(14)
    expect(CONTROL_KINDS).toHaveLength(4)
    expect(PROTOCOL_MANIFEST.bridgeRequestKinds).toEqual(BRIDGE_REQUEST_KINDS)
    expect(PROTOCOL_MANIFEST.controlLeaseSurfaceKinds).toEqual(CONTROL_LEASE_SURFACE_KINDS)
    expect(PROTOCOL_MANIFEST.controlLeaseCapabilities).toEqual(CONTROL_LEASE_CAPABILITIES)
    expect(PROTOCOL_MANIFEST.controlLeaseTargetFields).toEqual(CONTROL_LEASE_TARGET_FIELDS)
    expect(PROTOCOL_MANIFEST.controlLeaseQuotaFields).toEqual(CONTROL_LEASE_QUOTA_FIELDS)
    expect(PROTOCOL_MANIFEST.controlKeyValues).toEqual([
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
      'Enter', 'Tab', 'Space', 'Backspace', 'Escape', 'Delete', 'Home', 'End',
      'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp',
      'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    ])
    expect(PROTOCOL_MANIFEST.bridgeRequestFields['control.lease.acquire']).toEqual([
      'surfaceKind', 'targets', 'capabilities',
    ])
    expect(PROTOCOL_MANIFEST.bridgeRequestFields['control.lease.release']).toEqual([
      'leaseId', 'leaseRevision',
    ])
    expect(PROTOCOL_MANIFEST.helperRequestFields['lease.install']).toEqual([
      'leaseId', 'leaseRevision', 'agentId', 'targets', 'capabilities', 'quotas',
      'idleExpiresAfterMs', 'hardExpiresAfterMs',
    ])
    expect(PROTOCOL_MANIFEST.resultFields['control.lease.acquire']).toEqual([
      'leaseId', 'leaseRevision', 'surfaceKind', 'targets', 'capabilities',
      'idleExpiresAfterMs', 'hardExpiresAfterMs',
    ])
    expect(PROTOCOL_MANIFEST.resultFields['control.lease.release']).toEqual(['released'])
  })

  it.each([
    ['surface roster', { controlLeaseSurfaceKinds: ['native-application'] }],
    ['capability roster', { controlLeaseCapabilities: ['observe'] }],
    ['target fields', { controlLeaseTargetFields: ['appId'] }],
    ['quota fields', { controlLeaseQuotaFields: ['snapshots'] }],
    ['key vocabulary', { controlKeyValues: ['Enter'] }],
  ])('rejects a divergent %s in the machine manifest', (_name, override) => {
    expect(() => { validateProtocolManifest({ ...PROTOCOL_MANIFEST, ...override }) }).toThrow(/mismatch/i)
  })

  it('keeps lease DTOs in the closed bridge union', () => {
    expectTypeOf<ControlLeaseAcquireRequest>().toExtend<BridgeRequest>()
    expectTypeOf<ControlLeaseReleaseRequest>().toExtend<BridgeRequest>()
    expectTypeOf<ControlLeaseSurfaceKind>().toEqualTypeOf<
      'browser-ephemeral' | 'browser-human-persistent' | 'native-application'
    >()
  })
})

describe('lease acquire and release codec', () => {
  it('rejects inherited or hidden serialization hooks before they can rewrite lease wire bytes', () => {
    const inheritedAcquire = Object.assign(Object.create({
      toJSON: () => release(),
    }) as object, acquire())
    const hiddenRelease = release()
    Object.defineProperty(hiddenRelease, 'toJSON', {
      value: () => acquire(),
      enumerable: false,
    })

    expect(() => encodeJsonFrame(inheritedAcquire)).toThrow(/plain|serializ|toJSON|prototype/i)
    expect(() => encodeJsonFrame(hiddenRelease)).toThrow(/plain|serializ|toJSON|enumerable/i)
  })

  it('rejects a helper lease install carried by a custom prototype even when JSON would look valid', () => {
    const customPrototypeInstall = Object.assign(
      Object.create({ inheritedAuthority: true }) as object,
      install(),
    )

    expect(() => encodeJsonFrame(customPrototypeInstall)).toThrow(/plain|serializ|prototype/i)
  })

  it('round-trips pair-preserving native targets as detached deeply frozen data', () => {
    const decoded = decodeJsonFrame(encodeJsonFrame(acquire()))
    expect(decoded).toEqual(acquire())
    if (decoded.messageKind !== 'request' || decoded.requestKind !== 'control.lease.acquire') {
      throw new Error('wrong decoded request')
    }
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded.targets)).toBe(true)
    expect(Object.isFrozen(decoded.targets[0])).toBe(true)
    expect(Object.isFrozen(decoded.targets[0]?.windowIds)).toBe(true)
    expect(Object.isFrozen(decoded.capabilities)).toBe(true)
  })

  it.each<readonly [ControlLeaseSurfaceKind, readonly ControlLeaseTarget[]]>([
    ['browser-ephemeral', []],
    ['browser-human-persistent', []],
    ['native-application', TARGETS],
  ])('accepts the valid %s target shape', (surfaceKind, targets) => {
    expect(() => encodeJsonFrame(acquire({ surfaceKind, targets }))).not.toThrow()
  })

  it('round-trips the exact acquire result without authority internals', () => {
    const result: ControlLeaseAcquireResult = {
      leaseId: LEASE_ID,
      leaseRevision: 4,
      surfaceKind: 'native-application',
      targets: TARGETS,
      capabilities: CAPABILITIES,
      idleExpiresAfterMs: 300_000,
      hardExpiresAfterMs: 1_200_000,
    }
    const response = {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: REQUEST_ID,
      requestKind: 'control.lease.acquire',
      result,
    } as const
    const decoded = decodeJsonFrame(encodeJsonFrame(response))
    expect(decoded).toEqual(response)
    if (decoded.messageKind !== 'response' || decoded.responseKind !== 'ok'
      || decoded.requestKind !== 'control.lease.acquire') throw new Error('wrong result')
    expect(Object.keys(decoded.result)).toEqual([
      'leaseId', 'leaseRevision', 'surfaceKind', 'targets', 'capabilities',
      'idleExpiresAfterMs', 'hardExpiresAfterMs',
    ])
    expect(decoded.result).not.toHaveProperty('approved')
    expect(decoded.result).not.toHaveProperty('quotas')
    expect(decoded.result).not.toHaveProperty('issuedAt')
    expect(Object.isFrozen(decoded.result.targets[0]?.windowIds)).toBe(true)
  })

  it('round-trips exact release request and result', () => {
    expect(decodeJsonFrame(encodeJsonFrame(release()))).toEqual(release())
    const result: ControlLeaseReleaseResult = { released: true }
    const response = {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: RELEASE_REQUEST_ID,
      requestKind: 'control.lease.release',
      result,
    } as const
    expect(decodeJsonFrame(encodeJsonFrame(response))).toEqual(response)
  })

  it.each([
    ['unknown surface', acquire({ surfaceKind: 'browser-hidden' }), /surfaceKind/i],
    ['browser targets', acquire({ surfaceKind: 'browser-ephemeral', targets: TARGETS }), /browser.*targets/i],
    ['native no targets', acquire({ targets: [] }), /native.*target/i],
    ['empty capabilities', acquire({ capabilities: [] }), /capabilit.*non-empty/i],
    ['duplicate capability', acquire({ capabilities: ['observe', 'observe'] }), /capabilit.*unique/i],
    ['unknown capability', acquire({ capabilities: ['admin'] }), /capability/i],
    ['duplicate app', acquire({ targets: [TARGETS[0], { appId: TARGETS[0]!.appId, windowIds: ['window-9'] }] }), /appId.*unique/i],
    ['empty app windows', acquire({ targets: [{ appId: 'app-1', windowIds: [] }] }), /windowIds.*non-empty/i],
    ['duplicate window', acquire({ targets: [{ appId: 'app-1', windowIds: ['window-1', 'window-1'] }] }), /windowId.*unique/i],
    ['cross-app duplicate window', acquire({ targets: [{ appId: 'app-1', windowIds: ['window-1'] }, { appId: 'app-2', windowIds: ['window-1'] }] }), /windowId.*unique/i],
    ['oversized app count', acquire({ targets: Array.from({ length: PROTOCOL_LIMITS.maxGrantableApps + 1 }, (_, index) => ({ appId: `app-${index}`, windowIds: [`window-${index}`] })) }), /targets.*bounded/i],
    ['oversized windows', acquire({ targets: [{ appId: 'app-1', windowIds: Array.from({ length: PROTOCOL_LIMITS.maxGrantableWindowsPerApp + 1 }, (_, index) => `window-${index}`) }] }), /windowIds.*bounded/i],
    ['oversized app id', acquire({ targets: [{ appId: 'a'.repeat(PROTOCOL_LIMITS.appIdBytes + 1), windowIds: ['window-1'] }] }), /appId/i],
    ['oversized window id', acquire({ targets: [{ appId: 'app-1', windowIds: ['w'.repeat(PROTOCOL_LIMITS.windowIdBytes + 1)] }] }), /windowId/i],
    ['boxed app id', acquire({ targets: [{ appId: new String('app-1'), windowIds: ['window-1'] }] }), /appId/i],
    ['unknown request field', acquire({ approved: true }), /unknown field approved/i],
  ])('rejects %s', (_name, value, message) => {
    expect(() => encodeJsonFrame(value)).toThrow(message)
  })

  it.each([
    ['approved', true],
    ['quotas', { operations: 1 }],
    ['issuedAt', 1],
    ['actionDigest', 'digest'],
  ])('rejects forbidden acquire result field %s', (field, fieldValue) => {
    expect(() => encodeJsonFrame({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: REQUEST_ID,
      requestKind: 'control.lease.acquire',
      result: {
        leaseId: LEASE_ID,
        leaseRevision: 1,
        surfaceKind: 'browser-ephemeral',
        targets: [],
        capabilities: ['observe'],
        idleExpiresAfterMs: 1,
        hardExpiresAfterMs: 1,
        [field]: fieldValue,
      },
    } as never)).toThrow(new RegExp(`unknown field ${field}`, 'i'))
  })
})

describe('helper lease snapshot', () => {
  it('reuses pair-preserving targets and includes the total operations quota', () => {
    const decoded = decodeJsonFrame(encodeJsonFrame(install()))
    expect(decoded).toEqual(install())
    if (decoded.messageKind !== 'request' || decoded.requestKind !== 'lease.install') {
      throw new Error('wrong helper request')
    }
    expect(Object.isFrozen(decoded.targets)).toBe(true)
    expect(Object.isFrozen(decoded.targets[0]?.windowIds)).toBe(true)
    expect(Object.isFrozen(decoded.quotas)).toBe(true)
    expect(decoded.quotas.operations).toBe(100)
  })

  it.each([
    ['legacy apps', install({ apps: ['app-1'] }), /unknown field apps/i],
    ['legacy windows', install({ windows: ['window-1'] }), /unknown field windows/i],
    ['missing operations', install({ quotas: { snapshots: 1, pointerActions: 1, keyActions: 1, textBytes: 1 } }), /missing field operations/i],
    ['negative operations', install({ quotas: { operations: -1, snapshots: 1, pointerActions: 1, keyActions: 1, textBytes: 1 } }), /operations/i],
    ['oversized operations', install({ quotas: { operations: PROTOCOL_LIMITS.maxLeaseQuota + 1, snapshots: 1, pointerActions: 1, keyActions: 1, textBytes: 1 } }), /operations/i],
    ['extra quota', install({ quotas: { operations: 1, snapshots: 1, pointerActions: 1, keyActions: 1, textBytes: 1, network: 1 } }), /unknown field network/i],
  ])('rejects %s', (_name, value, message) => {
    expect(() => encodeJsonFrame(value)).toThrow(message)
  })
})

describe('raw lease lifecycle fixtures', () => {
  it.each([
    ['lease-acquire-request.bin', acquire()],
    ['lease-release-request.bin', release()],
  ])('byte-exactly decodes and re-encodes %s', async (name, expected) => {
    const bytes = new Uint8Array(await readFile(resolve(import.meta.dirname, `../fixtures/${name}`)))
    expect(decodeJsonFrame(bytes)).toEqual(expected)
    expect(encodeJsonFrame(decodeJsonFrame(bytes))).toEqual(bytes)
  })

  it('publishes every generated runtime chunk referenced by the public entries', async () => {
    const packageJson = JSON.parse(await readFile(
      resolve(import.meta.dirname, '../package.json'),
      'utf8',
    )) as { readonly files?: readonly string[] }
    expect(packageJson.files).toEqual(expect.arrayContaining([
      'lib/index.js',
      'lib/invariant.js',
      'lib/manifest-*.js',
    ]))
  })
})
