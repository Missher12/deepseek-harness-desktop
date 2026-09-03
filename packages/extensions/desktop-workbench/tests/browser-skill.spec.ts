import { mkdir, mkdtemp, realpath, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserSkillProbe, resolveBundledBrowserSkillCli } from '../src/browser-skill.ts'
import { BSK_PROBE_TIMEOUT_MS } from '../src/protocol.ts'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(async (root) => { await rm(root, { force: true, recursive: true }) }))
})

const FULL_STATUS_JSON = JSON.stringify({
  daemon_version: '0.1.11',
  protocol_version: '1.1',
  pid: 4321,
  uptime_secs: 9,
  ws_port: 52800,
  sock_path: '/tmp/daemon.sock',
  browsers: [{ id: 'browser-1' }],
  sessions: [
    { id: 'session-1', owned: true },
    { id: 'session-2', borrowed: true },
    { id: 'session-3', owned: true },
  ],
  version_skew_browsers: [],
})

interface ScriptedProbe {
  run(command: string, args: readonly string[], timeoutMs: number): Promise<{ stdout: string }>
  calls: Array<[string, readonly string[], number]>
}

function scriptedRun(outputs: Array<{ stdout: string } | Error>): ScriptedProbe {
  const calls: Array<[string, readonly string[], number]> = []
  return {
    calls,
    async run(command: string, args: readonly string[], timeoutMs: number): Promise<{ stdout: string }> {
      calls.push([command, args, timeoutMs])
      const next = outputs.shift()
      if (next === undefined) throw new Error('scripted probe ran out of outputs')
      if (next instanceof Error) throw next
      return { stdout: next.stdout }
    },
  }
}

describe('BrowserSkill probe', () => {
  it('runs the version then bounded status calls and returns only sanitized fields', async () => {
    const scripted = scriptedRun([{ stdout: 'bsk 0.1.11\n' }, { stdout: FULL_STATUS_JSON }])
    const probe = new BrowserSkillProbe({ cliPath: '/bsk', run: scripted.run })

    const status = await probe.status()

    expect(status).toEqual({
      state: 'bundled-ready',
      cliVersion: '0.1.11',
      extension: 'connected',
      ownedSessions: 2,
      borrowedSessions: 1,
    })
    expect(Object.keys(status)).toEqual(['state', 'cliVersion', 'extension', 'ownedSessions', 'borrowedSessions'])
    expect(JSON.stringify(status)).not.toMatch(/4321|daemon\.sock|52800|session-[123]|browser-1/u)
    expect(scripted.calls).toEqual([
      ['/bsk', ['--version'], BSK_PROBE_TIMEOUT_MS],
      ['/bsk', ['status', '--json'], BSK_PROBE_TIMEOUT_MS],
    ])
  })

  it('reports missing without running anything when no CLI resolves', async () => {
    const scripted = scriptedRun([])
    const probe = new BrowserSkillProbe({ run: scripted.run })

    expect(await probe.status()).toEqual({
      state: 'missing', extension: 'not-connected', ownedSessions: 0, borrowedSessions: 0,
    })
    expect(scripted.calls).toEqual([])
  })

  it('reports incompatible when the bundled CLI version differs from the pin', async () => {
    const scripted = scriptedRun([{ stdout: 'bsk 0.2.0\n' }])
    const probe = new BrowserSkillProbe({ cliPath: '/bsk', run: scripted.run })

    expect(await probe.status()).toEqual({
      state: 'incompatible', cliVersion: '0.2.0', extension: 'not-connected', ownedSessions: 0, borrowedSessions: 0,
    })
    expect(scripted.calls).toHaveLength(1)
  })

  it('reports incompatible when the daemon version skews from the CLI', async () => {
    const scripted = scriptedRun([
      { stdout: 'bsk 0.1.11\n' },
      { stdout: JSON.stringify({ daemon_version: '0.2.0', browsers: [], sessions: [] }) },
    ])
    const probe = new BrowserSkillProbe({ cliPath: '/bsk', run: scripted.run })

    expect((await probe.status()).state).toBe('incompatible')
  })

  it('reports unhealthy when the status call fails or is not a JSON object', async () => {
    for (const output of [new Error('spawn failed'), { stdout: 'not json' }, { stdout: '[1,2]' }]) {
      const scripted = scriptedRun([{ stdout: 'bsk 0.1.11\n' }, output])
      const probe = new BrowserSkillProbe({ cliPath: '/bsk', run: scripted.run })

      expect(await probe.status()).toEqual({
        state: 'unhealthy', cliVersion: '0.1.11', extension: 'not-connected', ownedSessions: 0, borrowedSessions: 0,
      })
    }
  })

  it('passes a configurable per-command timeout to the runner', async () => {
    const scripted = scriptedRun([{ stdout: 'bsk 0.1.11\n' }, { stdout: '{}' }])
    const probe = new BrowserSkillProbe({ cliPath: '/bsk', run: scripted.run, timeoutMs: 4000 })

    await probe.status()

    expect(scripted.calls.map(call => call[2])).toEqual([4000, 4000])
  })

  it('rejects status calls after disposal', async () => {
    const probe = new BrowserSkillProbe({ cliPath: '/bsk', run: scriptedRun([]).run })
    probe.dispose()
    await expect(probe.status()).rejects.toThrow(/disposed/u)
  })

  it.skipIf(process.platform === 'win32')('kills only its own in-flight probe on disposal', async () => {
    const script = await mkdtemp(join(tmpdir(), 'dsh-bsk-probe-'))
    cleanup.push(script)
    const cli = join(script, 'bsk-sleeper')
    await writeFile(cli, '#!/bin/sh\nsleep 30\n')
    await chmod(cli, 0o755)

    const probe = new BrowserSkillProbe({ cliPath: cli })
    const pending = probe.status()
    await new Promise(resolve => setTimeout(resolve, 150))
    probe.dispose()
    await expect(pending).resolves.toMatchObject({ state: 'unhealthy' })
  })

  it('resolves the bundled CLI only for a physical file outside app.asar', async () => {
    const resources = await mkdtemp(join(tmpdir(), 'dsh-bsk-resources-'))
    cleanup.push(resources)
    await mkdir(join(resources, 'browser-skill', 'bin'), { recursive: true })
    await writeFile(join(resources, 'browser-skill', 'bin', 'bsk'), 'binary')

    expect(resolveBundledBrowserSkillCli(resources, 'darwin')).toBe(
      join(await realpath(resources), 'browser-skill', 'bin', 'bsk'),
    )
    expect(resolveBundledBrowserSkillCli(resources, 'win32')).toBeUndefined()
    expect(resolveBundledBrowserSkillCli(join(resources, 'missing'), 'darwin')).toBeUndefined()

    await mkdir(join(resources, 'app.asar', 'browser-skill', 'bin'), { recursive: true })
    await writeFile(join(resources, 'app.asar', 'browser-skill', 'bin', 'bsk'), 'binary')
    expect(resolveBundledBrowserSkillCli(join(resources, 'app.asar'), 'darwin')).toBeUndefined()
  })
})
