import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'
import * as packagedSmoke from './packaged-smoke.ts'

const {
  descendantProcessTree,
  isCommandNoMatch,
  isUsageTokenTooltip,
  parseWindowsProcessRows,
  seedWindowsClipboardSmokeState,
} = packagedSmoke

describe('packaged desktop process inspection', () => {
  it('parses both PowerShell single-object and array JSON', () => {
    expect(parseWindowsProcessRows('{"ProcessId":12,"ParentProcessId":4}')).toEqual([
      { processId: 12, parentProcessId: 4 },
    ])
    expect(parseWindowsProcessRows('[{"ProcessId":12,"ParentProcessId":4},{"ProcessId":13,"ParentProcessId":12}]')).toEqual([
      { processId: 12, parentProcessId: 4 },
      { processId: 13, parentProcessId: 12 },
    ])
    expect(parseWindowsProcessRows('  ')).toEqual([])
  })

  it('walks descendants once when a malformed snapshot contains a cycle', () => {
    expect(descendantProcessTree(10, [
      { processId: 11, parentProcessId: 10 },
      { processId: 12, parentProcessId: 11 },
      { processId: 10, parentProcessId: 12 },
      { processId: 99, parentProcessId: 1 },
    ])).toEqual([10, 11, 12])
  })

  it('recognizes an empty native command result without swallowing other failures', () => {
    expect(isCommandNoMatch(Object.assign(new Error('no listener'), { code: 1 }))).toBe(true)
    expect(isCommandNoMatch(Object.assign(new Error('access denied'), { code: 5 }))).toBe(false)
    expect(isCommandNoMatch(new Error('missing exit code'))).toBe(false)
  })

  it('accepts the localized token tooltip word order used by the packaged UI', () => {
    expect(isUsageTokenTooltip('August 18: 8K tokens used')).toBe(true)
    expect(isUsageTokenTooltip('8月17日 使用了 9.8亿 个 Token')).toBe(true)
    expect(isUsageTokenTooltip('August 18: 8K tokens')).toBe(false)
  })

  it('waits for selected-session restore writes to settle before taking the mutation baseline', async () => {
    type Stabilize = (
      paths: readonly string[],
      options: {
        stableForMs: number
        timeoutMs: number
        readSnapshot: (paths: readonly string[]) => Promise<Record<string, string>>
        wait: (delayMs: number) => Promise<void>
        now: () => number
      },
    ) => Promise<Record<string, string>>
    const stabilize = (packagedSmoke as unknown as {
      waitForStableProtectedFileSnapshot?: Stabilize
    }).waitForStableProtectedFileSnapshot
    expect(stabilize).toBeTypeOf('function')
    if (stabilize === undefined) return

    const restored = { session: 'restored-policy-state' }
    const snapshots = [
      { session: 'seeded' },
      restored,
      restored,
    ]
    const waits: number[] = []
    let now = 0
    const result = await stabilize(['session'], {
      stableForMs: 200,
      timeoutMs: 1_000,
      readSnapshot: async () => snapshots.shift() ?? restored,
      wait: async (delayMs) => {
        waits.push(delayMs)
        now += delayMs
      },
      now: () => now,
    })

    expect(result).toEqual(restored)
    expect(waits).toEqual([200, 200])
  })

  it('seeds isolated ordinary, archived, and subagent sessions for native desktop smoke', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-clipboard-seed-'))
    try {
      const seeded = await seedWindowsClipboardSmokeState(root)
      expect(seeded.activeSessionId).not.toBe(seeded.archivedSessionId)
      expect(seeded.protectedPaths).toHaveLength(6)
      expect(seeded.expectedDailyTokens).toBe(8_000)
      await expect(Promise.all(seeded.protectedPaths.map(path => readFile(path)))).resolves.toHaveLength(6)

      const reader = new Context()
      try {
        await reader.plugin(SessionStore)
        await reader.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
        const headers = await reader.sessionPersistence.list()
        expect(headers.map(header => header.id).sort()).toEqual([
          seeded.activeSessionId,
          seeded.archivedSessionId,
          seeded.messengerSourceSessionId,
          seeded.messengerSubagentSessionId,
        ].sort())
        expect(headers.every(header => header.cwd !== undefined)).toBe(true)
        expect(new Set(headers.map(header => header.cwd)).size).toBe(4)
        expect(headers.find(header => header.id === seeded.messengerSubagentSessionId)).toMatchObject({
          origin: 'subagent',
          parentSession: seeded.activeSessionId,
          delegationDepth: 1,
        })
        const active = await reader.sessionPersistence.load(SessionId(seeded.activeSessionId))
        expect(active.events.slice(-4).map(event => ({ type: event.type, data: event.data }))).toEqual([
          { type: 'permission/preset', data: { preset: 'workspace-write' } },
          { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
          { type: 'approval/policy', data: { policy: 'ask' } },
          { type: 'session/end-seed', data: {} },
        ])
      } finally {
        await reader.fiber.dispose()
      }

      const workspace = JSON.parse(await readFile(join(root, 'storages', 'workspace.json'), 'utf8')) as {
        unit: { name: string; version: number }
        global: { initialized: boolean; workspaceIds: string[]; archivedSessionIds: string[] }
        tables: { workspaces: Record<string, unknown> }
      }
      expect(workspace).toEqual({
        unit: { name: 'workspace', version: 2 },
        global: {
          initialized: true,
          workspaceIds: [],
          archivedSessionIds: [seeded.archivedSessionId],
        },
        tables: { workspaces: {} },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
