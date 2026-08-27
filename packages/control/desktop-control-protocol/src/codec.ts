import { createHash } from 'node:crypto'
import {
  BRIDGE_REQUEST_KINDS,
  CONTROL_KINDS,
  ERROR_CODES,
  type BridgeRequest,
  type BrowserSemanticRef,
  type ComputerSemanticRef,
  type DesktopControlControl,
  type DesktopControlErrorResponse,
  type DesktopControlOkResponse,
  type DesktopControlResultMap,
  type GrantableApplication,
  type PngMetadata,
} from './bridge.ts'
import {
  BrowserRef,
  ComputerRef,
  ControlLeaseId,
  PngTransferId,
  RequestId,
  type SessionId,
} from './brand.ts'
import {
  HELPER_REQUEST_KINDS,
  type HelperErrorResponse,
  type HelperOkResponse,
  type HelperRequest,
  type HelperResultMap,
} from './helper.ts'
import { PROTOCOL_LIMITS } from './manifest.ts'

const JSON_TAG = 0x01
const PNG_TAG = 0x02
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const SHA256 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const utf8 = new TextEncoder()
const utf8Strict = new TextDecoder('utf-8', { fatal: true })
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const MODIFIERS = new Set(['Alt', 'Control', 'Meta', 'Shift'])
const BUTTONS = new Set(['left', 'middle', 'right'])
const PERMISSION_STATES = new Set(['granted', 'denied', 'unknown'])

/** Every closed JSON message accepted by protocol v1. */
export type DesktopControlMessage =
  | BridgeRequest | HelperRequest | DesktopControlControl
  | DesktopControlOkResponse | DesktopControlErrorResponse
  | HelperOkResponse | HelperErrorResponse

/** A decoded JSON message plus its correlated immutable PNG, when present. */
export interface DecodedDesktopControlEnvelope {
  readonly message: DesktopControlMessage
  readonly png?: ImmutablePng
}

/** Protocol decoding failure that requires closing only the dedicated control link. */
export class DesktopControlProtocolError extends Error {
  override readonly name = 'DesktopControlProtocolError'
}

function fail(message: string): never {
  throw new DesktopControlProtocolError(message)
}

function byteLength(value: string): number {
  return utf8.encode(value).byteLength
}

function isNegativeZero(value: number): boolean {
  return Object.is(value, -0)
}

function asObject(value: unknown, label: string): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function at(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function has(value: object, key: string): boolean {
  return Object.hasOwn(value, key)
}

function keys(value: object, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) fail(`dangerous key ${key} is forbidden`)
    if (!allowed.has(key)) fail(`unknown field ${key}`)
  }
  for (const key of required) if (!has(value, key)) fail(`missing field ${key}`)
}

function stringValue(value: unknown, label: string, maxBytes = 4_096, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) fail(`${label} must be a ${allowEmpty ? '' : 'non-empty '}string`)
  if (byteLength(value) > maxBytes) fail(`${label} exceeds ${maxBytes} UTF-8 bytes`)
  return value
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`)
  return value
}

function safeInteger(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || isNegativeZero(value) || value < minimum || value > maximum) {
    fail(`${label} must be a safe integer from ${minimum} through ${maximum}`)
  }
  return value
}

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || isNegativeZero(value) || value < minimum || value > maximum) {
    fail(`${label} must be finite and in range`)
  }
  return value
}

function literal<T extends string>(value: unknown, allowed: ReadonlySet<string>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) fail(`${label} is unknown`)
  return value as T
}

function stringList(value: unknown, label: string, maximum = 64): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be a bounded array`)
  return value.map((item, index) => stringValue(item, `${label}[${index}]`, 256))
}

function sessionId(value: unknown): SessionId {
  return stringValue(value, 'sessionId', PROTOCOL_LIMITS.sessionIdBytes) as SessionId
}

function leaseFields(value: object): void {
  ControlLeaseId(stringValue(at(value, 'leaseId'), 'leaseId', 64))
  safeInteger(at(value, 'leaseRevision'), 'leaseRevision', 1)
}

function targetFields(value: object): void {
  leaseFields(value)
  stringValue(at(value, 'appId'), 'appId', 256)
  stringValue(at(value, 'windowId'), 'windowId', 256)
  safeInteger(at(value, 'snapshotRevision'), 'snapshotRevision', 1)
}

function pointerLocation(value: object): void {
  const refPresent = has(value, 'ref')
  const coordinatePresent = has(value, 'x') || has(value, 'y')
  if (refPresent === coordinatePresent) fail('exactly one semantic ref or coordinate pair is required')
  if (refPresent) ComputerRef(stringValue(at(value, 'ref'), 'ref', 64))
  else {
    if (!has(value, 'x') || !has(value, 'y')) fail('x and y must appear together')
    finiteNumber(at(value, 'x'), 'x', 0, 1_000_000)
    finiteNumber(at(value, 'y'), 'y', 0, 1_000_000)
  }
}

