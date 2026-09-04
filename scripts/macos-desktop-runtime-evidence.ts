import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  PROFILE_BOOT_DETAIL_PHASES,
  parseDesktopStartupSample,
  summarizeDesktopStartupSamples,
  type DesktopStartupSample,
  type DesktopStartupSummary,
} from './desktop-startup-benchmark.ts'

const execFileAsync = promisify(execFile)
const SAMPLE_COUNT = 10
const BASELINE_VERSION = '0.5.3'
const CANDIDATE_VERSION = '0.5.4'
const BASELINE_TAG = 'desktop-v0.5.3'
const APP_NAME = 'DeepSeek Harness.app'
const EXECUTABLE_NAME = 'DeepSeek Harness'
const BUNDLE_IDENTIFIER = 'ai.deepseek.harness.desktop'
const STARTUP_TIMEOUT_MS = 120_000
const SHUTDOWN_TIMEOUT_MS = 30_000
const POLL_MS = 100

export interface StartupMetric {
  readonly medianMs: number
  readonly p95Ms: number
}

export interface StartupPair {
  readonly cold: StartupMetric
  readonly warm: StartupMetric
}

interface MetricComparison {
  readonly medianImprovementPercent: number
  readonly p95RegressionPercent: number
}

export interface MacStartupGate {
  readonly passed: boolean
  readonly cold: MetricComparison
  readonly warm: MetricComparison
  readonly requirements: {
    readonly oneMedianImprovesAtLeastPercent: 15
    readonly otherMedianRegressionAtMostPercent: 5
    readonly eachP95RegressionAtMostPercent: 10
  }
}

interface ProductDescriptor {
  readonly role: 'baseline' | 'candidate'
  readonly version: string
  readonly dmgPath: string
  readonly mountPoint: string
  readonly executable: string
  readonly appRoot: string
  readonly dmgBytes: number
  readonly dmgSha256: string
  readonly appAsarSha256: string
  readonly iconSha256: string
}

interface ProductSamples {
  readonly descriptor: ProductDescriptor
  readonly cold: DesktopStartupSample[]
  readonly warm: DesktopStartupSample[]
  readonly warmHome: string
  readonly warmUserData: string
  readonly markerSnapshots: Map<string, string>
}

interface CliOptions {
  readonly baselineDmg: string
  readonly candidateDmg: string
  readonly candidateRevision: string
  readonly output: string
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100
}

function requirePositiveMetric(product: string, phase: string, metric: StartupMetric): void {
  for (const [name, value] of Object.entries(metric)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`macOS startup gate: ${product} ${phase} ${name} must be positive`)
    }
  }
}

function compareMetric(baseline: StartupMetric, candidate: StartupMetric): MetricComparison {
  return {
    medianImprovementPercent: roundPercent((baseline.medianMs - candidate.medianMs) / baseline.medianMs * 100),
    p95RegressionPercent: roundPercent((candidate.p95Ms - baseline.p95Ms) / baseline.p95Ms * 100),
  }
}

/** Apply the release contract to one same-runner cold/warm comparison. */
export function evaluateMacStartupGate(baseline: StartupPair, candidate: StartupPair): MacStartupGate {
  requirePositiveMetric('baseline', 'cold', baseline.cold)
  requirePositiveMetric('baseline', 'warm', baseline.warm)
  requirePositiveMetric('candidate', 'cold', candidate.cold)
  requirePositiveMetric('candidate', 'warm', candidate.warm)
  const cold = compareMetric(baseline.cold, candidate.cold)
  const warm = compareMetric(baseline.warm, candidate.warm)
  const medianFloorMet = cold.medianImprovementPercent >= 15 || warm.medianImprovementPercent >= 15
  const medianCeilingsMet = cold.medianImprovementPercent >= -5 && warm.medianImprovementPercent >= -5
  const p95CeilingsMet = cold.p95RegressionPercent <= 10 && warm.p95RegressionPercent <= 10
  return {
    passed: medianFloorMet && medianCeilingsMet && p95CeilingsMet,
    cold,
    warm,
    requirements: {
      oneMedianImprovesAtLeastPercent: 15,
      otherMedianRegressionAtMostPercent: 5,
      eachP95RegressionAtMostPercent: 10,
    },
  }
}

const UNSAFE_EVIDENCE_KEY = /^(?:path|home|url|credential|secret|token|environment|raw|logs?|lifecycle)$/iu
const UNSAFE_EVIDENCE_VALUE = /(?:^\/|^[A-Za-z]:[\\/]|file:\/\/|https?:\/\/|lifecycle\.log|DSH_HOME)/u

