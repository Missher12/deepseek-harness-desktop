import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  BrowserRef,
  ComputerRef,
  ControlLeaseId,
  decodeJsonFrame,
  decodePngFrame,
  DesktopControlFrameDecoder,
  encodeJsonFrame,
  encodePngFrame,
  LengthPrefixedFrameDecoder,
  PngTransferId,
  PROTOCOL_MANIFEST,
  RequestId,
  validateProtocolManifest,
  type BridgeRequestKind,
  type HelperRequestKind,
} from '../src/index.ts'

const requestId = RequestId('10000000-0000-4000-8000-000000000001')
const leaseId = ControlLeaseId('10000000-0000-4000-8000-000000000002')
const transferId = PngTransferId('10000000-0000-4000-8000-000000000003')
const sessionId = 'matrix-session' as SessionId
const browserRef = BrowserRef('browser:10000000000000000000000000000004')
const computerRef = ComputerRef('computer:10000000000000000000000000000005')

function bridge(requestKind: BridgeRequestKind, extra = {}): never {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind,
    requestId,
    sessionId,
    deadlineUnixMs: 10_000,
    ...extra,
  } as never
}

function helper(requestKind: HelperRequestKind, extra = {}): never {
  return {
    protocolVersion: 1,
    messageKind: 'request',
    requestKind,
    requestId,
    sessionId,
    timeoutMs: 1_000,
    ...extra,
  } as never
}

function roundTrip(value: never): void {
  expect(decodeJsonFrame(encodeJsonFrame(value))).toEqual(value)
}

const lease = { leaseId, leaseRevision: 1 }
const target = { ...lease, appId: 'app-1', windowId: 'window-1', snapshotRevision: 1 }

describe('closed request field matrices', () => {
  it('round-trips every bridge request kind', () => {
    const values = [
      bridge('desktop.status'),
      bridge('browser.snapshot', { ...lease, includeImage: false }),
      bridge('browser.navigate', { ...lease, url: 'https://example.test/' }),
      bridge('browser.click', { ...lease, ref: browserRef }),
      bridge('browser.type', { ...lease, ref: browserRef, text: '' }),
      bridge('browser.key', { ...lease, key: 'Enter', modifiers: ['Control', 'Shift'] }),
      bridge('browser.select', { ...lease, ref: browserRef, value: '' }),
      bridge('browser.scroll', { ...lease, ref: browserRef, deltaX: 0, deltaY: -1 }),
      bridge('browser.wait', { ...lease, mode: 'duration', durationMs: 10 }),
      bridge('browser.wait', { ...lease, mode: 'navigation' }),
      bridge('browser.wait', { ...lease, mode: 'loading-idle' }),
      bridge('browser.back', lease), bridge('browser.forward', lease), bridge('browser.reload', lease),
      bridge('browser.stop'), bridge('computer.status'), bridge('computer.list'),
      bridge('computer.snapshot', { ...target, includeImage: false }),
      bridge('computer.focus', target),
      bridge('computer.click', { ...target, ref: computerRef, button: 'left' }),
      bridge('computer.double-click', { ...target, x: 1, y: 2, button: 'right' }),
      bridge('computer.drag', { ...target, fromX: 1, fromY: 2, toX: 3, toY: 4, button: 'middle' }),
      bridge('computer.type', { ...target, ref: computerRef, text: 'hello' }),
      bridge('computer.key', { ...target, key: 'A', modifiers: [] }),
      bridge('computer.scroll', { ...target, x: 1, y: 2, deltaX: -1, deltaY: 1 }),
      bridge('computer.wait', { ...target, durationMs: 10 }),
      bridge('computer.stop'),
    ]
    for (const value of values) roundTrip(value)
  })

  it('round-trips every helper request kind', () => {
    const values = [
      helper('status'), helper('list'),
      helper('snapshot', { ...target, includeImage: false }), helper('focus', target),
      helper('click', { ...target, ref: computerRef, button: 'left' }),
      helper('double-click', { ...target, x: 1, y: 2, button: 'right' }),
      helper('drag', { ...target, fromX: 1, fromY: 2, toX: 3, toY: 4, button: 'left' }),
      helper('type', { ...target, ref: computerRef, text: '' }),
      helper('key', { ...target, key: 'Enter', modifiers: ['Alt'] }),
      helper('scroll', { ...target, ref: computerRef, deltaX: 1, deltaY: -1 }),
      helper('wait', { ...target, durationMs: 10 }), helper('stop', lease),
      helper('lease.install', {
        ...lease,
        agentId: 'agent-1',
        apps: ['app-1'],
        windows: ['window-1'],
        capabilities: ['observe', 'pointer', 'keyboard'],
        quotas: { snapshots: 1, pointerActions: 2, keyActions: 3, textBytes: 4 },
        idleExpiresAfterMs: 1,
        hardExpiresAfterMs: 1,
      }),
      helper('input.release', { keys: [], buttons: [] }),
    ]
    for (const value of values) roundTrip(value)
  })

  it('round-trips every control kind', () => {
    const values = [
      { protocolVersion: 1, messageKind: 'control', controlKind: 'request.cancel', sessionId, requestId },
      { protocolVersion: 1, messageKind: 'control', controlKind: 'session.revoke', sessionId },
      { protocolVersion: 1, messageKind: 'control', controlKind: 'lease.revoke', sessionId, leaseId, leaseRevision: 1 },
      { protocolVersion: 1, messageKind: 'control', controlKind: 'parent.shutdown' },
    ]
    for (const value of values) roundTrip(value as never)
  })
})