function modifiers(value: unknown): void {
  if (!Array.isArray(value) || value.length > 4) fail('modifiers must be a bounded array')
  const seen = new Set<string>()
  for (const item of value) {
    const modifier = literal<string>(item, MODIFIERS, 'modifier')
    if (seen.has(modifier)) fail('modifiers must be unique')
    seen.add(modifier)
  }
}

const REQUEST_BASE = ['protocolVersion', 'messageKind', 'requestKind', 'requestId', 'sessionId'] as const
const BRIDGE_BASE = [...REQUEST_BASE, 'deadlineUnixMs'] as const
const HELPER_BASE = [...REQUEST_BASE, 'timeoutMs'] as const

function requestBase(value: object, bridge: boolean): void {
  if (at(value, 'protocolVersion') !== 1) fail('protocolVersion must be 1')
  if (at(value, 'messageKind') !== 'request') fail('messageKind must be request')
  RequestId(stringValue(at(value, 'requestId'), 'requestId', 64))
  sessionId(at(value, 'sessionId'))
  if (bridge) safeInteger(at(value, 'deadlineUnixMs'), 'deadlineUnixMs', 0)
  else safeInteger(at(value, 'timeoutMs'), 'timeoutMs', PROTOCOL_LIMITS.minHelperTimeoutMs, PROTOCOL_LIMITS.maxHelperTimeoutMs)
}

function browserLease(value: object): void {
  leaseFields(value)
}

function validateBridgeRequest(value: object, kind: typeof BRIDGE_REQUEST_KINDS[number]): BridgeRequest {
  requestBase(value, true)
  switch (kind) {
    case 'desktop.status': case 'browser.stop': case 'computer.status': case 'computer.list': case 'computer.stop':
      keys(value, BRIDGE_BASE)
      break
    case 'browser.snapshot':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'includeImage'])
      browserLease(value); booleanValue(at(value, 'includeImage'), 'includeImage')
      break
    case 'browser.navigate':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'url'])
      browserLease(value); stringValue(at(value, 'url'), 'url', 8_192)
      break
    case 'browser.click':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'ref'])
      browserLease(value); BrowserRef(stringValue(at(value, 'ref'), 'ref', 64))
      break
    case 'browser.type':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'ref', 'text'])
      browserLease(value); BrowserRef(stringValue(at(value, 'ref'), 'ref', 64)); stringValue(at(value, 'text'), 'text', PROTOCOL_LIMITS.semanticTextBytes, true)
      break
    case 'browser.key':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'key', 'modifiers'])
      browserLease(value); stringValue(at(value, 'key'), 'key', 64); modifiers(at(value, 'modifiers'))
      break
    case 'browser.select':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'ref', 'value'])
      browserLease(value); BrowserRef(stringValue(at(value, 'ref'), 'ref', 64)); stringValue(at(value, 'value'), 'value', 8_192, true)
      break
    case 'browser.scroll':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'deltaX', 'deltaY'], ['ref'])
      browserLease(value)
      if (has(value, 'ref')) BrowserRef(stringValue(at(value, 'ref'), 'ref', 64))
      finiteNumber(at(value, 'deltaX'), 'deltaX', -1_000_000, 1_000_000)
      finiteNumber(at(value, 'deltaY'), 'deltaY', -1_000_000, 1_000_000)
      break
    case 'browser.wait': {
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'mode'], ['durationMs'])
      browserLease(value)
      const mode = literal<string>(at(value, 'mode'), new Set(['duration', 'navigation', 'loading-idle']), 'mode')
      if (mode === 'duration') safeInteger(at(value, 'durationMs'), 'durationMs', 0, 10_000)
      else if (has(value, 'durationMs')) fail('durationMs is only valid for duration waits')
      break
    }
    case 'browser.back': case 'browser.forward': case 'browser.reload':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision']); browserLease(value)
      break
    case 'computer.snapshot':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'includeImage'])
      targetFields(value); booleanValue(at(value, 'includeImage'), 'includeImage')
      break
    case 'computer.focus':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision']); targetFields(value)
      break
    case 'computer.click': case 'computer.double-click':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'button'], ['ref', 'x', 'y'])
      targetFields(value); pointerLocation(value); literal(at(value, 'button'), BUTTONS, 'button')
      break
    case 'computer.drag':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'fromX', 'fromY', 'toX', 'toY', 'button'])
      targetFields(value)
      for (const field of ['fromX', 'fromY', 'toX', 'toY']) finiteNumber(at(value, field), field, 0, 1_000_000)
      literal(at(value, 'button'), BUTTONS, 'button')
      break
    case 'computer.type':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'text'])
      targetFields(value); ComputerRef(stringValue(at(value, 'ref'), 'ref', 64)); stringValue(at(value, 'text'), 'text', PROTOCOL_LIMITS.semanticTextBytes, true)
      break
    case 'computer.key':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'key', 'modifiers'])
      targetFields(value); stringValue(at(value, 'key'), 'key', 64); modifiers(at(value, 'modifiers'))
      break
    case 'computer.scroll':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'deltaX', 'deltaY'], ['ref', 'x', 'y'])
      targetFields(value); pointerLocation(value)
      finiteNumber(at(value, 'deltaX'), 'deltaX', -1_000_000, 1_000_000)
      finiteNumber(at(value, 'deltaY'), 'deltaY', -1_000_000, 1_000_000)
      break
    case 'computer.wait':
      keys(value, [...BRIDGE_BASE, 'leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'durationMs'])
      targetFields(value); safeInteger(at(value, 'durationMs'), 'durationMs', 0, 10_000)
      break
    /* v8 ignore next -- the closed roster check rejects this before dispatch. */
    default: return fail('unknown bridge request kind')
  }
  return value as BridgeRequest
}

