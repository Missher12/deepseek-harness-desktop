/** One-shot, private-file handoff from the updater to a native main process and its ready Host. */
import { createHash, randomBytes } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, posix } from 'node:path'

/** Identity observed by native main, never supplied by a renderer. */
export interface NativeRestartFacts {
  desktopVersion: string
  harnessVersion: string
  executablePath: string
  home: string
  dshHome: string
  userData: string
}
/** A caller may publish this only after its owned Host has passed application readiness and HTTP checks. */
export interface NativeRestartReadyFacts extends NativeRestartFacts { ownedHostPid: number }
/** A bounded request names exactly one expected native identity. */
export interface RestartRequest {
  schema: 1
  kind: 'desktop-restart-request'
  attemptId: string
  nonce: string
  transactionDirectory: string
  expiresAt: number
  expected: NativeRestartFacts
}
/** A consumed request; the durable claim and request hash are rechecked before publishing readiness. */
export interface RestartRequestHandle { requestPath: string; request: RestartRequest; requestSha256: string }
/** This receipt proves Host readiness only; it makes no UI or installation acceptance claim. */
export interface RestartReady extends NativeRestartReadyFacts {
  schema: 1
  kind: 'desktop-host-ready'
  attemptId: string
  nonce: string
  requestSha256: string
  mainPid: number
}
const FACT_KEYS = ['desktopVersion', 'harnessVersion', 'executablePath', 'home', 'dshHome', 'userData']
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u

/** Test a durable JSON object for an exact set of own fields.
 * @param value Untrusted JSON value.
 * @param keys Required and only allowed keys.
 * @returns Whether all and only the specified fields exist.
 */
export function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
/** POSIX wire paths cannot contain traversal or NUL characters.
 * @param value Untrusted wire path.
 * @returns Whether the path uses normalized absolute POSIX syntax.
 */
export function absoluteMacPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 1 && !value.includes('\0')
    && posix.isAbsolute(value) && posix.normalize(value) === value
}
/** Hash the exact transferred file bytes.
 * @param bytes Transferred content.
 * @returns Lowercase SHA-256 digest.
 */
export function bytesSha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
/** Reject links in every path component; the leaf must already exist.
 * @param path Existing normalized absolute path.
 */
export function assertPhysicalPath(path: string): void {
  if (!absoluteMacPath(path)) throw new Error('Expected a normalized absolute physical path.')
  let cursor = path
  for (;;) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Symbolic links are forbidden in updater paths.')
    if (cursor === '/') break
    cursor = dirname(cursor)
  }
}
/** Private transaction directories are owned, mode 0700, and have no linked ancestors.
 * @param path Existing transaction directory.
 */
export function assertPrivateDirectory(path: string): void {
  assertPhysicalPath(path)
  const stat = lstatSync(path)
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('Updater transaction directory must be private and owned.')
  }
}
/** Read bounded regular bytes through an identity-checked descriptor, refusing symlinks and hard links.
 * @param path Existing physical file.
 * @param maxBytes Maximum permitted file size.
 * @param privateFile Require owner-only access for transaction files.
 * @returns Verified file bytes.
 */
export function readPhysicalFile(path: string, maxBytes: number, privateFile = false): Buffer {
  assertPhysicalPath(path)
  const before = lstatSync(path)
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes
    || (privateFile && ((before.mode & 0o077) !== 0 || (process.getuid && before.uid !== process.getuid())))) {
    throw new Error('Unsafe updater file permissions, identity, or size.')
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const opened = fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Updater file changed while opening.')
    const buffer = Buffer.alloc(before.size + 1)
    let received = 0
    while (received < buffer.length) {
      const count = readSync(fd, buffer, received, buffer.length - received, null)
      if (count === 0) break
      received += count
    }
    const bytes = buffer.subarray(0, received)
    const after = fstatSync(fd)
    const current = lstatSync(path)
    if (bytes.length !== before.size || after.nlink !== 1 || current.nlink !== 1 || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev) {
      throw new Error('Updater file changed while reading.')
    }
    return bytes
  } finally { closeSync(fd) }
}
/** Publish complete JSON without overwriting an existing request, claim, receipt, or cancellation.
 * @param directory Owned private transaction directory.
 * @param name Fixed protocol record filename.
 * @param value JSON-serializable record.
 * @returns Exclusively published path.
 */