describe('closed response result matrices', () => {
  const action = { acted: true, snapshotRevision: 1 }
  const waited = { waited: true, snapshotRevision: 1 }
  const stopped = { stopped: true }
  const status = { viewing: 'granted', assistive: 'denied', supported: true }
  const list = { apps: [{ appId: 'app-1', name: 'Example', windows: [{ windowId: 'window-1', title: '' }] }] }
  const browserSnapshot = { surfaceId: 'surface-1', url: 'https://example.test/', title: '', snapshotRevision: 1, semanticText: '', refs: [{ ref: browserRef, role: 'button', name: '' }] }
  const computerSnapshot = { appId: 'app-1', windowId: 'window-1', snapshotRevision: 1, semanticText: '', refs: [{ ref: computerRef, role: 'button', name: '' }] }

  it('round-trips every successful result kind', () => {
    const results = new Map<string, object>([
      ['desktop.status', { browserSupported: true, computerSupported: false }],
      ['browser.snapshot', browserSnapshot],
      ['browser.navigate', { url: 'https://example.test/', snapshotRevision: 1 }],
      ['browser.click', action], ['browser.type', action], ['browser.key', action], ['browser.select', action], ['browser.scroll', action],
      ['browser.wait', waited],
      ['browser.back', { url: 'https://example.test/', snapshotRevision: 1 }],
      ['browser.forward', { url: 'https://example.test/', snapshotRevision: 1 }],
      ['browser.reload', { url: 'https://example.test/', snapshotRevision: 1 }],
      ['browser.stop', stopped], ['computer.status', status], ['computer.list', list], ['computer.snapshot', computerSnapshot],
      ['computer.focus', action], ['computer.click', action], ['computer.double-click', action], ['computer.drag', action], ['computer.type', action], ['computer.key', action], ['computer.scroll', action],
      ['computer.wait', waited], ['computer.stop', stopped],
      ['status', status], ['list', list], ['snapshot', computerSnapshot],
      ['focus', action], ['click', action], ['double-click', action], ['drag', action], ['type', action], ['key', action], ['scroll', action],
      ['wait', waited], ['stop', stopped], ['lease.install', { installed: true, leaseRevision: 1 }], ['input.release', { released: true }],
    ])
    for (const [requestKind, result] of results) roundTrip({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind,
      requestId,
      result,
    } as never)
  })

  it('round-trips every error code with a closed response', () => {
    const codes = [
      'NOT_SUPPORTED', 'UNAUTHORIZED', 'LEASE_EXPIRED', 'LEASE_REVOKED', 'STALE_REF',
      'TARGET_CLOSED', 'PERMISSION_DENIED', 'POLICY_DENIED', 'DUPLICATE_REQUEST',
      'TOO_MANY_PENDING', 'QUOTA_EXCEEDED', 'BINARY_MISMATCH', 'BUSY', 'TIMEOUT',
      'CANCELLED', 'DISCONNECTED', 'INTERNAL',
    ]
    for (const code of codes) roundTrip({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'error',
      requestKind: 'desktop.status',
      requestId,
      error: { code, message: '', retryable: code === 'BUSY' },
    } as never)
  })
})

