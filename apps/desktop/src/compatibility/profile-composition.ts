/** Derive an owned startup profile without editing canonical configuration or reading excluded Bundle manifests. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createRequire } from 'node:module'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { computeEffectiveBundles, type EffectiveBundles, type ExcludedBundle, type PluginStateSnapshot } from './plugin-state.ts'

const OFFICIAL_SHA = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
const OFFICIAL_VERSION = '0.1.5-rc.2'
const BASE = '@deepseek-ai/dsh-base'
const WEB = '@deepseek-ai/dsh-web-app'
const CORE = new Set([BASE, WEB])
const MARKER = '.desktop-profile.json'
const OWNER = 'deepseek-desktop-managed-profile'
const MAX_FILE_BYTES = 2_097_152
const MAX_ROWS = 4096

/** Fixed official exports supplied by the native runtime adapter; YAML functions must use the provided include schema. */
export interface OfficialProfileCompositionApi {
  readonly sourceSha: string
  readonly loadOverlayPatches: (binName: string, absolutePath: string) => unknown[]
  readonly resolveBundleDir: (binName: string, name: string, installAnchor: string, profileDirectory: string) => string
  readonly entryListSchema: unknown
  readonly yaml: {
    readonly load: (text: string, options: { schema: unknown }) => unknown
    readonly dump: (value: unknown, options: { schema: unknown; noRefs: true }) => string
  }
}
/** Native-owned inputs; the caller serializes package/state mutations and stops the managed Host before publication. */
export interface ManagedProfileInput {
  readonly canonicalDirectory: string
  readonly effectiveDirectory: string
  readonly dshHome: string
  readonly officialAnchor: string
  readonly snapshot: PluginStateSnapshot
  readonly effectiveBundles?: EffectiveBundles
}
/** An active Bundle whose manifest and patch were read from the resolved installed source. */
export interface ManagedBundleObservation {
  readonly name: string
  readonly observedVersion: string
  readonly codePath: string
  readonly patchPath: string
  readonly order: number
  readonly requiredBundleNames: readonly string[]
  readonly requiredRelationsVerified: true
}
/** Content identity of a source file; null records an absent optional source. */
export interface ProfileInputDigest { readonly path: string; readonly sha256: string | null }
/** Receipt published with one complete derived profile; it does not assert that the Host was launched. */
export interface ManagedProfileReceipt {
  readonly schemaVersion: 1
  readonly status: 'ready'
  readonly profileName: string
  readonly profileDirectory: string
  readonly canonicalDirectory: string
  readonly dshHome: string
  readonly officialSourceSha: string
  readonly stateRevision: number
  readonly inputHash: string
  readonly originalPatchReload: 'live' | 'startup'
  readonly effectivePatchReload: 'startup'
  readonly requestedBundles: readonly string[]
  readonly activeBundles: readonly string[]
  readonly excludedBundles: readonly ExcludedBundle[]
  readonly observations: readonly ManagedBundleObservation[]
  readonly relationVerification: 'declared-canonical-bundle-dependencies'
  readonly inputs: readonly ProfileInputDigest[]
  readonly directoryInputs: readonly ProfileInputDigest[]
  readonly publication: 'staged-directory-swap'
  readonly previousDirectory?: string
}
/** Expected recovery reasons; a recovery is not a running or ready Host. */
export type ProfileCompositionRecoveryCode = 'unsafe-path' | 'foreign-effective-directory' | 'canonical-manifest-invalid'
  | 'required-core-missing' | 'official-input-invalid' | 'selection-conflict' | 'core-input-invalid'
  | 'bundle-manifest-invalid' | 'bundle-yaml-invalid' | 'profile-yaml-invalid' | 'root-yaml-invalid'
  | 'preset-yaml-invalid' | 'excluded-bundle-reference' | 'excluded-bundle-dependency' | 'relative-config-unsupported'
  | 'include-unsupported' | 'expression-unsupported' | 'preset-relative-module-unsupported' | 'preset-roots-unsupported'
  | 'preset-hot-edit-uncontrolled' | 'module-unavailable' | 'uncontrolled-hmr' | 'yaml-roundtrip-failed'
  | 'input-changed' | 'publication-failed' | 'shared-cordis-conflict' | 'bundle-alias-unsupported'