export function publishPrivateRecord(directory: string, name: string, value: unknown): string {
  assertPrivateDirectory(directory)
  if (!/^[a-z-]+\.json$/u.test(name)) throw new Error('Invalid updater record filename.')
  const destination = join(directory, name)
  const temporary = join(directory, `.record-${randomBytes(16).toString('hex')}`)
  const fd = openSync(temporary, 'wx', 0o600)
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
  try { linkSync(temporary, destination) } finally { unlinkSync(temporary) }
  return destination
}
/** Read one fixed, private transaction record; absence or an unfinished atomic publication means pending.
 * @param directory Owned private transaction directory.
 * @param name Fixed protocol record filename.
 * @returns Untrusted parsed JSON, or undefined while pending.
 */
export function readPrivateRecord(directory: string, name: string): unknown {
  assertPrivateDirectory(directory)
  if (!/^[a-z-]+\.json$/u.test(name)) throw new Error('Invalid updater record filename.')
  const path = join(directory, name)
  // Atomic hard-link publication briefly has two names. Wait until the publisher removes its temporary name.
  try { if (lstatSync(path).nlink === 2) return undefined } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
  return JSON.parse(readPhysicalFile(path, 64 * 1024, true).toString('utf8')) as unknown
}
/** Match a filesystem/process error without treating permission failures as absence.
 * @param error Caught operation failure.
 * @param code Expected Node error code.
 * @returns Whether the failure has that code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
/** Validate identity fields from durable JSON.
 * @param value Untrusted identity record.
 * @returns Whether all closed identity fields are valid.
 */
export function validRestartFacts(value: unknown): value is NativeRestartFacts {
  return exactRecord(value, FACT_KEYS) && typeof value.desktopVersion === 'string' && VERSION.test(value.desktopVersion)
    && typeof value.harnessVersion === 'string' && VERSION.test(value.harnessVersion)
    && ['executablePath', 'home', 'dshHome', 'userData'].every(key => absoluteMacPath(value[key]))
}
/** Canonicalize native-owned paths before comparing them to a restart request.
 * @param facts Observed native identity with existing paths.
 * @returns Identity with physical path spellings.
 */
export function canonicalRestartFacts(facts: NativeRestartFacts): NativeRestartFacts {
  return { desktopVersion: facts.desktopVersion, harnessVersion: facts.harnessVersion,
    executablePath: realpathSync(facts.executablePath), home: realpathSync(facts.home),
    dshHome: realpathSync(facts.dshHome), userData: realpathSync(facts.userData) }
}
function sameFacts(actual: NativeRestartFacts, expected: NativeRestartFacts): boolean {
  return FACT_KEYS.every(key => actual[key as keyof NativeRestartFacts] === expected[key as keyof NativeRestartFacts])
}
function parseRequest(path: string): RestartRequestHandle {
  if (basename(path) !== 'restart-request.json') throw new Error('Invalid restart request filename.')
  const directory = dirname(path); assertPrivateDirectory(directory)
  const bytes = readPhysicalFile(path, 64 * 1024, true)
  const raw: unknown = JSON.parse(bytes.toString('utf8'))
  if (!exactRecord(raw, ['schema', 'kind', 'attemptId', 'nonce', 'transactionDirectory', 'expiresAt', 'expected'])
    || raw.schema !== 1 || raw.kind !== 'desktop-restart-request'
    || typeof raw.attemptId !== 'string' || !/^[a-f0-9]{32}$/u.test(raw.attemptId)
    || typeof raw.nonce !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.nonce)
    || raw.transactionDirectory !== directory || !Number.isSafeInteger(raw.expiresAt)
    || !validRestartFacts(raw.expected)) throw new Error('Invalid restart request fields.')
  if (Number(raw.expiresAt) <= Date.now()) throw new Error('Restart request expired.')
  if (Number(raw.expiresAt) > Date.now() + 180_000) throw new Error('Restart request deadline exceeds the protocol limit.')
  return { requestPath: path, request: raw as unknown as RestartRequest, requestSha256: bytesSha256(bytes) }
}
/** Create a single restart request after bundle verification has supplied the exact executable.
 * @param directory Exclusive transaction directory.
 * @param expected Expected native identity, with actual existing paths.
 * @param attemptId Random 128-bit hexadecimal transaction identifier.
 * @param nonce Random 256-bit hexadecimal one-shot challenge.
 * @param expiresAt Absolute deadline in milliseconds.
 * @returns Fixed request filename, published exclusively.
 */
