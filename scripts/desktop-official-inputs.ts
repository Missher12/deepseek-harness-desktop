/** Validate official package inputs and prepare a runtime for the current host. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { JSON_SCHEMA, load } from 'js-yaml'
import { recordOfficialRuntime, verifyOfficialRuntime, type OfficialRuntimeOrigin } from './desktop-base-runtime.ts'

const OFFICIAL_SHA = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
const OFFICIAL_TREE = 'bd7dd6d90010a35d3d6ff9f12c1f6207d5b6fe38'
const HARNESS_VERSION = '0.1.5-rc.2'
const PNPM_VERSION = '11.7.0'
const PACKAGE_COUNT = 275
const SUBPROCESS_PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const SUBPROCESS_POSTINSTALL = 'node scripts/ensure-spawn-helper.mjs'
const PKG_PATCH = '@yao-pkg/pkg@6.21.0'
const PTY_PATCH = 'node-pty@1.2.0-beta.15'
const INSTALLATION_RECEIPT = 'desktop-official-installation.json'
const runReadOnly = promisify(execFile)

/** A tarball identity recorded by the independently verified official build. */
export interface OfficialPackageInput {
  name: string
  version: string
  path: string
  bytes: number
  sha256: string
}

/** Package fields used to determine production dependencies and install scripts. */
export interface OfficialPackageManifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

declare const verifiedInputs: unique symbol

/** Source and package identity verified before any runtime output is created. */
export interface VerifiedOfficialInputs {
  readonly [verifiedInputs]: true
  source: OfficialRuntimeOrigin & { sourceTree: string }
  descriptorSha256: string
  packages: OfficialPackageInput[]
  policy: Record<string, unknown>
  patches: {
    path: string
    bytes: Buffer
  }[]
}

/** Relocatable input locations and the independently trusted descriptor digest. */
export interface OfficialInputLocations {
  sourceDirectory: string
  packagesDirectory: string
  descriptorPath: string
  descriptorSha256: string
}

/** An explicit shell-free invocation owned by the calling build workflow. */
export interface OfficialRuntimeCommand {
  executable: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  shell: false
}

/** Runtime installation controls; the caller supplies the only mutating process runner. */
export interface OfficialRuntimePreparation {
  runtimeDirectory: string
  pnpmJs: string
  runner: (command: OfficialRuntimeCommand) => Promise<{ exitCode: number; stdout?: string }>
}

/** Host installation identity, separate from the source and package identities. */
export interface OfficialRuntimeReceipt extends OfficialRuntimeOrigin {
  schema: 1
  sourceTree: string
  inputManifestSha256: string
  platform: NodeJS.Platform
  arch: string
  nodeVersion: string
  pnpmVersion: string
  pnpmCliSha256: string
  runtimeDirectory: string
  inventorySha256: string
  reused: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function stringMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {}
  if (!record(value) || Object.values(value).some(item => typeof item !== 'string')) throw new Error(`Invalid ${label}.`)
  return value as Record<string, string>
}

function safeRelative(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !/^[A-Za-z]:|^\\/u.test(path)
    && !path.includes('\\') && path.split('/').every(part => part !== '..' && part !== '.' && part !== '')
}