/** Fail closed before writing or uploading a supposedly portable evidence document. */
export function assertPortableMacEvidence(value: unknown): void {
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      if (UNSAFE_EVIDENCE_VALUE.test(item)) {
        throw new Error('Portable macOS evidence contains a path, URL, or raw lifecycle material')
      }
      return
    }
    if (item === null || typeof item !== 'object') return
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    for (const [key, child] of Object.entries(item)) {
      if (UNSAFE_EVIDENCE_KEY.test(key)) {
        throw new Error(`Portable macOS evidence contains forbidden field ${key}`)
      }
      visit(child)
    }
  }
  visit(value)
}

async function run(command: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  return result.stdout.trim()
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

async function plistValue(appRoot: string, key: string): Promise<string> {
  return await run('/usr/bin/plutil', [
    '-extract', key, 'raw', '-o', '-', join(appRoot, 'Contents', 'Info.plist'),
  ])
}

async function detachMountPoint(mountPoint: string): Promise<void> {
  try {
    await run('/usr/bin/hdiutil', ['detach', mountPoint])
  } catch (error) {
    await run('/usr/bin/hdiutil', ['detach', '-force', mountPoint]).catch(() => undefined)
    throw error
  }
}

async function attachProduct(
  role: ProductDescriptor['role'],
  version: string,
  dmgPath: string,
  mountRoot: string,
): Promise<ProductDescriptor> {
  await run('/usr/bin/hdiutil', ['verify', dmgPath])
  const mountPoint = join(mountRoot, `${role}-mount`)
  let attached = false
  try {
    await mkdir(mountPoint, { recursive: true })
    await run('/usr/bin/hdiutil', [
      'attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint, dmgPath,
    ])
    attached = true
    const appRoot = join(mountPoint, APP_NAME)
    const executable = join(appRoot, 'Contents', 'MacOS', EXECUTABLE_NAME)
    const actualVersion = await plistValue(appRoot, 'CFBundleShortVersionString')
    if (actualVersion !== version) {
      throw new Error(`macOS runtime evidence: ${role} bundle version mismatch`)
    }
    const bundleIdentifier = await plistValue(appRoot, 'CFBundleIdentifier')
    if (bundleIdentifier !== BUNDLE_IDENTIFIER) {
      throw new Error(`macOS runtime evidence: ${role} bundle identifier mismatch`)
    }
    const architectures = (await run('/usr/bin/lipo', ['-archs', executable])).split(/\s+/u)
    if (architectures.length !== 1 || architectures[0] !== 'x86_64') {
      throw new Error(`macOS runtime evidence: ${role} executable is not Intel x86_64 only`)
    }
    const dmgStats = await stat(dmgPath)
    if (!dmgStats.isFile() || dmgStats.size <= 0) {
      throw new Error(`macOS runtime evidence: ${role} DMG is not a non-empty file`)
    }
    return {
      role,
      version,
      dmgPath,
      mountPoint,
      executable,
      appRoot,
      dmgBytes: dmgStats.size,
      dmgSha256: await sha256(dmgPath),
      appAsarSha256: await sha256(join(appRoot, 'Contents', 'Resources', 'app.asar')),
      iconSha256: await sha256(join(appRoot, 'Contents', 'Resources', 'icon.icns')),
    }
  } catch (error) {
    if (attached) {
      try {
        await detachMountPoint(mountPoint)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'macOS runtime evidence: product validation and mount cleanup failed')
      }
    }
    throw error
  }
}

async function detachProduct(product: ProductDescriptor | undefined): Promise<void> {
  if (product === undefined) return
  await detachMountPoint(product.mountPoint)
}

function childEnvironment(harnessHome: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    DSH_HOME: harnessHome,
    DSH_TELEMETRY_DISABLED: '1',
    DSH_DESKTOP_STARTUP_TIMING: '1',
    DEEPSEEK_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
  }
}

async function processGroupMembers(groupId: number): Promise<number[]> {
  const rows = await run('/bin/ps', ['-axo', 'pid=,pgid='])
  const members: number[] = []
  for (const row of rows.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(row)
    if (match === null || Number(match[2]) !== groupId) continue
    members.push(Number(match[1]))
  }
  return members
}

async function waitForProcessGroupEmpty(groupId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await processGroupMembers(groupId)).length === 0) return true
    await delay(POLL_MS)
  }
  return (await processGroupMembers(groupId)).length === 0
}

function signalProcessGroup(groupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-groupId, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function waitForStartupLog(
  child: ChildProcess,
  lifecyclePath: string,
  sampleLabel: string,
): Promise<DesktopStartupSample> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`macOS runtime evidence: ${sampleLabel} exited before desktop-running`)
    }
    const content = await readFile(lifecyclePath, 'utf8').catch(() => '')
    if (/ startup desktop-running: [0-9]+ms$/mu.test(content)) {
      return parseDesktopStartupSample(content)
    }
    await delay(POLL_MS)
  }
  throw new Error(`macOS runtime evidence: ${sampleLabel} missed the startup deadline`)
}

