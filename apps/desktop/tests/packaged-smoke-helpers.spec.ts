import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'
import {
  descendantProcessTree,
  isCommandNoMatch,
  parseWindowsProcessRows,
  seedWindowsClipboardSmokeState,
} from './packaged-smoke.ts'

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

  it('seeds isolated ordinary and archived sessions for the real clipboard smoke', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-clipboard-seed-'))
    try {
      const seeded = await seedWindowsClipboardSmokeState(root)
      expect(seeded.activeSessionId).not.toBe(seeded.archivedSessionId)
      expect(seeded.protectedPaths).toHaveLength(5)
      await expect(Promise.all(seeded.protectedPaths.map(path => readFile(path)))).resolves.toHaveLength(5)

      const reader = new Context()
      try {
        await reader.plugin(SessionStore)
        await reader.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
        const headers = await reader.sessionPersistence.list()
        expect(headers.map(header => header.id).sort()).toEqual([
          seeded.activeSessionId,
          seeded.archivedSessionId,
          'desktop-smoke-messenger-source-session-id',
        ].sort())
        expect(headers.every(header => header.cwd !== undefined)).toBe(true)
        expect(new Set(headers.map(header => header.cwd)).size).toBe(3)
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
