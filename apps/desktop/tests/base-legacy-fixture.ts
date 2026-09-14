/** Generate synthetic history through a verified old production runtime; never relabel new Session data. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { desktopBaseLegacyBaseline, DESKTOP_BASE_LINUX_LEGACY_ASSETS } from '../../../scripts/desktop-base-contract.ts'
const TOOL_OUTPUT = 'R7_LEGACY_TOOL_OK'
const PUBLIC_PACKAGES = {
  cordis: '@deepseek-ai/cordis', session: '@deepseek-ai/dsh-session', persistence: '@deepseek-ai/dsh-session-persistence-jsonl',
  storage: '@deepseek-ai/dsh-storage', storageJson: '@deepseek-ai/dsh-storage-json', storageDomain: '@deepseek-ai/dsh-storage-domain',
  workspace: '@deepseek-ai/dsh-workspace', boot: '@deepseek-ai/dsh-app-boot', llm: '@deepseek-ai/dsh-llm',
}

/** Platform-owned old release inputs. Every executed/imported entry must have an independently supplied expected hash. */
export interface BaseLegacyRuntimeInput {
  artifactPath: string
  artifactSha256: string
  releaseUrl: string
  extractedRoot: string
  modulesRoot: string
  executablePath: string
  executableKind: 'electron' | 'node'
  cliPath: string
  applicationAsarPath?: string
  applicationManifestPath?: string
  sourceSha: string
  desktopVersion: string
  harnessVersion: string
  platform: string
  arch: string
  files: { path: string; sha256: string }[]
}

/** A new exclusive root and a real old release; no successful fake process runner is accepted. */
export interface BaseLegacyFixtureOptions {
  isolationRoot: string
  legacy: BaseLegacyRuntimeInput
}

/** Old-reader-confirmed fixture locations. All paths refer to synthetic data under the isolation root. */
export interface BaseLegacyFixture {
  oldVersion: string
  harnessVersion: string
  sourceSha: string
  sessionId: string
  title: string
  workspacePath: string
  protectedPaths: string[]
  fixtureReceiptPath: string
}

/** Immutable synthetic file evidence, relative to the fixture root. */
export interface LegacyFixtureFile {
  path: string
  bytes: number
  sha256: string
}

