import { createHash } from 'node:crypto'
import {
  BRIDGE_REQUEST_KINDS,
  CONTROL_LEASE_CAPABILITIES,
  CONTROL_LEASE_SURFACE_KINDS,
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
  type ControlLeaseSurfaceKind,
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
import {
  BRIDGE_REQUEST_FIELDS,
  CONTROL_FIELDS,
  CONTROL_LEASE_QUOTA_FIELDS,
  CONTROL_LEASE_TARGET_FIELDS,
  HELPER_REQUEST_FIELDS,
  RESULT_FIELDS,
} from './fields.ts'
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
const LEASE_SURFACES: ReadonlySet<string> = new Set(CONTROL_LEASE_SURFACE_KINDS)
const LEASE_CAPABILITIES: ReadonlySet<string> = new Set(CONTROL_LEASE_CAPABILITIES)

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

function stringValue(value: unknown, label: string, maxBytes: number, allowEmpty = false): string {
  if (typeof value !== 'string') fail(`${label} must be a ${allowEmpty ? '' : 'non-empty '}string`)
  const bytes = byteLength(value)
  if (!allowEmpty && bytes < PROTOCOL_LIMITS.minNonEmptyStringBytes) fail(`${label} must be a non-empty string`)
  if (bytes > maxBytes) fail(`${label} exceeds ${maxBytes} UTF-8 bytes`)
  return value
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`)
  return value
}

function safeInteger(
  value: unknown,
  label: string,
  minimum = PROTOCOL_LIMITS.minSafeInteger,
  maximum = PROTOCOL_LIMITS.maxSafeInteger,
): number {
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

function stringList(value: unknown, label: string, maximum = PROTOCOL_LIMITS.maxStringListItems): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be a bounded array`)
  return value.map((item, index) => stringValue(item, `${label}[${index}]`, PROTOCOL_LIMITS.stringListItemBytes))
}

function controlLeaseCapabilities(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0
    || value.length > PROTOCOL_LIMITS.maxLeaseCapabilities) {
    fail('capabilities must be a non-empty bounded array')
  }
  const seen = new Set<string>()
  for (const item of value) {
    const capability = literal<string>(item, LEASE_CAPABILITIES, 'capability')
    if (seen.has(capability)) fail('capabilities must be unique')
    seen.add(capability)
  }
}

function controlLeaseTargets(value: unknown, requireNativeTargets: boolean): void {
  if (!Array.isArray(value) || value.length > PROTOCOL_LIMITS.maxGrantableApps) {
    fail('targets must be a bounded array')
  }
  if (requireNativeTargets && value.length === 0) fail('native lease targets must be non-empty')
  if (!requireNativeTargets && value.length !== 0) fail('browser lease targets must be empty')
  const appIds = new Set<string>()
  const windowIds = new Set<string>()
  value.forEach((item, appIndex) => {
    const target = asObject(item, `targets[${appIndex}]`)
    keys(target, CONTROL_LEASE_TARGET_FIELDS)
    const appId = stringValue(at(target, 'appId'), `targets[${appIndex}].appId`, PROTOCOL_LIMITS.appIdBytes)
    if (appIds.has(appId)) fail('target appId values must be unique')
    appIds.add(appId)
    const windows = at(target, 'windowIds')
    if (!Array.isArray(windows) || windows.length === 0) {
      fail(`targets[${appIndex}].windowIds must be a non-empty bounded array`)
    }
    if (windows.length > PROTOCOL_LIMITS.maxGrantableWindowsPerApp) {
      fail(`targets[${appIndex}].windowIds must be a bounded array`)
    }
    windows.forEach((item, windowIndex) => {
      const windowId = stringValue(
        item,
        `targets[${appIndex}].windowIds[${windowIndex}]`,
        PROTOCOL_LIMITS.windowIdBytes,
      )
      if (windowIds.has(windowId)) fail('target windowId values must be unique')
      windowIds.add(windowId)
    })
  })
}

function controlLeaseSurface(value: unknown): ControlLeaseSurfaceKind {
  return literal<ControlLeaseSurfaceKind>(value, LEASE_SURFACES, 'surfaceKind')
}

function sessionId(value: unknown): SessionId {
  return stringValue(value, 'sessionId', PROTOCOL_LIMITS.sessionIdBytes) as SessionId
}

