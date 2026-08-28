import { createHmac, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export type ControlAuditAction =
  | 'lease-granted' | 'lease-revoked' | 'snapshot' | 'pointer' | 'keyboard'
  | 'text' | 'approval' | 'emergency-stop' | 'stop'
export type ControlAuditOutcome = 'allowed' | 'granted' | 'denied' | 'cancelled' | 'stopped' | 'failed'

export interface ControlAuditEvent {
  readonly sessionId: string
  readonly appId: string | null
  readonly action: ControlAuditAction
  readonly outcome: ControlAuditOutcome
}

export interface WallClock {
  nowUnixMs(): number
}

export interface ControlAuditLogOptions {
  readonly filename: string
  readonly clock: WallClock
  readonly installSalt: Uint8Array
  readonly maxRows?: number
  readonly maxBytes?: number
  readonly readText?: (filename: string) => Promise<string>
  readonly writeAtomic?: (filename: string, content: string) => Promise<void>
}

const INSTALL_SALT = /^[0-9a-f]{64}\n$/

/** Load or atomically create the separate per-install audit HMAC salt. */
export async function loadOrCreateControlAuditSalt(filename: string): Promise<Uint8Array> {
  try {
    const metadata = await lstat(filename)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== 65) {
      throw new Error('control audit salt file is invalid')
    }
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const encoded = await handle.readFile({ encoding: 'utf8' })
      if (!INSTALL_SALT.test(encoded)) throw new Error('control audit salt file is invalid')
      return new Uint8Array(Buffer.from(encoded.slice(0, 64), 'hex'))
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const salt = randomBytes(32)
    await writeFileAtomic(filename, `${salt.toString('hex')}\n`, { mode: 0o600, dirMode: 0o700 })
    return new Uint8Array(salt)
  }
}

interface ControlAuditRow {
  readonly timeUnixMs: number
  readonly sessionHash: string
  readonly appId: string | null
  readonly action: ControlAuditAction
  readonly outcome: ControlAuditOutcome
}

const ACTIONS: ReadonlySet<string> = new Set([
  'lease-granted', 'lease-revoked', 'snapshot', 'pointer', 'keyboard',
  'text', 'approval', 'emergency-stop', 'stop',
])
const OUTCOMES: ReadonlySet<string> = new Set([
  'allowed', 'granted', 'denied', 'cancelled', 'stopped', 'failed',
])
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const HASH = /^[0-9a-f]{64}$/
const ROW_KEYS: ReadonlySet<string> = new Set([
  'timeUnixMs', 'sessionHash', 'appId', 'action', 'outcome',
])

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function parseRow(value: unknown): ControlAuditRow | null {
  if (!isPlainRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== ROW_KEYS.size || keys.some(key => !ROW_KEYS.has(key))) return null
  const timeUnixMs = ownData(value, 'timeUnixMs')
  const sessionHash = ownData(value, 'sessionHash')
  const appId = ownData(value, 'appId')
  const action = ownData(value, 'action')
  const outcome = ownData(value, 'outcome')
  if (!Number.isSafeInteger(timeUnixMs) || (timeUnixMs as number) < 0
    || typeof sessionHash !== 'string' || !HASH.test(sessionHash)
    || !(appId === null || (typeof appId === 'string' && APP_ID.test(appId)))
    || typeof action !== 'string' || !ACTIONS.has(action)
    || typeof outcome !== 'string' || !OUTCOMES.has(outcome)) return null
  return {
    timeUnixMs: timeUnixMs as number,
    sessionHash,
    appId,
    action: action as ControlAuditAction,
    outcome: outcome as ControlAuditOutcome,
  }
}

export class ControlAuditLog {
  readonly #filename: string
  readonly #clock: WallClock
  readonly #salt: Uint8Array
  readonly #maxRows: number
  readonly #maxBytes: number
  readonly #readText: (filename: string) => Promise<string>
  readonly #writeAtomic: (filename: string, content: string) => Promise<void>
  #tail: Promise<void> = Promise.resolve()

  constructor(options: ControlAuditLogOptions) {
    if (!(options.installSalt instanceof Uint8Array) || options.installSalt.byteLength !== 32) {
      throw new TypeError('control audit install salt must be exactly 32 bytes')
    }
    this.#filename = options.filename
    this.#clock = options.clock
    this.#salt = new Uint8Array(options.installSalt)
    this.#maxRows = options.maxRows ?? 512
    this.#maxBytes = options.maxBytes ?? 256 * 1024
    if (!Number.isSafeInteger(this.#maxRows) || this.#maxRows < 1 || this.#maxRows > 10_000
      || !Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 256 || this.#maxBytes > 4 * 1024 * 1024) {
      throw new TypeError('control audit rotation bounds are invalid')
    }
    this.#readText = options.readText ?? (async filename => readFile(filename, 'utf8'))
    this.#writeAtomic = options.writeAtomic ?? (async (filename, content) => {
      await writeFileAtomic(filename, content, { mode: 0o600, dirMode: 0o700 })
    })
  }

  record(event: ControlAuditEvent): Promise<void> {
    const pending = this.#tail.then(() => this.#record(event))
    this.#tail = pending.catch(() => {})
    return pending
  }

  async flush(): Promise<void> {
    await this.#tail
  }

  async #record(event: ControlAuditEvent): Promise<void> {
    if (!isPlainRecord(event)) throw new TypeError('control audit event is invalid')
    const sessionId = ownData(event, 'sessionId')
    const appId = ownData(event, 'appId')
    const action = ownData(event, 'action')
    const outcome = ownData(event, 'outcome')
    if (typeof sessionId !== 'string' || sessionId.length === 0
      || Buffer.byteLength(sessionId, 'utf8') > 256
      || !(appId === null || (typeof appId === 'string' && APP_ID.test(appId)))
      || typeof action !== 'string' || !ACTIONS.has(action)
      || typeof outcome !== 'string' || !OUTCOMES.has(outcome)) {
      throw new TypeError('control audit event uses invalid metadata')
    }
    const timeUnixMs = this.#clock.nowUnixMs()
    if (!Number.isSafeInteger(timeUnixMs) || timeUnixMs < 0) {
      throw new TypeError('control audit wall clock is invalid')
    }
    const row: ControlAuditRow = {
      timeUnixMs,
      sessionHash: createHmac('sha256', this.#salt).update(sessionId, 'utf8').digest('hex'),
      appId,
      action: action as ControlAuditAction,
      outcome: outcome as ControlAuditOutcome,
    }
    const rows = await this.#readRows()
    rows.push(row)
    const kept: string[] = []
    let bytes = 0
    for (let index = rows.length - 1; index >= 0 && kept.length < this.#maxRows; index--) {
      const encoded = `${JSON.stringify(rows[index])}\n`
      const encodedBytes = Buffer.byteLength(encoded, 'utf8')
      if (encodedBytes > this.#maxBytes) throw new Error('control audit row exceeds rotation bound')
      if (bytes + encodedBytes > this.#maxBytes) break
      kept.unshift(encoded)
      bytes += encodedBytes
    }
    await this.#writeAtomic(this.#filename, kept.join(''))
  }

  async #readRows(): Promise<ControlAuditRow[]> {
    let contents: string
    try {
      contents = await this.#readText(this.#filename)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const rows: ControlAuditRow[] = []
    for (const line of contents.split('\n')) {
      if (line.length === 0) continue
      try {
        const row = parseRow(JSON.parse(line))
        if (row !== null) rows.push(row)
      } catch {
        // A corrupt or hostile historical row is dropped during the next atomic rotation.
      }
    }
    return rows
  }
}
