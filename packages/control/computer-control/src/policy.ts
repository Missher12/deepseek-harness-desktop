import type {
  BridgeRequest,
  BridgeRequestKind,
} from '@deepseek-ai/dsh-desktop-control-protocol'

/** Closed policy outcomes consumed by Desktop adapters. */
export const CONTROL_POLICY_RESULTS = Object.freeze(['ALLOW', 'APPROVAL_REQUIRED', 'DENY'] as const)
/** One closed Desktop action-policy outcome. */
export type ControlPolicyResult = typeof CONTROL_POLICY_RESULTS[number]

/** Authoritative surface class; model and page content never choose this value. */
export type ControlSurfaceClass = 'browser-ephemeral' | 'browser-human-persistent' | 'native-application'

/**
 * Authoritative sensitivity class produced by an adapter from native/DOM semantics.
 * `unknown` is intentional: uncertain targets fail closed rather than becoming ordinary.
 */
export type ControlTargetSensitivity =
  | 'not-applicable'
  | 'ordinary'
  | 'secure-text'
  | 'password'
  | 'one-time-code'
  | 'payment'
  | 'file'
  | 'biometric'
  | 'password-manager'
  | 'keychain'
  | 'os-privacy'
  | 'os-security'
  | 'installation'
  | 'removal'
  | 'destructive-deletion'
  | 'download-execute'
  | 'unknown'

/** Authoritative expected effect of the selected target/action pair. */
export type ControlActionEffect = 'not-applicable' | 'read-only' | 'local-interaction' | 'external-side-effect' | 'unknown'

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

function surfaceMatches(kind: BridgeRequestKind, surface: ControlSurfaceClass): boolean {
  if (kind === 'desktop.status') return true
  if (kind.startsWith('browser.')) return surface !== 'native-application'
  return surface === 'native-application'
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
  const kind = input.request.requestKind
  if (!surfaceMatches(kind, input.surface)) return 'DENY'
  if (STOP_KINDS.has(kind)) return 'ALLOW'
  if (TARGETLESS_KINDS.has(kind)) {
    return input.sensitivity === 'not-applicable'
      && (input.effect === 'read-only' || input.effect === 'not-applicable')
      ? 'ALLOW'
      : 'DENY'
  }
  if (input.sensitivity !== 'ordinary'
    || input.effect === 'unknown'
    || input.effect === 'not-applicable') return 'DENY'
  if (input.effect === 'read-only') return READ_ONLY_KINDS.has(kind) ? 'ALLOW' : 'DENY'
  if (READ_ONLY_KINDS.has(kind)) return 'DENY'
  if (input.effect === 'external-side-effect') return 'APPROVAL_REQUIRED'
  if (input.surface === 'browser-human-persistent' && PERSISTENT_BROWSER_MUTATIONS.has(kind)) {
    return 'APPROVAL_REQUIRED'
  }
  return 'ALLOW'
}
