import { describe, expect, it, vi } from 'vitest'
import {
  findConflictingHarness,
  MAC_DSH_PROCESS_QUERY,
  parsePosixProcesses,
  parseWindowsProcesses,
  windowsProcessQuery,
} from '../src/harness/ownership.ts'

describe('findConflictingHarness', () => {
  it('reports another dsh web process holding a file below the same DSH_HOME', async () => {
    const conflict = await findConflictingHarness('/Users/test/.dsh', {
      platform: 'darwin',
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
      platform: 'darwin',
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

  it('uses a narrow macOS process query before the exact command and DSH_HOME checks', () => {
    expect(MAC_DSH_PROCESS_QUERY).toEqual({
      file: '/usr/bin/pgrep',
      args: ['-lf', 'web'],
      noMatchExitCode: 1,
    })
    expect(parsePosixProcesses([
      '91 node /cache/node_modules/.bin/dsh web --port 65000',
      '92 node server.js',
      '',
    ].join('\n'))).toEqual([
      { pid: 91, command: 'node /cache/node_modules/.bin/dsh web --port 65000' },
      { pid: 92, command: 'node server.js' },
    ])
  })

  it('fails closed on an observable Windows dsh web command without open-file inspection', async () => {
    const listOpenFiles = vi.fn(async () => [])
    const conflict = await findConflictingHarness('C:\\Users\\test\\.dsh', {
      platform: 'win32',
      listProcesses: async () => [
        {
          pid: 91,
          command: '"C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe" "C:\\Program Files\\DeepSeek Harness\\resources\\app.asar.unpacked\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web --port 65000',
        },
      ],
      listOpenFiles,
      ownPid: 10,
    })

    expect(conflict?.pid).toBe(91)
    expect(listOpenFiles).not.toHaveBeenCalled()
  })

  it('ignores unrelated Windows commands and propagates process inspection failure', async () => {
    await expect(findConflictingHarness('C:\\Users\\test\\.dsh', {
      platform: 'win32',
      listProcesses: async () => [
        { pid: 91, command: '"C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe"' },
        { pid: 92, command: 'node C:\\tools\\script.js web' },
      ],
      ownPid: 10,
    })).resolves.toBeUndefined()

    await expect(findConflictingHarness('C:\\Users\\test\\.dsh', {
      platform: 'win32',
      listProcesses: async () => { throw new Error('CIM unavailable') },
    })).rejects.toThrow('CIM unavailable')
  })

  it('parses the array returned by Windows PowerShell process discovery', () => {
    expect(parseWindowsProcesses('[{"pid":91,"command":"dsh web"}]')).toEqual([
      { pid: 91, command: 'dsh web' },
    ])
    expect(parseWindowsProcesses('null')).toEqual([])
    expect(() => parseWindowsProcesses('{"pid":"91","command":null}')).toThrow(/invalid/i)
  })

  it('keeps the Windows process-selection pipe inside one PowerShell statement', () => {
    const script = windowsProcessQuery()
    expect(script).toContain('Where-Object { $_.CommandLine } | Select-Object')
    expect(script).not.toMatch(/;\s*\|/u)
    expect(script).toContain('; ConvertTo-Json -InputObject $processes -Compress')
  })
})
