import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertWindowsCoreSelection, assertWindowsCoreStopped, prepareWindowsCoreHistory, windowsCorePortListening,
  windowsCoreProcessSnapshot, windowsCoreProcessTree, waitForWindowsCoreProcessesStopped } from './windows-core-native.ts'
import { closeBaseSmokeOwnedApplication } from './packaged-base-smoke.ts'

describe('Windows core process observation', () => {
  it.each(['', 'null', '[]', '[{"ProcessId":9001}]', '[{"ProcessId":9001,"ParentProcessId":"4"}]',
    '[{"ProcessId":9001.5,"ParentProcessId":4}]', '[{"ProcessId":9001,"ParentProcessId":-1}]',
    '[{"ProcessId":9001,"ParentProcessId":4},null]',
    '[{"ProcessId":9001,"ParentProcessId":4},{"ProcessId":9001,"ParentProcessId":8}]'])
  ('rejects incomplete or ambiguous snapshot %s', (output) => {
    expect(() => windowsCoreProcessSnapshot(output)).toThrow()
  })
  it('rejects a valid table missing the owned root before quit', () => {
    expect(() => windowsCoreProcessTree(9001, '[{"ProcessId":4,"ParentProcessId":0}]')).toThrow(/root/u)
  })
  it('keeps legitimate system PID zero and includes real descendants', () => {
    const output = JSON.stringify([{ ProcessId: 0, ParentProcessId: 0 }, { ProcessId: 4, ParentProcessId: 0 },
      { ProcessId: 9002, ParentProcessId: 9001 }, { ProcessId: 9001, ParentProcessId: 4 }])
    expect(windowsCoreProcessSnapshot(output)).toHaveLength(4)
    expect(windowsCoreProcessTree(9001, output).sort((a, b) => a - b)).toEqual([9001, 9002])
  })
  it('allows a valid post-exit snapshot without inventing a stopped root', () => {
    expect(windowsCoreProcessSnapshot('{"ProcessId":4,"ParentProcessId":0}')).toEqual([{ processId: 4, parentProcessId: 0 }])
  })
  it.each(['', '[{"ProcessId":9001}]', '[{"ProcessId":4,"ParentProcessId":0}]'])
  ('quits but cannot certify cleanup when pre-quit discovery fails: %s', async (output) => {
    const observed: number[] = []
    let quit = false
    let certified = false
    await expect(closeBaseSmokeOwnedApplication({ rootPid: 9001,
      record: pids => observed.push(...pids),
      discover: async () => {
        expect(observed).toEqual([9001])
        return windowsCoreProcessTree(9001, output)
      },
      quit: async () => { quit = true },
      waitForQuiescence: async () => { certified = true },
    })).rejects.toThrow()
    expect(quit).toBe(true)
    expect(certified).toBe(false)
  })
  it('does not retry a failed or malformed post-quit query into a false success', async () => {
    const failure = new Error('CIM query failed')
    let calls = 0
    await expect(waitForWindowsCoreProcessesStopped([9001], async () => {
      calls++
      throw failure
    })).rejects.toBe(failure)
    expect(calls).toBe(1)
    for (const output of ['', '[]', '[{"ProcessId":4}]']) {
      await expect(waitForWindowsCoreProcessesStopped([9001], async () => output)).rejects.toThrow()
    }
    await expect(waitForWindowsCoreProcessesStopped([9001], async () => '[{"ProcessId":4,"ParentProcessId":0}]'))
      .resolves.toBeUndefined()
  })
})

describe('Windows official historical Session identity', () => {
  it('accepts the selected row matching the old reader ID', () => {
    expect(() => { assertWindowsCoreSelection({ sessionId: 'legacy-id', selected: 'true' }, 'legacy-id') }).not.toThrow()
  })
  it('rejects a same-title row belonging to another Session', () => {
    expect(() => { assertWindowsCoreSelection({ sessionId: 'other-id', selected: 'true' }, 'legacy-id') }).toThrow(/different Session/u)
  })
  it('rejects the correct ID when its official row is not selected', () => {
    for (const selected of [null, 'false']) {
      expect(() => { assertWindowsCoreSelection({ sessionId: 'legacy-id', selected }, 'legacy-id') }).toThrow(/not selected/u)
    }
  })
})

describe('Windows core native inputs and cleanup', () => {
  it('refuses a non-release old runtime input without creating history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'windows-core-input-'))
    try {
      const input = join(root, 'input.json')
      await writeFile(input, JSON.stringify({ platform: 'win32', executableKind: 'electron', sourceSha: 'new-source' }))
      await expect(prepareWindowsCoreHistory(input, join(root, 'history'))).rejects.toThrow(/published Windows 0.5.5/u)
      await expect(readFile(join(root, 'history/legacy-fixture.json'))).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('rejects a live process and missing resource observations', async () => {
    await expect(assertWindowsCoreStopped([process.pid], [1])).rejects.toThrow(/alive/u)
    await expect(assertWindowsCoreStopped([], [1])).rejects.toThrow(/incomplete/u)
  })
  it('observes a real owned listener, then its closed port', async () => {
    const server = createServer(socket => socket.end())
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('No owned loopback port.')
    try { expect(await windowsCorePortListening(address.port)).toBe(true) }
    finally {
      await new Promise<void>((done, fail) => server.close((error) => { if (error === undefined) done(); else fail(error) }))
    }
    expect(await windowsCorePortListening(address.port)).toBe(false)
  })
})
