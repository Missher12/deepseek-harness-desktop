import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DESKTOP_CANDIDATE_PLATFORMS = ['mac-x64', 'win-x64'] as const
export const DESKTOP_CANDIDATE_MODES = ['quick', 'full'] as const

export type DesktopCandidatePlatform = typeof DESKTOP_CANDIDATE_PLATFORMS[number]
export type DesktopCandidateMode = typeof DESKTOP_CANDIDATE_MODES[number]

export interface DesktopCandidateDescriptor {
  readonly schemaVersion: 1
  readonly sourceSha: string
  readonly platform: DesktopCandidatePlatform
  readonly mode: DesktopCandidateMode
  readonly artifact: {
    readonly basename: string
    readonly bytes: number
    readonly sha256: string
  }
  readonly productInputSha256: string
}

export interface CreateDesktopCandidateDescriptorOptions {
  readonly sourceSha: string
  readonly platform: DesktopCandidatePlatform
  readonly mode: DesktopCandidateMode
  readonly artifactPath: string
  readonly productInputPath: string
  readonly descriptorPath: string
}

export interface VerifyDesktopCandidateDescriptorOptions {
  readonly sourceSha: string
  readonly platform: DesktopCandidatePlatform
  readonly mode: DesktopCandidateMode
  readonly artifactPath: string
  readonly descriptorPath: string
}

const LOWER_SHA256 = /^[0-9a-f]{64}$/u
const LOWER_GIT_SHA = /^[0-9a-f]{40}$/u

