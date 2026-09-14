import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'

/** Physical identity of one verified regular file. Integer timestamps avoid rounded comparisons. */
export interface LinuxFileIdentity {
  dev: string
  ino: string
  bytes: number
  mtimeNs: string
  ctimeNs: string
  mode: number
  sha256: string
}

/** Immutable prepared file replacement, retained outside the AppImage mount. */
export interface LinuxAppImagePlan {
  schema: 1
  id: string
  nonce: string
  targetPath: string
  transactionDirectory: string
  lockPath: string
  backupPath: string
  candidatePath: string
  original: LinuxFileIdentity
  candidate: LinuxFileIdentity
  parentDirectory: { dev: string; ino: string }
  targetVersion: string
}

/** A parent PID is meaningful only together with its Linux kernel start identity. */
export interface LinuxParentIdentity { pid: number; startTime: string }

/** Atomic source move into an absent destination; native callers must never downgrade to check-then-rename. */
export type LinuxRenameNoReplace = (source: string, destination: string) => Promise<void>

/** Existing independently staged runtime or helper, supplied by the shared packaging owner. */
export interface LinuxHelperArtifact { path: string; bytes: number; sha256: string }

/** Public outcomes intentionally stop short of declaring the restarted Desktop healthy. */
export type LinuxInstallResult =
  | { status: 'cancelled' }
  | { status: 'system-transaction-complete' }
  | { status: 'restart-requested'; pid: number }
  | { status: 'failed' | 'recovery-required'; reason: string }

/** Events translated by a maintained D-Bus adapter; no D-Bus wire encoding belongs here. */
export type LinuxPackageKitEvent =
  | { type: 'allow-cancel'; allowed: boolean }
  | { type: 'finished'; outcome: 'success' | 'cancelled' | 'failed' }
  | { type: 'error'; reason: string }
  | { type: 'disconnected'; reason: string }

/** One system transaction; cancellation must never kill the package-manager service. */
export interface LinuxPackageKitTransaction {
  subscribe(listener: (event: LinuxPackageKitEvent) => void): () => void
  installFile(path: string): Promise<void>
  cancel(): Promise<void>
  close(): Promise<void>
}

/** Structural high-level proxy returned by the pinned maintained D-Bus client. */
export type LinuxDbusProxy = Pick<EventEmitter, 'on' | 'removeListener'> & Record<string, unknown>

/** The adapter consumes introspected proxies, never raw D-Bus messages or byte framing. */
export interface LinuxDbusBus {
  connection: EventEmitter & { stream: Socket }
  getService(name: string): { getInterface(path: string, name: string, callback: (error: unknown, proxy?: LinuxDbusProxy) => void): void }
}

/**
 * Require a canonical private directory owned by the invoking user.
 * @param path - Canonical directory whose ownership must match the current user.
 * @returns Device and inode identifiers.
 */
export async function inspectLinuxDirectory(path: string): Promise<{ dev: string; ino: string }> {
  const info = await lstat(path, { bigint: true })
  if (!info.isDirectory() || info.uid !== BigInt(process.getuid?.() ?? -1)
    || (info.mode & 0o022n) !== 0n || await realpath(path) !== path) throw new Error('Unsafe Linux update directory')
  return { dev: String(info.dev), ino: String(info.ino) }
}

/**
 * Hash an owned unlinked regular file while retaining and checking the opened inode.
 * @param path - Canonical regular file with a single directory link.
 * @param maxBytes - Maximum readable file size.
 * @param allowRootOwned - Permit a root-owned runtime artifact.
 * @returns Identity and digest checked against the opened inode and current path.
 */
