import type {
  BridgeRequest,
  ControlLeaseCapability,
  ControlLeaseSurfaceKind,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type {
  ControlActionEffect,
  ControlPolicyResult,
  ControlTargetSensitivity,
} from '@deepseek-ai/dsh-computer-control'
import { classifyControlPolicy } from '@deepseek-ai/dsh-computer-control'

export interface AdapterPolicyFacts {
  readonly sensitivity: ControlTargetSensitivity
  readonly effect: ControlActionEffect
}

export interface UnscopedControlRequestRule {
  readonly leaseScoped: false
}

export interface ScopedControlRequestRule {
  readonly leaseScoped: true
  readonly capability: ControlLeaseCapability
  readonly quota?: 'snapshots' | 'pointerActions' | 'keyActions' | 'textBytes'
  readonly amount?: number
}

export type ControlRequestRule = UnscopedControlRequestRule | ScopedControlRequestRule

const SENSITIVITIES: ReadonlySet<string> = new Set([
  'not-applicable', 'ordinary', 'secure-text', 'password', 'one-time-code',
  'payment', 'file', 'biometric', 'password-manager', 'keychain', 'os-privacy',
  'os-security', 'installation', 'removal', 'destructive-deletion',
  'download-execute', 'unknown',
])
const EFFECTS: ReadonlySet<string> = new Set([
  'not-applicable', 'read-only', 'local-interaction', 'external-side-effect', 'unknown',
])

const UNSCOPED = Object.freeze({ leaseScoped: false } as const)

function scoped(
  capability: ControlLeaseCapability,
  quota?: ScopedControlRequestRule['quota'],
  amount?: number,
): ScopedControlRequestRule {
  if (quota === undefined) return Object.freeze({ leaseScoped: true, capability })
  if (amount === undefined) throw new TypeError('a category quota requires an amount')
  return Object.freeze({ leaseScoped: true, capability, quota, amount })
}

export function adapterPolicyFacts(
  sensitivity: ControlTargetSensitivity,
  effect: ControlActionEffect,
): AdapterPolicyFacts {
  if (arguments.length !== 2
    || typeof sensitivity !== 'string' || !SENSITIVITIES.has(sensitivity)
    || typeof effect !== 'string' || !EFFECTS.has(effect)) {
    throw new TypeError('adapter policy facts must use the closed sensitivity/effect vocabulary')
  }
  return Object.freeze({ sensitivity, effect })
}

export function controlRequestRule(request: BridgeRequest): ControlRequestRule {
  switch (request.requestKind) {
    case 'control.lease.acquire':
    case 'control.lease.release':
    case 'desktop.status':
    case 'browser.stop':
    case 'computer.status':
    case 'computer.list':
    case 'computer.stop':
      return UNSCOPED
    case 'browser.snapshot':
    case 'computer.snapshot':
      return scoped('observe', 'snapshots', 1)
    case 'browser.wait':
    case 'computer.wait':
      return scoped('observe')
    case 'browser.type':
    case 'computer.type':
      return scoped('keyboard', 'textBytes', Buffer.byteLength(
        request.text, 'utf8',
      ))
    case 'browser.key':
    case 'computer.key':
      return scoped('keyboard', 'keyActions', 1)
    case 'browser.navigate':
    case 'browser.click':
    case 'browser.select':
    case 'browser.scroll':
    case 'browser.back':
    case 'browser.forward':
    case 'browser.reload':
    case 'computer.focus':
    case 'computer.click':
    case 'computer.double-click':
    case 'computer.drag':
    case 'computer.scroll':
      return scoped('pointer', 'pointerActions', 1)
    default: {
      const exhaustive: never = request
      throw new TypeError(`unsupported control request: ${String(exhaustive)}`)
    }
  }
}

export function classifyAuthorityRequest(
  request: BridgeRequest,
  surface: ControlLeaseSurfaceKind,
  facts: AdapterPolicyFacts,
): ControlPolicyResult {
  return classifyControlPolicy({
    request,
    surface,
    sensitivity: facts.sensitivity,
    effect: facts.effect,
  })
}