function helperTargetAction(value: object, kind: string): void {
  targetFields(value)
  if (kind === 'click' || kind === 'double-click') {
    pointerLocation(value); literal(at(value, 'button'), BUTTONS, 'button')
  } else if (kind === 'drag') {
    for (const field of ['fromX', 'fromY', 'toX', 'toY']) finiteNumber(at(value, field), field, 0, 1_000_000)
    literal(at(value, 'button'), BUTTONS, 'button')
  } else if (kind === 'type') {
    ComputerRef(stringValue(at(value, 'ref'), 'ref', 64)); stringValue(at(value, 'text'), 'text', PROTOCOL_LIMITS.semanticTextBytes, true)
  } else if (kind === 'key') {
    stringValue(at(value, 'key'), 'key', 64); modifiers(at(value, 'modifiers'))
  } else if (kind === 'scroll') {
    pointerLocation(value)
    finiteNumber(at(value, 'deltaX'), 'deltaX', -1_000_000, 1_000_000)
    finiteNumber(at(value, 'deltaY'), 'deltaY', -1_000_000, 1_000_000)
  } else if (kind === 'wait') safeInteger(at(value, 'durationMs'), 'durationMs', 0, 10_000)
}

function validateHelperRequest(value: object, kind: typeof HELPER_REQUEST_KINDS[number]): HelperRequest {
  requestBase(value, false)
  const target = ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision'] as const
  switch (kind) {
    case 'status': case 'list': keys(value, HELPER_BASE); break
    case 'snapshot':
      keys(value, [...HELPER_BASE, ...target, 'includeImage']); targetFields(value); booleanValue(at(value, 'includeImage'), 'includeImage'); break
    case 'focus': keys(value, [...HELPER_BASE, ...target]); targetFields(value); break
    case 'click': case 'double-click':
      keys(value, [...HELPER_BASE, ...target, 'button'], ['ref', 'x', 'y']); helperTargetAction(value, kind); break
    case 'drag':
      keys(value, [...HELPER_BASE, ...target, 'fromX', 'fromY', 'toX', 'toY', 'button']); helperTargetAction(value, kind); break
    case 'type':
      keys(value, [...HELPER_BASE, ...target, 'ref', 'text']); helperTargetAction(value, kind); break
    case 'key':
      keys(value, [...HELPER_BASE, ...target, 'key', 'modifiers']); helperTargetAction(value, kind); break
    case 'scroll':
      keys(value, [...HELPER_BASE, ...target, 'deltaX', 'deltaY'], ['ref', 'x', 'y']); helperTargetAction(value, kind); break
    case 'wait':
      keys(value, [...HELPER_BASE, ...target, 'durationMs']); helperTargetAction(value, kind); break
    case 'stop': keys(value, [...HELPER_BASE, 'leaseId', 'leaseRevision']); leaseFields(value); break
    case 'lease.install': {
      keys(value, [...HELPER_BASE, 'leaseId', 'leaseRevision', 'agentId', 'apps', 'windows', 'capabilities', 'quotas', 'idleExpiresAfterMs', 'hardExpiresAfterMs'])
      leaseFields(value); stringValue(at(value, 'agentId'), 'agentId', 256)
      stringList(at(value, 'apps'), 'apps'); stringList(at(value, 'windows'), 'windows')
      const capabilities = at(value, 'capabilities')
      if (!Array.isArray(capabilities) || capabilities.length > 3) fail('capabilities must be a bounded array')
      const capabilitySet = new Set<string>()
      for (const item of capabilities) {
        const capability = literal<string>(item, new Set(['observe', 'pointer', 'keyboard']), 'capability')
        if (capabilitySet.has(capability)) fail('capabilities must be unique')
        capabilitySet.add(capability)
      }
      const quotas = asObject(at(value, 'quotas'), 'quotas')
      keys(quotas, ['snapshots', 'pointerActions', 'keyActions', 'textBytes'])
      for (const field of ['snapshots', 'pointerActions', 'keyActions', 'textBytes']) safeInteger(at(quotas, field), field, 0, 1_000_000)
      safeInteger(at(value, 'idleExpiresAfterMs'), 'idleExpiresAfterMs', 1, 300_000)
      safeInteger(at(value, 'hardExpiresAfterMs'), 'hardExpiresAfterMs', 1, 1_200_000)
      break
    }
    case 'input.release':
      keys(value, [...HELPER_BASE, 'keys', 'buttons'])
      stringList(at(value, 'keys'), 'keys', 64)
      if (!Array.isArray(at(value, 'buttons')) || (at(value, 'buttons') as unknown[]).some(item => typeof item !== 'string' || !BUTTONS.has(item))) fail('buttons are invalid')
      break
    /* v8 ignore next -- the closed roster check rejects this before dispatch. */
    default: return fail('unknown helper request kind')
  }
  return value as HelperRequest
}

