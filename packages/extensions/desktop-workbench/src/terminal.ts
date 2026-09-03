import { access } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type {
  SubprocessTerminalHandle, SubprocessTerminalSignal, SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  MAX_TERMINAL_INPUT_BYTES, MAX_TERMINAL_OUTPUT_BYTES, type WorkbenchTerminalSnapshot,
} from './protocol.ts'

/** Maximum user terminals owned by one workbench Client. */
export const MAX_TERMINALS = 4
const SIGNALS = new Set<SubprocessTerminalSignal>(['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'])

interface RecordState {
  id: string
  owner: string
  cwd: string
  handle: SubprocessTerminalHandle
  output: Buffer
  revision: number
  status: 'running' | 'exited'
  exitCode?: number | null
}

/** Terminal allocator supplied by the Host subprocess service. */
export type SpawnTerminal = (spec: SubprocessTerminalSpawnSpec) => Promise<SubprocessTerminalHandle>

/** Executable and arguments used to open one native workbench terminal. */
export type WorkbenchShellCommand = readonly [string, ...string[]]

type ShellAccess = (path: string) => Promise<void>

/**
 * Select the bounded native shell command for the current platform.
 * @param platform - runtime operating-system identifier.
 * @param verifyAccess - executable probe; injectable for platform-independent tests.
 * @returns PowerShell on Windows or the first supported POSIX login shell.
 */
export async function defaultShell(
  platform: NodeJS.Platform = process.platform,
  verifyAccess: ShellAccess = access,
): Promise<WorkbenchShellCommand> {
  if (platform === 'win32') return ['powershell.exe', '-NoLogo', '-NoProfile']
  for (const shell of ['/bin/zsh', '/bin/bash']) {
    try { await verifyAccess(shell); return [shell, '-l'] } catch { /* try the bounded fallback */ }
  }
  throw new Error('no supported shell is available')
}

/** Bounded registry for user-owned terminals outside the Agent terminal service. */
export class WorkbenchTerminalRegistry {
  private readonly records = new Map<string, RecordState>()
  constructor(
    private readonly spawn: SpawnTerminal,
    private readonly shell: () => Promise<WorkbenchShellCommand> = defaultShell,
  ) {}

  /**
   * Open one owned login shell.
   * @param owner - opaque Client-generation owner.
   * @param cwd - live session workspace directory.
   * @param rows - initial terminal rows.
   * @param cols - initial terminal columns.
   * @returns initial bounded snapshot.
   */
  async open(owner: string, cwd: string, rows = 30, cols = 100): Promise<WorkbenchTerminalSnapshot> {
    const owned = [...this.records.values()].filter(record => record.owner === owner)
    if (owned.length >= MAX_TERMINALS) {
      // A previous mount's cleanup closes are fire-and-forget; a fresh mount
      // that opens while they are still in flight supersedes the oldest
      // leftover so a rapid close/reopen can never 400 on capacity.
      const oldest = owned[0]
      if (oldest === undefined) {
        throw new Error(`at most ${String(MAX_TERMINALS)} terminals may be open`)
      }
      this.records.delete(oldest.id)
      await oldest.handle.terminate()
    }
    const handle = await this.spawn({ argv: await this.shell(), cwd, rows: clamp(rows, 8, 120), cols: clamp(cols, 20, 240), graceMs: 1500,
      env: { TERM: 'xterm-256color', DSH_UI_TERMINAL: '1' } })
    const record: RecordState = {
      id: randomBytes(12).toString('base64url'), owner, cwd, handle, output: Buffer.alloc(0), revision: 0, status: 'running',
    }
    this.records.set(record.id, record)
    void this.collect(record)
    void handle.done.then((outcome) => {
      record.status = 'exited'
      record.exitCode = outcome.exitCode
      record.revision += 1
    }, () => {
      record.status = 'exited'
      record.exitCode = null
      record.revision += 1
    })
    return snapshot(record)
  }

  /**
   * List one owner's terminals.
   * @param owner - opaque Client-generation owner.
   * @returns current bounded snapshots.
   */
  list(owner: string): WorkbenchTerminalSnapshot[] {
    return [...this.records.values()].filter(record => record.owner === owner).map(snapshot)
  }

  /**
   * Write exact text to an owned terminal.
   * @param owner - opaque Client-generation owner.
   * @param id - terminal id.
   * @param data - bounded UTF-8 input.
   */
  async write(owner: string, id: string, data: string): Promise<void> {
    const record = this.ownedOrClosed(owner, id)
    if (record === undefined) return
    if (Buffer.byteLength(data) > MAX_TERMINAL_INPUT_BYTES) throw new Error('terminal input is too large')
    await record.handle.write(data)
  }

  /**
   * Signal one owned foreground process group.
   * @param owner - opaque Client-generation owner.
   * @param id - terminal id.
   * @param signal - closed signal vocabulary member.
   */
  async signal(owner: string, id: string, signal: string): Promise<void> {
    const record = this.ownedOrClosed(owner, id)
    if (record === undefined) return
    if (!SIGNALS.has(signal as SubprocessTerminalSignal)) throw new Error('unsupported terminal signal')
    await record.handle.signalForeground(signal as SubprocessTerminalSignal)
  }

  /**
   * Terminate and remove one owned terminal.
   * @param owner - opaque Client-generation owner.
   * @param id - terminal id.
   */
  async close(owner: string, id: string): Promise<void> {
    const record = this.records.get(id)
    // React effect cleanup and an explicit close can race. A missing random
    // terminal id is already closed, while a live foreign record remains a
    // hard authorization failure.
    if (record === undefined) return
    if (record.owner !== owner) throw new Error('foreign terminal')
    this.records.delete(id)
    await record.handle.terminate()
  }

  /**
   * Terminate every terminal owned by one Client.
   * @param owner - owner whose terminals must all terminate.
   */
  async closeOwner(owner: string): Promise<void> {
    const records = [...this.records.values()].filter(record => record.owner === owner)
    for (const record of records) this.records.delete(record.id)
    await Promise.allSettled(records.map(record => record.handle.terminate()))
  }

  /** Terminate every retained terminal during plugin disposal. */
  async closeAll(): Promise<void> {
    const records = [...this.records.values()]
    this.records.clear()
    await Promise.allSettled(records.map(record => record.handle.terminate()))
  }

  /**
   * Resolve a record for an idempotent teardown action: a missing random id
   * is already closed (the React cleanup and an explicit close can race),
   * while a live record owned by someone else stays a hard authorization
   * failure.
   * @param owner - opaque Client-generation owner.
   * @param id - terminal id.
   * @returns the record, or undefined when the terminal is already gone.
   */
  private ownedOrClosed(owner: string, id: string): RecordState | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    if (record.owner !== owner) throw new Error('foreign terminal')
    return record
  }

  private async collect(record: RecordState): Promise<void> {
    try {
      for await (const chunk of record.handle.output) {
        if (!this.records.has(record.id)) return
        const next = Buffer.concat([record.output, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)])
        record.output = next.subarray(Math.max(0, next.byteLength - MAX_TERMINAL_OUTPUT_BYTES))
        record.revision += 1
      }
    } catch { /* the settled status is reported through handle.done */ }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min))
}

function snapshot(record: RecordState): WorkbenchTerminalSnapshot {
  return {
    id: record.id, cwd: record.cwd, pid: record.handle.pid, output: record.output.toString('utf8'), revision: record.revision,
    status: record.status, ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
  }
}