export async function inspectLinuxFile(path: string, maxBytes = 2_000_000_000, allowRootOwned = false): Promise<LinuxFileIdentity> {
  const before = await lstat(path, { bigint: true })
  if (!before.isFile() || before.nlink !== 1n || (before.uid !== BigInt(process.getuid?.() ?? -1) && !(allowRootOwned && before.uid === 0n))
    || (before.mode & 0o022n) !== 0n || (before.mode & 0o6000n) !== 0n
    || before.size > BigInt(maxBytes) || before.size < 1n || await realpath(path) !== path) throw new Error('Unsafe Linux update file')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024)
    let bytes = 0
    while (true) {
      const result = await file.read(buffer, 0, buffer.length, null)
      if (result.bytesRead === 0) break
      bytes += result.bytesRead
      if (BigInt(bytes) > before.size) throw new Error('Linux update file changed')
      hash.update(buffer.subarray(0, result.bytesRead))
    }
    for (const after of [await file.stat({ bigint: true }), await lstat(path, { bigint: true })]) {
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.nlink !== after.nlink
        || before.mode !== after.mode || before.uid !== after.uid || BigInt(bytes) !== after.size) throw new Error('Linux update file changed')
    }
    return { dev: String(before.dev), ino: String(before.ino), bytes, mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs), mode: Number(before.mode & 0o777n), sha256: hash.digest('hex') }
  } finally { await file.close() }
}

/**
 * Compare all captured fields before mutating a previously observed file.
 * @param left - Newly observed identity.
 * @param right - Previously recorded identity.
 * @returns Whether every recorded field matches.
 */
export function sameLinuxFile(left: LinuxFileIdentity, right: LinuxFileIdentity): boolean {
  return Object.entries(left).every(([key, value]) => right[key as keyof LinuxFileIdentity] === value)
}

/**
 * Atomically persist one private transaction record and synchronize its directory.
 * @param path - Record path inside an owned private directory.
 * @param value - JSON-serializable transaction data.
 * @returns Resolves after file and directory synchronization.
 */
export async function writeLinuxUpdateRecord(path: string, value: unknown): Promise<void> {
  await inspectLinuxDirectory(dirname(path))
  const temporary = join(dirname(path), `.record-${randomBytes(12).toString('hex')}`)
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  let renamed = false
  try {
    await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); await file.close()
    await rename(temporary, path); renamed = true
    const directory = await open(dirname(path), constants.O_RDONLY)
    try { await directory.sync() } finally { await directory.close() }
  } finally {
    await file.close()
    if (!renamed) await unlink(temporary)
  }
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function canonicalPath(value: unknown): value is string { return typeof value === 'string' && !value.includes('\0') && posix.isAbsolute(value) && posix.resolve(value) === value }
function fileIdentity(value: unknown): value is LinuxFileIdentity {
  return record(value) && ['dev', 'ino', 'mtimeNs', 'ctimeNs'].every(key => typeof value[key] === 'string' && /^\d+$/.test(value[key]))
    && Number.isSafeInteger(value.bytes) && Number(value.bytes) > 0 && Number(value.bytes) <= 2_000_000_000
    && Number.isSafeInteger(value.mode) && Number(value.mode) >= 0 && Number(value.mode) <= 0o777
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
}

/**
 * Parse one identity recovered from a bounded transaction record.
 * @param value - Parsed untrusted persisted data.
 * @returns Validated physical file identity.
 */
export function parseLinuxFileIdentity(value: unknown): LinuxFileIdentity {
  if (!fileIdentity(value)) throw new Error('Invalid Linux update file identity')
  return value
}

/**
 * Read a small owned JSON record without following a replacement symlink.
 * @param path - Owned record path, limited to 32 KiB.
 * @returns Parsed JSON after file and digest validation.
 */
export async function readLinuxUpdateRecord(path: string): Promise<unknown> {
  const identity = await inspectLinuxFile(path, 32_768)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const bytes = Buffer.alloc(identity.bytes + 1)
    const result = await file.read(bytes, 0, bytes.length, 0)
    if (result.bytesRead !== identity.bytes || createHash('sha256').update(bytes.subarray(0, result.bytesRead)).digest('hex') !== identity.sha256) throw new Error('Linux update record changed')
    return JSON.parse(bytes.subarray(0, result.bytesRead).toString('utf8')) as unknown
  } finally { await file.close() }
}