async function preserveMarker(directory: string, markers: Map<string, string>): Promise<void> {
  await mkdir(directory, { recursive: true })
  const marker = join(directory, '.dsh-macos-runtime-preserve')
  const expected = 'macOS runtime evidence preserves isolated user data\n'
  try {
    const current = await readFile(marker, 'utf8')
    if (current !== expected) throw new Error('macOS runtime evidence: isolated marker changed')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(marker, expected, 'utf8')
  }
  markers.set(marker, await sha256(marker))
}

async function assertMarkers(markers: ReadonlyMap<string, string>): Promise<void> {
  for (const [marker, expected] of markers) {
    if (await sha256(marker) !== expected) {
      throw new Error('macOS runtime evidence: isolated user-data marker changed')
    }
  }
}

async function captureStartupSample(
  product: ProductSamples,
  harnessHome: string,
  userData: string,
  sampleKind: 'cold' | 'warm' | 'warm-prime',
  sampleIndex: number,
): Promise<DesktopStartupSample> {
  await Promise.all([
    preserveMarker(harnessHome, product.markerSnapshots),
    preserveMarker(userData, product.markerSnapshots),
  ])
  const lifecyclePath = join(userData, 'logs', 'lifecycle.log')
  await unlink(lifecyclePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof Error) throw error
      throw new Error('macOS runtime evidence: lifecycle cleanup failed', { cause: error })
    }
  })
  const child = spawn(product.descriptor.executable, [`--user-data-dir=${userData}`], {
    cwd: dirname(product.descriptor.executable),
    detached: true,
    env: childEnvironment(harnessHome),
    stdio: 'ignore',
  })
  const groupId = child.pid
  if (groupId === undefined) throw new Error('macOS runtime evidence: child PID is unavailable')
  const sampleLabel = `${product.descriptor.role}-${sampleKind}-${String(sampleIndex)}`
  let sample: DesktopStartupSample | undefined
  let failure: unknown
  try {
    sample = await waitForStartupLog(child, lifecyclePath, sampleLabel)
  } catch (error) {
    failure = error
  } finally {
    signalProcessGroup(groupId, 'SIGTERM')
    if (!await waitForProcessGroupEmpty(groupId, SHUTDOWN_TIMEOUT_MS)) {
      signalProcessGroup(groupId, 'SIGKILL')
      await waitForProcessGroupEmpty(groupId, 5_000)
      failure ??= new Error(`macOS runtime evidence: ${sampleLabel} required forced process cleanup`)
    }
  }
  await assertMarkers(product.markerSnapshots)
  if (failure instanceof Error) throw failure
  if (failure !== undefined) {
    throw new Error(`macOS runtime evidence: ${sampleLabel} failed`, { cause: failure })
  }
  if (sample === undefined) throw new Error(`macOS runtime evidence: ${sampleLabel} produced no sample`)
  return sample
}

function productSamples(descriptor: ProductDescriptor, root: string): ProductSamples {
  return {
    descriptor,
    cold: [],
    warm: [],
    warmHome: join(root, descriptor.role, 'warm', 'dsh-home'),
    warmUserData: join(root, descriptor.role, 'warm', 'electron-data'),
    markerSnapshots: new Map(),
  }
}

async function collectSamples(baseline: ProductSamples, candidate: ProductSamples): Promise<void> {
  for (const product of [baseline, candidate]) {
    await captureStartupSample(product, product.warmHome, product.warmUserData, 'warm-prime', 0)
  }
  for (const sampleKind of ['cold', 'warm'] as const) {
    for (let sampleIndex = 1; sampleIndex <= SAMPLE_COUNT; sampleIndex += 1) {
      const order = sampleIndex % 2 === 0 ? [candidate, baseline] : [baseline, candidate]
      for (const product of order) {
        const harnessHome = sampleKind === 'warm'
          ? product.warmHome
          : join(dirname(product.warmHome), '..', `cold-${String(sampleIndex)}`, 'dsh-home')
        const userData = sampleKind === 'warm'
          ? product.warmUserData
          : join(dirname(product.warmUserData), '..', `cold-${String(sampleIndex)}`, 'electron-data')
        product[sampleKind].push(await captureStartupSample(
          product,
          harnessHome,
          userData,
          sampleKind,
          sampleIndex,
        ))
      }
    }
  }
}

