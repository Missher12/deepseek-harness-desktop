import { access } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type {
  SubprocessTerminalHandle, SubprocessTerminalSignal, SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  MAX_TERMINAL_INPUT_BYTES, MAX_TERMINAL_OUTPUT_BYTES, type WorkbenchTerminalSnapshot,
} from './protocol.ts'

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

export type SpawnTerminal = (spec: SubprocessTerminalSpawnSpec) => Promise<SubprocessTerminalHandle>

export async function defaultShell(): Promise<string> {
  for (const shell of ['/bin/zsh', '/bin/bash']) {
    try { await access(shell); return shell } catch { /* try the bounded fallback */ }
  }
  throw new Error('no supported shell is available')
}

export class WorkbenchTerminalRegistry {
  private readonly records = new Map<string, RecordState>()
  constructor(private readonly spawn: SpawnTerminal, private readonly shell: () => Promise<string> = defaultShell) {}

  async open(owner: string, cwd: string, rows = 30, cols = 100): Promise<WorkbenchTerminalSnapshot> {
    if ([...this.records.values()].filter(record => record.owner === owner).length >= MAX_TERMINALS) {
      throw new Error(`at most ${String(MAX_TERMINALS)} terminals may be open`)
    }
    const handle = await this.spawn({ argv: [await this.shell(), '-l'], cwd, rows: clamp(rows, 8, 120), cols: clamp(cols, 20, 240), graceMs: 1500,
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

  list(owner: string): WorkbenchTerminalSnapshot[] {
    return [...this.records.values()].filter(record => record.owner === owner).map(snapshot)
  }

  async write(owner: string, id: string, data: string): Promise<void> {
    const record = this.owned(owner, id)
    if (Buffer.byteLength(data) > MAX_TERMINAL_INPUT_BYTES) throw new Error('terminal input is too large')
    await record.handle.write(data)
  }

  async signal(owner: string, id: string, signal: string): Promise<void> {
    const record = this.owned(owner, id)
    if (!SIGNALS.has(signal as SubprocessTerminalSignal)) throw new Error('unsupported terminal signal')
    await record.handle.signalForeground(signal as SubprocessTerminalSignal)
  }

  async close(owner: string, id: string): Promise<void> {
    const record = this.owned(owner, id)
    this.records.delete(id)
    await record.handle.terminate()
  }

  async closeOwner(owner: string): Promise<void> {
    const records = [...this.records.values()].filter(record => record.owner === owner)
    for (const record of records) this.records.delete(record.id)
    await Promise.allSettled(records.map(record => record.handle.terminate()))
  }

  async closeAll(): Promise<void> {
    const records = [...this.records.values()]
    this.records.clear()
    await Promise.allSettled(records.map(record => record.handle.terminate()))
  }

  private owned(owner: string, id: string): RecordState {
    const record = this.records.get(id)
    if (record === undefined || record.owner !== owner) throw new Error('foreign terminal')
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