function imageMetadata(value: unknown): PngMetadata {
  const image = asObject(value, 'image')
  keys(image, ['transferId', 'byteLength', 'sha256', 'width', 'height'])
  const transferId = PngTransferId(stringValue(at(image, 'transferId'), 'transferId', 64))
  const byteLength = safeInteger(at(image, 'byteLength'), 'byteLength', 1, PROTOCOL_LIMITS.pngBytes)
  const sha256 = stringValue(at(image, 'sha256'), 'sha256', 64)
  if (!SHA256.test(sha256)) fail('sha256 must be lower-case hexadecimal')
  const width = safeInteger(at(image, 'width'), 'width', 1, 100_000)
  const height = safeInteger(at(image, 'height'), 'height', 1, 100_000)
  return { transferId, byteLength, sha256, width, height }
}

function semanticRefs(value: unknown, browser: boolean): readonly (BrowserSemanticRef | ComputerSemanticRef)[] {
  if (!Array.isArray(value) || value.length > 300) fail('refs must be a bounded array')
  return value.map((item, index) => {
    const ref = asObject(item, `refs[${index}]`)
    keys(ref, ['ref', 'role', 'name'])
    const raw = stringValue(at(ref, 'ref'), `refs[${index}].ref`, 64)
    const role = stringValue(at(ref, 'role'), `refs[${index}].role`, 128)
    const name = stringValue(at(ref, 'name'), `refs[${index}].name`, 1_024, true)
    return browser
      ? { ref: BrowserRef(raw), role, name }
      : { ref: ComputerRef(raw), role, name }
  })
}

function semanticText(value: unknown): string {
  return stringValue(value, 'semanticText', PROTOCOL_LIMITS.semanticTextBytes, true)
}

function appsResult(value: unknown): readonly GrantableApplication[] {
  if (!Array.isArray(value) || value.length > 128) fail('apps must be a bounded array')
  return value.map((item, appIndex) => {
    const app = asObject(item, `apps[${appIndex}]`)
    keys(app, ['appId', 'name', 'windows'])
    const windows = at(app, 'windows')
    if (!Array.isArray(windows) || windows.length > 256) fail('windows must be a bounded array')
    return {
      appId: stringValue(at(app, 'appId'), 'appId', 256),
      name: stringValue(at(app, 'name'), 'name', 256),
      windows: windows.map((item, windowIndex) => {
        const window = asObject(item, `windows[${windowIndex}]`)
        keys(window, ['windowId', 'title'])
        return {
          windowId: stringValue(at(window, 'windowId'), 'windowId', 256),
          title: stringValue(at(window, 'title'), 'title', 1_024, true),
        }
      }),
    }
  })
}

function actionResult(value: object): void {
  keys(value, ['acted', 'snapshotRevision'])
  if (at(value, 'acted') !== true) fail('acted must be true')
  safeInteger(at(value, 'snapshotRevision'), 'snapshotRevision', 1)
}

function waitResult(value: object): void {
  keys(value, ['waited', 'snapshotRevision'])
  if (at(value, 'waited') !== true) fail('waited must be true')
  safeInteger(at(value, 'snapshotRevision'), 'snapshotRevision', 1)
}

function statusResult(value: object): void {
  keys(value, ['viewing', 'assistive', 'supported'])
  literal(at(value, 'viewing'), PERMISSION_STATES, 'viewing')
  literal(at(value, 'assistive'), PERMISSION_STATES, 'assistive')
  booleanValue(at(value, 'supported'), 'supported')
}

