/** Private physical rendezvous and serialized decisions for the Windows update bootstrap. */
import { randomBytes } from 'node:crypto'
import { link, lstat, mkdtemp, open, realpath, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Private update rendezvous allocated by the native main process, never the renderer. */
export interface WindowsUpdateSignal {
  directory: string
  nonce: string
}

/** Kernel identity of the worker whose readiness the bootstrap verified. */
export interface WindowsUpdateWorker {
  pid: number
  started: string
}

async function physicalDirectory(directory: string): Promise<void> {
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || resolve(await realpath(directory)) !== resolve(directory)) {
    throw new Error('Invalid private update signal directory.')
  }
}

/**
 * Allocate a private, unpredictable signal directory beneath the verified payload stage.
 * @param stage Physical, already verified native payload directory.
 * @returns A newly owned directory and its transaction nonce.
 */
export async function createWindowsUpdateSignal(stage: string): Promise<WindowsUpdateSignal> {
  await physicalDirectory(stage)
  return { directory: await mkdtemp(join(stage, 'handoff-')), nonce: randomBytes(32).toString('hex') }
}

/**
 * Read only a bounded physical single-link record matching this native transaction.
 * @param signal Native-owned directory and expected nonce.
 * @returns Exact worker identity, or rejects malformed, indirect or changed records.
 */
export async function readWindowsUpdateSignal(signal: WindowsUpdateSignal): Promise<WindowsUpdateWorker> {
  await physicalDirectory(signal.directory)
  const path = join(signal.directory, 'ready.json')
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > 1024) {
    throw new Error('Invalid update readiness record.')
  }
  const file = await open(path, 'r')
  try {
    const current = await file.stat()
    if (current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size) {
      throw new Error('Update readiness record changed.')
    }
    const bytes = Buffer.alloc(1025)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== before.size) throw new Error('Update readiness record changed.')
    const record: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
    if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid update readiness record.')
    const row = record as Record<string, unknown>
    if (Object.keys(row).sort().join(',') !== 'nonce,pid,schema,started,token'
      || row.schema !== 1 || row.nonce !== signal.nonce || row.token !== 'DSH_UPDATE_READY'
      || typeof row.pid !== 'number' || !Number.isSafeInteger(row.pid) || row.pid <= 0
      || typeof row.started !== 'string' || !/^[1-9]\d{0,18}$/u.test(row.started)) {
      throw new Error('Invalid update readiness record.')
    }
    return { pid: row.pid, started: row.started }
  } finally { await file.close() }
}

/**
 * Atomically publish a complete decision; irreversible cancellation dominates approval.
 * @param signal Native-owned directory and expected nonce.
 * @param approve Commit already verified readiness when true, otherwise cancel.
 * @returns Resolves after publication; rejects foreign files or duplicate approval.
 */
export async function decideWindowsUpdateSignal(signal: WindowsUpdateSignal, approve: boolean): Promise<void> {
  await physicalDirectory(signal.directory)
  const cancelled = join(signal.directory, 'cancelled')
  if (approve && await lstat(cancelled).then(() => true, (error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  })) throw new Error('Update handoff was cancelled.')
  const path = join(signal.directory, approve ? 'decision' : 'cancelled')
  const temporary = join(signal.directory, 'publish-' + randomBytes(16).toString('hex'))
  await writeFile(temporary, approve ? signal.nonce : 'CANCEL', { flag: 'wx', mode: 0o600 })
  try {
    // An atomic single-name publication never exposes a zero-length decision.
    await link(temporary, path)
  } catch (error) {
    if (approve || !(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink() || before.size !== 6) throw new Error('Invalid update cancellation record.')
  } finally { await unlink(temporary) }
}

/** Serializes native decisions; cancellation permanently fences an in-flight receipt read. */
export class WindowsUpdateDecision {
  private cancelled = false
  private pending: Promise<void> = Promise.resolve()
  private cancellation: Promise<void> | undefined

  constructor(private readonly signal: WindowsUpdateSignal,
    private readonly readReceipt: () => Promise<WindowsUpdateWorker> = () => readWindowsUpdateSignal(signal)) {}

  private isCancelled(): boolean { return this.cancelled }

  /**
   * Approve only a still-current verified worker, never a receipt arriving after cancellation.
   * @returns The worker identity after publication, or rejects if cancelled.
   */
  async approve(): Promise<WindowsUpdateWorker> {
    const worker = await this.readReceipt()
    const result = this.pending.then(async () => {
      if (this.isCancelled()) throw new Error('Update handoff was cancelled.')
      await decideWindowsUpdateSignal(this.signal, true)
      if (this.isCancelled()) throw new Error('Update handoff was cancelled.')
      return worker
    })
    this.pending = result.then(() => {}, () => {})
    return await result
  }

  /**
   * Publish irreversible cancellation after any decision already being written.
   * @returns The shared promise for complete cancellation publication.
   */
  cancel(): Promise<void> {
    this.cancelled = true
    this.cancellation ??= this.pending.then(() => decideWindowsUpdateSignal(this.signal, false))
    this.pending = this.cancellation.then(() => {}, () => {})
    return this.cancellation
  }
}