/** Read-only fixture verification result; Workspace storage is checked semantically rather than frozen as a whole. */
export interface VerifiedBaseLegacyFixture extends BaseLegacyFixture {
  dshHome: string
  protectedFiles: LegacyFixtureFile[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function coded(code: string, message: string): Error { return new Error(`${code}: ${message}`) }
function within(root: string, path: string, code: string): void {
  const local = relative(root, path)
  if (!isAbsolute(path) || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw coded(code, 'path is outside its declared root')
}
async function physical(root: string, path: string, code: string): Promise<string> {
  if (!isAbsolute(path)) throw coded(code, 'path must be absolute')
  within(root, join(await realpath(dirname(path)), basename(path)), code)
  const target = await realpath(path)
  within(root, target, code)
  return target
}
async function hash(path: string): Promise<string> {
  if (!(await lstat(path)).isFile()) throw coded('legacy-file-invalid', 'a regular file is required')
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) as unknown }
async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
async function absent(path: string): Promise<void> {
  try { await lstat(path) } catch (error) {
    if (record(error) && error.code === 'ENOENT') return
    throw error
  }
  throw coded('fixture-root-exists', 'isolation root already exists; nothing was changed')
}

async function validateInput(options: BaseLegacyFixtureOptions) {
  const legacy = options.legacy
  const baseline = desktopBaseLegacyBaseline(legacy.platform)
  if (legacy.sourceSha !== baseline.sourceSha || legacy.desktopVersion !== baseline.desktopVersion
    || legacy.harnessVersion !== baseline.harnessVersion
    || legacy.arch !== 'x64' || legacy.platform !== process.platform || legacy.arch !== process.arch) {
    throw coded('legacy-runtime-identity', 'requires the pinned old source, versions and matching native platform/ABI')
  }
  const url = new URL(legacy.releaseUrl)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw coded('legacy-runtime-identity', 'release provenance requires a credential-free HTTPS URL')
  }
  if (!isAbsolute(options.isolationRoot) || !isAbsolute(legacy.extractedRoot) || !isAbsolute(legacy.artifactPath)) {
    throw coded('legacy-path-escape', 'inputs and isolation root must be absolute')
  }
  await absent(options.isolationRoot)
  const artifactBytes = (await lstat(legacy.artifactPath)).size
  if (!/^[a-f\d]{64}$/u.test(legacy.artifactSha256) || await hash(legacy.artifactPath) !== legacy.artifactSha256) {
    throw coded('legacy-artifact-hash', 'old asset bytes differ from the platform-provided receipt')
  }
  const extractedRoot = await realpath(legacy.extractedRoot)
  for (const path of [legacy.executablePath, legacy.modulesRoot, legacy.cliPath,
    ...(legacy.applicationAsarPath === undefined ? [] : [legacy.applicationAsarPath]),
    ...(legacy.applicationManifestPath === undefined ? [] : [legacy.applicationManifestPath])]) {
    within(resolve(legacy.extractedRoot), resolve(path), 'legacy-path-escape')
  }
  if (relative(extractedRoot, options.isolationRoot) === '' || !relative(extractedRoot, options.isolationRoot).startsWith('..')) {
    throw coded('legacy-path-escape', 'fixture writes cannot enter the old installation')
  }
  if (legacy.platform === 'linux' && !DESKTOP_BASE_LINUX_LEGACY_ASSETS.some(asset =>
    asset.sha256 === legacy.artifactSha256 && asset.bytes === artifactBytes)) {
    throw coded('legacy-artifact-hash', 'Linux history requires the published 0.5.7 AppImage or deb bytes')
  }
  try {
    const required = [legacy.executablePath, legacy.cliPath]
    for (const path of required) await physical(extractedRoot, path, 'legacy-path-escape')
    await physical(extractedRoot, legacy.modulesRoot, 'legacy-path-escape')
    const resolver = createRequire(legacy.cliPath)
    const imports = Object.fromEntries(Object.entries(PUBLIC_PACKAGES).map(([key, name]) => [key, resolver.resolve(name)] as const))
    const manifests = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence-jsonl']
      .map(name => resolver.resolve(`${name}/package.json`))
    for (const path of manifests) {
      const manifest = await json(await physical(extractedRoot, path, 'legacy-path-escape'))
      if (!record(manifest) || manifest.version !== baseline.harnessVersion) throw coded('legacy-runtime-identity', 'an old runtime package has the wrong version')
    }
    const applicationPath = legacy.applicationAsarPath ?? legacy.applicationManifestPath
    if (applicationPath === undefined) throw coded('legacy-runtime-unavailable', 'application identity input is missing')
    const expected = new Map<string, string>()
    for (const file of legacy.files) {
      const path = await physical(extractedRoot, file.path, 'legacy-path-escape')
      if (expected.has(path) || !/^[a-f\d]{64}$/u.test(file.sha256)) throw coded('legacy-runtime-identity', 'duplicate or invalid expected file hash')
      expected.set(path, file.sha256)
    }
    const files = [...new Set([...required, ...Object.values(imports), ...manifests, applicationPath])]
    const verified: { path: string; sha256: string }[] = []
    for (const entry of files) {
      const path = await physical(extractedRoot, entry, 'legacy-path-escape')
      const sha256 = await hash(path)
      if (expected.get(path) !== sha256) throw coded('legacy-runtime-identity', 'a required old executable/import has no matching expected hash')
      verified.push({ path, sha256 })
    }
    return { imports, manifests, verified, extractedRoot }
  } catch (error) {
    if (error instanceof Error && /legacy-(?:path|runtime)-/u.test(error.message)) throw error
    throw coded('legacy-runtime-unavailable', error instanceof Error ? error.message : 'old installed runtime cannot be read')
  }
}

const DRIVER = String.raw`
import { readFile, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const mode = process.argv[3]
const modules = Object.fromEntries(await Promise.all(Object.entries(config.imports).map(async ([name, path]) => [name, await import(pathToFileURL(path).href)])))
if (modules.session.SESSION_FORMAT_VERSION !== 2) throw new Error('Old public Session format is not V2.')
const manifestPath = config.applicationAsarPath === undefined ? config.applicationManifestPath : join(config.applicationAsarPath, 'package.json')
const application = JSON.parse(await readFile(manifestPath, 'utf8'))
if (application.version !== config.desktopVersion) throw new Error('Old application package version differs.')
const identity = { desktopVersion: application.version, node: process.version, electron: process.versions.electron ?? null,
  platform: process.platform, arch: process.arch, sessionFormatVersion: modules.session.SESSION_FORMAT_VERSION }
if (identity.platform !== config.platform || identity.arch !== 'x64') throw new Error('Old process target differs.')
if (config.executableKind === 'electron' && identity.electron !== '43.4.0') throw new Error('Old Electron ABI differs.')
if (mode === 'bootstrap') {
  const template = modules.boot.PROFILE_TEMPLATES.web
  modules.boot.initProfile(join(config.dshHome, 'profiles/web'), template.bundles, template.patchReload)
  await modules.boot.healProfilesModuleFallback({ installAnchor: config.harnessManifest, home: config.dshHome })
  await writeFile(join(config.driverRoot, 'bootstrap.json'), JSON.stringify({ identity, webBundles: template.bundles }), { flag: 'wx' })
} else {
  const ctx = new modules.cordis.Context()
  let result
  try {
    await ctx.plugin(modules.session.default)
    await ctx.plugin(modules.persistence.default, { root: join(config.dshHome, 'sessions') })
    const sessions = await ctx.sessionPersistence.list()
    if (sessions.length !== 1) throw new Error('Old production fixture must contain exactly one stored session.')
    const header = sessions[0].header
    const handle = await ctx.sessionPersistence.open(header.id, 'read')
    const events = await handle.read()
    await handle.close()
    if (header.version !== 2 || header.cwd !== await realpath(config.workspacePath)) throw new Error('Old reader header mismatch.')
    if (!events.every((event, index) => event.seq === index)) throw new Error('Old events are not contiguous.')
    const firstStep = events.findIndex(event => event.type === 'step/start')
    const firstSurface = events.findIndex(event => event.type === 'user/message')
    if (firstStep < 0 || firstSurface <= firstStep) throw new Error('Old production event ordering differs.')
    const title = events.filter(event => event.type === 'session/title').at(-1)?.data?.title
    if (typeof title !== 'string' || title.length === 0) throw new Error('Old production session title is missing.')
    const tool = events.filter(event => event.type === 'tool/result').flatMap(event => event.data.message.content)
      .some(block => block.type === 'tool-result' && block.isError === false
        && block.content.filter(item => item.type === 'text').map(item => item.text).join('').trim() === config.toolOutput)
    const assistant = events.filter(event => event.type === 'assistant/message')
      .some(event => event.data.message.content.some(block => block.type === 'text' && block.text.includes(config.toolOutput)))
    if (!tool || !assistant) throw new Error('Old production shell/assistant round trip is missing.')
    await ctx.plugin(modules.storage.default)
    await ctx.plugin(modules.storageJson, { root: join(config.dshHome, 'storages') })
    await ctx.plugin(modules.storageDomain, { backend: 'json' })
    await ctx.plugin(modules.workspace.default)
    let workspace = ctx.workspaceRegistry.list().find(item => item.path === header.cwd)
    if (mode === 'inspect') {
      workspace ??= await ctx.workspaceRegistry.create(header.cwd, 'R7 legacy workspace')
      await workspace.setTitle('R7 legacy workspace')
      await workspace.attachSession(header.id)
    }
    if (workspace === undefined || !workspace.sessionIds.includes(header.id)) throw new Error('Old Workspace reader lost session membership.')
    result = { identity, sessionId: header.id, title, eventCount: events.length, firstStep, firstSurface,
      oldReaderPassed: true, toolOutputPassed: tool, assistantOutputPassed: assistant,
      workspace: { id: workspace.id, path: workspace.path, title: workspace.title, sessionIds: [...workspace.sessionIds] } }
  } finally { await ctx.fiber.dispose() }
  await writeFile(join(config.driverRoot, mode + '.json'), JSON.stringify(result), { flag: 'wx' })
}
`

function mockProvider(llmPath: string): string {
  return `import { LlmAdapter, ToolCallId, ReasoningEffortId } from ${JSON.stringify(pathToFileURL(llmPath).href)}
const tool = process.platform === 'win32' ? 'pwsh' : 'bash'
const command = process.platform === 'win32' ? "Write-Output '${TOOL_OUTPUT}'" : 'printf ${TOOL_OUTPUT}'
class FixtureAdapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model, reasoning: {
    efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }], defaultEffort: ReasoningEffortId('off') } } }
  async *stream(options) {
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (result === undefined) {
      const args = JSON.stringify({ command, description: 'Run a synthetic old-runtime fixture command.' })
      const block = { type: 'tool-call', id: ToolCallId('r7-legacy-tool'), name: tool, arguments: args }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = 'Legacy fixture complete: ' + result.content.filter(block => block.type === 'text').map(block => block.text).join('').trim()
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
export const name = 'r7-legacy-fixture-llm'
export const inject = ['llm']
export function apply(ctx) { ctx.effect(() => ctx.llm.registerAdapter(['cli-mock'], new FixtureAdapter()), 'legacy fixture adapter') }
`
}

function environment(home: string, temporary: string, dshHome: string, kind: 'electron' | 'node'): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: home, USERPROFILE: home, TMPDIR: temporary, TMP: temporary, TEMP: temporary, DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'danger-full-access',
    PATH: process.platform === 'win32'
      ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32;${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0`
      : '/usr/bin:/bin:/usr/sbin:/sbin',
  }
  for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key] !== undefined) env[key] = process.env[key]
  if (kind === 'electron') env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

async function runOld(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, output: string) {
  const startedAt = new Date().toISOString()
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(executable, ['--expose-internals', ...args], { cwd, env, timeout: 90_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        if (error !== null) reject(Object.assign(coded('legacy-production-failed', error.message), { stdout, stderr }))
        else resolve({ exitCode: 0, stdout, stderr })
      })
  }).catch(async (error: unknown) => {
    try { await writeJson(output, { startedAt, status: 'failed', message: error instanceof Error ? error.message : 'unknown old-process failure' }) } catch {
      // Failure to write a diagnostic cannot replace the original old-process failure.
    }
    throw error
  })
  await writeJson(output, { startedAt, ...result })
  return { startedAt, exitCode: result.exitCode, stdoutSha256: createHash('sha256').update(result.stdout).digest('hex'),
    stderrSha256: createHash('sha256').update(result.stderr).digest('hex') }
}

async function recursiveFiles(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await recursiveFiles(path))
    else if (entry.isFile()) result.push(path)
    else throw coded('fixture-path-escape', 'protected fixture files cannot be symlinks')
  }
  return result
}
async function fileReceipt(root: string, path: string): Promise<LegacyFixtureFile> {
  const target = await physical(root, path, 'fixture-path-escape')
  return { path: relative(root, target).split(sep).join('/'), bytes: (await lstat(target)).size, sha256: await hash(target) }
}

/**
 * Run one fake-provider turn through an old production headless profile, then read it twice through the old public reader.
 * Only new isolated HOME, DSH_HOME, temporary and workspace directories are written; the old installation remains immutable.
 * @param options - exclusive fixture destination and platform-verified old release inputs.
 * @returns old reader identity and protected synthetic files; no receipt is published if old execution fails.
 * @throws on missing/mismatched old assets, escaped paths, existing output, or unsuccessful production/readback operations.
 */
export async function prepareBaseLegacyFixture(options: BaseLegacyFixtureOptions): Promise<BaseLegacyFixture> {
  const verified = await validateInput(options)
  const baseline = desktopBaseLegacyBaseline(options.legacy.platform)
  await mkdir(options.isolationRoot, { mode: 0o700 })
  const root = await realpath(options.isolationRoot)
  const home = join(root, 'home')
  const dshHome = join(home, '.dsh')
  const temporary = join(root, 'tmp')
  const workspacePath = join(root, 'workspace')
  const driverRoot = join(root, 'driver')
  for (const path of [dshHome, temporary, workspacePath, driverRoot]) await mkdir(path, { recursive: true, mode: 0o700 })
  const env = environment(home, temporary, dshHome, options.legacy.executableKind)
  const configPath = join(driverRoot, 'config.json')
  await writeJson(configPath, { imports: verified.imports, harnessManifest: verified.manifests[0],
    applicationAsarPath: options.legacy.applicationAsarPath, applicationManifestPath: options.legacy.applicationManifestPath,
    executableKind: options.legacy.executableKind, platform: options.legacy.platform, desktopVersion: baseline.desktopVersion,
    dshHome, workspacePath, driverRoot, toolOutput: TOOL_OUTPUT })
  const driverPath = join(driverRoot, 'old-public-driver.mjs')
  await writeFile(driverPath, DRIVER, { flag: 'wx', mode: 0o600 })
  const llmPath = verified.imports.llm
  if (llmPath === undefined) throw coded('legacy-runtime-unavailable', 'old LLM API is absent')
  const providerPath = join(driverRoot, 'mock-provider.mjs')
  await writeFile(providerPath, mockProvider(llmPath), { flag: 'wx', mode: 0o600 })
  const patchPath = join(driverRoot, 'fixture.patch.yml')
  await writeFile(patchPath, `- id: llm-deepseek\n  disabled: true\n- id: session-title-llm\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: cli-mock\n    model: cli-mock\n- insert:\n    - id: r7-legacy-fixture-llm\n      name: ${JSON.stringify(providerPath)}\n`, { flag: 'wx', mode: 0o600 })
  const executions = []
  for (const mode of ['bootstrap', 'headless', 'inspect', 'verify']) {
    const args = mode === 'headless'
      ? [options.legacy.cliPath, '--profile', 'headless', '--patch', patchPath, 'R7 legacy fixture conversation: perform the tool round trip and stop.']
      : [driverPath, configPath, mode]
    executions.push({ mode, ...await runOld(options.legacy.executablePath, args, workspacePath, env, join(driverRoot, `${mode}-process.json`)) })
  }
  const observed = await json(join(driverRoot, 'verify.json'))
  if (!record(observed) || observed.oldReaderPassed !== true || observed.toolOutputPassed !== true
    || observed.assistantOutputPassed !== true
    || typeof observed.sessionId !== 'string' || typeof observed.title !== 'string' || !record(observed.workspace) || !record(observed.identity)) {
    throw coded('legacy-readback-invalid', 'the old public reader did not produce a complete result')
  }
  const evolutionSource = join(root, 'evolution-source')
  const evolutionInstalled = join(dshHome, 'profiles/web/node_modules/dsh-missher-evolution')
  const evolutionData = join(dshHome, 'evolution-fixture-data')
  for (const path of [evolutionSource, evolutionInstalled, evolutionData]) await mkdir(path, { recursive: true, mode: 0o700 })
  const evolution = { name: 'dsh-missher-evolution', version: '0.7.0', type: 'module', main: 'index.js',
    fixtureOnly: true, origin: 'synthetic-evolution-origin', dsh: { bundle: { patch: './cordis.patch.yml' } } }
  for (const path of [evolutionSource, evolutionInstalled]) {
    await writeJson(join(path, 'package.json'), evolution)
    await writeFile(join(path, 'index.js'), "export const fixtureOnly = true\nexport const origin = 'synthetic-evolution-origin'\nexport function apply() {}\n", { flag: 'wx' })
    await writeFile(join(path, 'cordis.patch.yml'), '# Synthetic Evolution fixture; no Evolution algorithm executes.\n[]\n', { flag: 'wx' })
  }
  await writeJson(join(evolutionData, 'sentinel.json'), { fixtureOnly: true, marker: 'R7_LEGACY_EVOLUTION_070_DATA' })
  const profilePath = join(dshHome, 'profiles/web/package.json')
  const profile = await json(profilePath)
  if (!record(profile) || !record(profile.dsh) || !record(profile.dsh.profile) || !Array.isArray(profile.dsh.profile.bundles)) {
    throw coded('legacy-profile-invalid', 'old public initProfile did not create the canonical web profile')
  }
  profile.dependencies = { 'dsh-missher-evolution': `file:${evolutionSource}` }
  profile.dsh.profile.bundles.push('dsh-missher-evolution')
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
  const sessionFiles = (await recursiveFiles(join(dshHome, 'sessions'))).filter(path => /session\.v2\.jsonl(?:\.zstd)?$/u.test(path))
  if (sessionFiles.length !== 1) throw coded('legacy-readback-invalid', 'expected one actual V2 generation file')
  const protectedPaths = [...sessionFiles, profilePath, join(dshHome, 'profiles/web/cordis.patch.yml'),
    join(dshHome, 'profiles/web/pnpm-workspace.yaml'), ...await recursiveFiles(evolutionSource),
    ...await recursiveFiles(evolutionInstalled), ...await recursiveFiles(evolutionData)]
  const protectedFiles = await Promise.all(protectedPaths.map(path => fileReceipt(root, path)))
  for (const file of verified.verified) if (await hash(file.path) !== file.sha256) throw coded('legacy-runtime-mutated', 'an old source file changed')
  const fixtureReceiptPath = join(root, 'legacy-fixture.json')
  const result: BaseLegacyFixture = { oldVersion: baseline.desktopVersion, harnessVersion: baseline.harnessVersion,
    sourceSha: baseline.sourceSha,
    sessionId: observed.sessionId, title: observed.title, workspacePath, protectedPaths, fixtureReceiptPath }
  await writeJson(fixtureReceiptPath, { schema: 1, fixtureOnly: true, mode: 'old-runtime-agent-generated',
    isolationRoot: root, dshHome, platform: options.legacy.platform, ...result, oldReaderPassed: true,
    identity: observed.identity, eventCount: observed.eventCount, expectedToolOutput: TOOL_OUTPUT,
    executions, protectedFiles, oldInputs: { ...options.legacy,
      artifactBytes: (await lstat(options.legacy.artifactPath)).size, files: verified.verified },
    workspace: { ...observed.workspace, storagePath: relative(root, join(dshHome, 'storages/workspace.json')).split(sep).join('/'),
      initialSha256: await hash(join(dshHome, 'storages/workspace.json')) },
    evolution: { fixtureOnly: true, origin: 'synthetic-evolution-origin', version: '0.7.0', algorithmCompatibilityTested: false },
    producerFiles: await Promise.all([driverPath, providerPath, patchPath, configPath, ...['bootstrap', 'inspect', 'verify'].map(mode => join(driverRoot, `${mode}.json`))]
      .map(path => fileReceipt(root, path))),
  })
  await verifyBaseLegacyFixture(fixtureReceiptPath, { isolationRoot: root, platform: options.legacy.platform })
  return result
}

/**
 * Validate frozen old Session/profile/Evolution bytes and retained Workspace membership without rewriting the fixture.
 * @param receiptPath - real producer receipt inside the declared fixture root.
 * @param options - exact fixture root and native platform expected by the consuming smoke.
 * @returns old fixture paths and verified protected hashes, suitable for before/after upgrade comparisons.
 * @throws on incomplete execution evidence, escaped or changed files, or lost old Workspace membership.
 */
export async function verifyBaseLegacyFixture(
  receiptPath: string, options: { isolationRoot: string; platform: string },
): Promise<VerifiedBaseLegacyFixture> {
  const baseline = desktopBaseLegacyBaseline(options.platform)
  const root = await realpath(options.isolationRoot)
  await physical(root, receiptPath, 'fixture-path-escape')
  const receipt = await json(receiptPath)
  if (!record(receipt) || receipt.schema !== 1 || receipt.fixtureOnly !== true || receipt.mode !== 'old-runtime-agent-generated'
    || receipt.isolationRoot !== root || receipt.platform !== options.platform || receipt.oldVersion !== baseline.desktopVersion
    || receipt.harnessVersion !== baseline.harnessVersion || receipt.sourceSha !== baseline.sourceSha || receipt.oldReaderPassed !== true
    || typeof receipt.sessionId !== 'string' || typeof receipt.title !== 'string' || typeof receipt.workspacePath !== 'string'
    || typeof receipt.dshHome !== 'string' || !Array.isArray(receipt.protectedFiles) || receipt.protectedFiles.length < 7
    || !Array.isArray(receipt.producerFiles) || receipt.producerFiles.length < 6 || !Array.isArray(receipt.executions)
    || !record(receipt.identity) || receipt.identity.sessionFormatVersion !== 2
    || receipt.identity.desktopVersion !== baseline.desktopVersion
    || !record(receipt.oldInputs) || receipt.oldInputs.desktopVersion !== baseline.desktopVersion
    || receipt.oldInputs.harnessVersion !== baseline.harnessVersion || receipt.oldInputs.sourceSha !== baseline.sourceSha
    || receipt.oldInputs.platform !== options.platform || !record(receipt.workspace)) {
    throw coded('fixture-receipt-invalid', 'requires observed old production execution and complete protected-file evidence')
  }
  const oldInputs = receipt.oldInputs
  if (options.platform === 'linux' && !DESKTOP_BASE_LINUX_LEGACY_ASSETS.some(asset =>
    asset.sha256 === oldInputs.artifactSha256 && asset.bytes === oldInputs.artifactBytes)) {
    throw coded('fixture-receipt-invalid', 'Linux fixture does not identify a pinned published old asset')
  }
  const modes = receipt.executions.map((value: unknown) => record(value) && value.exitCode === 0 ? value.mode : undefined)
  if (JSON.stringify(modes) !== JSON.stringify(['bootstrap', 'headless', 'inspect', 'verify'])) throw coded('fixture-receipt-invalid', 'old process phases did not all succeed')
  await physical(root, receipt.dshHome, 'fixture-path-escape')
  await physical(root, receipt.workspacePath, 'fixture-path-escape')
  const protectedFiles: LegacyFixtureFile[] = []
  const protectedPaths: string[] = []
  const protectedInputs: unknown[] = receipt.protectedFiles
  const producerInputs: unknown[] = receipt.producerFiles
  const files = [...protectedInputs, ...producerInputs]
  const names = new Set<string>()
  for (const entry of files) {
    if (!record(entry) || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string' || typeof entry.bytes !== 'number') {
      throw coded('fixture-receipt-invalid', 'invalid protected-file record')
    }
    const path = await physical(root, resolve(root, entry.path), 'fixture-path-escape')
    if (names.has(path)) throw coded('fixture-receipt-invalid', 'duplicate protected path')
    names.add(path)
    const actual = await fileReceipt(root, path)
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw coded('fixture-file-changed', actual.path)
    if (protectedFiles.length < receipt.protectedFiles.length) { protectedFiles.push(actual); protectedPaths.push(path) }
  }
  for (const phase of receipt.executions as unknown[]) {
    if (!record(phase) || typeof phase.mode !== 'string') throw coded('fixture-receipt-invalid', 'invalid execution phase')
    const processLog = await json(await physical(root, join(root, 'driver', `${phase.mode}-process.json`), 'fixture-path-escape'))
    if (!record(processLog) || processLog.exitCode !== 0 || typeof processLog.stdout !== 'string' || typeof processLog.stderr !== 'string'
      || createHash('sha256').update(processLog.stdout).digest('hex') !== phase.stdoutSha256
      || createHash('sha256').update(processLog.stderr).digest('hex') !== phase.stderrSha256) {
      throw coded('fixture-receipt-invalid', 'old execution evidence differs from its process log')
    }
  }
  const observation = await json(await physical(root, join(root, 'driver/verify.json'), 'fixture-path-escape'))
  if (!record(observation) || observation.sessionId !== receipt.sessionId || observation.title !== receipt.title
    || observation.oldReaderPassed !== true || observation.toolOutputPassed !== true || observation.assistantOutputPassed !== true
    || !record(observation.identity) || observation.identity.sessionFormatVersion !== 2
    || observation.identity.desktopVersion !== baseline.desktopVersion || observation.identity.platform !== options.platform
    || observation.identity.arch !== 'x64') {
    throw coded('fixture-receipt-invalid', 'old public reader observation differs from the claimed fixture')
  }
  const workspace = receipt.workspace
  if (typeof workspace.storagePath !== 'string' || typeof workspace.id !== 'string') throw coded('fixture-receipt-invalid', 'old workspace evidence is absent')
  const state = await json(await physical(root, resolve(root, workspace.storagePath), 'fixture-path-escape'))
  const old = record(state) && record(state.tables) && record(state.tables.workspaces) ? state.tables.workspaces[workspace.id] : undefined
  if (!record(state) || !record(state.global) || !Array.isArray(state.global.workspaceIds)
    || !state.global.workspaceIds.includes(workspace.id) || !record(old) || old.path !== workspace.path || old.title !== workspace.title
    || !Array.isArray(old.sessionIds) || !old.sessionIds.includes(receipt.sessionId)) {
    throw coded('fixture-workspace-changed', 'old workspace identity or Session membership was lost')
  }
  return { oldVersion: baseline.desktopVersion, harnessVersion: baseline.harnessVersion,
    sourceSha: baseline.sourceSha, sessionId: receipt.sessionId,
    title: receipt.title, workspacePath: receipt.workspacePath, fixtureReceiptPath: receiptPath, protectedPaths,
    dshHome: receipt.dshHome, protectedFiles }
}