function validateResult(value: unknown, kind: keyof DesktopControlResultMap | keyof HelperResultMap): void {
  const result = asObject(value, 'result')
  switch (kind) {
    case 'desktop.status':
      keys(result, ['browserSupported', 'computerSupported'])
      booleanValue(at(result, 'browserSupported'), 'browserSupported'); booleanValue(at(result, 'computerSupported'), 'computerSupported'); break
    case 'browser.snapshot':
      keys(result, ['surfaceId', 'url', 'title', 'snapshotRevision', 'semanticText', 'refs'], ['image'])
      stringValue(at(result, 'surfaceId'), 'surfaceId', 256); stringValue(at(result, 'url'), 'url', 8_192); stringValue(at(result, 'title'), 'title', 2_048, true)
      safeInteger(at(result, 'snapshotRevision'), 'snapshotRevision', 1); semanticText(at(result, 'semanticText')); semanticRefs(at(result, 'refs'), true)
      if (has(result, 'image')) imageMetadata(at(result, 'image'))
      break
    case 'browser.navigate': case 'browser.back': case 'browser.forward': case 'browser.reload':
      keys(result, ['url', 'snapshotRevision']); stringValue(at(result, 'url'), 'url', 8_192); safeInteger(at(result, 'snapshotRevision'), 'snapshotRevision', 1); break
    case 'browser.click': case 'browser.type': case 'browser.key': case 'browser.select': case 'browser.scroll':
    case 'computer.focus': case 'computer.click': case 'computer.double-click': case 'computer.drag': case 'computer.type': case 'computer.key': case 'computer.scroll':
    case 'focus': case 'click': case 'double-click': case 'drag': case 'type': case 'key': case 'scroll': actionResult(result); break
    case 'browser.wait': case 'computer.wait': case 'wait': waitResult(result); break
    case 'browser.stop': case 'computer.stop': case 'stop':
      keys(result, ['stopped']); if (at(result, 'stopped') !== true) fail('stopped must be true'); break
    case 'computer.status': case 'status': statusResult(result); break
    case 'computer.list': case 'list': keys(result, ['apps']); appsResult(at(result, 'apps')); break
    case 'computer.snapshot': case 'snapshot':
      keys(result, ['appId', 'windowId', 'snapshotRevision', 'semanticText', 'refs'], ['image'])
      stringValue(at(result, 'appId'), 'appId', 256); stringValue(at(result, 'windowId'), 'windowId', 256)
      safeInteger(at(result, 'snapshotRevision'), 'snapshotRevision', 1); semanticText(at(result, 'semanticText')); semanticRefs(at(result, 'refs'), false)
      if (has(result, 'image')) imageMetadata(at(result, 'image'))
      break
    case 'lease.install':
      keys(result, ['installed', 'leaseRevision']); if (at(result, 'installed') !== true) fail('installed must be true'); safeInteger(at(result, 'leaseRevision'), 'leaseRevision', 1); break
    case 'input.release': keys(result, ['released']); if (at(result, 'released') !== true) fail('released must be true'); break
    /* v8 ignore next -- the closed response roster rejects this before dispatch. */
    default: fail('result does not match requestKind')
  }
}

function validateResponse(value: object): DesktopControlOkResponse | DesktopControlErrorResponse | HelperOkResponse | HelperErrorResponse {
  if (at(value, 'protocolVersion') !== 1) fail('protocolVersion must be 1')
  if (at(value, 'messageKind') !== 'response') fail('messageKind must be response')
  RequestId(stringValue(at(value, 'requestId'), 'requestId', 64))
  const rawKind = at(value, 'requestKind')
  const allKinds = new Set<string>([...BRIDGE_REQUEST_KINDS, ...HELPER_REQUEST_KINDS])
  const kind = literal<keyof DesktopControlResultMap | keyof HelperResultMap>(rawKind, allKinds, 'requestKind')
  const responseKind = literal<string>(at(value, 'responseKind'), new Set(['ok', 'error']), 'responseKind')
  if (responseKind === 'ok') {
    keys(value, ['protocolVersion', 'messageKind', 'responseKind', 'requestKind', 'requestId', 'result'])
    validateResult(at(value, 'result'), kind)
  } else {
    keys(value, ['protocolVersion', 'messageKind', 'responseKind', 'requestKind', 'requestId', 'error'])
    const error = asObject(at(value, 'error'), 'error')
    keys(error, ['code', 'message', 'retryable'])
    literal(at(error, 'code'), new Set(ERROR_CODES), 'error code')
    stringValue(at(error, 'message'), 'error message', PROTOCOL_LIMITS.errorMessageBytes, true)
    booleanValue(at(error, 'retryable'), 'retryable')
  }
  return value as DesktopControlOkResponse | DesktopControlErrorResponse | HelperOkResponse | HelperErrorResponse
}

function validateControl(value: object): DesktopControlControl {
  if (at(value, 'protocolVersion') !== 1) fail('protocolVersion must be 1')
  if (at(value, 'messageKind') !== 'control') fail('messageKind must be control')
  const kind = literal<typeof CONTROL_KINDS[number]>(at(value, 'controlKind'), new Set(CONTROL_KINDS), 'controlKind')
  if (kind === 'request.cancel') {
    keys(value, ['protocolVersion', 'messageKind', 'controlKind', 'sessionId', 'requestId'])
    sessionId(at(value, 'sessionId')); RequestId(stringValue(at(value, 'requestId'), 'requestId', 64))
  } else if (kind === 'session.revoke') {
    keys(value, ['protocolVersion', 'messageKind', 'controlKind', 'sessionId']); sessionId(at(value, 'sessionId'))
  } else if (kind === 'lease.revoke') {
    keys(value, ['protocolVersion', 'messageKind', 'controlKind', 'sessionId', 'leaseId', 'leaseRevision'])
    sessionId(at(value, 'sessionId')); leaseFields(value)
  } else keys(value, ['protocolVersion', 'messageKind', 'controlKind'])
  return value as DesktopControlControl
}

