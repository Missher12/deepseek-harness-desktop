/** Prepare a standalone, pinned Node executable for Desktop update helpers without launching the product. */
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'tar'
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'

const NODE_VERSION = '24.17.0'
const RELEASE_URL = `https://nodejs.org/download/release/v${NODE_VERSION}`
// Resource limits apply to untrusted archive metadata and network/file inputs before allocation or extraction.
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_SUMS_BYTES = 1024 * 1024
const MAX_NODE_BYTES = 256 * 1024 * 1024
const MAX_LICENSE_BYTES = 4 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 50_000
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024

/** Supported update-helper runtime targets; archive filenames use win for win32. */
export type HelperRuntimePlatform = 'darwin' | 'win32' | 'linux'

/** Explicit input files or the fixed official release download cache. */
export type HelperRuntimeSource =
  | { kind: 'files'; archivePath: string; shasumsPath: string }
  | { kind: 'download'; cacheDirectory: string }

/** Exclusive preparation destination and pinned native target. All filesystem inputs must be absolute. */
export interface PrepareDesktopHelperRuntimeOptions {
  platform: string
  arch: string
  outputDirectory: string
  source: HelperRuntimeSource
}

/** Bounded version-probe result; nonzero exits or unexpected output reject preparation. */
export interface HelperRuntimeVersionResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Injectable I/O; an injected runner is explicitly identified in the resulting receipt. */
export interface HelperRuntimeDependencies {
  fetch?: (url: string, options: RequestInit) => Promise<Response>
  runVersion?: (runtimePath: string) => Promise<HelperRuntimeVersionResult>
}

/** Hash of one prepared regular file, relative to the exclusive output directory. */
export interface HelperRuntimeFile {
  path: string
  bytes: number
  sha256: string
}

/** Prepared bytes and observed execution status; cross-target preparation never claims a native probe. */
export interface DesktopHelperRuntimeReceipt {
  runtimePath: string
  sourceManifestPath: string
  platform: HelperRuntimePlatform
  arch: 'x64'
  nodeVersion: string
  validation: 'prepared' | 'read-only'
  execution: 'native-verified' | 'injected-runner-verified' | 'cross-target-unverified'
  files: HelperRuntimeFile[]
}

interface Target {
  folder: string
  archiveName: string
  executable: string
  platform: HelperRuntimePlatform
}
interface ArchiveInput { archive: Buffer; sums: Buffer; archiveSha256: string }
interface SelectedFiles { executable: Buffer; license: Buffer }