export function createRestartRequest(
  directory: string, expected: NativeRestartFacts, attemptId: string, nonce: string, expiresAt: number,
): string {
  const request: RestartRequest = { schema: 1, kind: 'desktop-restart-request', attemptId, nonce, transactionDirectory: directory,
    expiresAt, expected: canonicalRestartFacts(expected) }
  if (!validRestartFacts(request.expected) || !/^[a-f0-9]{32}$/u.test(attemptId) || !/^[a-f0-9]{64}$/u.test(nonce)
    || !Number.isSafeInteger(expiresAt)) throw new Error('Invalid restart request input.')
  return publishPrivateRecord(directory, 'restart-request.json', request)
}
/** Claim an updater request once, before launching a Host. Invalid identities fail closed.
 * @param envPath Native process environment DSH_DESKTOP_RESTART_REQUEST; undefined is an ordinary launch.
 * @param actual Facts obtained by native main. The caller removes the environment key after claiming it.
 * @returns A one-shot handle, or null for ordinary launches.
 */
export function readRestartRequest(envPath: string | undefined, actual: NativeRestartFacts): Promise<RestartRequestHandle | null> {
  return Promise.resolve().then(() => {
    if (envPath === undefined) return null
    const handle = parseRequest(envPath)
    if (!sameFacts(canonicalRestartFacts(actual), handle.request.expected)) throw new Error('Native restart identity mismatch.')
    publishPrivateRecord(handle.request.transactionDirectory, 'restart-claim.json', {
      schema: 1, attemptId: handle.request.attemptId, nonce: handle.request.nonce,
      requestSha256: handle.requestSha256, mainPid: process.pid,
    })
    return handle
  })
}
/** Publish readiness only after the caller's actual owned Host has become ready.
 * @param handle Previously consumed request from readRestartRequest.
 * @param actual Native identity plus the PID of the caller's ready, owned Host process.
 * @returns Resolves after an exclusive durable Host-ready receipt is published.
 */
export function writeRestartReady(handle: RestartRequestHandle, actual: NativeRestartReadyFacts): Promise<void> {
  return Promise.resolve().then(() => {
    const current = parseRequest(handle.requestPath)
    if (current.requestSha256 !== handle.requestSha256) throw new Error('Restart request changed after claim.')
    if (!sameFacts(canonicalRestartFacts(actual), current.request.expected)) throw new Error('Ready native identity mismatch.')
    if (!Number.isSafeInteger(actual.ownedHostPid) || actual.ownedHostPid <= 0 || actual.ownedHostPid === process.pid) {
      throw new Error('Invalid owned Host PID.')
    }
    const claim = readPrivateRecord(current.request.transactionDirectory, 'restart-claim.json')
    if (!validClaim(claim, current, process.pid)) throw new Error('Restart claim does not belong to this main process.')
    const ready: RestartReady = { schema: 1, kind: 'desktop-host-ready', attemptId: current.request.attemptId, nonce: current.request.nonce,
      requestSha256: current.requestSha256, mainPid: process.pid, ...canonicalRestartFacts(actual), ownedHostPid: actual.ownedHostPid }
    publishPrivateRecord(current.request.transactionDirectory, 'restart-ready.json', ready)
  })
}
function validClaim(raw: unknown, handle: RestartRequestHandle, pid: number): boolean {
  return exactRecord(raw, ['schema', 'attemptId', 'nonce', 'requestSha256', 'mainPid']) && raw.schema === 1
    && raw.attemptId === handle.request.attemptId && raw.nonce === handle.request.nonce
    && raw.requestSha256 === handle.requestSha256 && raw.mainPid === pid
}
/** Validate a ready receipt against the exact spawned main process and its original request.
 * @param requestPath Fixed request filename.
 * @param expectedMainPid PID returned when the updater spawned the verified executable.
 * @returns Validated Host readiness, or null while no receipt has been published.
 */
export function readRestartReady(requestPath: string, expectedMainPid: number): RestartReady | null {
  const handle = parseRequest(requestPath)
  const raw = readPrivateRecord(handle.request.transactionDirectory, 'restart-ready.json')
  if (raw === undefined) return null
  if (!exactRecord(raw, ['schema', 'kind', 'attemptId', 'nonce', 'requestSha256', 'mainPid', ...FACT_KEYS, 'ownedHostPid'])
    || raw.schema !== 1 || raw.kind !== 'desktop-host-ready' || raw.attemptId !== handle.request.attemptId
    || raw.nonce !== handle.request.nonce || raw.requestSha256 !== handle.requestSha256 || raw.mainPid !== expectedMainPid
    || !Number.isSafeInteger(raw.ownedHostPid) || Number(raw.ownedHostPid) <= 0 || raw.ownedHostPid === expectedMainPid
    || !sameFacts(raw as unknown as NativeRestartFacts, handle.request.expected)
    || !validClaim(readPrivateRecord(handle.request.transactionDirectory, 'restart-claim.json'), handle, expectedMainPid)) {
    throw new Error('Restart readiness identity, nonce, or request hash mismatch.')
  }
  return raw as unknown as RestartReady
}