interface RecoveryLocation {
  readonly sourcePath?: string
  readonly row?: string
  readonly bundleName?: string
  readonly requiredBundleNames?: readonly string[]
}
/** Structured safe diagnostics: supplied exception messages and YAML/config contents are never copied. */
export class ProfileCompositionRecovery extends Error {
  readonly sourcePath: string | undefined
  readonly row: string | undefined
  readonly bundleName: string | undefined
  readonly requiredBundleNames: readonly string[] | undefined
  /** @param code Native recovery reason. @param location Safe file/row/identity metadata, without raw exception text. */
  constructor(readonly code: ProfileCompositionRecoveryCode, location: RecoveryLocation = {}) {
    super(`Managed profile requires recovery: ${code}.`)
    this.name = 'ProfileCompositionRecovery'
    this.sourcePath = location.sourcePath
    this.row = location.row
    this.bundleName = location.bundleName
    this.requiredBundleNames = location.requiredBundleNames
  }
}
function recover(code: ProfileCompositionRecoveryCode, location: RecoveryLocation = {}): never {
  throw new ProfileCompositionRecovery(code, location)
}
function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function packageName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
}
function packageOf(specifier: string): string | undefined {
  if (/^[a-zA-Z]+:/.test(specifier) || specifier.startsWith('.') || isAbsolute(specifier)) return undefined
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return packageName(name) ? name : undefined
}
function within(path: string, directory: string): boolean {
  const value = relative(directory, path)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}