function leaseFields(value: object): void {
  ControlLeaseId(stringValue(at(value, 'leaseId'), 'leaseId', PROTOCOL_LIMITS.identifierBytes))
  safeInteger(at(value, 'leaseRevision'), 'leaseRevision', PROTOCOL_LIMITS.minRevision)
}

function targetFields(value: object): void {
  leaseFields(value)
  stringValue(at(value, 'appId'), 'appId', PROTOCOL_LIMITS.appIdBytes)
  stringValue(at(value, 'windowId'), 'windowId', PROTOCOL_LIMITS.windowIdBytes)
  safeInteger(at(value, 'snapshotRevision'), 'snapshotRevision', PROTOCOL_LIMITS.minRevision)
}

function pointerLocation(value: object): void {
  const refPresent = has(value, 'ref')
  const coordinatePresent = has(value, 'x') || has(value, 'y')
  if (refPresent === coordinatePresent) fail('exactly one semantic ref or coordinate pair is required')
  if (refPresent) ComputerRef(stringValue(at(value, 'ref'), 'ref', PROTOCOL_LIMITS.identifierBytes))
  else {
    if (!has(value, 'x') || !has(value, 'y')) fail('x and y must appear together')
    finiteNumber(at(value, 'x'), 'x', PROTOCOL_LIMITS.minCoordinate, PROTOCOL_LIMITS.maxCoordinate)
    finiteNumber(at(value, 'y'), 'y', PROTOCOL_LIMITS.minCoordinate, PROTOCOL_LIMITS.maxCoordinate)
  }
}