function targetOf(options: Pick<PrepareDesktopHelperRuntimeOptions, 'platform' | 'arch' | 'outputDirectory'>): Target {
  const platform = options.platform
  if ((platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') || options.arch !== 'x64') {
    throw new Error('Unsupported Node runtime platform or architecture.')
  }
  if (!isAbsolute(options.outputDirectory)) throw new Error('Node runtime output must be an absolute directory.')
  const folder = `node-v${NODE_VERSION}-${platform === 'win32' ? 'win' : platform}-x64`
  return { folder, archiveName: `${folder}.${platform === 'win32' ? 'zip' : 'tar.gz'}`,
    executable: platform === 'win32' ? 'node.exe' : 'node', platform }
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

async function readLimited(path: string, limit: number): Promise<Buffer> {
  if (!isAbsolute(path)) throw new Error('Node runtime inputs must be absolute paths.')
  const before = await lstat(path)
  if (!before.isFile()) throw new Error('Node runtime input must be a regular file.')
  const handle = await open(path, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > limit) {
      throw new Error('Node runtime input identity or byte limit rejected.')
    }
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Unexpected Node runtime file chunk.')
      bytes += chunk.length
      if (bytes > limit) throw new Error('Node runtime input exceeds its byte limit.')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } finally {
    await handle.close()
  }
}

function expectedChecksum(sums: Buffer, target: Target): string {
  const candidates = sums.toString('utf8').split(/\r?\n/u)
    .map(line => /^([a-f\d]{64}) [ *](.+)$/iu.exec(line))
    .filter(match => match?.[2] === target.archiveName)
  const expected = candidates[0]?.[1]?.toLowerCase()
  if (candidates.length !== 1 || expected === undefined) throw new Error('Node archive checksum entry is missing or ambiguous.')
  return expected
}

function verifyChecksum(archive: Buffer, expected: string, target: Target): string {
  const actual = digest(archive)
  if (actual !== expected) throw new Error(`Node archive checksum mismatch: ${target.archiveName}`)
  return actual
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function download(
  url: string, temporaryPath: string, limit: number, fetcher: NonNullable<HelperRuntimeDependencies['fetch']>,
): Promise<Buffer> {
  const handle = await open(temporaryPath, 'wx', 0o600)
  let failed = false
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
    if (!response.ok || response.body === null) throw new Error(`Node runtime download failed: HTTP ${response.status}`)
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit)) throw new Error('Node runtime download exceeds its byte limit.')
    const chunks: Buffer[] = []
    let total = 0
    reader = response.body.getReader()
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      const chunk = Buffer.from(result.value)
      total += chunk.length
      if (total > limit) throw new Error('Node runtime download exceeds its byte limit.')
      await handle.writeFile(chunk)
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } catch (error) {
    failed = true
    try { await (reader ?? response?.body)?.cancel() } catch {
      // A response cancellation failure cannot replace the original transfer failure.
    }
    throw error
  } finally {
    reader?.releaseLock()
    try { await handle.close() } catch (error) { if (!failed) throw error }
  }
}

async function archiveInput(source: HelperRuntimeSource, target: Target, dependencies: HelperRuntimeDependencies): Promise<ArchiveInput> {
  if (source.kind === 'files') {
    if (basename(source.archivePath) !== target.archiveName) throw new Error('Node archive filename does not match the selected platform.')
    const sums = await readLimited(source.shasumsPath, MAX_SUMS_BYTES)
    const expected = expectedChecksum(sums, target)
    const archive = await readLimited(source.archivePath, MAX_ARCHIVE_BYTES)
    return { archive, sums, archiveSha256: verifyChecksum(archive, expected, target) }
  }
  if (!isAbsolute(source.cacheDirectory)) throw new Error('Node download cache must be an absolute directory.')
  await mkdir(source.cacheDirectory, { recursive: true, mode: 0o700 })
  if (!(await lstat(source.cacheDirectory)).isDirectory()) throw new Error('Node download cache must be a physical directory.')
  const cache = join(source.cacheDirectory, target.folder)
  let created = false
  try { await mkdir(cache, { mode: 0o700 }); created = true } catch (error) { if (!hasCode(error, 'EEXIST')) throw error }
  const archivePath = join(cache, target.archiveName)
  const sumsPath = join(cache, 'SHASUMS256.txt')
  if (!created) {
    if (!(await lstat(cache)).isDirectory()) throw new Error('Node download cache entry must be a physical directory.')
    let sums: Buffer
    let archive: Buffer
    try {
      sums = await readLimited(sumsPath, MAX_SUMS_BYTES)
      archive = await readLimited(archivePath, MAX_ARCHIVE_BYTES)
    } catch (cause) {
      throw new Error('Node download cache is incomplete or unreadable; existing files are retained.', { cause })
    }
    return { archive, sums, archiveSha256: verifyChecksum(archive, expectedChecksum(sums, target), target) }
  }
  const fetcher = dependencies.fetch ?? fetch
  const sumsTemporary = join(cache, `SHASUMS256.txt.partial-${randomUUID()}`)
  const archiveTemporary = join(cache, `${target.archiveName}.partial-${randomUUID()}`)
  const sums = await download(`${RELEASE_URL}/SHASUMS256.txt`, sumsTemporary, MAX_SUMS_BYTES, fetcher)
  const expected = expectedChecksum(sums, target)
  const archive = await download(`${RELEASE_URL}/${target.archiveName}`, archiveTemporary, MAX_ARCHIVE_BYTES, fetcher)
  const archiveSha256 = verifyChecksum(archive, expected, target)
  await copyFile(sumsTemporary, sumsPath, constants.COPYFILE_EXCL)
  await copyFile(archiveTemporary, archivePath, constants.COPYFILE_EXCL)
  return { archive, sums, archiveSha256 }
}

