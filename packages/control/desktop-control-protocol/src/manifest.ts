import { createRequire } from 'node:module'
import {
  BRIDGE_REQUEST_KINDS,
  CONTROL_KINDS,
  ERROR_CODES,
  PROTOCOL_VERSION,
} from './bridge.ts'
import { HELPER_REQUEST_KINDS } from './helper.ts'

/** Fixed protocol size and duration limits. */
export const PROTOCOL_LIMITS = Object.freeze({
  semanticTextBytes: 49_152,
  jsonPayloadBytes: 65_536,
  jsonFrameBytes: 65_537,
  pngBytes: 4_194_304,
  pngFrameBytes: 4_194_321,
  outerFrameBytes: 4_194_321,
  errorMessageBytes: 512,
  sessionIdBytes: 128,
  maxDeadlineAheadMs: 30_000,
  minHelperTimeoutMs: 1,
  maxHelperTimeoutMs: 30_000,
} as const)

interface ProtocolManifest {
  readonly protocolVersion: number
  readonly limits: object
  readonly bridgeRequestKinds: readonly unknown[]
  readonly helperRequestKinds: readonly unknown[]
  readonly controlKinds: readonly unknown[]
  readonly errorCodes: readonly unknown[]
  readonly bridgeRequestFields: object
  readonly helperRequestFields: object
  readonly controlFields: object
  readonly resultFields: object
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
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`)
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`)
  return Object.freeze([...value])
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

function parseManifest(value: unknown): ProtocolManifest {
  const root = objectValue(value, 'protocol manifest')
  const expectedRoot = [
    'protocolVersion', 'limits', 'bridgeRequestKinds', 'helperRequestKinds',
    'controlKinds', 'errorCodes', 'bridgeRequestFields', 'helperRequestFields',
    'controlFields', 'resultFields',
  ]
  exactObjectKeys(root, expectedRoot, 'protocol manifest')
  const manifest: ProtocolManifest = {
    protocolVersion: own(root, 'protocolVersion') as number,
    limits: copiedObject(own(root, 'limits'), 'limits'),
    bridgeRequestKinds: stringArray(own(root, 'bridgeRequestKinds'), 'bridgeRequestKinds'),
    helperRequestKinds: stringArray(own(root, 'helperRequestKinds'), 'helperRequestKinds'),
    controlKinds: stringArray(own(root, 'controlKinds'), 'controlKinds'),
    errorCodes: stringArray(own(root, 'errorCodes'), 'errorCodes'),
    bridgeRequestFields: fieldSection(own(root, 'bridgeRequestFields'), 'bridgeRequestFields'),
    helperRequestFields: fieldSection(own(root, 'helperRequestFields'), 'helperRequestFields'),
    controlFields: fieldSection(own(root, 'controlFields'), 'controlFields'),
    resultFields: fieldSection(own(root, 'resultFields'), 'resultFields'),
  }
  return Object.freeze(manifest)
}

function assertParsedManifest(manifest: ProtocolManifest): void {
  if (manifest.protocolVersion !== PROTOCOL_VERSION) throw new Error('protocol version mismatch')
  if (!same(manifest.bridgeRequestKinds as readonly string[], BRIDGE_REQUEST_KINDS)) throw new Error('bridge roster mismatch')
  if (!same(manifest.helperRequestKinds as readonly string[], HELPER_REQUEST_KINDS)) throw new Error('helper roster mismatch')
  if (!same(manifest.controlKinds as readonly string[], CONTROL_KINDS)) throw new Error('control roster mismatch')
  if (!same(manifest.errorCodes as readonly string[], ERROR_CODES)) throw new Error('error roster mismatch')
  exactObjectKeys(manifest.limits, Object.keys(PROTOCOL_LIMITS), 'limits')
  for (const [key, limit] of Object.entries(PROTOCOL_LIMITS)) {
    if (own(manifest.limits, key) !== limit) throw new Error(`limit mismatch for ${key}`)
  }
  exactObjectKeys(manifest.bridgeRequestFields, BRIDGE_REQUEST_KINDS, 'bridge request fields')
  exactObjectKeys(manifest.helperRequestFields, HELPER_REQUEST_KINDS, 'helper request fields')
  exactObjectKeys(manifest.controlFields, CONTROL_KINDS, 'control fields')
  exactObjectKeys(manifest.resultFields, [...BRIDGE_REQUEST_KINDS, ...HELPER_REQUEST_KINDS], 'result fields')
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

/** Assert that TypeScript rosters and limits match the machine-readable v1 manifest. */
export function assertProtocolManifest(): void {
  assertParsedManifest(PROTOCOL_MANIFEST)
}

assertProtocolManifest()