function validateMessage(value: unknown): DesktopControlMessage {
  const message = asObject(value, 'protocol message')
  const messageKind = at(message, 'messageKind')
  if (messageKind === 'request') {
    const kind = at(message, 'requestKind')
    if (typeof kind !== 'string') fail('requestKind must be a string')
    if ((BRIDGE_REQUEST_KINDS as readonly string[]).includes(kind)) {
      return validateBridgeRequest(message, kind as typeof BRIDGE_REQUEST_KINDS[number])
    }
    if ((HELPER_REQUEST_KINDS as readonly string[]).includes(kind)) {
      return validateHelperRequest(message, kind as typeof HELPER_REQUEST_KINDS[number])
    }
    return fail('unknown requestKind')
  }
  if (messageKind === 'response') return validateResponse(message)
  if (messageKind === 'control') return validateControl(message)
  return fail('messageKind is unknown')
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

class StrictJsonParser {
  private offset = 0
  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.value()
    this.space()
    if (this.offset !== this.source.length) fail(`unexpected JSON token at ${this.offset}`)
    return value
  }

  private space(): void {
    while (/\s/u.test(this.source[this.offset] ?? '')) this.offset += 1
  }

  private value(): unknown {
    this.space()
    const char = this.source[this.offset]
    if (char === '{') return this.object()
    if (char === '[') return this.array()
    if (char === '"') return this.string()
    if (char === 't' && this.take('true')) return true
    if (char === 'f' && this.take('false')) return false
    if (char === 'n' && this.take('null')) return null
    return this.number()
  }

  private object(): object {
    this.offset += 1
    this.space()
    const result = {}
    const seen = new Set<string>()
    if (this.source[this.offset] === '}') { this.offset += 1; return result }
    while (true) {
      this.space()
      if (this.source[this.offset] !== '"') fail(`object key expected at ${this.offset}`)
      const key = this.string()
      if (DANGEROUS_KEYS.has(key)) fail(`dangerous key ${key} is forbidden`)
      if (seen.has(key)) fail(`duplicate JSON key ${key}`)
      seen.add(key)
      this.space()
      if (this.source[this.offset] !== ':') fail(`colon expected at ${this.offset}`)
      this.offset += 1
      Object.defineProperty(result, key, { value: this.value(), enumerable: true, configurable: true, writable: true })
      this.space()
      const delimiter = this.source[this.offset]
      this.offset += 1
      if (delimiter === '}') return result
      if (delimiter !== ',') fail(`object delimiter expected at ${this.offset - 1}`)
    }
  }

  private array(): unknown[] {
    this.offset += 1
    this.space()
    const result: unknown[] = []
    if (this.source[this.offset] === ']') { this.offset += 1; return result }
    while (true) {
      result.push(this.value())
      this.space()
      const delimiter = this.source[this.offset]
      this.offset += 1
      if (delimiter === ']') return result
      if (delimiter !== ',') fail(`array delimiter expected at ${this.offset - 1}`)
    }
  }

  private string(): string {
    const start = this.offset
    this.offset += 1
    let escaped = false
    while (this.offset < this.source.length) {
      const code = this.source.charCodeAt(this.offset)
      if (!escaped && code === 0x22) {
        this.offset += 1
        try {
          const parsed: unknown = JSON.parse(this.source.slice(start, this.offset))
          if (typeof parsed !== 'string') return fail('invalid JSON string')
          return parsed
        } catch {
          return fail(`invalid JSON string at ${start}`)
        }
      }
      if (!escaped && code < 0x20) fail(`control character in JSON string at ${this.offset}`)
      if (!escaped && code === 0x5c) escaped = true
      else escaped = false
      this.offset += 1
    }
    return fail(`unterminated JSON string at ${start}`)
  }

  private number(): number {
    const rest = this.source.slice(this.offset)
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest)
    if (match === null) return fail(`JSON value expected at ${this.offset}`)
    this.offset += match[0].length
    const value = Number(match[0])
    if (!Number.isFinite(value)) return fail('JSON number must be finite')
    return value
  }

  private take(token: string): boolean {
    if (!this.source.startsWith(token, this.offset)) return false
    this.offset += token.length
    return true
  }
}

/**
 * Decode, strictly validate, detach, and deeply freeze one JSON protocol frame.
 * @param frame - One complete JSON-tagged frame.
 * @returns the detached immutable message.
 */
export function decodeJsonFrame(frame: Uint8Array): DesktopControlMessage {
  if (frame.byteLength < 2 || frame[0] !== JSON_TAG) fail('JSON frame tag is invalid')
  const bytes = frame.subarray(1)
  if (bytes.byteLength > PROTOCOL_LIMITS.jsonPayloadBytes) fail('JSON frame exceeds the payload limit')
  let text: string
  try { text = utf8Strict.decode(bytes) } catch { return fail('JSON frame is not valid UTF-8') }
  const parsed = new StrictJsonParser(text).parse()
  return deepFreeze(validateMessage(parsed))
}