function entryPath(path: string, target: Target): string {
  if (path.length === 0 || /[\\:\x00-\x1f\x7f]/u.test(path) || path.startsWith('/')) throw new Error('Unsafe Node archive path.')
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  if (normalized.split('/').some(part => part === '' || part === '.' || part === '..')
    || (normalized !== target.folder && !normalized.startsWith(`${target.folder}/`))) throw new Error('Node archive path escapes its expected root.')
  return normalized
}

function safeLink(path: string, link: string, hard: boolean, target: Target): void {
  if (link.length === 0 || /[\\:\x00-\x1f\x7f]/u.test(link) || link.startsWith('/')) throw new Error('Unsafe Node archive link.')
  const resolved = posix.normalize(hard ? link : posix.join(posix.dirname(path), link))
  if (resolved !== target.folder && !resolved.startsWith(`${target.folder}/`)) throw new Error('Node archive link escapes its root.')
}

function selection(target: Target) {
  const executablePath = `${target.folder}/${target.platform === 'win32' ? 'node.exe' : 'bin/node'}`
  const licensePath = `${target.folder}/LICENSE`
  const selected = new Map<string, Buffer>()
  const seen = new Set<string>()
  let total = 0
  return {
    inspect(path: string, size: number, regular: boolean): number | undefined {
      const normalized = entryPath(path, target)
      const identity = target.platform === 'win32' ? normalized.toLowerCase() : normalized
      if (seen.has(identity)) throw new Error('Duplicate Node archive path.')
      seen.add(identity)
      total += size
      if (seen.size > MAX_ARCHIVE_ENTRIES || !Number.isSafeInteger(size) || size < 0 || total > MAX_EXPANDED_BYTES) {
        throw new Error('Node archive exceeds entry or expanded-byte limits.')
      }
      const limit = normalized === executablePath ? MAX_NODE_BYTES : normalized === licensePath ? MAX_LICENSE_BYTES : undefined
      if (limit !== undefined && (!regular || size === 0 || size > limit)) throw new Error('Node executable and LICENSE require bounded nonempty regular files.')
      return limit
    },
    retain(path: string, bytes: Buffer) { selected.set(path, bytes) },
    finish(): SelectedFiles {
      const executable = selected.get(executablePath)
      const license = selected.get(licensePath)
      if (executable === undefined || license === undefined) throw new Error('Node archive is missing its exact executable or LICENSE.')
      return { executable, license }
    },
  }
}

async function readTar(archive: Buffer, target: Target): Promise<SelectedFiles> {
  const files = selection(target)
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ strict: true, maxMetaEntrySize: MAX_SUMS_BYTES, onReadEntry(entry) {
      try {
        const regular = entry.type === 'File'
        if (!regular && !['Directory', 'SymbolicLink', 'Link'].includes(entry.type)) throw new Error('Unsupported Node tar entry type.')
        const limit = files.inspect(entry.path, entry.size, regular)
        if (entry.type === 'SymbolicLink' || entry.type === 'Link') safeLink(entry.path, entry.linkpath ?? '', entry.type === 'Link', target)
        if (limit !== undefined) {
          const chunks: Buffer[] = []
          let total = 0
          entry.on('data', (chunk: Buffer) => {
            total += chunk.length
            if (total > limit) parser.abort(new Error('Node tar entry exceeds its byte limit.'))
            else chunks.push(chunk)
          })
          entry.on('end', () => {
            if (total !== entry.size) parser.abort(new Error('Node tar entry size differs from its header.'))
            else files.retain(entry.path, Buffer.concat(chunks))
          })
        }
        entry.resume()
      } catch (error) {
        parser.abort(error instanceof Error ? error : new Error('Node tar validation failed.'))
      }
    } })
    parser.on('error', reject)
    parser.on('end', resolve)
    parser.end(archive)
  })
  return files.finish()
}

