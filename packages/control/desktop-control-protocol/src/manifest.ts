import { createRequire } from 'node:module'
import {
  BRIDGE_REQUEST_KINDS,
  CONTROL_LEASE_CAPABILITIES,
  CONTROL_LEASE_SURFACE_KINDS,
  CONTROL_KINDS,
  ERROR_CODES,
  PROTOCOL_VERSION,
} from './bridge.ts'
import {
  BRIDGE_REQUEST_FIELDS,
  CONTROL_FIELDS,
  CONTROL_LEASE_QUOTA_FIELDS,
  CONTROL_LEASE_TARGET_FIELDS,
  HELPER_REQUEST_FIELDS,
  RESULT_FIELDS,
} from './fields.ts'
import { HELPER_REQUEST_KINDS } from './helper.ts'

const LIMIT_NAMES = Object.freeze([
  'semanticTextBytes', 'jsonPayloadBytes', 'jsonFrameBytes', 'pngBytes',
  'pngFrameBytes', 'outerFrameBytes', 'errorMessageBytes', 'sessionIdBytes',
  'identifierBytes', 'sha256Bytes', 'appIdBytes', 'windowIdBytes', 'agentIdBytes', 'urlBytes',
  'keyBytes', 'selectValueBytes', 'semanticRoleBytes', 'semanticNameBytes',
  'appNameBytes', 'windowTitleBytes', 'browserTitleBytes', 'surfaceIdBytes',
  'stringListItemBytes', 'minNonEmptyStringBytes', 'minSafeInteger', 'maxSafeInteger', 'minRevision',
  'minCoordinate', 'minDeadlineUnixMs', 'minWaitDurationMs', 'minLeaseQuota',
  'minLeaseDurationMs', 'minPngBytes', 'minPngDimension', 'minOuterFrameBytes',
  'minJsonFrameBytes', 'minPngFrameBytes', 'minPngStructureBytes',
  'maxStringListItems', 'maxModifiers', 'maxCoordinate',
  'maxWaitDurationMs', 'maxLeaseCapabilities', 'maxLeaseQuota',
  'maxIdleExpiresAfterMs', 'maxHardExpiresAfterMs', 'maxPngDimension',
  'maxSemanticRefs', 'maxGrantableApps', 'maxGrantableWindowsPerApp',
  'maxDeadlineAheadMs', 'minHelperTimeoutMs', 'maxHelperTimeoutMs',
] as const)

interface ProtocolLimits {
  readonly semanticTextBytes: number
  readonly jsonPayloadBytes: number
  readonly jsonFrameBytes: number
  readonly pngBytes: number
  readonly pngFrameBytes: number
  readonly outerFrameBytes: number
  readonly errorMessageBytes: number
  readonly sessionIdBytes: number
  readonly identifierBytes: number
  readonly sha256Bytes: number
  readonly appIdBytes: number
  readonly windowIdBytes: number
  readonly agentIdBytes: number
  readonly urlBytes: number
  readonly keyBytes: number
  readonly selectValueBytes: number
  readonly semanticRoleBytes: number
  readonly semanticNameBytes: number
  readonly appNameBytes: number
  readonly windowTitleBytes: number
  readonly browserTitleBytes: number
  readonly surfaceIdBytes: number
  readonly stringListItemBytes: number
  readonly minNonEmptyStringBytes: number
  readonly minSafeInteger: number
  readonly maxSafeInteger: number
  readonly minRevision: number
  readonly minCoordinate: number
  readonly minDeadlineUnixMs: number
  readonly minWaitDurationMs: number
  readonly minLeaseQuota: number
  readonly minLeaseDurationMs: number
  readonly minPngBytes: number
  readonly minPngDimension: number
  readonly minOuterFrameBytes: number
  readonly minJsonFrameBytes: number
  readonly minPngFrameBytes: number
  readonly minPngStructureBytes: number
  readonly maxStringListItems: number
  readonly maxModifiers: number
  readonly maxCoordinate: number
  readonly maxWaitDurationMs: number
  readonly maxLeaseCapabilities: number
  readonly maxLeaseQuota: number
  readonly maxIdleExpiresAfterMs: number
  readonly maxHardExpiresAfterMs: number
  readonly maxPngDimension: number
  readonly maxSemanticRefs: number
  readonly maxGrantableApps: number
  readonly maxGrantableWindowsPerApp: number
  readonly maxDeadlineAheadMs: number
  readonly minHelperTimeoutMs: number
  readonly maxHelperTimeoutMs: number
}