/**
 * Validate and encode one detached protocol message as a compact JSON frame.
 * @param message - Closed protocol message to validate and encode.
 * @returns a fresh JSON-tagged frame.
 */
export function encodeJsonFrame(message: DesktopControlMessage): Uint8Array {
  validateMessage(message)
  const text = JSON.stringify(message)
  const bytes = utf8.encode(text)
  if (bytes.byteLength > PROTOCOL_LIMITS.jsonPayloadBytes) fail('JSON frame exceeds the payload limit')
  const frame = new Uint8Array(1 + bytes.byteLength)
  frame[0] = JSON_TAG
  frame.set(bytes, 1)
  return frame
}

/**
 * Assert a child-provided wall-clock deadline against the caller's current time.
 * @param request - Validated bridge request carrying the proposed deadline.
 * @param nowUnixMs - Caller-owned current Unix time in milliseconds.
 */
export function assertBridgeDeadline(request: BridgeRequest, nowUnixMs: number): void {
  safeInteger(nowUnixMs, 'nowUnixMs', 0)
  if (request.deadlineUnixMs < nowUnixMs || request.deadlineUnixMs > nowUnixMs + PROTOCOL_LIMITS.maxDeadlineAheadMs) {
    fail('deadlineUnixMs must be current and no more than 30 seconds ahead')
  }
}

