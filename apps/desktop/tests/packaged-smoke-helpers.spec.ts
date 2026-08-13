import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  descendantProcessTree,
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

  it('seeds isolated ordinary and archived sessions for the real clipboard smoke', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-clipboard-seed-'))
    try {
      const seeded = await seedWindowsClipboardSmokeState(root)
      expect(seeded.activeSessionId).not.toBe(seeded.archivedSessionId)
      expect(seeded.protectedPaths).toHaveLength(3)
      await expect(Promise.all(seeded.protectedPaths.map(path => readFile(path)))).resolves.toHaveLength(3)

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
