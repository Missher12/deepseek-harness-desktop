/** Native-owned Bundle choices and attributable pause records; package and data paths are references only. */
import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const STATE_FILENAME = 'plugin-state.json'
const MAX_STATE_BYTES = 1_048_576
const MAX_ENTRIES = 512
const MAX_EVIDENCE = 64
const PROTECTED_BUNDLES = new Set([
  '@deepseek-ai/dsh', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-desktop', '@deepseek-ai/dsh-desktop-host',
  '@deepseek-ai/dsh-client-ui-desktop-shell', '@deepseek-ai/dsh-client-ui-settings-system-update',
])
const REASONS = {
  incompatible: 'The installed Bundle is incompatible with the target host.',
  'invalid-manifest': 'The Bundle manifest failed validation.',
  'invalid-yaml': 'The Bundle patch failed YAML validation.',
  'missing-required-dependency': 'An explicitly verified required Bundle is unavailable.',
} as const

/** Diagnosis classes a native loader can attribute to a specific Bundle. */
export type PluginDiagnosisCode = keyof typeof REASONS
/** User preferences remain independent of compatibility and validation outcomes. */
export type PluginHealth = 'unverified' | 'healthy' | 'suspected' | 'paused'
/** Bounded confirmation history; each identifier is a SHA-256 digest of a distinct native observation. */
export interface PluginDiagnosis {
  readonly code: PluginDiagnosisCode
  readonly observedVersion: string
  readonly targetHostVersion: string
  readonly summary: string
  readonly confirmations: number
  readonly evidenceIds: readonly string[]
}
/** Native discovery records these pointers without reading, modifying, or deleting their targets. */
export interface PluginSource {
  readonly profileName: string
  readonly codePath: string
  readonly dataPaths: readonly string[]
}
/** One discovered Bundle and relations verified by the native composition owner, never inferred here. */
export interface ObservedBundle {
  readonly name: string
  readonly observedVersion: string
  readonly targetHostVersion: string
  readonly userEnabled: boolean
  readonly source: PluginSource
  readonly order: number
  readonly requiredBundleNames: readonly string[]
  readonly requiredRelationsVerified: true
}
/** Persisted identity, preference, and health of one Bundle. */
export interface PluginStateEntry extends Omit<ObservedBundle, 'requiredRelationsVerified'> {
  readonly health: PluginHealth
  readonly diagnosis?: PluginDiagnosis
  readonly pauseReason?: PluginDiagnosis
}
/** Explicit native policy; at most 64 distinct evidence digests are retained per diagnosis. */
export interface PluginStatePolicy {
  readonly failureConfirmations: number
}
/** One atomic revision of the native compatibility document. */
export interface PluginStateSnapshot {
  readonly schemaVersion: 1
  readonly revision: number
  readonly policy: PluginStatePolicy
  readonly entries: readonly PluginStateEntry[]
}
/** A native diagnosis names its exact observed identity and a digest, never raw exceptions or config. */
export interface PluginDiagnosisInput {
  readonly name: string
  readonly observedVersion: string
  readonly targetHostVersion: string
  readonly code: PluginDiagnosisCode
  readonly evidenceId: string
}
/** Safe machine-readable failure codes for native callers. */
export type PluginStateErrorCode = 'invalid-state' | 'unsafe-path' | 'revision-conflict' | 'identity-conflict'
  | 'policy-conflict' | 'protected-bundle' | 'unknown-bundle' | 'unattributable-diagnosis'
  | 'invalid-evidence' | 'unverified-relations' | 'untrusted-receipt' | 'validation-failed'
/** Messages are owned summaries and never incorporate supplied diagnostics or stored content. */
export class PluginStateError extends Error {
  /** @param code Machine-readable native failure. @param message Safe caller-facing summary. */
  constructor(readonly code: PluginStateErrorCode, message: string) {
    super(message)
    this.name = 'PluginStateError'
  }
}
declare const receiptBrand: unique symbol
/** Opaque process-local validation authority; a JSON copy is not a receipt. */
export interface PluginRestoreReceipt { readonly [receiptBrand]: true }
/** State paths and policy are supplied by the native owner, never a renderer. */
export interface PluginStateStoreOptions {
  readonly directory: string
  readonly policy: PluginStatePolicy
}
/** Why a requested Bundle is not included in the effective launch list. */
export interface ExcludedBundle {
  readonly name: string
  readonly reason: 'user-disabled' | 'paused' | 'required-bundle-unavailable'
  readonly requiredBundleNames: readonly string[]
}
/** Ordered launch selection; this module does not parse profiles or load plugins. */
export interface EffectiveBundles {
  readonly active: readonly string[]
  readonly excluded: readonly ExcludedBundle[]
}
interface ReceiptRecord { revision: number; entry: PluginStateEntry }