async function zipBytes(zip: ZipFile, entry: Entry, limit: number): Promise<Buffer> {
  const stream = await new Promise<import('node:stream').Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => { if (error !== null) reject(error); else resolve(stream) })
  })
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Unexpected ZIP data chunk.')
    total += chunk.length
    if (total > limit) throw new Error('Node ZIP entry exceeds its byte limit.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readZip(archive: Buffer, target: Target): Promise<SelectedFiles> {
  const files = selection(target)
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(archive, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, file) => { if (error !== null) reject(error); else resolve(file) })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const type = (entry.externalFileAttributes >>> 16) & 0o170000
          const directory = entry.fileName.endsWith('/')
          if (entry.isEncrypted() || (type !== 0 && type !== 0o100000 && type !== 0o040000)) throw new Error('Unsupported Node ZIP entry type.')
          const limit = files.inspect(entry.fileName, entry.uncompressedSize, !directory && type !== 0o040000)
          if (limit !== undefined) files.retain(entry.fileName, await zipBytes(zip, entry, limit))
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  return files.finish()
}

function runVersion(runtimePath: string): Promise<HelperRuntimeVersionResult> {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return new Promise((resolve, reject) => {
    execFile(runtimePath, ['--version'], { cwd: dirname(runtimePath), env, timeout: 15_000, maxBuffer: 4096, windowsHide: true },
      (error, stdout, stderr) => {
        if (error !== null) reject(new Error('Prepared Node version probe failed.', { cause: error }))
        else resolve({ stdout, stderr, exitCode: 0 })
      })
  })
}

/**
 * Prepare Node 24.17.0 from explicitly supplied files or a verified fixed-release cache.
 * Every output is created exclusively; failures retain owned partial files and never clean an older cache or output.
 * Archive bytes are hashed before parsing, and only the exact regular executable and LICENSE reach the output.
 * @param options - explicit target, source and new absolute output directory.
 * @param dependencies - optional download and native-probe I/O; injected probes are identified in the receipt.
 * @returns prepared paths, file hashes, pinned target and honest native/cross-target probe status.
 * @throws on unsupported inputs, integrity/path/size failures, existing output or a failed native version probe.
 */