interface ProtocolManifest {
  readonly protocolVersion: number
  readonly limits: ProtocolLimits
  readonly bridgeRequestKinds: readonly unknown[]
  readonly controlLeaseSurfaceKinds: readonly unknown[]
  readonly controlLeaseCapabilities: readonly unknown[]
  readonly controlLeaseTargetFields: readonly unknown[]
  readonly controlLeaseQuotaFields: readonly unknown[]
  readonly helperRequestKinds: readonly unknown[]
  readonly controlKinds: readonly unknown[]
  readonly errorCodes: readonly unknown[]
  readonly bridgeRequestFields: typeof BRIDGE_REQUEST_FIELDS
  readonly helperRequestFields: typeof HELPER_REQUEST_FIELDS
  readonly controlFields: typeof CONTROL_FIELDS
  readonly resultFields: typeof RESULT_FIELDS
}

const require = createRequire(import.meta.url)
const loaded: unknown = require('../protocol-v1.json')

function objectValue(value: unknown, label: string): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function own(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array`)
  const result: string[] = []
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'string') throw new Error(`${label} must be a string array`)
    result.push(item)
  }
  if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`)
  return Object.freeze(result)
}

function copiedObject(value: unknown, label: string): object {
  const source = objectValue(value, label)
  const result = {}
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(`${label} contains a dangerous key`)
    }
    Object.defineProperty(result, key, {
      value: own(source, key),
      enumerable: true,
      configurable: false,
      writable: false,
    })
  }
  return Object.freeze(result)
}

function limitsValue(value: unknown): ProtocolLimits {
  const limits = copiedObject(value, 'limits')
  exactObjectKeys(limits, LIMIT_NAMES, 'limits')
  for (const key of LIMIT_NAMES) {
    const limit = own(limits, key)
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || Object.is(limit, -0) || limit < 0) {
      throw new Error(`limit ${key} must be a non-negative safe integer`)
    }
  }
  return limits as ProtocolLimits
}

function fieldSection(value: unknown, label: string): object {
  const source = objectValue(value, label)
  const result = {}
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(`${label} contains a dangerous key`)
    }
    Object.defineProperty(result, key, {
      value: stringArray(own(source, key), `${label}.${key}`),
      enumerable: true,
      configurable: false,
      writable: false,
    })
  }
  return Object.freeze(result)
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function exactObjectKeys(value: object, expected: readonly string[], label: string): void {
  const keys = Object.keys(value).sort()
  const sorted = [...expected].sort()
  if (!same(keys, sorted)) throw new Error(`${label} keys do not match the request roster`)
}

function exactFieldMatrix(actual: object, expected: object, label: string): void {
  exactObjectKeys(actual, Object.keys(expected), label)
  for (const key of Object.keys(expected)) {
    const actualFields = own(actual, key)
    const expectedFields = own(expected, key)
    if (!Array.isArray(actualFields) || !Array.isArray(expectedFields) || !same(actualFields, expectedFields)) {
      throw new Error(`${label} field matrix mismatch for ${key}`)
    }
  }
}

