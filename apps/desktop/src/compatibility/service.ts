/** Native orchestration of canonical profile discovery and persisted Bundle choices. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { join, parse, relative, resolve, sep } from 'node:path'
import { DesktopPluginStateStore, computeEffectiveBundles, type PluginStatePolicy, type PluginStateSnapshot } from './plugin-state.ts'
import { composeManagedProfile, ProfileCompositionRecovery } from './profile-composition.ts'
import type { DesktopCompatibilitySnapshot, DesktopPluginMutation } from './contracts.ts'

type CompositionApi = Parameters<typeof composeManagedProfile>[1]
type CompositionInput = Parameters<typeof composeManagedProfile>[0]

/** Paths and official operations are supplied only by the native installation owner. */
export interface DesktopCompatibilityOptions {
  readonly dshHome: string
  readonly directory: string
  readonly canonicalDirectory: string
  readonly effectiveDirectory: string
  readonly officialAnchor: string
  readonly harnessVersion: string
  readonly policy: PluginStatePolicy
  readonly official: CompositionApi
  /** Initialize only absent canonical files through the official profile API. */
  initializeCanonical(): void
  /** Read the canonical ordered names through the official manifest parser. */
  requestedBundles(): readonly string[]
  /** Start and stop an actual candidate Host using the already composed effective profile. */
  validateHost(signal: AbortSignal): Promise<void>
}

const CORE = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

/** Persisted choices precede every official profile parse; failed validation never clears a pause. */
export class DesktopCompatibilityService {
  private readonly store: DesktopPluginStateStore
  private recoveryCode: string | null = null
  private originalPatchReload: 'live' | 'startup' | null = null

  /** @param options Exact installed runtime operations and native-owned paths. */
  constructor(private readonly options: DesktopCompatibilityOptions) {
    this.store = new DesktopPluginStateStore({ directory: options.directory, policy: options.policy })
  }

  private input(snapshot: PluginStateSnapshot): CompositionInput {
    return { canonicalDirectory: this.options.canonicalDirectory, effectiveDirectory: this.options.effectiveDirectory,
      dshHome: this.options.dshHome, officialAnchor: this.options.officialAnchor, snapshot }
  }

