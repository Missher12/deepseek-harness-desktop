import type {
  BridgeRequest,
  BridgeRequestKind,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import { BRIDGE_REQUEST_KINDS } from '@deepseek-ai/dsh-desktop-control-protocol'

/** Closed policy outcomes consumed by Desktop adapters. */
export const CONTROL_POLICY_RESULTS = Object.freeze(['ALLOW', 'APPROVAL_REQUIRED', 'DENY'] as const)
/** One closed Desktop action-policy outcome. */
export type ControlPolicyResult = typeof CONTROL_POLICY_RESULTS[number]

const CONTROL_SURFACE_CLASSES = Object.freeze([
  'browser-ephemeral', 'browser-human-persistent', 'native-application',
] as const)

/** Authoritative surface class; model and page content never choose this value. */
export type ControlSurfaceClass = typeof CONTROL_SURFACE_CLASSES[number]

/**
 * Authoritative sensitivity class produced by an adapter from native/DOM semantics.
 * `unknown` is intentional: uncertain targets fail closed rather than becoming ordinary.
 */
const CONTROL_TARGET_SENSITIVITIES = Object.freeze([
  'not-applicable', 'ordinary', 'secure-text', 'password', 'one-time-code',
  'payment', 'file', 'biometric', 'password-manager', 'keychain', 'os-privacy',
  'os-security', 'installation', 'removal', 'destructive-deletion',
  'download-execute', 'unknown',
] as const)

/** One closed adapter-owned target-sensitivity classification. */
export type ControlTargetSensitivity = typeof CONTROL_TARGET_SENSITIVITIES[number]

/** Authoritative expected effect of the selected target/action pair. */
const CONTROL_ACTION_EFFECTS = Object.freeze([
  'not-applicable', 'read-only', 'local-interaction', 'external-side-effect', 'unknown',
] as const)

/** One closed adapter-owned action-effect classification. */
export type ControlActionEffect = typeof CONTROL_ACTION_EFFECTS[number]

/** Inputs to the pure control policy classifier. */
export interface ControlPolicyInput {
  /** Exact protocol request already accepted by the strict decoder. */
  readonly request: BridgeRequest
  /** Electron/helper-owned surface classification. */
  readonly surface: ControlSurfaceClass
  /** Adapter-owned target sensitivity; page/model assertions are untrusted. */
  readonly sensitivity: ControlTargetSensitivity
  /** Adapter-owned effect classification; uncertainty is explicit. */
  readonly effect: ControlActionEffect
}

const READ_ONLY_KINDS = new Set<BridgeRequestKind>([
  'desktop.status', 'browser.snapshot', 'browser.wait',
  'computer.status', 'computer.list', 'computer.snapshot', 'computer.wait',
])

const STOP_KINDS = new Set<BridgeRequestKind>(['browser.stop', 'computer.stop'])

const TARGETLESS_KINDS = new Set<BridgeRequestKind>([
  'desktop.status', 'computer.status', 'computer.list',
])

const PERSISTENT_BROWSER_MUTATIONS = new Set<BridgeRequestKind>([
  'browser.navigate', 'browser.click', 'browser.type', 'browser.key',
  'browser.select', 'browser.scroll', 'browser.back', 'browser.forward',
  'browser.reload',
])

const BRIDGE_REQUEST_KIND_SET: ReadonlySet<string> = new Set(BRIDGE_REQUEST_KINDS)
const CONTROL_SURFACE_CLASS_SET: ReadonlySet<string> = new Set(CONTROL_SURFACE_CLASSES)
const CONTROL_TARGET_SENSITIVITY_SET: ReadonlySet<string> = new Set(CONTROL_TARGET_SENSITIVITIES)
const CONTROL_ACTION_EFFECT_SET: ReadonlySet<string> = new Set(CONTROL_ACTION_EFFECTS)

function surfaceMatches(kind: BridgeRequestKind, surface: ControlSurfaceClass): boolean {
  switch (kind) {
    case 'desktop.status':
      return true
    case 'browser.snapshot':
    case 'browser.navigate':
    case 'browser.click':
    case 'browser.type':
    case 'browser.key':
    case 'browser.select':
    case 'browser.scroll':
    case 'browser.wait':
    case 'browser.back':
    case 'browser.forward':
    case 'browser.reload':
    case 'browser.stop':
      return surface === 'browser-ephemeral' || surface === 'browser-human-persistent'
    case 'computer.status':
    case 'computer.list':
    case 'computer.snapshot':
    case 'computer.focus':
    case 'computer.click':
    case 'computer.double-click':
    case 'computer.drag':
    case 'computer.type':
    case 'computer.key':
    case 'computer.scroll':
    case 'computer.wait':
    case 'computer.stop':
      return surface === 'native-application'
  }
}

interface RuntimePolicyFacts {
  readonly kind: BridgeRequestKind
  readonly surface: ControlSurfaceClass
  readonly sensitivity: ControlTargetSensitivity
  readonly effect: ControlActionEffect
}

function isPlainObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function runtimeFacts(input: unknown): RuntimePolicyFacts | null {
  if (!isPlainObject(input)) return null
  const request = ownData(input, 'request')
  const surface = ownData(input, 'surface')
  const sensitivity = ownData(input, 'sensitivity')
  const effect = ownData(input, 'effect')
  if (!isPlainObject(request)) return null
  const kind = ownData(request, 'requestKind')
  if (typeof kind !== 'string' || !BRIDGE_REQUEST_KIND_SET.has(kind)) return null
  if (typeof surface !== 'string' || !CONTROL_SURFACE_CLASS_SET.has(surface)) return null
  if (typeof sensitivity !== 'string' || !CONTROL_TARGET_SENSITIVITY_SET.has(sensitivity)) return null
  if (typeof effect !== 'string' || !CONTROL_ACTION_EFFECT_SET.has(effect)) return null
  return {
    kind: kind as BridgeRequestKind,
    surface: surface as ControlSurfaceClass,
    sensitivity: sensitivity as ControlTargetSensitivity,
    effect: effect as ControlActionEffect,
  }
}

/**
 * Classify one strict protocol request without trusting page/model claims.
 * Known sensitive classes and every uncertain classification are denied. Ordinary reads are allowed;
 * external side effects and mutations of a persistent human browser require a separate native approval.
 * Accessibility semantics cannot prove that hostile page code lacks side effects, so adapters must use
 * `unknown` whenever their own evidence is insufficient.
 * @param input - Strict request plus authoritative adapter classifications.
 * @returns one of the three closed policy outcomes.
 */
export function classifyControlPolicy(input: ControlPolicyInput): ControlPolicyResult {
  try {
    const facts = runtimeFacts(input)
    if (facts === null || !surfaceMatches(facts.kind, facts.surface)) return 'DENY'
    if (STOP_KINDS.has(facts.kind)) return 'ALLOW'
    if (TARGETLESS_KINDS.has(facts.kind)) {
      return facts.sensitivity === 'not-applicable'
        && (facts.effect === 'read-only' || facts.effect === 'not-applicable')
        ? 'ALLOW'
        : 'DENY'
    }
    if (facts.sensitivity !== 'ordinary'
      || facts.effect === 'unknown'
      || facts.effect === 'not-applicable') return 'DENY'
    if (facts.effect === 'read-only') return READ_ONLY_KINDS.has(facts.kind) ? 'ALLOW' : 'DENY'
    if (READ_ONLY_KINDS.has(facts.kind)) return 'DENY'
    if (facts.effect === 'external-side-effect') return 'APPROVAL_REQUIRED'
    if (facts.surface === 'browser-human-persistent' && PERSISTENT_BROWSER_MUTATIONS.has(facts.kind)) {
      return 'APPROVAL_REQUIRED'
    }
    return 'ALLOW'
  } catch {
    return 'DENY'
  }
}