function parseManifest(value: unknown): ProtocolManifest {
  const root = objectValue(value, 'protocol manifest')
  const expectedRoot = [
    'protocolVersion', 'limits', 'bridgeRequestKinds', 'helperRequestKinds',
    'controlLeaseSurfaceKinds', 'controlLeaseCapabilities', 'controlKinds',
    'controlLeaseTargetFields', 'controlLeaseQuotaFields', 'errorCodes',
    'bridgeRequestFields', 'helperRequestFields',
    'controlFields', 'resultFields',
  ]
  exactObjectKeys(root, expectedRoot, 'protocol manifest')
  const manifest: ProtocolManifest = {
    protocolVersion: own(root, 'protocolVersion') as number,
    limits: limitsValue(own(root, 'limits')),
    bridgeRequestKinds: stringArray(own(root, 'bridgeRequestKinds'), 'bridgeRequestKinds'),
    controlLeaseSurfaceKinds: stringArray(own(root, 'controlLeaseSurfaceKinds'), 'controlLeaseSurfaceKinds'),
    controlLeaseCapabilities: stringArray(own(root, 'controlLeaseCapabilities'), 'controlLeaseCapabilities'),
    controlLeaseTargetFields: stringArray(own(root, 'controlLeaseTargetFields'), 'controlLeaseTargetFields'),
    controlLeaseQuotaFields: stringArray(own(root, 'controlLeaseQuotaFields'), 'controlLeaseQuotaFields'),
    helperRequestKinds: stringArray(own(root, 'helperRequestKinds'), 'helperRequestKinds'),
    controlKinds: stringArray(own(root, 'controlKinds'), 'controlKinds'),
    errorCodes: stringArray(own(root, 'errorCodes'), 'errorCodes'),
    bridgeRequestFields: fieldSection(
      own(root, 'bridgeRequestFields'),
      'bridgeRequestFields',
    ) as typeof BRIDGE_REQUEST_FIELDS,
    helperRequestFields: fieldSection(
      own(root, 'helperRequestFields'),
      'helperRequestFields',
    ) as typeof HELPER_REQUEST_FIELDS,
    controlFields: fieldSection(own(root, 'controlFields'), 'controlFields') as typeof CONTROL_FIELDS,
    resultFields: fieldSection(own(root, 'resultFields'), 'resultFields') as typeof RESULT_FIELDS,
  }
  return Object.freeze(manifest)
}

function assertParsedManifest(manifest: ProtocolManifest): void {
  if (manifest.protocolVersion !== PROTOCOL_VERSION) throw new Error('protocol version mismatch')
  if (!same(manifest.bridgeRequestKinds as readonly string[], BRIDGE_REQUEST_KINDS)) throw new Error('bridge roster mismatch')
  if (!same(manifest.controlLeaseSurfaceKinds as readonly string[], CONTROL_LEASE_SURFACE_KINDS)) throw new Error('lease surface roster mismatch')
  if (!same(manifest.controlLeaseCapabilities as readonly string[], CONTROL_LEASE_CAPABILITIES)) throw new Error('lease capability roster mismatch')
  if (!same(manifest.controlLeaseTargetFields as readonly string[], CONTROL_LEASE_TARGET_FIELDS)) throw new Error('lease target field mismatch')
  if (!same(manifest.controlLeaseQuotaFields as readonly string[], CONTROL_LEASE_QUOTA_FIELDS)) throw new Error('lease quota field mismatch')
  if (!same(manifest.helperRequestKinds as readonly string[], HELPER_REQUEST_KINDS)) throw new Error('helper roster mismatch')
  if (!same(manifest.controlKinds as readonly string[], CONTROL_KINDS)) throw new Error('control roster mismatch')
  if (!same(manifest.errorCodes as readonly string[], ERROR_CODES)) throw new Error('error roster mismatch')
  exactObjectKeys(manifest.limits, LIMIT_NAMES, 'limits')
  for (const [key, limit] of Object.entries(PROTOCOL_LIMITS)) {
    if (own(manifest.limits, key) !== limit) throw new Error(`limit mismatch for ${key}`)
  }
  exactFieldMatrix(manifest.bridgeRequestFields, BRIDGE_REQUEST_FIELDS, 'bridge request fields')
  exactFieldMatrix(manifest.helperRequestFields, HELPER_REQUEST_FIELDS, 'helper request fields')
  exactFieldMatrix(manifest.controlFields, CONTROL_FIELDS, 'control fields')
  exactFieldMatrix(manifest.resultFields, RESULT_FIELDS, 'result fields')
}

/**
 * Validate a candidate v1 manifest without changing the active manifest.
 * @param value - Candidate machine-readable value.
 */
export function validateProtocolManifest(value: unknown): void {
  assertParsedManifest(parseManifest(value))
}

/** Parsed machine-readable v1 manifest. */
export const PROTOCOL_MANIFEST = parseManifest(loaded)

/** Fixed wire acceptance limits read from the machine-readable manifest. */
export const PROTOCOL_LIMITS: ProtocolLimits = PROTOCOL_MANIFEST.limits

/** Assert that TypeScript rosters and limits match the machine-readable v1 manifest. */
export function assertProtocolManifest(): void {
  assertParsedManifest(PROTOCOL_MANIFEST)
}

assertProtocolManifest()