function fail(code: PluginStateErrorCode, message: string): never { throw new PluginStateError(code, message) }
function invalid(): never { return fail('invalid-state', 'Invalid native plugin state document.') }
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !allowed.includes(key))) return invalid()
  return record
}
function count(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) return invalid()
  return value
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)) return invalid()
  return value
}
function version(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/.test(value)) return invalid()
  return value
}
function pointer(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value) || !isAbsolute(value)) return invalid()
  return value
}
function array<T>(value: unknown, item: (value: unknown) => T, maximum: number): T[] {
  if (!Array.isArray(value) || value.length > maximum) return invalid()
  return value.map(item)
}
function names(value: unknown): string[] {
  const result = array(value, identifier, MAX_ENTRIES)
  if (new Set(result).size !== result.length) return invalid()
  return result
}
function policy(value: unknown): PluginStatePolicy {
  const item = object(value, ['failureConfirmations'])
  return { failureConfirmations: count(item.failureConfirmations, 1, MAX_EVIDENCE) }
}
function source(value: unknown): PluginSource {
  const item = object(value, ['profileName', 'codePath', 'dataPaths'])
  const profileName = version(item.profileName)
  if (profileName === '.' || profileName === '..') return invalid()
  return { profileName, codePath: pointer(item.codePath), dataPaths: array(item.dataPaths, pointer, 32) }
}
function evidenceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    return fail('invalid-evidence', 'Invalid evidence identifier; a SHA-256 digest is required.')
  }
  return value
}
function diagnosis(value: unknown): PluginDiagnosis {
  const item = object(value, ['code', 'observedVersion', 'targetHostVersion', 'summary', 'confirmations', 'evidenceIds'])
  if (typeof item.code !== 'string' || !Object.hasOwn(REASONS, item.code)) return invalid()
  const code = item.code as PluginDiagnosisCode
  if (item.summary !== REASONS[code]) return invalid()
  const ids = array(item.evidenceIds, evidenceId, MAX_EVIDENCE)
  if (new Set(ids).size !== ids.length || count(item.confirmations, 1, MAX_EVIDENCE) !== ids.length) return invalid()
  return {
    code, observedVersion: version(item.observedVersion), targetHostVersion: version(item.targetHostVersion),
    summary: REASONS[code], confirmations: ids.length, evidenceIds: ids,
  }
}
function identity(item: Record<string, unknown>): Omit<ObservedBundle, 'requiredRelationsVerified'> {
  if (typeof item.userEnabled !== 'boolean') return invalid()
  return {
    name: identifier(item.name), observedVersion: version(item.observedVersion),
    targetHostVersion: version(item.targetHostVersion),
    userEnabled: item.userEnabled, source: source(item.source), order: count(item.order),
    requiredBundleNames: names(item.requiredBundleNames),
  }
}
function entry(value: unknown, currentPolicy: PluginStatePolicy): PluginStateEntry {
  const item = object(value, [
    'name', 'observedVersion', 'targetHostVersion', 'userEnabled', 'source', 'order',
    'requiredBundleNames', 'health', 'diagnosis', 'pauseReason',
  ])
  const base = identity(item)
  const health = item.health
  if (health !== 'unverified' && health !== 'healthy' && health !== 'suspected' && health !== 'paused') return invalid()
  const current = item.diagnosis === undefined ? undefined : diagnosis(item.diagnosis)
  const pause = item.pauseReason === undefined ? undefined : diagnosis(item.pauseReason)
  if (current && !sameIdentity(current, base)) return invalid()
  if ((health === 'paused') !== (pause !== undefined) || (health === 'suspected' && current === undefined)) return invalid()
  if ((health === 'unverified' || health === 'healthy') && current !== undefined) return invalid()
  if (health === 'suspected' && current !== undefined && current.confirmations >= currentPolicy.failureConfirmations) return invalid()
  if (pause && pause.confirmations < currentPolicy.failureConfirmations) return invalid()
  if (PROTECTED_BUNDLES.has(base.name) && (!base.userEnabled || health === 'paused' || health === 'suspected')) return invalid()
  return { ...base, health, ...(current ? { diagnosis: current } : {}), ...(pause ? { pauseReason: pause } : {}) }
}
function snapshot(value: unknown): PluginStateSnapshot {
  const item = object(value, ['schemaVersion', 'revision', 'policy', 'entries'])
  if (item.schemaVersion !== 1) return invalid()
  const currentPolicy = policy(item.policy)
  const entries = array(item.entries, value => entry(value, currentPolicy), MAX_ENTRIES)
  if (new Set(entries.map(value => value.name)).size !== entries.length) return invalid()
  return { schemaVersion: 1, revision: count(item.revision), policy: currentPolicy, entries }
}
function requireEntry(state: PluginStateSnapshot, name: string): PluginStateEntry {
  const result = state.entries.find(item => item.name === name)
  if (!result) return fail('unknown-bundle', 'The Bundle is not recorded in native plugin state.')
  return result
}
function protect(name: string): void {
  if (PROTECTED_BUNDLES.has(name)) fail('protected-bundle', 'A required official or native shell Bundle cannot be paused.')
}
function sameIdentity(
  left: { observedVersion: string; targetHostVersion: string },
  right: { observedVersion: string; targetHostVersion: string },
): boolean {
  return left.observedVersion === right.observedVersion && left.targetHostVersion === right.targetHostVersion
}
function replaceEntry(state: PluginStateSnapshot, replacement: PluginStateEntry): PluginStateSnapshot {
  return { ...state, entries: state.entries.map(item => item.name === replacement.name ? replacement : item) }
}
function checkRevision(state: PluginStateSnapshot, revision: number): void {
  if (count(revision) !== state.revision) fail('revision-conflict', 'Native plugin state changed; refresh before retrying.')
}
async function inspect(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try { return await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
async function plainFile(path: string): Promise<void> {
  const info = await inspect(path)
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) fail('unsafe-path', 'Native plugin state requires ordinary private files.')
}

/**
 * Atomic native state owner. The directory must be native-owned and cannot be replaced concurrently by an untrusted writer.
 * Methods reject existing symlinks, junctions and hard-linked files; pointer targets are never opened.
 * This file-lock protocol inherits atomic-write's rename durability and does not promise fsync crash durability.
 */
export class DesktopPluginStateStore {
  private readonly directory: string
  private readonly filename: string
  private readonly initialPolicy: PluginStatePolicy
  private readonly receipts = new WeakMap<PluginRestoreReceipt, ReceiptRecord>()

  /** @param options Absolute native-owned directory and an explicit bounded confirmation policy. */
  constructor(options: PluginStateStoreOptions) {
    if (!isAbsolute(options.directory)) fail('unsafe-path', 'Native plugin state directory must be absolute.')
    this.directory = resolve(options.directory)
    this.filename = join(this.directory, STATE_FILENAME)
    this.initialPolicy = policy(options.policy)
  }

  private async directoryReady(create: boolean): Promise<boolean> {
    let current = parse(this.directory).root
    for (const part of relative(current, this.directory).split(sep).filter(Boolean)) {
      current = join(current, part)
      let info = await inspect(current)
      if (!info) {
        if (!create) return false
        try { await mkdir(current, { mode: 0o700 }) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
        info = await inspect(current)
      }
      if (!info || !info.isDirectory() || info.isSymbolicLink()) fail('unsafe-path', 'Native plugin state directory cannot traverse links.')
    }
    await plainFile(this.filename)
    await plainFile(`${this.filename}.lock`)
    return true
  }

  /** @returns A detached validated snapshot; an absent document has revision zero and creates no files. */
  async read(): Promise<PluginStateSnapshot> {
    const empty = (): PluginStateSnapshot => ({ schemaVersion: 1, revision: 0, policy: { ...this.initialPolicy }, entries: [] })
    if (!await this.directoryReady(false)) return empty()
    let handle
    try { handle = await open(this.filename, constants.O_RDONLY | (constants.O_NOFOLLOW)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') return fail('unsafe-path', 'Native plugin state cannot be a link.')
      throw error
    }
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size > MAX_STATE_BYTES) return invalid()
      const raw = await handle.readFile('utf8')
      if (Buffer.byteLength(raw) > MAX_STATE_BYTES) return invalid()
      let value: unknown
      try { value = JSON.parse(raw) } catch { return invalid() /* Malformed JSON must never echo stored content. */ }
      const parsed = snapshot(value)
      if (parsed.policy.failureConfirmations !== this.initialPolicy.failureConfirmations) fail('policy-conflict', 'Persisted plugin policy differs from the native configuration.')
      return parsed
    } finally { await handle.close() }
  }

  private async update(
    expectedRevision: number, change: (state: PluginStateSnapshot) => PluginStateSnapshot,
  ): Promise<PluginStateSnapshot> {
    await this.directoryReady(true)
    return withFileLock(this.filename, async () => {
      await this.directoryReady(false)
      const state = await this.read()
      checkRevision(state, expectedRevision)
      const candidate = change(state)
      if (candidate === state) return state
      const next = snapshot({ ...candidate, revision: count(state.revision + 1) })
      const content = JSON.stringify(next, undefined, 2) + '\n'
      if (Buffer.byteLength(content) > MAX_STATE_BYTES) return invalid()
      if (!await this.directoryReady(false)) return fail('unsafe-path', 'Native plugin state directory disappeared.')
      await writeFileAtomic(this.filename, content, { mode: 0o600, dirMode: 0o700 })
      return next
    })
  }

  /**
   * Record native discovery and verified relations; rediscovery never reenables a user choice or clears a pause.
   * @param observed Native inventory entry; required edges must have explicit verified provenance.
   * @param expectedRevision Last revision read by the caller.
   * @returns Committed snapshot.
   */
  async observeBundle(observed: ObservedBundle, expectedRevision: number): Promise<PluginStateSnapshot> {
    const parsed = object(observed, [
      'name', 'observedVersion', 'targetHostVersion', 'userEnabled', 'source', 'order',
      'requiredBundleNames', 'requiredRelationsVerified',
    ])
    if (parsed.requiredRelationsVerified !== true) fail('unverified-relations', 'Required Bundle relations must be explicitly verified.')
    const base = identity(parsed)
    if (!base.userEnabled) protect(base.name)
    return this.update(expectedRevision, (state) => {
      const previous = state.entries.find(item => item.name === base.name)
      const same = previous && sameIdentity(previous, base)
      const next: PluginStateEntry = {
        ...base, userEnabled: previous?.userEnabled ?? base.userEnabled,
        health: previous?.pauseReason ? 'paused' : same ? previous.health : 'unverified',
        ...(same && previous.diagnosis ? { diagnosis: previous.diagnosis } : {}),
        ...(previous?.pauseReason ? { pauseReason: previous.pauseReason } : {}),
      }
      return previous ? replaceEntry(state, next) : { ...state, entries: [...state.entries, next] }
    })
  }

  /**
   * Change only the persisted user preference.
   * @param name Recorded Bundle identity.
   * @param enabled User choice.
   * @param expectedRevision Last observed revision.
   * @returns Committed snapshot.
   */
  async setUserEnabled(name: string, enabled: boolean, expectedRevision: number): Promise<PluginStateSnapshot> {
    if (!enabled) protect(name)
    return this.update(expectedRevision, state => replaceEntry(state, { ...requireEntry(state, name), userEnabled: enabled }))
  }

  /**
   * Count distinct native observations of one attributable code; other error classes cannot become pauses.
   * @param input Exact plugin/host identity and bounded evidence digest, with no raw diagnostic text.
   * @param expectedRevision Last observed revision.
   * @returns Committed snapshot, or the same revision for duplicate evidence.
   */
  async recordDiagnosis(input: PluginDiagnosisInput, expectedRevision: number): Promise<PluginStateSnapshot> {
    if (!Object.hasOwn(REASONS, input.code)) fail('unattributable-diagnosis', 'This failure class cannot pause a Bundle.')
    protect(input.name)
    const digest = evidenceId(input.evidenceId)
    return this.update(expectedRevision, (state) => {
      const previous = requireEntry(state, input.name)
      if (!sameIdentity(previous, input)) fail('identity-conflict', 'Diagnosis does not match the current plugin and host versions.')
      const current = previous.diagnosis?.code === input.code ? previous.diagnosis : undefined
      if (current?.evidenceIds.includes(digest) || (current?.confirmations ?? 0) >= state.policy.failureConfirmations) return state
      const ids = [...current?.evidenceIds ?? [], digest]
      const result: PluginDiagnosis = {
        code: input.code, observedVersion: input.observedVersion, targetHostVersion: input.targetHostVersion,
        summary: REASONS[input.code], confirmations: ids.length, evidenceIds: ids,
      }
      const pauseReason = result.confirmations >= state.policy.failureConfirmations ? result : previous.pauseReason
      return replaceEntry(state, { ...previous, health: pauseReason ? 'paused' : 'suspected', diagnosis: result, ...(pauseReason ? { pauseReason } : {}) })
    })
  }

  /**
   * Validate through a native-owned callback without clearing state. Never expose this callback admission through IPC.
   * @param name Bundle to validate against its recorded version, host and source pointers.
   * @param expectedRevision Revision validated by the caller.
   * @param validate Trusted in-process validation; false retains the current pause and choice.
   * @returns An opaque receipt on success, or null on a negative validation result.
   */
  async validateRestore(
    name: string, expectedRevision: number, validate: (entry: PluginStateEntry) => Promise<boolean>,
  ): Promise<PluginRestoreReceipt | null> {
    const state = await this.read()
    checkRevision(state, expectedRevision)
    const current = requireEntry(state, name)
    let valid: boolean
    try { valid = await validate(structuredClone(current)) } catch { return fail('validation-failed', 'Native Bundle restoration validation failed.') }
    if (!valid) return null
    const receipt = Object.freeze({}) as PluginRestoreReceipt
    this.receipts.set(receipt, { revision: state.revision, entry: current })
    return receipt
  }

  /**
   * Consume one successful receipt from this store instance; revision changes invalidate it and user disable is preserved.
   * @param receipt Opaque receipt returned by this instance, never deserialized renderer data.
   * @param expectedRevision Current revision, which must also match the receipt.
   * @returns Committed healthy state without automatically enabling the Bundle.
   */
  async restore(receipt: PluginRestoreReceipt, expectedRevision: number): Promise<PluginStateSnapshot> {
    const trusted = this.receipts.get(receipt)
    if (!trusted) return fail('untrusted-receipt', 'Restoration requires a current native validation receipt.')
    if (trusted.revision !== expectedRevision) return fail('revision-conflict', 'State changed after native restoration validation.')
    const result = await this.update(expectedRevision, (state) => {
      const current = requireEntry(state, trusted.entry.name)
      if (!sameIdentity(current, trusted.entry)) return fail('identity-conflict', 'Bundle identity changed after restoration validation.')
      const { diagnosis: _diagnosis, pauseReason: _pauseReason, ...base } = current
      return replaceEntry(state, { ...base, health: 'healthy' })
    })
    this.receipts.delete(receipt)
    return result
  }
}

/**
 * Preserve requested order while excluding user-disabled/paused Bundles and their explicitly verified dependents.
 * @param state Validated native snapshot.
 * @param requestedNames Bundle activation list supplied by the composition owner.
 * @returns Ordered active and excluded lists; unknown optional compatibility remains unverified, not automatically paused.
 */
export function computeEffectiveBundles(state: PluginStateSnapshot, requestedNames: readonly string[]): EffectiveBundles {
  const entries = new Map(state.entries.map(item => [item.name, item]))
  const excluded = new Map<string, ExcludedBundle>()
  const requested = new Set(requestedNames)
  for (const name of requestedNames) {
    if (PROTECTED_BUNDLES.has(name)) continue
    const item = entries.get(name)
    const reason = item?.userEnabled === false ? 'user-disabled' : item?.health === 'paused' ? 'paused' : undefined
    if (reason) excluded.set(name, { name, reason, requiredBundleNames: [] })
  }
  let changed = true
  while (changed) {
    changed = false
    for (const name of requestedNames) {
      if (excluded.has(name) || PROTECTED_BUNDLES.has(name)) continue
      const missing = entries.get(name)?.requiredBundleNames.filter(required => !requested.has(required) || excluded.has(required)) ?? []
      if (missing.length === 0) continue
      excluded.set(name, { name, reason: 'required-bundle-unavailable', requiredBundleNames: missing })
      changed = true
    }
  }
  return {
    active: requestedNames.filter(name => !excluded.has(name)),
    excluded: requestedNames.flatMap((name) => {
      const value = excluded.get(name)
      return value ? [value] : []
    }),
  }
}