function uuidBytes(value: PngTransferId): Uint8Array {
  const hex = value.replaceAll('-', '')
  const bytes = new Uint8Array(16)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function bytesUuid(bytes: Uint8Array): PngTransferId {
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return PngTransferId(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`)
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 24 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) fail('PNG signature is invalid')
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') fail('PNG IHDR is missing')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width === 0 || height === 0) fail('PNG dimensions are invalid')
  return { width, height }
}

/** Immutable raw PNG storage whose only reader returns a fresh copy. */
export class ImmutablePng {
  readonly #bytes: Uint8Array
  /** Number of raw PNG bytes retained internally. */
  readonly byteLength: number

  /** Copy raw PNG bytes into immutable protocol-owned storage. */
  constructor(bytes: Uint8Array) {
    this.#bytes = new Uint8Array(bytes)
    this.byteLength = this.#bytes.byteLength
    Object.freeze(this)
  }

  /**
   * Return a fresh copy of the raw PNG bytes.
   * @returns a copy with no mutable alias to retained storage.
   */
  read(): Uint8Array {
    return new Uint8Array(this.#bytes)
  }
}

/** Decoded raw PNG frame with an immutable byte owner. */
export interface DecodedPngFrame {
  readonly transferId: PngTransferId
  readonly png: ImmutablePng
}

/**
 * Encode one raw PNG with its 16-byte transfer UUID.
 * @param transferId - Correlation UUID declared by the adjacent JSON metadata.
 * @param png - Complete bounded PNG bytes.
 * @returns a fresh PNG-tagged frame.
 */
export function encodePngFrame(transferId: PngTransferId, png: Uint8Array): Uint8Array {
  if (!UUID.test(transferId)) fail('transferId has an invalid format')
  if (png.byteLength === 0 || png.byteLength > PROTOCOL_LIMITS.pngBytes) fail('PNG exceeds the byte limit')
  pngDimensions(png)
  const frame = new Uint8Array(17 + png.byteLength)
  frame[0] = PNG_TAG
  frame.set(uuidBytes(transferId), 1)
  frame.set(png, 17)
  return frame
}

/**
 * Decode one raw PNG frame into protocol-owned immutable bytes.
 * @param frame - One complete PNG-tagged frame.
 * @returns the transfer identifier and immutable byte owner.
 */
export function decodePngFrame(frame: Uint8Array): DecodedPngFrame {
  if (frame.byteLength < 18 || frame[0] !== PNG_TAG) fail('PNG frame tag or body is invalid')
  if (frame.byteLength > PROTOCOL_LIMITS.pngFrameBytes) fail('PNG frame exceeds the byte limit')
  const transferId = bytesUuid(frame.subarray(1, 17))
  const pngBytes = new Uint8Array(frame.subarray(17))
  pngDimensions(pngBytes)
  return Object.freeze({ transferId, png: new ImmutablePng(pngBytes) })
}

function pendingImage(message: DesktopControlMessage): PngMetadata | undefined {
  if (message.messageKind !== 'response' || message.responseKind !== 'ok') return undefined
  if (message.requestKind !== 'browser.snapshot' && message.requestKind !== 'computer.snapshot' && message.requestKind !== 'snapshot') return undefined
  const result = asObject(message.result, 'result')
  return has(result, 'image') ? imageMetadata(at(result, 'image')) : undefined
}

/** Stateful JSON/PNG correlator. Any malformed or mis-sequenced frame permanently closes this decoder. */
export class DesktopControlFrameDecoder {
  private pending: { message: DesktopControlMessage; image: PngMetadata } | undefined
  private closed = false

  /**
   * Accept one complete unprefixed protocol frame.
   * @param frame - JSON or PNG frame received in exact order.
   * @returns zero envelopes while awaiting a PNG, otherwise the completed envelope.
   */
  pushFrame(frame: Uint8Array): readonly DecodedDesktopControlEnvelope[] {
    if (this.closed) return fail('control decoder is closed')
    try {
      if (this.pending !== undefined) {
        if (frame[0] !== PNG_TAG) fail('expected the correlated PNG frame immediately')
        const decoded = decodePngFrame(frame)
        const expected = this.pending.image
        if (decoded.transferId !== expected.transferId) fail('PNG transfer id mismatch')
        const bytes = decoded.png.read()
        if (bytes.byteLength !== expected.byteLength) fail('PNG byte length mismatch')
        const digest = createHash('sha256').update(bytes).digest('hex')
        if (digest !== expected.sha256) fail('PNG hash mismatch')
        const dimensions = pngDimensions(bytes)
        if (dimensions.width !== expected.width || dimensions.height !== expected.height) fail('PNG dimensions mismatch')
        const envelope = deepFreeze({ message: this.pending.message, png: decoded.png })
        this.pending = undefined
        return [envelope]
      }
      if (frame[0] === PNG_TAG) fail('orphan PNG frame')
      const message = decodeJsonFrame(frame)
      const image = pendingImage(message)
      if (image !== undefined) {
        this.pending = { message, image }
        return []
      }
      return [deepFreeze({ message })]
    } catch (error) {
      this.closed = true
      this.pending = undefined
      throw error
    }
  }

  /** Assert that the input ended without a partial PNG pair. */
  finish(): void {
    if (this.closed) return fail('control decoder is closed')
    if (this.pending !== undefined) {
      this.closed = true
      this.pending = undefined
      fail('expected the correlated PNG frame before end of input')
    }
  }
}

function frameLimit(frame: Uint8Array): number {
  if (frame.byteLength === 0) return 0
  if (frame[0] === JSON_TAG) return PROTOCOL_LIMITS.jsonFrameBytes
  if (frame[0] === PNG_TAG) return PROTOCOL_LIMITS.pngFrameBytes
  return 0
}

/**
 * Prefix one complete frame with its four-byte big-endian length.
 * @param frame - Complete validated-tag frame.
 * @returns a fresh length-prefixed frame.
 */
export function encodeLengthPrefixedFrame(frame: Uint8Array): Uint8Array {
  const limit = frameLimit(frame)
  if (limit === 0 || frame.byteLength > limit) fail('frame tag or length is invalid')
  const output = new Uint8Array(4 + frame.byteLength)
  new DataView(output.buffer).setUint32(0, frame.byteLength)
  output.set(frame, 4)
  return output
}

/** Streaming decoder for the helper's four-byte big-endian frame lengths. */
export class LengthPrefixedFrameDecoder {
  private readonly header = new Uint8Array(4)
  private headerBytes = 0
  private body: Uint8Array | undefined
  private bodyBytes = 0
  private closed = false

  /**
   * Accept any split or coalesced stream bytes and return complete copied frames.
   * @param chunk - Next stream bytes in arrival order.
   * @returns every complete frame finished by this chunk.
   */
  push(chunk: Uint8Array): readonly Uint8Array[] {
    if (this.closed) return fail('length decoder is closed')
    const frames: Uint8Array[] = []
    let offset = 0
    try {
      while (offset < chunk.byteLength) {
        if (this.body === undefined) {
          const count = Math.min(4 - this.headerBytes, chunk.byteLength - offset)
          this.header.set(chunk.subarray(offset, offset + count), this.headerBytes)
          this.headerBytes += count
          offset += count
          if (this.headerBytes < 4) continue
          const length = new DataView(this.header.buffer).getUint32(0)
          if (length === 0 || length > PROTOCOL_LIMITS.outerFrameBytes) fail('frame length prefix is invalid')
          this.body = new Uint8Array(length)
          this.bodyBytes = 0
        }
        const count = Math.min(this.body.byteLength - this.bodyBytes, chunk.byteLength - offset)
        this.body.set(chunk.subarray(offset, offset + count), this.bodyBytes)
        this.bodyBytes += count
        offset += count
        if (this.bodyBytes === this.body.byteLength) {
          const complete = this.body
          const limit = frameLimit(complete)
          if (limit === 0 || complete.byteLength > limit) fail('frame tag or length is invalid')
          frames.push(complete)
          this.body = undefined
          this.bodyBytes = 0
          this.headerBytes = 0
        }
      }
      return frames
    } catch (error) {
      this.closed = true
      this.body = undefined
      throw error
    }
  }

  /** Assert that the stream ended between frames. */
  finish(): void {
    if (this.closed) return fail('length decoder is closed')
    if (this.headerBytes !== 0 || this.body !== undefined) {
      this.closed = true
      this.body = undefined
      fail('truncated length-prefixed frame')
    }
  }
}