function modifiers(value: unknown): void {
  if (!Array.isArray(value) || value.length > PROTOCOL_LIMITS.maxModifiers) fail('modifiers must be a bounded array')
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

function matrixKeys(
  value: object,
  base: readonly string[],
  fields: readonly string[],
  optional: readonly string[] = [],
): void {
  const optionalSet = new Set(optional)
  keys(value, [...base, ...fields.filter(field => !optionalSet.has(field))], optional)
}

function bridgeKeys(
  value: object,
  kind: typeof BRIDGE_REQUEST_KINDS[number],
  optional: readonly string[] = [],
): void {
  matrixKeys(value, BRIDGE_BASE, BRIDGE_REQUEST_FIELDS[kind], optional)
}

function helperKeys(
  value: object,
  kind: typeof HELPER_REQUEST_KINDS[number],
  optional: readonly string[] = [],
): void {
  matrixKeys(value, HELPER_BASE, HELPER_REQUEST_FIELDS[kind], optional)
}

function controlKeys(value: object, kind: typeof CONTROL_KINDS[number]): void {
  matrixKeys(value, ['protocolVersion', 'messageKind', 'controlKind'], CONTROL_FIELDS[kind])
}

function resultKeys(
  value: object,
  kind: keyof DesktopControlResultMap | keyof HelperResultMap,
  optional: readonly string[] = [],
): void {
  matrixKeys(value, [], RESULT_FIELDS[kind], optional)
}

function requestBase(value: object, bridge: boolean): void {
  if (at(value, 'protocolVersion') !== 1) fail('protocolVersion must be 1')
  if (at(value, 'messageKind') !== 'request') fail('messageKind must be request')
  RequestId(stringValue(at(value, 'requestId'), 'requestId', PROTOCOL_LIMITS.identifierBytes))
  sessionId(at(value, 'sessionId'))
  if (bridge) safeInteger(at(value, 'deadlineUnixMs'), 'deadlineUnixMs', PROTOCOL_LIMITS.minDeadlineUnixMs)
  else safeInteger(at(value, 'timeoutMs'), 'timeoutMs', PROTOCOL_LIMITS.minHelperTimeoutMs, PROTOCOL_LIMITS.maxHelperTimeoutMs)
}

function browserLease(value: object): void {
  leaseFields(value)
}

function validateBridgeRequest(value: object, kind: typeof BRIDGE_REQUEST_KINDS[number]): BridgeRequest {
  requestBase(value, true)
  switch (kind) {
    case 'control.lease.acquire': {
      bridgeKeys(value, kind)
      const surfaceKind = controlLeaseSurface(at(value, 'surfaceKind'))
      controlLeaseTargets(at(value, 'targets'), surfaceKind === 'native-application')
      controlLeaseCapabilities(at(value, 'capabilities'))
      break
    }
    case 'control.lease.release':
      bridgeKeys(value, kind); leaseFields(value)
      break
    case 'desktop.status': case 'browser.stop': case 'computer.status': case 'computer.list': case 'computer.stop':
      bridgeKeys(value, kind)
      break
    case 'browser.snapshot':
      bridgeKeys(value, kind)
      browserLease(value); booleanValue(at(value, 'includeImage'), 'includeImage')
      break
    case 'browser.navigate':
      bridgeKeys(value, kind)
      browserLease(value); stringValue(at(value, 'url'), 'url', PROTOCOL_LIMITS.urlBytes)
      break
    case 'browser.click':
      bridgeKeys(value, kind)
      browserLease(value); BrowserRef(stringValue(at(value, 'ref'), 'ref', PROTOCOL_LIMITS.identifierBytes))
      break
    case 'browser.type':
      bridgeKeys(value, kind)
      browserLease(value); BrowserRef(stringValue(at(value, 'ref'), 'ref', PROTOCOL_LIMITS.identifierBytes)); stringValue(at(value, 'text'), 'text', PROTOCOL_LIMITS.semanticTextBytes, true)
      break
    case 'browser.key':
      bridgeKeys(value, kind)
      browserLease(value); stringValue(at(value, 'key'), 'key', PROTOCOL_LIMITS.keyBytes); modifiers(at(value, 'modifiers'))
      break
    case 'browser.select':
      bridgeKeys(value, kind)
      browserLease(value); BrowserRef(stringValue(at(value, 'ref'), 'ref', PROTOCOL_LIMITS.identifierBytes)); stringValue(at(value, 'value'), 'value', PROTOCOL_LIMITS.selectValueBytes, true)
      break
    case 'browser.scroll':
      bridgeKeys(value, kind, ['ref'])
      browserLease(value)
      if (has(value, 'ref')) BrowserRef(stringValue(at(value, 'ref'), 'ref', PROTOCOL_LIMITS.identifierBytes))
      finiteNumber(at(value, 'deltaX'), 'deltaX', -PROTOCOL_LIMITS.maxCoordinate, PROTOCOL_LIMITS.maxCoordinate)
      finiteNumber(at(value, 'deltaY'), 'deltaY', -PROTOCOL_LIMITS.maxCoordinate, PROTOCOL_LIMITS.maxCoordinate)
      break
    case 'browser.wait': {
      bridgeKeys(value, kind, ['durationMs'])
      browserLease(value)
      const mode = literal<string>(at(value, 'mode'), new Set(['duration', 'navigation', 'loading-idle']), 'mode')
      if (mode === 'duration') safeInteger(at(value, 'durationMs'), 'durationMs', PROTOCOL_LIMITS.minWaitDurationMs, PROTOCOL_LIMITS.maxWaitDurationMs)
      else if (has(value, 'durationMs')) fail('durationMs is only valid for duration waits')
      break
    }
    case 'browser.back': case 'browser.forward': case 'browser.reload':
      bridgeKeys(value, kind); browserLease(value)
      break
    case 'computer.snapshot':
      bridgeKeys(value, kind)
      targetFields(value); booleanValue(at(value, 'includeImage'), 'includeImage')
      break
    case 'computer.focus':
      bridgeKeys(value, kind); targetFields(value)
      break
    case 'computer.click': case 'computer.double-click':
      bridgeKeys(value, kind, ['ref', 'x', 'y'])
      targetFields(value); pointerLocation(value); literal(at(value, 'button'), BUTTONS, 'button')
      break
    case 'computer.drag':
      bridgeKeys(value, kind)
      targetFields(value)
      for (const field of ['fromX', 'fromY', 'toX', 'toY']) {
        finiteNumber(at(value, field), field, PROTOCOL_LIMITS.minCoordinate, PROTOCOL_LIMITS.maxCoordinate)
      }
      literal(at(value, 'button'), BUTTONS, 'button')
      break
    case 'computer.type':
      bridgeKeys(value, kind)
      targetFields(value); ComputerRef(stringValue(at(value, 'ref'), 'ref', PROTOCOL_LIMITS.identifierBytes)); stringValue(at(value, 'text'), 'text', PROTOCOL_LIMITS.semanticTextBytes, true)
      break
    case 'computer.key':
      bridgeKeys(value, kind)
      targetFields(value); stringValue(at(value, 'key'), 'key', PROTOCOL_LIMITS.keyBytes); modifiers(at(value, 'modifiers'))
      break
    case 'computer.scroll':
      bridgeKeys(value, kind, ['ref', 'x', 'y'])
      targetFields(value); pointerLocation(value)
      finiteNumber(at(value, 'deltaX'), 'deltaX', -PROTOCOL_LIMITS.maxCoordinate, PROTOCOL_LIMITS.maxCoordinate)
      finiteNumber(at(value, 'deltaY'), 'deltaY', -PROTOCOL_LIMITS.maxCoordinate, PROTOCOL_LIMITS.maxCoordinate)
      break
    case 'computer.wait':
      bridgeKeys(value, kind)
      targetFields(value); safeInteger(at(value, 'durationMs'), 'durationMs', PROTOCOL_LIMITS.minWaitDurationMs, PROTOCOL_LIMITS.maxWaitDurationMs)
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
    for (const field of ['fromX', 'fromY', 'toX', 'toY']) {
      finiteNumber(at(value, field), field, PROTOCOL_LIMITS.minCoordinate, PROTOCOL_LIMITS.maxCoordinate)
    }
    literal(at(value, 'button'), BUTTONS, 'button')
  } else if (kind === 'type') {
    ComputerRef(stringValue(at(value, 'ref'), 'ref', PROTOCOL_LIMITS.identifierBytes)); stringValue(at(value, 'text'), 'text', PROTOCOL_LIMITS.semanticTextBytes, true)
  } else if (kind === 'key') {
    stringValue(at(value, 'key'), 'key', PROTOCOL_LIMITS.keyBytes); modifiers(at(value, 'modifiers'))
  } else if (kind === 'scroll') {
    pointerLocation(value)
    finiteNumber(at(value, 'deltaX'), 'deltaX', -PROTOCOL_LIMITS.maxCoordinate, PROTOCOL_LIMITS.maxCoordinate)
    finiteNumber(at(value, 'deltaY'), 'deltaY', -PROTOCOL_LIMITS.maxCoordinate, PROTOCOL_LIMITS.maxCoordinate)
  } else if (kind === 'wait') {
    safeInteger(at(value, 'durationMs'), 'durationMs', PROTOCOL_LIMITS.minWaitDurationMs, PROTOCOL_LIMITS.maxWaitDurationMs)
  }
}

function validateHelperRequest(value: object, kind: typeof HELPER_REQUEST_KINDS[number]): HelperRequest {
  requestBase(value, false)
  switch (kind) {
    case 'status': case 'list': helperKeys(value, kind); break
    case 'snapshot':
      helperKeys(value, kind); targetFields(value); booleanValue(at(value, 'includeImage'), 'includeImage'); break
    case 'focus': helperKeys(value, kind); targetFields(value); break
    case 'click': case 'double-click':
      helperKeys(value, kind, ['ref', 'x', 'y']); helperTargetAction(value, kind); break
    case 'drag':
      helperKeys(value, kind); helperTargetAction(value, kind); break
    case 'type':
      helperKeys(value, kind); helperTargetAction(value, kind); break
    case 'key':
      helperKeys(value, kind); helperTargetAction(value, kind); break
    case 'scroll':
      helperKeys(value, kind, ['ref', 'x', 'y']); helperTargetAction(value, kind); break
    case 'wait':
      helperKeys(value, kind); helperTargetAction(value, kind); break
    case 'stop': helperKeys(value, kind); leaseFields(value); break
    case 'lease.install': {
      helperKeys(value, kind)
      leaseFields(value); stringValue(at(value, 'agentId'), 'agentId', PROTOCOL_LIMITS.agentIdBytes)
      controlLeaseTargets(at(value, 'targets'), true)
      controlLeaseCapabilities(at(value, 'capabilities'))
      const quotas = asObject(at(value, 'quotas'), 'quotas')
      keys(quotas, CONTROL_LEASE_QUOTA_FIELDS)
      for (const field of CONTROL_LEASE_QUOTA_FIELDS) {
        safeInteger(at(quotas, field), field, PROTOCOL_LIMITS.minLeaseQuota, PROTOCOL_LIMITS.maxLeaseQuota)
      }
      safeInteger(at(value, 'idleExpiresAfterMs'), 'idleExpiresAfterMs', PROTOCOL_LIMITS.minLeaseDurationMs, PROTOCOL_LIMITS.maxIdleExpiresAfterMs)
      safeInteger(at(value, 'hardExpiresAfterMs'), 'hardExpiresAfterMs', PROTOCOL_LIMITS.minLeaseDurationMs, PROTOCOL_LIMITS.maxHardExpiresAfterMs)
      break
    }
    case 'input.release':
      helperKeys(value, kind)
      stringList(at(value, 'keys'), 'keys', PROTOCOL_LIMITS.maxStringListItems)
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
  const transferId = PngTransferId(stringValue(at(image, 'transferId'), 'transferId', PROTOCOL_LIMITS.identifierBytes))
  const byteLength = safeInteger(at(image, 'byteLength'), 'byteLength', PROTOCOL_LIMITS.minPngBytes, PROTOCOL_LIMITS.pngBytes)
  const sha256 = stringValue(at(image, 'sha256'), 'sha256', PROTOCOL_LIMITS.sha256Bytes)
  if (!SHA256.test(sha256)) fail('sha256 must be lower-case hexadecimal')
  const width = safeInteger(at(image, 'width'), 'width', PROTOCOL_LIMITS.minPngDimension, PROTOCOL_LIMITS.maxPngDimension)
  const height = safeInteger(at(image, 'height'), 'height', PROTOCOL_LIMITS.minPngDimension, PROTOCOL_LIMITS.maxPngDimension)
  return { transferId, byteLength, sha256, width, height }
}

function semanticRefs(value: unknown, browser: boolean): readonly (BrowserSemanticRef | ComputerSemanticRef)[] {
  if (!Array.isArray(value) || value.length > PROTOCOL_LIMITS.maxSemanticRefs) fail('refs must be a bounded array')
  return value.map((item, index) => {
    const ref = asObject(item, `refs[${index}]`)
    keys(ref, ['ref', 'role', 'name'])
    const raw = stringValue(at(ref, 'ref'), `refs[${index}].ref`, PROTOCOL_LIMITS.identifierBytes)
    const role = stringValue(at(ref, 'role'), `refs[${index}].role`, PROTOCOL_LIMITS.semanticRoleBytes)
    const name = stringValue(at(ref, 'name'), `refs[${index}].name`, PROTOCOL_LIMITS.semanticNameBytes, true)
    return browser
      ? { ref: BrowserRef(raw), role, name }
      : { ref: ComputerRef(raw), role, name }
  })
}

function semanticText(value: unknown): string {
  return stringValue(value, 'semanticText', PROTOCOL_LIMITS.semanticTextBytes, true)
}

function appsResult(value: unknown): readonly GrantableApplication[] {
  if (!Array.isArray(value) || value.length > PROTOCOL_LIMITS.maxGrantableApps) fail('apps must be a bounded array')
  return value.map((item, appIndex) => {
    const app = asObject(item, `apps[${appIndex}]`)
    keys(app, ['appId', 'name', 'windows'])
    const windows = at(app, 'windows')
    if (!Array.isArray(windows) || windows.length > PROTOCOL_LIMITS.maxGrantableWindowsPerApp) fail('windows must be a bounded array')
    return {
      appId: stringValue(at(app, 'appId'), 'appId', PROTOCOL_LIMITS.appIdBytes),
      name: stringValue(at(app, 'name'), 'name', PROTOCOL_LIMITS.appNameBytes),
      windows: windows.map((item, windowIndex) => {
        const window = asObject(item, `windows[${windowIndex}]`)
        keys(window, ['windowId', 'title'])
        return {
          windowId: stringValue(at(window, 'windowId'), 'windowId', PROTOCOL_LIMITS.windowIdBytes),
          title: stringValue(at(window, 'title'), 'title', PROTOCOL_LIMITS.windowTitleBytes, true),
        }
      }),
    }
  })
}

function actionResult(value: object, kind: keyof DesktopControlResultMap | keyof HelperResultMap): void {
  resultKeys(value, kind)
  if (at(value, 'acted') !== true) fail('acted must be true')
  safeInteger(at(value, 'snapshotRevision'), 'snapshotRevision', PROTOCOL_LIMITS.minRevision)
}

function waitResult(value: object, kind: keyof DesktopControlResultMap | keyof HelperResultMap): void {
  resultKeys(value, kind)
  if (at(value, 'waited') !== true) fail('waited must be true')
  safeInteger(at(value, 'snapshotRevision'), 'snapshotRevision', PROTOCOL_LIMITS.minRevision)
}

function statusResult(value: object, kind: keyof DesktopControlResultMap | keyof HelperResultMap): void {
  resultKeys(value, kind)
  literal(at(value, 'viewing'), PERMISSION_STATES, 'viewing')
  literal(at(value, 'assistive'), PERMISSION_STATES, 'assistive')
  booleanValue(at(value, 'supported'), 'supported')
}

function validateResult(value: unknown, kind: keyof DesktopControlResultMap | keyof HelperResultMap): void {
  const result = asObject(value, 'result')
  switch (kind) {
    case 'control.lease.acquire': {
      resultKeys(result, kind)
      leaseFields(result)
      const surfaceKind = controlLeaseSurface(at(result, 'surfaceKind'))
      controlLeaseTargets(at(result, 'targets'), surfaceKind === 'native-application')
      controlLeaseCapabilities(at(result, 'capabilities'))
      safeInteger(at(result, 'idleExpiresAfterMs'), 'idleExpiresAfterMs', PROTOCOL_LIMITS.minLeaseDurationMs, PROTOCOL_LIMITS.maxIdleExpiresAfterMs)
      safeInteger(at(result, 'hardExpiresAfterMs'), 'hardExpiresAfterMs', PROTOCOL_LIMITS.minLeaseDurationMs, PROTOCOL_LIMITS.maxHardExpiresAfterMs)
      break
    }
    case 'control.lease.release':
      resultKeys(result, kind); if (at(result, 'released') !== true) fail('released must be true'); break
    case 'desktop.status':
      resultKeys(result, kind)
      booleanValue(at(result, 'browserSupported'), 'browserSupported'); booleanValue(at(result, 'computerSupported'), 'computerSupported'); break
    case 'browser.snapshot':
      resultKeys(result, kind, ['image'])
      stringValue(at(result, 'surfaceId'), 'surfaceId', PROTOCOL_LIMITS.surfaceIdBytes); stringValue(at(result, 'url'), 'url', PROTOCOL_LIMITS.urlBytes); stringValue(at(result, 'title'), 'title', PROTOCOL_LIMITS.browserTitleBytes, true)
      safeInteger(at(result, 'snapshotRevision'), 'snapshotRevision', PROTOCOL_LIMITS.minRevision); semanticText(at(result, 'semanticText')); semanticRefs(at(result, 'refs'), true)
      if (has(result, 'image')) imageMetadata(at(result, 'image'))
      break
    case 'browser.navigate': case 'browser.back': case 'browser.forward': case 'browser.reload':
      resultKeys(result, kind); stringValue(at(result, 'url'), 'url', PROTOCOL_LIMITS.urlBytes); safeInteger(at(result, 'snapshotRevision'), 'snapshotRevision', PROTOCOL_LIMITS.minRevision); break
    case 'browser.click': case 'browser.type': case 'browser.key': case 'browser.select': case 'browser.scroll':
    case 'computer.focus': case 'computer.click': case 'computer.double-click': case 'computer.drag': case 'computer.type': case 'computer.key': case 'computer.scroll':
    case 'focus': case 'click': case 'double-click': case 'drag': case 'type': case 'key': case 'scroll': actionResult(result, kind); break
    case 'browser.wait': case 'computer.wait': case 'wait': waitResult(result, kind); break
    case 'browser.stop': case 'computer.stop': case 'stop':
      resultKeys(result, kind); if (at(result, 'stopped') !== true) fail('stopped must be true'); break
    case 'computer.status': case 'status': statusResult(result, kind); break
    case 'computer.list': case 'list': resultKeys(result, kind); appsResult(at(result, 'apps')); break
    case 'computer.snapshot': case 'snapshot':
      resultKeys(result, kind, ['image'])
      stringValue(at(result, 'appId'), 'appId', PROTOCOL_LIMITS.appIdBytes); stringValue(at(result, 'windowId'), 'windowId', PROTOCOL_LIMITS.windowIdBytes)
      safeInteger(at(result, 'snapshotRevision'), 'snapshotRevision', PROTOCOL_LIMITS.minRevision); semanticText(at(result, 'semanticText')); semanticRefs(at(result, 'refs'), false)
      if (has(result, 'image')) imageMetadata(at(result, 'image'))
      break
    case 'lease.install':
      resultKeys(result, kind); if (at(result, 'installed') !== true) fail('installed must be true'); safeInteger(at(result, 'leaseRevision'), 'leaseRevision', PROTOCOL_LIMITS.minRevision); break
    case 'input.release': resultKeys(result, kind); if (at(result, 'released') !== true) fail('released must be true'); break
    /* v8 ignore next -- the closed response roster rejects this before dispatch. */
    default: fail('result does not match requestKind')
  }
}

function validateResponse(value: object): DesktopControlOkResponse | DesktopControlErrorResponse | HelperOkResponse | HelperErrorResponse {
  if (at(value, 'protocolVersion') !== 1) fail('protocolVersion must be 1')
  if (at(value, 'messageKind') !== 'response') fail('messageKind must be response')
  RequestId(stringValue(at(value, 'requestId'), 'requestId', PROTOCOL_LIMITS.identifierBytes))
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
    controlKeys(value, kind)
    sessionId(at(value, 'sessionId')); RequestId(stringValue(at(value, 'requestId'), 'requestId', PROTOCOL_LIMITS.identifierBytes))
  } else if (kind === 'session.revoke') {
    controlKeys(value, kind); sessionId(at(value, 'sessionId'))
  } else if (kind === 'lease.revoke') {
    controlKeys(value, kind)
    sessionId(at(value, 'sessionId')); leaseFields(value)
  } else controlKeys(value, kind)
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
    while (true) {
      const code = this.source.charCodeAt(this.offset)
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return
      this.offset += 1
    }
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
  if (frame.byteLength < PROTOCOL_LIMITS.minJsonFrameBytes || frame[0] !== JSON_TAG) fail('JSON frame tag is invalid')
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
  safeInteger(nowUnixMs, 'nowUnixMs', PROTOCOL_LIMITS.minDeadlineUnixMs)
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
  if (bytes.byteLength < PROTOCOL_LIMITS.minPngStructureBytes || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) fail('PNG signature is invalid')
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') fail('PNG IHDR is missing')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width < PROTOCOL_LIMITS.minPngDimension || height < PROTOCOL_LIMITS.minPngDimension) fail('PNG dimensions are invalid')
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
  if (png.byteLength < PROTOCOL_LIMITS.minPngBytes || png.byteLength > PROTOCOL_LIMITS.pngBytes) fail('PNG exceeds the byte limit')
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
  if (frame.byteLength < PROTOCOL_LIMITS.minPngFrameBytes || frame[0] !== PNG_TAG) fail('PNG frame tag or body is invalid')
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

function frameLimit(frame: Uint8Array): number | undefined {
  if (frame.byteLength < PROTOCOL_LIMITS.minOuterFrameBytes) return undefined
  if (frame[0] === JSON_TAG) return PROTOCOL_LIMITS.jsonFrameBytes
  if (frame[0] === PNG_TAG) return PROTOCOL_LIMITS.pngFrameBytes
  return undefined
}

/**
 * Prefix one complete frame with its four-byte big-endian length.
 * @param frame - Complete validated-tag frame.
 * @returns a fresh length-prefixed frame.
 */
export function encodeLengthPrefixedFrame(frame: Uint8Array): Uint8Array {
  const limit = frameLimit(frame)
  if (limit === undefined || frame.byteLength > limit) fail('frame tag or length is invalid')
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
          if (length < PROTOCOL_LIMITS.minOuterFrameBytes || length > PROTOCOL_LIMITS.outerFrameBytes) fail('frame length prefix is invalid')
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
          if (limit === undefined || complete.byteLength > limit) fail('frame tag or length is invalid')
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