describe('hostile syntax and cross-field combinations', () => {
  it.each([
    ['duplicate modifier', bridge('browser.key', { ...lease, key: 'A', modifiers: ['Shift', 'Shift'] }), /unique/i],
    ['unknown modifier', bridge('browser.key', { ...lease, key: 'A', modifiers: ['CapsLock'] }), /modifier/i],
    ['coordinate half', bridge('computer.click', { ...target, x: 1, button: 'left' }), /together/i],
    ['ref and coordinates', bridge('computer.click', { ...target, ref: computerRef, x: 1, y: 2, button: 'left' }), /exactly one/i],
    ['bad button', bridge('computer.drag', { ...target, fromX: 1, fromY: 2, toX: 3, toY: 4, button: 'back' }), /button/i],
    ['duration on navigation wait', bridge('browser.wait', { ...lease, mode: 'navigation', durationMs: 1 }), /only valid/i],
    ['negative wait', bridge('browser.wait', { ...lease, mode: 'duration', durationMs: -1 }), /durationMs/i],
    ['oversized duration', bridge('computer.wait', { ...target, durationMs: 10_001 }), /durationMs/i],
    ['negative coordinate', bridge('computer.click', { ...target, x: -1, y: 2, button: 'left' }), /finite/i],
    ['negative zero coordinate', bridge('computer.drag', { ...target, fromX: -0, fromY: 2, toX: 3, toY: 4, button: 'left' }), /finite/i],
  ])('rejects %s', (_name, value, message) => {
    expect(() => encodeJsonFrame(value)).toThrow(message)
  })

  it.each([
    ['bad capability', ['admin'], /capability/i],
    ['duplicate capability', ['observe', 'observe'], /unique/i],
  ])('rejects lease installation with %s', (_name, capabilities, message) => {
    expect(() => encodeJsonFrame(helper('lease.install', {
      ...lease, agentId: 'a', apps: [], windows: [], capabilities,
      quotas: { snapshots: 1, pointerActions: 1, keyActions: 1, textBytes: 1 },
      idleExpiresAfterMs: 1, hardExpiresAfterMs: 1,
    }))).toThrow(message)
  })

  it.each([
    '', ' ', '{', '[]x', '{"x" 1}', '{"x":1 "y":2}', '[1 2]', '"unterminated',
    '"bad\\x"', '01', '1e9999', '{"x":"\u0001"}',
  ])('rejects malformed or non-message JSON %j', (text) => {
    expect(() => decodeJsonFrame(Uint8Array.from([0x01, ...new TextEncoder().encode(text)]))).toThrow()
  })

  it('rejects invalid UTF-8 and bad response fields', () => {
    expect(() => decodeJsonFrame(Uint8Array.of(0x01, 0xff))).toThrow(/UTF-8/i)
    expect(() => encodeJsonFrame({
      protocolVersion: 1, messageKind: 'response', responseKind: 'error', requestKind: 'desktop.status', requestId,
      error: { code: 'NOPE', message: '', retryable: false },
    } as never)).toThrow(/code/i)
    expect(() => encodeJsonFrame({
      protocolVersion: 1, messageKind: 'response', responseKind: 'error', requestKind: 'desktop.status', requestId,
      error: { code: 'INTERNAL', message: '', retryable: 'no' },
    } as never)).toThrow(/retryable/i)
  })

  it('rejects unknown top-level message kinds and malformed manifest values', () => {
    expect(() => decodeJsonFrame(Uint8Array.from([0x01, 0x7b, 0x7d]))).toThrow(/messageKind/i)
    expect(() => validateProtocolManifest(null)).toThrow(/object/i)
    expect(() => validateProtocolManifest({ ...PROTOCOL_MANIFEST, bridgeRequestKinds: [1] })).toThrow(/string array/i)
    expect(() => validateProtocolManifest({ ...PROTOCOL_MANIFEST, protocolVersion: 2 })).toThrow(/version/i)
    expect(() => validateProtocolManifest({ ...PROTOCOL_MANIFEST, limits: { ...PROTOCOL_MANIFEST.limits, spare: 1 } })).toThrow(/limits/i)
    expect(() => validateProtocolManifest({
      ...PROTOCOL_MANIFEST,
      limits: { ...PROTOCOL_MANIFEST.limits, minRevision: -1 },
    })).toThrow(/non-negative/i)
    expect(() => validateProtocolManifest({ ...PROTOCOL_MANIFEST, controlFields: { ...PROTOCOL_MANIFEST.controlFields, 'parent.shutdown': 'none' } })).toThrow(/string array/i)
    expect(() => validateProtocolManifest({
      ...PROTOCOL_MANIFEST,
      controlFields: { ...PROTOCOL_MANIFEST.controlFields, 'parent.shutdown': ['leaseId'] },
    })).toThrow(/field matrix/i)
  })
})