async function containedFile(root: string, path: string): Promise<string> {
  const physical = await realpath(path)
  const local = relative(await realpath(root), physical)
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`) || !(await lstat(path)).isFile()) {
    throw new Error(`Official input is outside its directory or is not a regular file: ${path}`)
  }
  return physical
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

/**
 * Verify a real archive without extracting files to disk; archive links are not accepted.
 * @param input - independently recorded tarball bytes and identity.
 * @param path - current regular-file location of the tarball.
 * @returns its validated manifest fields needed for runtime policy.
 */
export async function verifyOfficialTarball(input: OfficialPackageInput, path: string): Promise<OfficialPackageManifest> {
  if (!(await lstat(path)).isFile()) throw new Error('Official tarball must be a regular file.')
  const bytes = await readFile(path)
  if (bytes.length !== input.bytes || sha256(bytes) !== input.sha256) throw new Error(`Official tarball bytes/hash mismatch: ${input.name}`)
  const manifest = await archiveManifest(path)
  if (manifest.name !== input.name || manifest.version !== input.version) throw new Error('Official tarball manifest identity mismatch.')
  return manifest
}

/**
 * Describe actual package bytes for a separately verified source-build descriptor.
 * @param path - produced regular tarball file; this does not establish its official source origin.
 * @returns manifest name/version, byte count, and SHA-256 after archive validation.
 */
export async function inspectOfficialTarball(path: string): Promise<Omit<OfficialPackageInput, 'path'>> {
  if (!(await lstat(path)).isFile()) throw new Error('Official tarball must be a regular file.')
  const bytes = await readFile(path)
  const manifest = await archiveManifest(path)
  return { name: manifest.name, version: manifest.version, bytes: bytes.length, sha256: sha256(bytes) }
}

async function archiveManifest(path: string): Promise<OfficialPackageManifest> {
  const options = { encoding: 'utf8' as const, maxBuffer: 16 * 1024 * 1024 }
  const names = (await runReadOnly('tar', ['-tzf', path], options)).stdout.replace(/\r?\n$/u, '').split(/\r?\n/u)
  const seen = new Set<string>()
  for (const name of names) {
    const normalized = name.replace(/\/$/u, '')
    if (!safeRelative(normalized) || (normalized !== 'package' && !normalized.startsWith('package/')) || seen.has(normalized)) {
      throw new Error(`Unsafe or duplicate archive entry: ${name}`)
    }
    seen.add(normalized)
  }
  const verbose = (await runReadOnly('tar', ['-tvzf', path], options)).stdout.replace(/\r?\n$/u, '').split(/\r?\n/u)
  if (verbose.some(line => !/^[-d]/u.test(line))) throw new Error('Official archive entry is a link or unsupported file type.')
  if (!seen.has('package/package.json')) throw new Error('Official archive has no package identity manifest.')
  const manifest: unknown = JSON.parse((await runReadOnly('tar', ['-xOzf', path, 'package/package.json'], options)).stdout)
  if (!record(manifest) || typeof manifest.name !== 'string' || !/^@deepseek-ai\/[a-z0-9][a-z0-9._-]*$/u.test(manifest.name)
    || typeof manifest.version !== 'string' || manifest.version.length === 0) throw new Error('Invalid official tarball manifest identity.')
  return { name: manifest.name, version: manifest.version,
    dependencies: stringMap(manifest.dependencies, 'package dependencies'),
    optionalDependencies: stringMap(manifest.optionalDependencies, 'optional dependencies'),
    scripts: stringMap(manifest.scripts, 'package scripts') }
}

function productionClosure(packages: { manifest: OfficialPackageManifest }[], lockfile: unknown): Set<string> {
  if (!record(lockfile) || !record(lockfile.snapshots)) throw new Error('Official lockfile has no production snapshots.')
  const graph = new Map<string, Set<string>>()
  const add = (name: string, dependencies: Record<string, string>): void => {
    const names = graph.get(name) ?? new Set<string>()
    for (const dependency of Object.keys(dependencies)) names.add(dependency)
    graph.set(name, names)
  }
  for (const [key, snapshot] of Object.entries(lockfile.snapshots)) {
    if (!record(snapshot)) throw new Error('Invalid official dependency snapshot.')
    const name = key.slice(0, key.indexOf('@', 1))
    add(name, { ...stringMap(snapshot.dependencies, 'snapshot dependencies'), ...stringMap(snapshot.optionalDependencies, 'snapshot optional dependencies') })
  }
  const importers = lockfile.importers
  if (record(importers)) {
    for (const [importerPath, importer] of Object.entries(importers)) {
      if (!record(importer)) throw new Error('Invalid official workspace importer.')
      for (const [name, dependency] of Object.entries({
        ...record(importer.dependencies) ? importer.dependencies : {},
        ...record(importer.optionalDependencies) ? importer.optionalDependencies : {},
      })) {
        if (!record(dependency) || typeof dependency.version !== 'string' || !dependency.version.startsWith('link:')) continue
        const target = posix.normalize(posix.join(importerPath, dependency.version.slice(5)))
        const linked = importers[target]
        if (!safeRelative(target) || !record(linked)) throw new Error('Unresolved official production workspace link.')
        add(name, Object.fromEntries(Object.keys({
          ...record(linked.dependencies) ? linked.dependencies : {},
          ...record(linked.optionalDependencies) ? linked.optionalDependencies : {},
        }).map(key => [key, 'workspace'])))
      }
    }
  }
  for (const { manifest } of packages) add(manifest.name, { ...manifest.dependencies, ...manifest.optionalDependencies })
  const reachable = new Set<string>()
  const pending = ['@deepseek-ai/dsh']
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (reachable.has(name)) continue
    reachable.add(name)
    const dependencies = graph.get(name)
    if (dependencies === undefined) throw new Error(`Unresolved official production dependency: ${name}`)
    pending.push(...dependencies)
  }
  return reachable
}

/**
 * Preserve the official build policy and remove only the unreachable dev-only pkg patch.
 * @param policy - YAML value read from the pinned official source.
 * @param rootManifest - official root manifest establishing the pkg development dependency.
 * @param lockfile - official dependency snapshots used for conservative production reachability.
 * @param packages - verified tarball inputs and their actual manifests.
 * @returns local-file overrides and the reviewed runtime install policy.
 */
export function createOfficialRuntimePolicy(
  policy: unknown,
  rootManifest: unknown,
  lockfile: unknown,
  packages: { input: OfficialPackageInput; manifest: OfficialPackageManifest }[],
): Record<string, unknown> {
  if (!record(policy) || !record(policy.allowBuilds) || Object.values(policy.allowBuilds).some(value => typeof value !== 'boolean')
    || !record(policy.patchedDependencies) || !record(rootManifest)) throw new Error('Invalid official pnpm policy.')
  const patches = stringMap(policy.patchedDependencies, 'official patch paths')
  if (patches[PTY_PATCH] !== 'patches/node-pty@1.2.0-beta.15.patch'
    || patches[PKG_PATCH] !== 'patches/@yao-pkg__pkg@6.21.0.patch'
    || stringMap(rootManifest.devDependencies, 'root dev dependencies')['@yao-pkg/pkg'] !== '6.21.0') {
    throw new Error('Official patch and dev-only pkg identities differ from the reviewed policy.')
  }
  const reachable = productionClosure(packages, lockfile)
  if (reachable.has('@yao-pkg/pkg')) throw new Error('The pkg patch is required by the production closure.')
  const subprocess = packages.find(entry => entry.input.name === SUBPROCESS_PACKAGE)
  if (subprocess?.manifest.scripts?.postinstall !== SUBPROCESS_POSTINSTALL
    || Object.keys(subprocess.manifest.scripts).some(key => ['preinstall', 'install', 'prepare'].includes(key))) {
    throw new Error('Unreviewed subprocess-local postinstall identity.')
  }
  const overrides = Object.fromEntries(packages.map(({ input }) => [input.name, `file:${input.path.split(sep).join('/')}`]))
  if (Object.keys(overrides).length !== packages.length) throw new Error('Duplicate official package identity.')
  const allowBuilds = Object.fromEntries(Object.entries(policy.allowBuilds)
    .filter(([key]) => key !== `${SUBPROCESS_PACKAGE}@file:packages/subprocess/subprocess-local`))
  allowBuilds[`${SUBPROCESS_PACKAGE}@${overrides[SUBPROCESS_PACKAGE]}`] = true
  const patchedDependencies = Object.fromEntries(Object.entries(patches).filter(([key]) => key !== PKG_PATCH))
  return { ...structuredClone(policy), packages: [], linkWorkspacePackages: false, overrides, allowBuilds, patchedDependencies,
    strictDepBuilds: true, nodeLinker: 'hoisted', autoInstallPeers: false }
}

async function packageFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Official package input directories cannot contain symlinks.')
      if (entry.isDirectory()) await visit(path)
      else if (entry.name.endsWith('.tgz')) {
        if (files.has(entry.name)) throw new Error('Duplicate official tarball filename.')
        files.set(entry.name, await containedFile(root, path))
      }
    }
  }
  await visit(root)
  return files
}

/**
 * Verify trusted descriptor bytes, clean pinned source, and all 275 actual tarballs.
 * Historical absolute tarball locations are resolved by their unique filename in the supplied package directory.
 * @param locations - current input locations and the independently trusted descriptor SHA-256.
 * @returns verified inputs for the local installation step; does not build or install anything.
 */
export async function verifyOfficialInputs(locations: OfficialInputLocations): Promise<VerifiedOfficialInputs> {
  const descriptorBytes = await readFile(locations.descriptorPath)
  if (!/^[a-f0-9]{64}$/u.test(locations.descriptorSha256) || sha256(descriptorBytes) !== locations.descriptorSha256) throw new Error('Official descriptor hash mismatch.')
  const descriptor: unknown = JSON.parse(descriptorBytes.toString('utf8'))
  if (!record(descriptor) || descriptor.sourceSha !== OFFICIAL_SHA || descriptor.sourceTree !== OFFICIAL_TREE
    || descriptor.harnessVersion !== HARNESS_VERSION || descriptor.sourceDirty !== false) throw new Error('Pinned official source identity is required.')
  if (descriptor.buildCommand !== 'pnpm run build:official' || typeof descriptor.clientBuildRecordSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(descriptor.clientBuildRecordSha256)) throw new Error('Missing official build input evidence.')
  if (!Array.isArray(descriptor.packages) || descriptor.packages.length !== PACKAGE_COUNT) throw new Error('Official input descriptor must contain exactly 275 packages.')
  const inputs: OfficialPackageInput[] = []
  const names = new Set<string>()
  const paths = new Set<string>()
  for (const candidate of descriptor.packages as unknown[]) {
    if (!record(candidate) || typeof candidate.name !== 'string' || !/^@deepseek-ai\/[a-z0-9][a-z0-9._-]*$/u.test(candidate.name)
      || typeof candidate.version !== 'string' || candidate.version.length === 0 || typeof candidate.path !== 'string'
      || typeof candidate.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.sha256)
      || typeof candidate.bytes !== 'number' || !Number.isSafeInteger(candidate.bytes) || candidate.bytes <= 0) throw new Error('Invalid official package input record.')
    const normalized = candidate.path.replace(/\\/gu, '/')
    if (normalized.split('/').includes('..') || normalized.split('/').includes('.')) throw new Error('Official package path escapes its input directory.')
    const filename = basename(normalized)
    if (!filename.endsWith('.tgz') || names.has(candidate.name) || paths.has(filename)) throw new Error('Duplicate or invalid official package identity/path.')
    names.add(candidate.name)
    paths.add(filename)
    inputs.push({ name: candidate.name, version: candidate.version, path: normalized, sha256: candidate.sha256, bytes: candidate.bytes })
  }
  if (inputs.find(input => input.name === '@deepseek-ai/dsh')?.version !== HARNESS_VERSION) throw new Error('Official CLI version differs from the pinned source.')
  const sourceDirectory = await realpath(locations.sourceDirectory)
  const git = async (...args: string[]): Promise<string> => (await runReadOnly('git', ['-c', 'core.fsmonitor=false', '-C', sourceDirectory, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })).stdout.trimEnd()
  if (await git('rev-parse', 'HEAD') !== OFFICIAL_SHA || await git('rev-parse', 'HEAD^{tree}') !== OFFICIAL_TREE
    || await git('status', '--porcelain') !== '') throw new Error('Official source must be clean at the pinned commit and tree.')
  const committed = async (path: string): Promise<Buffer> => {
    if (!safeRelative(path)) throw new Error('Official source input path escapes the checkout.')
    const bytes = await readFile(await containedFile(sourceDirectory, join(sourceDirectory, path)))
    const committedBytes = (await runReadOnly('git', ['-C', sourceDirectory, 'show', `${OFFICIAL_SHA}:${path}`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })).stdout
    if (!bytes.equals(committedBytes)) throw new Error(`Official source input differs from its commit: ${path}`)
    return bytes
  }
  const clientBytes = await readFile(await containedFile(sourceDirectory, join(sourceDirectory, '.dsh-build/client-build-environment.json')))
  if (sha256(clientBytes) !== descriptor.clientBuildRecordSha256) throw new Error('Official client build record hash mismatch.')
  const files = await packageFiles(await realpath(locations.packagesDirectory))
  if (files.size !== PACKAGE_COUNT) throw new Error('Official tarball directory must contain exactly the recorded 275 packages.')
  const verified: { input: OfficialPackageInput; manifest: OfficialPackageManifest }[] = []
  for (const input of inputs) {
    const physical = files.get(basename(input.path))
    if (physical === undefined) throw new Error(`Missing official tarball: ${input.name}`)
    if (!isAbsolute(input.path) && !/^[A-Za-z]:\//u.test(input.path)
      && await containedFile(locations.packagesDirectory, join(locations.packagesDirectory, input.path)) !== physical) throw new Error('Official relative package input path differs from its inventory.')
    const local = { ...input, path: physical }
    verified.push({ input: local, manifest: await verifyOfficialTarball(local, physical) })
  }
  const policy = createOfficialRuntimePolicy(load((await committed('pnpm-workspace.yaml')).toString('utf8'), { schema: JSON_SCHEMA }),
    JSON.parse((await committed('package.json')).toString('utf8')) as unknown,
    load((await committed('pnpm-lock.yaml')).toString('utf8'), { schema: JSON_SCHEMA }), verified)
  const patches = []
  for (const path of Object.values(stringMap(policy.patchedDependencies, 'runtime patches'))) patches.push({ path, bytes: await committed(path) })
  return { source: { sourceSha: OFFICIAL_SHA, sourceTree: OFFICIAL_TREE, harnessVersion: HARNESS_VERSION },
    descriptorSha256: locations.descriptorSha256, packages: verified.map(entry => entry.input), policy, patches } as VerifiedOfficialInputs
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (record(error) && error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Resolve the pinned pnpm package's JavaScript command for Desktop preparation.
 * @param pnpmRoot - directory containing the installed pnpm package manifest.
 * @returns absolute declared regular JavaScript file; rejects wrong identity, missing or escaping entries.
 */
export async function resolveOfficialPnpmCli(pnpmRoot: string): Promise<string> {
  const manifest = await readJson(join(pnpmRoot, 'package.json'))
  if (!record(manifest) || manifest.name !== 'pnpm' || manifest.version !== PNPM_VERSION || !record(manifest.bin)
    || typeof manifest.bin.pnpm !== 'string' || !safeRelative(manifest.bin.pnpm) || !/\.(?:c|m)?js$/u.test(manifest.bin.pnpm)) {
    throw new Error('Runtime preparation requires the exact pnpm 11.7.0 JavaScript CLI.')
  }
  const pnpmJs = resolve(pnpmRoot, manifest.bin.pnpm)
  await containedFile(pnpmRoot, pnpmJs)
  return pnpmJs
}

/**
 * Reuse only a fully inventoried runtime for this host, or install into an exclusively created directory.
 * Existing runtimes without local installation receipts require independent audit/import and are never overwritten.
 * @param inputs - verified output from verifyOfficialInputs; ordinary descriptors are not accepted by this interface.
 * @param options - exact pnpm JS path, output directory, and caller-owned shell-free process runner.
 * @returns source, input, host, package-manager, and runtime-inventory identities.
 */
export async function prepareOfficialRuntime(
  inputs: VerifiedOfficialInputs,
  options: OfficialRuntimePreparation,
): Promise<OfficialRuntimeReceipt> {
  const runtimeDirectory = resolve(options.runtimeDirectory)
  const pnpmJs = resolve(options.pnpmJs)
  const pnpmRoot = dirname(dirname(pnpmJs))
  const declaredPnpmJs = await resolveOfficialPnpmCli(pnpmRoot)
  if (await realpath(declaredPnpmJs) !== await realpath(pnpmJs)) {
    throw new Error('Runtime preparation requires the exact pnpm 11.7.0 JavaScript CLI.')
  }
  const identity = { schema: 1 as const, ...inputs.source, inputManifestSha256: inputs.descriptorSha256,
    platform: process.platform, arch: process.arch, nodeVersion: process.version,
    pnpmVersion: PNPM_VERSION, pnpmCliSha256: sha256(await readFile(pnpmJs)) }
  const receiptPath = join(runtimeDirectory, INSTALLATION_RECEIPT)
  if (await exists(runtimeDirectory)) {
    if (!(await lstat(runtimeDirectory)).isDirectory()) throw new Error('Existing runtime must be a physical directory.')
    if (!await exists(receiptPath)) throw new Error('Missing local installation receipt; independent audit/import is required.')
    const receipt = await readJson(await containedFile(runtimeDirectory, receiptPath))
    if (!record(receipt) || Object.keys(receipt).length !== Object.keys(identity).length
      || Object.entries(identity).some(([key, value]) => receipt[key] !== value)) throw new Error('Runtime installation receipt does not match source, inputs, platform/arch, Node, or pnpm.')
    const provenance = await verifyOfficialRuntime(runtimeDirectory)
    return { ...identity, runtimeDirectory: await realpath(runtimeDirectory), inventorySha256: provenance.inventorySha256, reused: true }
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:npm_config_|pnpm_)/iu.test(key)))
  const version = await options.runner({ executable: process.execPath, args: [pnpmJs, '--version'], cwd: dirname(pnpmJs), env, shell: false })
  if (version.exitCode !== 0 || version.stdout?.trim() !== PNPM_VERSION) throw new Error('The invoked pnpm CLI did not report version 11.7.0.')
  const policy = structuredClone(inputs.policy)
  const subprocess = inputs.packages.find(input => input.name === SUBPROCESS_PACKAGE)
  const cli = inputs.packages.find(input => input.name === '@deepseek-ai/dsh')
  if (subprocess === undefined || cli === undefined || !record(policy.allowBuilds)) throw new Error('Verified runtime inputs lack the CLI or subprocess install policy.')
  const relativeInput = relative(runtimeDirectory, subprocess.path).split(sep).join('/')
  policy.allowBuilds[`${SUBPROCESS_PACKAGE}@file:${relativeInput}`] = true
  await mkdir(dirname(runtimeDirectory), { recursive: true })
  await mkdir(runtimeDirectory)
  await writeFile(join(runtimeDirectory, 'package.json'), `${JSON.stringify({ name: 'dsh-official-runtime', version: HARNESS_VERSION,
    private: true, type: 'module', packageManager: `pnpm@${PNPM_VERSION}`,
    dependencies: { '@deepseek-ai/dsh': `file:${cli.path.split(sep).join('/')}` } }, null, 2)}\n`, { flag: 'wx' })
  await writeFile(join(runtimeDirectory, 'pnpm-workspace.yaml'), `${JSON.stringify(policy, null, 2)}\n`, { flag: 'wx' })
  const userconfig = join(runtimeDirectory, '.npmrc')
  await writeFile(userconfig, '', { flag: 'wx' })
  for (const patch of inputs.patches) {
    const path = join(runtimeDirectory, patch.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, patch.bytes, { flag: 'wx' })
  }
  const result = await options.runner({ executable: process.execPath, args: [pnpmJs, 'install', '--prod', '--no-frozen-lockfile', `--config.npmrc-auth-file=${userconfig}`],
    cwd: runtimeDirectory, env, shell: false })
  if (result.exitCode !== 0) throw new Error(`Official runtime install failed with exit code ${String(result.exitCode)}; output is retained for audit.`)
  const installed = await readJson(await containedFile(runtimeDirectory, join(runtimeDirectory, 'node_modules/@deepseek-ai/dsh/package.json')))
  if (!record(installed) || installed.name !== '@deepseek-ai/dsh' || installed.version !== HARNESS_VERSION) throw new Error('Installed official CLI identity is inconsistent.')
  await containedFile(runtimeDirectory, join(runtimeDirectory, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
  await writeFile(receiptPath, `${JSON.stringify(identity, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  const provenance = await recordOfficialRuntime(runtimeDirectory, inputs.source)
  return { ...identity, runtimeDirectory: await realpath(runtimeDirectory), inventorySha256: provenance.inventorySha256, reused: false }
}