  private async discover(snapshot: PluginStateSnapshot, validateNames?: readonly string[]): Promise<PluginStateSnapshot> {
    const requested = this.options.requestedBundles()
    const selection = computeEffectiveBundles(snapshot, requested)
    for (const name of validateNames ?? selection.active) {
      if (CORE.has(name)) continue
      const codePath = await realpath(this.options.official.resolveBundleDir('dsh', name, this.options.officialAnchor, this.options.canonicalDirectory))
      const text = await readFile(join(codePath, 'package.json'), 'utf8')
      let manifest: unknown
      try { manifest = JSON.parse(text) } catch { throw new ProfileCompositionRecovery('bundle-manifest-invalid', { bundleName: name }) }
      if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
        throw new ProfileCompositionRecovery('bundle-manifest-invalid', { bundleName: name })
      }
      const value = manifest as Record<string, unknown>
      if (value.name !== name || typeof value.version !== 'string') throw new ProfileCompositionRecovery('bundle-manifest-invalid', { bundleName: name })
      const deps = value.dependencies
      if (deps !== undefined && (typeof deps !== 'object' || deps === null || Array.isArray(deps)
        || Object.values(deps).some(item => typeof item !== 'string'))) throw new ProfileCompositionRecovery('bundle-manifest-invalid', { bundleName: name })
      const required = requested.filter(item => item !== name && deps !== undefined && Object.hasOwn(deps, item))
      snapshot = await this.store.observeBundle({ name, observedVersion: value.version,
        targetHostVersion: this.options.harnessVersion, userEnabled: true,
        source: { profileName: 'web', codePath, dataPaths: [] }, order: requested.indexOf(name),
        requiredBundleNames: required, requiredRelationsVerified: true }, snapshot.revision)
    }
    return snapshot
  }

  private async initializeCanonical(): Promise<void> {
    const target = resolve(this.options.canonicalDirectory)
    if (target !== join(resolve(this.options.dshHome), 'profiles', 'web')) throw new Error('Invalid canonical profile location.')
    let current = parse(target).root
    let created = false
    for (const segment of relative(current, target).split(sep).filter(Boolean)) {
      current = join(current, segment)
      let info = await lstat(current).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      if (info === undefined) {
        await mkdir(current, { mode: 0o700 })
        info = await lstat(current)
        if (current === target) created = true
      }
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Canonical profile cannot traverse links.')
    }
    if (created) this.options.initializeCanonical()
    else {
      const manifest = await lstat(join(target, 'package.json'))
      if (!manifest.isFile() || manifest.isSymbolicLink()) throw new Error('Invalid existing canonical profile.')
    }
  }

  /** Compose the managed profile while the owning Host is stopped. */
  async prepare(): Promise<void> {
    let snapshot = await this.store.read()
    try {
      await this.initializeCanonical()
      snapshot = await this.discover(snapshot)
      const receipt = await composeManagedProfile(this.input(snapshot), this.options.official)
      this.originalPatchReload = receipt.originalPatchReload
      this.recoveryCode = null
    } catch (error) {
      snapshot = await this.store.read()
      this.recoveryCode = error instanceof ProfileCompositionRecovery ? error.code : 'canonical-input-invalid'
      if (error instanceof ProfileCompositionRecovery && error.bundleName !== undefined
        && (error.code === 'bundle-yaml-invalid' || error.code === 'bundle-manifest-invalid')) {
        const entry = snapshot.entries.find(item => item.name === error.bundleName)
        if (entry !== undefined) {
          snapshot = await this.store.recordDiagnosis({ name: entry.name, observedVersion: entry.observedVersion,
            targetHostVersion: entry.targetHostVersion, code: error.code === 'bundle-yaml-invalid' ? 'invalid-yaml' : 'invalid-manifest',
            evidenceId: createHash('sha256').update(`${randomUUID()}:${error.code}:${entry.name}:${entry.observedVersion}`).digest('hex'),
          }, snapshot.revision)
          if (snapshot.entries.find(item => item.name === entry.name)?.health === 'paused') {
            const receipt = await composeManagedProfile(this.input(snapshot), this.options.official)
            this.originalPatchReload = receipt.originalPatchReload
            this.recoveryCode = null
            return
          }
        }
      }
      throw error
    }
  }

  /** @returns Safe recovery projection; no package paths, configuration or raw exception content. */
  async getSnapshot(): Promise<DesktopCompatibilitySnapshot> {
    const state = await this.store.read()
    return { schemaVersion: 1, revision: state.revision, canonicalProfile: 'web', effectiveProfile: 'desktop-base',
      restartRequired: true, originalPatchReload: this.originalPatchReload,
      recoveryCode: this.recoveryCode, entries: state.entries.map(entry => ({ name: entry.name,
        version: entry.observedVersion, enabled: entry.userEnabled, health: entry.health,
        reason: entry.pauseReason?.code ?? entry.diagnosis?.code ?? null,
        requiredBundles: [...entry.requiredBundleNames],
      })) }
  }

  /**
   * Apply one validated choice inside the native lifecycle's stopped-runtime operation.
   * @param mutation User identity/action/revision only; native validators and paths cannot be provided by IPC.
   * @param signal Native lifecycle cancellation, including quit during candidate validation.
   */
  async mutate(mutation: DesktopPluginMutation, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    let before = await this.store.read()
    if (before.revision !== mutation.revision) throw new Error('Plugin state changed; refresh before retrying.')
    if (mutation.action !== 'restore') {
      await this.store.setUserEnabled(mutation.name, mutation.action === 'enable', mutation.revision)
      return
    }
    before = await this.discover(before, [mutation.name])
    const receipt = await this.store.validateRestore(mutation.name, before.revision, async (entry) => {
      const candidate: PluginStateSnapshot = { ...before, entries: before.entries.map((item) => {
        if (item.name !== entry.name) return item
        const restored = { ...item, health: 'healthy' as const, userEnabled: true }
        delete restored.pauseReason
        delete restored.diagnosis
        return restored
      }) }
      signal.throwIfAborted()
      const composed = await composeManagedProfile(this.input(candidate), this.options.official)
      const loaded = composed.observations.find(item => item.name === entry.name)
      if (!composed.activeBundles.includes(entry.name) || loaded?.observedVersion !== entry.observedVersion
        || loaded.codePath !== entry.source.codePath) return false
      signal.throwIfAborted()
      await this.options.validateHost(signal)
      signal.throwIfAborted()
      return true
    })
    if (receipt === null) throw new Error('Plugin validation failed; pause retained.')
    signal.throwIfAborted()
    await this.store.restore(receipt, before.revision)
  }
}