function compactProductEvidence(product: ProductSamples): {
  readonly version: string
  readonly artifact: { readonly name: string; readonly bytes: number; readonly sha256: string }
  readonly appAsarSha256: string
  readonly iconSha256: string
  readonly architecture: 'x86_64'
  readonly bundleIdentifier: typeof BUNDLE_IDENTIFIER
  readonly cold: DesktopStartupSummary
  readonly warm: DesktopStartupSummary
  readonly dataPreserved: true
  readonly processTreeRemaining: 0
} {
  return {
    version: product.descriptor.version,
    artifact: {
      name: basename(product.descriptor.dmgPath),
      bytes: product.descriptor.dmgBytes,
      sha256: product.descriptor.dmgSha256,
    },
    appAsarSha256: product.descriptor.appAsarSha256,
    iconSha256: product.descriptor.iconSha256,
    architecture: 'x86_64',
    bundleIdentifier: BUNDLE_IDENTIFIER,
    cold: summarizeDesktopStartupSamples(product.cold),
    warm: summarizeDesktopStartupSamples(product.warm),
    dataPreserved: true,
    processTreeRemaining: 0,
  }
}

function parseOptions(args: readonly string[]): CliOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new Error('macOS runtime evidence: expected option/value pairs')
    }
    values.set(key, value)
  }
  const baselineDmg = values.get('--baseline-dmg')
  const candidateDmg = values.get('--candidate-dmg')
  const candidateRevision = values.get('--candidate-revision')
  const output = values.get('--output')
  const expected = new Set(['--baseline-dmg', '--candidate-dmg', '--candidate-revision', '--output'])
  if ([...values.keys()].some(key => !expected.has(key))
    || baselineDmg === undefined || candidateDmg === undefined
    || candidateRevision === undefined || output === undefined) {
    throw new Error('macOS runtime evidence: required baseline DMG, candidate DMG, revision, and output')
  }
  if (!/^[0-9a-f]{40}$/u.test(candidateRevision)) {
    throw new Error('macOS runtime evidence: candidate revision must be a complete Git SHA')
  }
  return {
    baselineDmg: resolve(baselineDmg),
    candidateDmg: resolve(candidateDmg),
    candidateRevision,
    output: resolve(output),
  }
}

async function main(args: readonly string[]): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('macOS runtime evidence: requires macOS')
  const options = parseOptions(args)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-macos-runtime-'))
  let baselineDescriptor: ProductDescriptor | undefined
  let candidateDescriptor: ProductDescriptor | undefined
  let evidence: unknown
  try {
    baselineDescriptor = await attachProduct(
      'baseline', BASELINE_VERSION, options.baselineDmg, temporaryRoot,
    )
    candidateDescriptor = await attachProduct(
      'candidate', CANDIDATE_VERSION, options.candidateDmg, temporaryRoot,
    )
    if (baselineDescriptor.iconSha256 !== candidateDescriptor.iconSha256) {
      throw new Error('macOS runtime evidence: candidate changed the public Mac icon')
    }
    const baseline = productSamples(baselineDescriptor, temporaryRoot)
    const candidate = productSamples(candidateDescriptor, temporaryRoot)
    await collectSamples(baseline, candidate)
    const baselineEvidence = compactProductEvidence(baseline)
    const candidateEvidence = compactProductEvidence(candidate)
    if (candidateEvidence.cold.profileBootDetails === undefined
      || candidateEvidence.warm.profileBootDetails === undefined
      || Object.keys(candidateEvidence.cold.profileBootDetails).length !== PROFILE_BOOT_DETAIL_PHASES.length
      || Object.keys(candidateEvidence.warm.profileBootDetails).length !== PROFILE_BOOT_DETAIL_PHASES.length) {
      throw new Error('macOS runtime evidence: candidate omitted detailed startup durations')
    }
    const comparison = evaluateMacStartupGate(
      { cold: baselineEvidence.cold.total, warm: baselineEvidence.warm.total },
      { cold: candidateEvidence.cold.total, warm: candidateEvidence.warm.total },
    )
    evidence = {
      schemaVersion: 1,
      platform: 'darwin-x64',
      sameMachine: true,
      sampleCount: SAMPLE_COUNT,
      baselineTag: BASELINE_TAG,
      candidateRevision: options.candidateRevision,
      baseline: baselineEvidence,
      candidate: candidateEvidence,
      comparison,
      mountsRemaining: 0,
    }
  } finally {
    const cleanupResults = await Promise.allSettled([
      detachProduct(candidateDescriptor),
      detachProduct(baselineDescriptor),
    ])
    await rm(temporaryRoot, { recursive: true, force: true })
    const cleanupFailure = cleanupResults.find(result => result.status === 'rejected')
    if (cleanupFailure?.status === 'rejected') {
      if (cleanupFailure.reason instanceof Error) throw cleanupFailure.reason
      throw new Error('macOS runtime evidence: mount cleanup failed', { cause: cleanupFailure.reason })
    }
  }
  assertPortableMacEvidence(evidence)
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  process.stdout.write('macOS Desktop runtime evidence passed: 10 cold and 10 warm launches per product\n')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