function fail(reason: string): never {
  throw new Error(`Desktop candidate descriptor: ${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort((left, right) => left.localeCompare(right, 'en'))
  const sortedExpected = [...expected].sort((left, right) => left.localeCompare(right, 'en'))
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    fail(`${label} keys must be exactly ${sortedExpected.join(', ')}`)
  }
}

function assertSourceSha(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !LOWER_GIT_SHA.test(value)) {
    fail('sourceSha must be one lowercase 40-character Git SHA')
  }
}

function assertPlatform(value: unknown): asserts value is DesktopCandidatePlatform {
  if (typeof value !== 'string' || !DESKTOP_CANDIDATE_PLATFORMS.includes(value as DesktopCandidatePlatform)) {
    fail('platform must be mac-x64 or win-x64')
  }
}

function assertMode(value: unknown): asserts value is DesktopCandidateMode {
  if (typeof value !== 'string' || !DESKTOP_CANDIDATE_MODES.includes(value as DesktopCandidateMode)) {
    fail('mode must be quick or full')
  }
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !LOWER_SHA256.test(value)) {
    fail(`${label} must be one lowercase 64-character SHA-256`)
  }
}

function assertPortableBasename(value: unknown): asserts value is string {
  if (typeof value !== 'string'
    || value.length === 0
    || value === '.'
    || value === '..'
    || /[\\/:]/u.test(value)) {
    fail('artifact.basename must be a portable basename without a path')
  }
}

/** Parse and strictly validate one portable candidate descriptor document. */
export function parseDesktopCandidateDescriptor(value: unknown): DesktopCandidateDescriptor {
  if (!isRecord(value)) fail('document must be an object')
  assertExactKeys(
    value,
    ['schemaVersion', 'sourceSha', 'platform', 'mode', 'artifact', 'productInputSha256'],
    'document',
  )
  if (value.schemaVersion !== 1) fail('schemaVersion must be 1')
  assertSourceSha(value.sourceSha)
  assertPlatform(value.platform)
  assertMode(value.mode)
  assertSha256(value.productInputSha256, 'productInputSha256')
  if (!isRecord(value.artifact)) fail('artifact must be an object')
  assertExactKeys(value.artifact, ['basename', 'bytes', 'sha256'], 'artifact')
  assertPortableBasename(value.artifact.basename)
  if (!Number.isSafeInteger(value.artifact.bytes) || Number(value.artifact.bytes) < 0) {
    fail('artifact.bytes must be a non-negative safe integer')
  }
  assertSha256(value.artifact.sha256, 'artifact.sha256')
  return value as unknown as DesktopCandidateDescriptor
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function inspectArtifact(path: string): Promise<DesktopCandidateDescriptor['artifact']> {
  const details = await stat(path)
  if (!details.isFile()) fail('artifact must be a file')
  const name = basename(path)
  assertPortableBasename(name)
  return {
    basename: name,
    bytes: details.size,
    sha256: await hashFile(path),
  }
}

/** Create a portable descriptor for one exact packaged Desktop candidate. */
export async function createDesktopCandidateDescriptor(
  options: CreateDesktopCandidateDescriptorOptions,
): Promise<DesktopCandidateDescriptor> {
  assertSourceSha(options.sourceSha)
  assertPlatform(options.platform)
  assertMode(options.mode)
  const productInput = await stat(options.productInputPath)
  if (!productInput.isFile()) fail('product input must be a file')
  const descriptor = parseDesktopCandidateDescriptor({
    schemaVersion: 1,
    sourceSha: options.sourceSha,
    platform: options.platform,
    mode: options.mode,
    artifact: await inspectArtifact(options.artifactPath),
    productInputSha256: await hashFile(options.productInputPath),
  })
  await mkdir(dirname(options.descriptorPath), { recursive: true })
  await writeFile(options.descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8')
  return descriptor
}

/** Verify a downloaded Desktop candidate before any consumer executes it. */
export async function verifyDesktopCandidateDescriptor(
  options: VerifyDesktopCandidateDescriptorOptions,
): Promise<DesktopCandidateDescriptor> {
  assertSourceSha(options.sourceSha)
  assertPlatform(options.platform)
  assertMode(options.mode)
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(options.descriptorPath, 'utf8')) as unknown
  } catch {
    fail('could not parse descriptor JSON')
  }
  const descriptor = parseDesktopCandidateDescriptor(raw)
  if (descriptor.sourceSha !== options.sourceSha) fail('candidate source mismatch')
  if (descriptor.platform !== options.platform) fail('candidate platform mismatch')
  if (descriptor.mode !== options.mode) fail('candidate mode mismatch')
  const artifact = await inspectArtifact(options.artifactPath)
  if (descriptor.artifact.basename !== artifact.basename) fail('artifact basename mismatch')
  if (descriptor.artifact.bytes !== artifact.bytes) fail('artifact byte length mismatch')
  if (descriptor.artifact.sha256 !== artifact.sha256) fail('artifact SHA-256 mismatch')
  return descriptor
}

interface ParsedArguments {
  readonly command: 'create' | 'verify'
  readonly values: Readonly<Record<string, string>>
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const [command, ...rest] = args
  if (command !== 'create' && command !== 'verify') fail('command must be create or verify')
  const values: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (flag === undefined || value === undefined || !flag.startsWith('--') || value.startsWith('--')) {
      fail('arguments must be --name value pairs')
    }
    const name = flag.slice(2)
    if (Object.hasOwn(values, name)) fail(`duplicate argument --${name}`)
    values[name] = value
  }
  const expected = command === 'create'
    ? ['source', 'platform', 'mode', 'artifact', 'product-input', 'output']
    : ['source', 'platform', 'mode', 'artifact', 'descriptor']
  assertExactKeys(values, expected, `${command} arguments`)
  return { command, values }
}

async function main(args: readonly string[]): Promise<void> {
  const parsed = parseArguments(args)
  const sourceSha = parsed.values.source
  const platform = parsed.values.platform
  const mode = parsed.values.mode
  const artifactPath = parsed.values.artifact
  assertSourceSha(sourceSha)
  assertPlatform(platform)
  assertMode(mode)
  if (artifactPath === undefined) fail('artifact path is required')
  if (parsed.command === 'create') {
    const productInputPath = parsed.values['product-input']
    const descriptorPath = parsed.values.output
    if (productInputPath === undefined || descriptorPath === undefined) fail('create paths are required')
    await createDesktopCandidateDescriptor({
      sourceSha,
      platform,
      mode,
      artifactPath,
      productInputPath,
      descriptorPath,
    })
    process.stdout.write('desktop candidate descriptor: created\n')
    return
  }
  const descriptorPath = parsed.values.descriptor
  if (descriptorPath === undefined) fail('descriptor path is required')
  await verifyDesktopCandidateDescriptor({ sourceSha, platform, mode, artifactPath, descriptorPath })
  process.stdout.write('desktop candidate descriptor: verified\n')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