export async function prepareDesktopHelperRuntime(
  options: PrepareDesktopHelperRuntimeOptions,
  dependencies: HelperRuntimeDependencies = {},
): Promise<DesktopHelperRuntimeReceipt> {
  const target = targetOf(options)
  try {
    await lstat(options.outputDirectory)
    throw new Error('Node runtime output already exists; refusing to modify it.')
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error
  }
  const input = await archiveInput(options.source, target, dependencies)
  const files = target.platform === 'win32' ? await readZip(input.archive, target) : await readTar(input.archive, target)
  await mkdir(options.outputDirectory, { mode: 0o755 })
  const runtimePath = join(options.outputDirectory, target.executable)
  await writeFile(runtimePath, files.executable, { flag: 'wx', mode: 0o700 })
  if (target.platform !== 'win32') await chmod(runtimePath, 0o755)
  await writeFile(join(options.outputDirectory, 'LICENSE'), files.license, { flag: 'wx', mode: 0o644 })
  let execution: DesktopHelperRuntimeReceipt['execution'] = 'cross-target-unverified'
  if (process.platform === target.platform && process.arch === 'x64') {
    const result = await (dependencies.runVersion ?? runVersion)(runtimePath)
    if (result.exitCode !== 0 || result.stdout.trim() !== `v${NODE_VERSION}` || result.stderr.trim() !== '') {
      throw new Error('Prepared Node version verification failed.')
    }
    execution = dependencies.runVersion === undefined ? 'native-verified' : 'injected-runner-verified'
  }
  if (digest(await readLimited(runtimePath, MAX_NODE_BYTES)) !== digest(files.executable)
    || digest(await readLimited(join(options.outputDirectory, 'LICENSE'), MAX_LICENSE_BYTES)) !== digest(files.license)) {
    throw new Error('Prepared Node or LICENSE bytes changed during version verification.')
  }
  const fileReceipt = (path: string, bytes: Buffer): HelperRuntimeFile => ({ path, bytes: bytes.length, sha256: digest(bytes) })
  const outputFiles = [fileReceipt(target.executable, files.executable), fileReceipt('LICENSE', files.license)]
  const sourceManifestPath = join(options.outputDirectory, 'source.json')
  const manifest = Buffer.from(`${JSON.stringify({
    schema: 1, platform: target.platform, arch: 'x64', nodeVersion: NODE_VERSION,
    releaseUrl: RELEASE_URL, archiveName: target.archiveName, archiveSha256: input.archiveSha256,
    shasumsSha256: digest(input.sums), inputKind: options.source.kind, execution, files: outputFiles,
  }, null, 2)}\n`)
  await writeFile(sourceManifestPath, manifest, { flag: 'wx', mode: 0o644 })
  return { runtimePath, sourceManifestPath, platform: target.platform, arch: 'x64', nodeVersion: NODE_VERSION,
    validation: 'prepared', execution, files: [...outputFiles, fileReceipt('source.json', manifest)] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recheck an existing helper directory without copying, downloading, executing or altering its original execution status.
 * The manifest's execution field records preparation-time evidence, never a new probe on the verifying host.
 * @param directory - absolute physical directory containing the executable, LICENSE and source.json only.
 * @param expected - fixed supported platform and x64 architecture required by the consuming package.
 * @returns read-only receipt with actual file hashes and the original preparation-time execution identity.
 * @throws on incompatible provenance, missing/extra/linked files, or changed sizes and hashes.
 */
export async function verifyDesktopHelperRuntime(
  directory: string, expected: { platform: HelperRuntimePlatform; arch: 'x64' },
): Promise<DesktopHelperRuntimeReceipt> {
  const target = targetOf({ ...expected, outputDirectory: directory })
  if (!(await lstat(directory)).isDirectory()) throw new Error('Prepared Node runtime must be a physical directory.')
  const sourceManifestPath = join(directory, 'source.json')
  const manifest = await readLimited(sourceManifestPath, MAX_SUMS_BYTES)
  const source: unknown = JSON.parse(manifest.toString('utf8'))
  const fields = ['schema', 'platform', 'arch', 'nodeVersion', 'releaseUrl', 'archiveName', 'archiveSha256',
    'shasumsSha256', 'inputKind', 'execution', 'files']
  if (!isRecord(source) || Object.keys(source).length !== fields.length || fields.some(field => !Object.hasOwn(source, field))
    || source.schema !== 1 || source.platform !== expected.platform || source.arch !== 'x64' || source.nodeVersion !== NODE_VERSION
    || source.releaseUrl !== RELEASE_URL || source.archiveName !== target.archiveName
    || typeof source.archiveSha256 !== 'string' || !/^[a-f\d]{64}$/u.test(source.archiveSha256)
    || typeof source.shasumsSha256 !== 'string' || !/^[a-f\d]{64}$/u.test(source.shasumsSha256)
    || (source.inputKind !== 'files' && source.inputKind !== 'download') || !Array.isArray(source.files) || source.files.length !== 2) {
    throw new Error('Prepared Node source manifest has an incompatible version, target or inventory.')
  }
  const execution = source.execution
  if (execution !== 'native-verified' && execution !== 'injected-runner-verified' && execution !== 'cross-target-unverified') {
    throw new Error('Prepared Node source manifest has an invalid execution identity.')
  }
  const names = [target.executable, 'LICENSE', 'source.json'].sort()
  const actualNames = (await readdir(directory)).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(names)) throw new Error('Prepared Node runtime contains missing or unlisted files.')
  const declared: unknown[] = source.files
  const files: HelperRuntimeFile[] = []
  for (const name of [target.executable, 'LICENSE']) {
    const entries = declared.filter(entry => isRecord(entry) && entry.path === name)
    const entry = entries[0]
    if (entries.length !== 1 || !isRecord(entry) || Object.keys(entry).length !== 3
      || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0
      || typeof entry.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(entry.sha256)) {
      throw new Error('Prepared Node source manifest contains an invalid file receipt.')
    }
    const bytes = await readLimited(join(directory, name), name === 'LICENSE' ? MAX_LICENSE_BYTES : MAX_NODE_BYTES)
    const sha256 = digest(bytes)
    if (entry.bytes !== bytes.length || entry.sha256 !== sha256) throw new Error('Prepared Node file bytes or hash differ from the receipt.')
    files.push({ path: name, bytes: bytes.length, sha256 })
  }
  files.push({ path: 'source.json', bytes: manifest.length, sha256: digest(manifest) })
  return { runtimePath: join(directory, target.executable), sourceManifestPath, platform: target.platform,
    arch: 'x64', nodeVersion: NODE_VERSION, validation: 'read-only', execution, files }
}

async function main(args: string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Prepare Desktop helper Node 24.17.0: --platform darwin|win32|linux --arch x64 --output <directory> [--archive <file> --shasums <file> | --cache <directory>]')
    console.log('Default output: .dsh-build/desktop-base/<OS>-x64/helper-runtime; existing outputs are verified read-only.')
    return
  }
  const allowed = new Set(['--platform', '--arch', '--output', '--archive', '--shasums', '--cache'])
  const flags = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || !allowed.has(key) || flags.has(key) || value === undefined || value.startsWith('--')) {
      throw new Error('Invalid or duplicate helper-runtime CLI argument; use --help.')
    }
    flags.set(key, value)
  }
  if (flags.has('--archive') !== flags.has('--shasums') || (flags.has('--archive') && flags.has('--cache'))) {
    throw new Error('Provide archive and SHASUMS together, or select the download cache.')
  }
  const root = resolve(import.meta.dirname, '..')
  const platform = flags.get('--platform') ?? process.platform
  const arch = flags.get('--arch') ?? 'x64'
  const outputDirectory = resolve(flags.get('--output') ?? join(root, '.dsh-build/desktop-base', `${platform}-${arch}`, 'helper-runtime'))
  const target = targetOf({ platform, arch, outputDirectory })
  let exists = false
  try { await lstat(outputDirectory); exists = true } catch (error) { if (!hasCode(error, 'ENOENT')) throw error }
  if (exists) {
    console.log(JSON.stringify(await verifyDesktopHelperRuntime(outputDirectory, { platform: target.platform, arch: 'x64' }), null, 2))
    return
  }
  const archive = flags.get('--archive')
  const sums = flags.get('--shasums')
  const source: HelperRuntimeSource = archive !== undefined && sums !== undefined
    ? { kind: 'files', archivePath: resolve(archive), shasumsPath: resolve(sums) }
    : { kind: 'download', cacheDirectory: resolve(flags.get('--cache') ?? join(root, '.dsh-build/desktop-base/downloads')) }
  await mkdir(dirname(outputDirectory), { recursive: true })
  console.log(JSON.stringify(await prepareDesktopHelperRuntime({ platform: target.platform, arch, outputDirectory, source }), null, 2))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)) } catch (error) {
    console.error(error instanceof Error ? error.message : 'Helper runtime preparation failed.')
    process.exitCode = 1
  }
}