async function inspect(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try { return await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
async function plainDirectory(path: string): Promise<void> {
  let cursor = parse(path).root
  for (const component of relative(cursor, path).split(sep).filter(Boolean)) {
    cursor = join(cursor, component)
    const info = await inspect(cursor)
    if (!info || !info.isDirectory() || info.isSymbolicLink()) recover('unsafe-path', { sourcePath: cursor })
  }
}
async function rawFile(path: string, optional?: false): Promise<string>
async function rawFile(path: string, optional: boolean): Promise<string | undefined>
async function rawFile(path: string, optional = false): Promise<string | undefined> {
  const info = await inspect(path)
  if (!info && optional) return undefined
  if (!info || !info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) {
    return recover('unsafe-path', { sourcePath: path })
  }
  const text = await readFile(path, 'utf8')
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) recover('unsafe-path', { sourcePath: path })
  return text
}
function jsonObject(text: string, code: ProfileCompositionRecoveryCode, location: RecoveryLocation): Record<string, unknown> {
  try {
    const value = record(JSON.parse(text))
    if (value) return value
  } catch { /* Only JSON syntax is attempted here; its raw diagnostic can contain private content. */ }
  return recover(code, location)
}
function safeRow(value: unknown, index: number): string {
  return typeof value === 'string' && /^[A-Za-z0-9@/._-]{1,128}$/.test(value) ? value : `row-${index + 1}`
}

class CompositionReader {
  readonly inputs = new Map<string, string | null>()
  readonly directoryInputs = new Map<string, string | null>()
  readonly projections = new Map<string, string>()
  private readonly excluded: Set<string>
  private rows = 0

  constructor(
    private readonly input: ManagedProfileInput,
    private readonly api: OfficialProfileCompositionApi,
    selection: EffectiveBundles,
  ) { this.excluded = new Set(selection.excluded.map(item => item.name)) }

  async read(path: string, optional?: false): Promise<string>
  async read(path: string, optional: true): Promise<string | undefined>
  async read(path: string, optional = false): Promise<string | undefined> {
    const text = await rawFile(path, optional)
    const digest = text === undefined ? null : hash(text)
    if (this.inputs.has(path) && this.inputs.get(path) !== digest) recover('input-changed', { sourcePath: path })
    this.inputs.set(path, digest)
    return text
  }

  patches(path: string, code: ProfileCompositionRecoveryCode, bundleName?: string): unknown[] {
    let patches: unknown[]
    try { patches = this.api.loadOverlayPatches('desktop', path) } catch {
      return recover(code, { sourcePath: path, ...(bundleName ? { bundleName } : {}) })
    }
    return patches
  }

  async module(specifier: string, location: RecoveryLocation, preset: boolean): Promise<void> {
    if (this.excluded.has(specifier) || [...this.excluded].some(name => specifier.startsWith(`${name}/`))) {
      recover('excluded-bundle-reference', location)
    }
    const name = packageOf(specifier)
    if (name) {
      if (name === '@deepseek-ai/cordis-plugin-include') recover('include-unsupported', location)
      if (name === '@deepseek-ai/cordis-plugin-hmr' && this.excluded.size > 0) recover('uncontrolled-hmr', location)
      if (!this.projections.has(name)) {
        let directory: string
        try { directory = this.api.resolveBundleDir('desktop', name, this.input.officialAnchor, this.input.canonicalDirectory) } catch {
          return recover('module-unavailable', location)
        }
        const actual = await realpath(directory)
        for (const item of this.input.snapshot.entries) {
          if (this.excluded.has(item.name) && within(actual, item.source.codePath)) recover('excluded-bundle-reference', location)
        }
        this.projections.set(name, actual)
      }
      return
    }
    if (preset) return recover('preset-relative-module-unsupported', location)
    let path: string
    try { path = specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier } catch {
      return recover('module-unavailable', location)
    }
    if (!isAbsolute(path)) return recover('module-unavailable', location)
    for (const item of this.input.snapshot.entries) {
      if (this.excluded.has(item.name) && within(path, item.source.codePath)) recover('excluded-bundle-reference', location)
    }
    const actual = await realpath(path).catch(() => recover('module-unavailable', location))
    for (const item of this.input.snapshot.entries) {
      if (this.excluded.has(item.name) && within(actual, item.source.codePath)) recover('excluded-bundle-reference', location)
    }
    await this.read(actual)
  }

  private config(value: unknown, location: RecoveryLocation, key = '', depth = 0): void {
    if (depth > 32) recover('relative-config-unsupported', location)
    if (typeof value === 'string') {
      if ([...this.excluded].some(name => value === name || value.startsWith(`${name}/`))) {
        recover('excluded-bundle-reference', location)
      }
      if (/^\.{1,2}([/\\]|$)/.test(value)
        || (/^(?:path|root|cwd|directory|filename|filepath|url)$/i.test(key)
          && value !== ':memory:' && !isAbsolute(value) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value))) {
        recover('relative-config-unsupported', location)
      }
      return
    }
    if (Array.isArray(value)) { value.forEach((item) => { this.config(item, location, key, depth + 1) }); return }
    const item = record(value)
    if (!item) return
    if (Object.hasOwn(item, '__jsExpr')) {
      const expression = item.__jsExpr
      if (typeof expression !== 'string' || expression.length > 256 || Object.keys(item).length !== 1) {
        recover('expression-unsupported', location)
      }
      const pure = expression.replace(/\b(?:true|false|null)\b/g, '')
      const home = /^dshHomePath\((?:'[^'\\\r\n]*'|"[^"\\\r\n]*")\)$/.test(expression)
      if (!home && !/^[\s\d.+*/%()?:<>=!&|-]+$/.test(pure) && !/^(true|false|null)$/.test(expression)) {
        recover('expression-unsupported', location)
      }
      return
    }
    for (const [childKey, child] of Object.entries(item)) {
      if (childKey === 'roots' && Array.isArray(child) && child.length > 0) recover('preset-roots-unsupported', location)
      this.config(child, location, childKey, depth + 1)
    }
  }

  async scan(rows: unknown, path: string, preset = false): Promise<void> {
    if (!Array.isArray(rows)) recover(preset ? 'preset-yaml-invalid' : 'profile-yaml-invalid', { sourcePath: path })
    for (const [index, value] of rows.entries()) {
      if (++this.rows > MAX_ROWS) recover('relative-config-unsupported', { sourcePath: path })
      const row = record(value)
      if (!row) recover(preset ? 'preset-yaml-invalid' : 'profile-yaml-invalid', { sourcePath: path })
      const location = { sourcePath: path, row: safeRow(row.id, index) }
      if (this.excluded.size > 0 && row.id === 'hmr' && row.disabled !== true) recover('uncontrolled-hmr', location)
      if (row.name !== undefined) {
        if (typeof row.name !== 'string') recover('expression-unsupported', location)
        await this.module(row.name, location, preset)
      }
      if (row.insert !== undefined) await this.scan(row.insert, path, preset)
      if (row.group === true && Array.isArray(row.config)) await this.scan(row.config, path, preset)
      else this.config(row.config, location)
      for (const key of ['disabled', 'inject', 'isolate', 'intercept']) this.config(row[key], location, key)
    }
  }

  async presets(): Promise<void> {
    const root = join(this.input.dshHome, '.agent-presets')
    const children = await this.directory(root)
    if (!children) return
    await plainDirectory(root)
    if (children.length > MAX_ROWS) recover('preset-yaml-invalid', { sourcePath: root })
    for (const child of children) {
      if (child.isSymbolicLink()) recover('unsafe-path', { sourcePath: join(root, child.name) })
      if (!child.isDirectory()) continue
      const path = join(root, child.name, 'agent.cordis.yml')
      const text = await this.read(path, true)
      if (text === undefined) recover('preset-yaml-invalid', { sourcePath: path })
      let rows: unknown
      try { rows = this.api.yaml.load(text, { schema: this.api.entryListSchema }) } catch {
        return recover('preset-yaml-invalid', { sourcePath: path })
      }
      await this.scan(rows, path, true)
      if (this.excluded.size > 0) recover('preset-hot-edit-uncontrolled', { sourcePath: path })
    }
  }

  private async directory(path: string) {
    if (!await inspect(path)) { this.directoryInputs.set(path, null); return undefined }
    const children = await readdir(path, { withFileTypes: true })
    const digest = directoryDigest(children)
    this.directoryInputs.set(path, digest)
    return children
  }

  async unchanged(): Promise<void> {
    for (const [path, digest] of this.directoryInputs) {
      const current = await inspect(path)
      if (current?.isSymbolicLink() || (current && !current.isDirectory())) recover('input-changed', { sourcePath: path })
      const actual = current ? directoryDigest(await readdir(path, { withFileTypes: true })) : null
      if (actual !== digest) recover('input-changed', { sourcePath: path })
    }
    for (const [path, digest] of this.inputs) {
      let text: string | undefined
      try { text = await rawFile(path, true) } catch { return recover('input-changed', { sourcePath: path }) }
      if ((text === undefined ? null : hash(text)) !== digest) recover('input-changed', { sourcePath: path })
    }
  }
}

function directoryDigest(children: readonly { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }[]): string {
  return hash(JSON.stringify(children.map(child => [child.name, child.isDirectory(), child.isSymbolicLink()])
    .sort(([left], [right]) => String(left).localeCompare(String(right)))))
}

async function verifySharedCordis(input: ManagedProfileInput, projections: ReadonlyMap<string, string>, expected: string): Promise<void> {
  const sharedFallback = join(input.dshHome, 'profiles/node_modules')
  for (const [name, directory] of projections) {
    if (name === '@deepseek-ai/cordis') continue
    const paths = createRequire(join(directory, 'package.json')).resolve.paths('@deepseek-ai/cordis') ?? []
    for (const path of paths) {
      // The official launcher heals this shared fallback before any profile plugin mounts.
      if (resolve(path) === sharedFallback) break
      const candidate = join(path, '@deepseek-ai/cordis')
      if (!await inspect(candidate)) continue
      if (await realpath(candidate) !== expected) recover('shared-cordis-conflict', { sourcePath: candidate })
      break
    }
  }
}

async function assertOwned(input: ManagedProfileInput): Promise<boolean> {
  const info = await inspect(input.effectiveDirectory)
  if (!info) return false
  if (!info.isDirectory() || info.isSymbolicLink()) recover('unsafe-path', { sourcePath: input.effectiveDirectory })
  const path = join(input.effectiveDirectory, MARKER)
  const text = await rawFile(path, true)
  if (!text) recover('foreign-effective-directory', { sourcePath: input.effectiveDirectory })
  const marker = jsonObject(text, 'foreign-effective-directory', { sourcePath: path })
  if (marker.owner !== OWNER || marker.schemaVersion !== 1 || marker.canonicalDirectory !== input.canonicalDirectory
    || marker.effectiveDirectory !== input.effectiveDirectory || marker.dshHome !== input.dshHome
    || marker.officialSourceSha !== OFFICIAL_SHA) recover('foreign-effective-directory', { sourcePath: path })
  const allowed = new Set([MARKER, 'package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'receipt.json',
    'node_modules', '.dsh-module-fallback'])
  for (const child of await readdir(input.effectiveDirectory, { withFileTypes: true })) {
    if (!allowed.has(child.name)) recover('foreign-effective-directory', { sourcePath: join(input.effectiveDirectory, child.name) })
    if (child.isSymbolicLink()) recover('unsafe-path', { sourcePath: join(input.effectiveDirectory, child.name) })
  }
  return true
}

async function publish(
  input: ManagedProfileInput, reader: CompositionReader, receipt: ManagedProfileReceipt, patch: string,
): Promise<ManagedProfileReceipt> {
  const parent = dirname(input.effectiveDirectory)
  const stage = join(parent, `.${basename(input.effectiveDirectory)}.stage-${randomUUID()}`)
  await mkdir(stage, { mode: 0o700 })
  let movedPrevious = false
  try {
    const manifest = { name: `dsh-profile-${basename(input.effectiveDirectory)}`, private: true, dependencies: {},
      dsh: { profile: { bundles: receipt.activeBundles, patchReload: 'startup' } } }
    const marker = { schemaVersion: 1, owner: OWNER, canonicalDirectory: input.canonicalDirectory,
      effectiveDirectory: input.effectiveDirectory, dshHome: input.dshHome, officialSourceSha: OFFICIAL_SHA }
    for (const [name, content] of [
      [MARKER, JSON.stringify(marker, null, 2) + '\n'], ['package.json', JSON.stringify(manifest, null, 2) + '\n'],
      ['cordis.patch.yml', patch], ['pnpm-workspace.yaml', 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n'],
      ['receipt.json', JSON.stringify(receipt, null, 2) + '\n'],
    ] as const) await writeFileAtomic(join(stage, name), content, { mode: 0o600, dirMode: 0o700 })
    await mkdir(join(stage, 'node_modules'), { mode: 0o700 })
    for (const [name, target] of reader.projections) {
      const link = join(stage, 'node_modules', name)
      await mkdir(dirname(link), { recursive: true, mode: 0o700 })
      await symlink(target, link, 'junction')
    }
    await reader.unchanged()
    await plainDirectory(parent)
    const exists = await assertOwned(input)
    if (exists !== (receipt.previousDirectory !== undefined)) recover('input-changed', { sourcePath: input.effectiveDirectory })
    if (receipt.previousDirectory !== undefined) {
      await rename(input.effectiveDirectory, receipt.previousDirectory)
      movedPrevious = true
    }
    try { await rename(stage, input.effectiveDirectory) } catch {
      if (movedPrevious && receipt.previousDirectory !== undefined && !await inspect(input.effectiveDirectory)) {
        await rename(receipt.previousDirectory, input.effectiveDirectory)
      }
      return recover('publication-failed', { sourcePath: input.effectiveDirectory })
    }
    return receipt
  } finally {
    // This directory was exclusively created by this invocation and contains only our generated files and package links.
    await rm(stage, { recursive: true, force: true })
  }
}

/**
 * Derive and publish a startup-only profile from fixed official exports and a persisted native choice snapshot.
 * The native caller must stop the Host and serialize canonical/state changes. Replacing an existing directory uses
 * a retained previous directory and can briefly leave the final name absent; the receipt returns only after the complete
 * staged profile is published. Never launch by polling the directory during this operation.
 * @param supplied Canonical/effective sibling profile directories in one logical Harness home, with native state.
 * @param api Public exports bound to the verified fixed official runtime, including its entry-list YAML schema.
 * @returns Complete publication receipt; typed recovery never means a running chat Host.
 */
export async function composeManagedProfile(
  supplied: ManagedProfileInput, api: OfficialProfileCompositionApi,
): Promise<ManagedProfileReceipt> {
  const input = { ...supplied, canonicalDirectory: resolve(supplied.canonicalDirectory),
    effectiveDirectory: resolve(supplied.effectiveDirectory), dshHome: resolve(supplied.dshHome) }
  if (![supplied.canonicalDirectory, supplied.effectiveDirectory, supplied.dshHome, supplied.officialAnchor].every(isAbsolute)
    || dirname(input.canonicalDirectory) !== join(input.dshHome, 'profiles')
    || dirname(input.effectiveDirectory) !== join(input.dshHome, 'profiles')
    || input.canonicalDirectory === input.effectiveDirectory) recover('unsafe-path')
  await plainDirectory(input.canonicalDirectory)
  await plainDirectory(dirname(input.effectiveDirectory))
  if (api.sourceSha !== OFFICIAL_SHA) recover('official-input-invalid')
  const lock = join(dirname(input.effectiveDirectory), `.${basename(input.effectiveDirectory)}.compose`)
  const lockInfo = await inspect(`${lock}.lock`)
  if (lockInfo && (!lockInfo.isFile() || lockInfo.isSymbolicLink() || lockInfo.nlink !== 1)) recover('unsafe-path')
  return withFileLock(lock, async () => {
    const previous = await assertOwned(input)
    const manifestPath = join(input.canonicalDirectory, 'package.json')
    const manifestText = await rawFile(manifestPath)
    const manifest = jsonObject(manifestText, 'canonical-manifest-invalid', { sourcePath: manifestPath })
    const profile = record(record(manifest.dsh)?.profile)
    const bundles = profile?.bundles
    if (!Array.isArray(bundles) || !bundles.every(packageName) || new Set(bundles).size !== bundles.length || bundles.length > 512) {
      recover('canonical-manifest-invalid', { sourcePath: manifestPath })
    }
    if (!bundles.includes(BASE) || !bundles.includes(WEB) || bundles.indexOf(BASE) > bundles.indexOf(WEB)) {
      recover('required-core-missing', { sourcePath: manifestPath })
    }
    const reload = profile?.patchReload ?? 'live'
    if (reload !== 'live' && reload !== 'startup') recover('canonical-manifest-invalid', { sourcePath: manifestPath })
    const selection = computeEffectiveBundles(input.snapshot, bundles)
    if (input.effectiveBundles && !isDeepStrictEqual(selection, input.effectiveBundles)) recover('selection-conflict')
    const reader = new CompositionReader(input, api, selection)
    reader.inputs.set(manifestPath, hash(manifestText))
    const anchorPath = await realpath(input.officialAnchor)
    const official = jsonObject((await reader.read(anchorPath)), 'official-input-invalid', { sourcePath: anchorPath })
    if (official.name !== '@deepseek-ai/dsh' || official.version !== OFFICIAL_VERSION) recover('official-input-invalid')
    const observations: ManagedBundleObservation[] = []
    for (const name of selection.active) {
      let codePath: string
      try { codePath = await realpath(api.resolveBundleDir('desktop', name, input.officialAnchor, input.canonicalDirectory)) } catch {
        return recover(CORE.has(name) ? 'core-input-invalid' : 'bundle-manifest-invalid', { ...(CORE.has(name) ? {} : { bundleName: name }) })
      }
      const path = join(codePath, 'package.json')
      const failure = CORE.has(name) ? 'core-input-invalid' : 'bundle-manifest-invalid'
      const location = { sourcePath: path, ...(CORE.has(name) ? {} : { bundleName: name }) }
      const item = jsonObject((await reader.read(path)), failure, location)
      const patchName = record(record(item.dsh)?.bundle)?.patch
      if (!packageName(item.name) || typeof item.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/.test(item.version)
        || typeof patchName !== 'string' || isAbsolute(patchName) || !within(resolve(codePath, patchName), codePath)) {
        recover(failure, location)
      }
      if (item.name !== name) recover(CORE.has(name) ? 'core-input-invalid' : 'bundle-alias-unsupported', { sourcePath: path })
      const dependencyMap = item.dependencies === undefined ? {} : record(item.dependencies)
      if (!dependencyMap) recover(failure, location)
      const required = bundles.filter(candidate => Object.hasOwn(dependencyMap, candidate))
      const unavailable = required.filter(candidate => !selection.active.includes(candidate))
      if (unavailable.length > 0) recover('excluded-bundle-dependency', { ...location, requiredBundleNames: unavailable })
      const patchPath = resolve(codePath, patchName)
      const actualPatch = await realpath(patchPath).catch(() => recover(CORE.has(name) ? 'core-input-invalid' : 'bundle-yaml-invalid', {
        sourcePath: patchPath, ...(CORE.has(name) ? {} : { bundleName: name }),
      }))
      if (!within(actualPatch, codePath)) recover('unsafe-path', { sourcePath: patchPath })
      await reader.read(patchPath)
      const patches = reader.patches(patchPath, CORE.has(name) ? 'core-input-invalid' : 'bundle-yaml-invalid', CORE.has(name) ? undefined : name)
      reader.projections.set(name, codePath)
      if (!CORE.has(name)) await reader.scan(patches, patchPath)
      observations.push({ name, observedVersion: item.version, codePath, patchPath, order: bundles.indexOf(name),
        requiredBundleNames: required, requiredRelationsVerified: true })
    }
    const userPath = join(input.canonicalDirectory, 'cordis.patch.yml')
    const userText = await reader.read(userPath, true)
    const userPatches = userText === undefined ? [] : reader.patches(userPath, 'profile-yaml-invalid')
    await reader.scan(userPatches, userPath)
    const rootPath = join(input.dshHome, 'cordis.patch.yml')
    const rootText = await reader.read(rootPath, true)
    if (rootText !== undefined) await reader.scan(reader.patches(rootPath, 'root-yaml-invalid'), rootPath)
    await reader.presets()
    // The shared Cordis identity is always projected from the fixed installation, never from canonical dependencies.
    const cordis = api.resolveBundleDir('desktop', '@deepseek-ai/cordis', input.officialAnchor, input.canonicalDirectory)
    const sharedCordis = await realpath(cordis)
    reader.projections.set('@deepseek-ai/cordis', sharedCordis)
    await verifySharedCordis(input, reader.projections, sharedCordis)
    let patch: string
    try {
      patch = api.yaml.dump(userPatches, { schema: api.entryListSchema, noRefs: true })
      if (!isDeepStrictEqual(api.yaml.load(patch, { schema: api.entryListSchema }), userPatches)) recover('yaml-roundtrip-failed')
    } catch { return recover('yaml-roundtrip-failed', { sourcePath: userPath }) }
    const inputs = [...reader.inputs].sort(([left], [right]) => left.localeCompare(right)).map(([path, sha256]) => ({ path, sha256 }))
    const directoryInputs = [...reader.directoryInputs].map(([path, sha256]) => ({ path, sha256 }))
    const inputHash = hash(JSON.stringify({
      officialSourceSha: OFFICIAL_SHA, snapshot: input.snapshot, inputs, directoryInputs, selection,
    }))
    const receipt: ManagedProfileReceipt = {
      schemaVersion: 1, status: 'ready', profileName: basename(input.effectiveDirectory), profileDirectory: input.effectiveDirectory,
      canonicalDirectory: input.canonicalDirectory, dshHome: input.dshHome, officialSourceSha: OFFICIAL_SHA,
      stateRevision: input.snapshot.revision, inputHash, originalPatchReload: reload, effectivePatchReload: 'startup',
      requestedBundles: bundles, activeBundles: selection.active, excludedBundles: selection.excluded,
      observations, relationVerification: 'declared-canonical-bundle-dependencies', inputs, directoryInputs, publication: 'staged-directory-swap',
      ...(previous ? { previousDirectory: join(dirname(input.effectiveDirectory), `.${basename(input.effectiveDirectory)}.previous-${randomUUID()}`) } : {}),
    }
    return publish(input, reader, receipt, patch.endsWith('\n') ? patch : `${patch}\n`)
  })
}