describe('binary decoder failures', () => {
  it('rejects invalid PNG structure and transfer UUID bytes', async () => {
    const png = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/tiny.png')))
    const invalidSignature = new Uint8Array(png); invalidSignature[0] = 0
    expect(() => encodePngFrame(transferId, invalidSignature)).toThrow(/signature/i)
    const invalidHeader = new Uint8Array(png); invalidHeader[12] = 0
    expect(() => encodePngFrame(transferId, invalidHeader)).toThrow(/IHDR/i)
    const invalidDimensions = new Uint8Array(png); invalidDimensions.fill(0, 16, 20)
    expect(() => encodePngFrame(transferId, invalidDimensions)).toThrow(/dimensions/i)
    const invalidUuid = encodePngFrame(transferId, png); invalidUuid[7] = 0
    expect(() => decodePngFrame(invalidUuid)).toThrow(/transferId|format/i)
  })

  it('rejects wrong tags, empty PNGs, truncation, and reuse after failure', async () => {
    const png = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/tiny.png')))
    expect(() => decodeJsonFrame(Uint8Array.of(0x02, 1))).toThrow(/tag/i)
    expect(() => encodePngFrame(transferId, new Uint8Array())).toThrow(/limit/i)
    expect(() => decodePngFrame(Uint8Array.of(0x02))).toThrow(/body/i)
    const stream = new LengthPrefixedFrameDecoder()
    stream.push(Uint8Array.of(0, 0))
    expect(() => stream.finish()).toThrow(/truncated/i)
    expect(() => stream.push(Uint8Array.of(0, 0))).toThrow(/closed/i)
    const invalid = new DesktopControlFrameDecoder()
    expect(() => invalid.pushFrame(Uint8Array.of(0x03))).toThrow()
    expect(() => invalid.finish()).toThrow(/closed/i)
    expect(() => decodePngFrame(encodePngFrame(transferId, png))).not.toThrow()
    expect(() => new LengthPrefixedFrameDecoder().push(new Uint8Array())).not.toThrow()
    expect(() => new DesktopControlFrameDecoder().pushFrame(encodeJsonFrame(bridge('desktop.status')))).not.toThrow()
  })
})