/**
 * Validate persisted plan fields and their exact path relationships before recovery.
 * @param value - Parsed untrusted persisted data.
 * @returns Validated transaction plan with constrained file relationships.
 */
export function parseLinuxAppImagePlan(value: unknown): LinuxAppImagePlan {
  if (!record(value) || value.schema !== 1 || typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id)
    || typeof value.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(value.nonce)
    || !canonicalPath(value.targetPath) || !canonicalPath(value.transactionDirectory) || !canonicalPath(value.lockPath)
    || value.backupPath !== join(value.transactionDirectory, 'previous.AppImage')
    || value.candidatePath !== join(value.transactionDirectory, 'next.AppImage')
    || dirname(value.transactionDirectory) !== dirname(value.targetPath)
    || value.lockPath !== linuxInstallationLock(value.targetPath)
    || !fileIdentity(value.original) || !fileIdentity(value.candidate)
    || !record(value.parentDirectory) || !['dev', 'ino'].every(key => typeof (value.parentDirectory as Record<string, unknown>)[key] === 'string' && /^\d+$/.test((value.parentDirectory as Record<string, string>)[key] ?? ''))
    || typeof value.targetVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.targetVersion)) throw new Error('Invalid Linux AppImage transaction plan')
  return value as unknown as LinuxAppImagePlan
}

/**
 * Stable per-installation lock, independent of the downloaded release filename.
 * @param target - Canonical installation pathname.
 * @returns Stable adjacent lock pathname for this installation.
 */
export function linuxInstallationLock(target: string): string {
  return join(dirname(target), `.dsh-update-${createHash('sha256').update(target).digest('hex').slice(0, 24)}.lock`)
}

/** Request consumed by the independently staged Node helper. */
export interface LinuxHelperRequest {
  schema: 1
  planPath: string
  parent: LinuxParentIdentity
  commandTimeoutMs: number
  parentExitTimeoutMs: number
  pollIntervalMs: number
}

/**
 * Validate the non-secret helper file input. Environment values travel only through process inheritance.
 * @param value - Parsed untrusted helper input.
 * @returns Validated request with bounded deadlines and exact top-level fields.
 */
export function parseLinuxHelperRequest(value: unknown): LinuxHelperRequest {
  if (!record(value) || Object.keys(value).length !== 6 || value.schema !== 1 || !canonicalPath(value.planPath)
    || posix.basename(value.planPath) !== 'plan.json' || !record(value.parent)
    || !Number.isSafeInteger(value.parent.pid) || Number(value.parent.pid) <= 0
    || typeof value.parent.startTime !== 'string' || !/^\d+$/.test(value.parent.startTime)
    || !['commandTimeoutMs', 'parentExitTimeoutMs', 'pollIntervalMs'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) > 0 && Number(value[key]) <= 600_000)
    || Number(value.pollIntervalMs) > Number(value.parentExitTimeoutMs)) throw new Error('Invalid Linux helper request')
  return value as unknown as LinuxHelperRequest
}

/**
 * Snapshot inherited values without persisting credentials or allowing loader injection.
 * @param value - Explicit environment selected by the shared owner.
 * @returns Copied environment rejecting loader overrides; never persisted by this backend.
 */
export function validateLinuxRestartEnvironment(value: Readonly<Record<string, string>>): Record<string, string> {
  if (Object.entries(value).some(([key, entry]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    || typeof entry !== 'string' || entry.includes('\0') || entry.length > 16_384
    || /^(?:LD_|DYLD_|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$|APPIMAGE$|APPDIR$|DSH_UPDATE_)/.test(key))) throw new Error('Unsafe Linux restart environment')
  return { ...value }
}
