import { describe, expect, it } from 'vitest'
import { findConflictingHarness } from '../src/harness/ownership.ts'

describe('findConflictingHarness', () => {
  it('reports another dsh web process holding a file below the same DSH_HOME', async () => {
    const conflict = await findConflictingHarness('/Users/test/.dsh', {
      listProcesses: async () => [
        { pid: 91, command: 'node /cache/node_modules/.bin/dsh web --port 65000' },
      ],
      listOpenFiles: async () => ['/Users/test/.dsh/profiles/web/cordis.patch.yml'],
      ownPid: 10,
    })

    expect(conflict?.pid).toBe(91)
    expect(conflict?.command).toContain('dsh web')
  })

  it('ignores unrelated commands, its own PID, and a separate Harness home', async () => {
    const conflict = await findConflictingHarness('/Users/test/.dsh', {
      listProcesses: async () => [
        { pid: 10, command: 'dsh web' },
        { pid: 91, command: 'node server.js' },
        { pid: 92, command: '/usr/local/bin/dsh web' },
      ],
      listOpenFiles: async pid => pid === 92 ? ['/tmp/other/.dsh/settings.yaml'] : [],
      ownPid: 10,
    })

    expect(conflict).toBeUndefined()
  })
})
