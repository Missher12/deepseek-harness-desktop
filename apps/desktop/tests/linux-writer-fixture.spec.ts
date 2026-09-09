import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { linuxDesktopEnvironment, processAlive, withLinuxWriterFixture, type LinuxWriterFixture } from './linux-writer-fixture.ts'

describe('Linux Desktop native environment isolation', () => {
  it('keeps display transport and replaces account paths without provider or runtime injections', () => {
    const env = linuxDesktopEnvironment({
      PATH: '/usr/bin:/bin', DISPLAY: ':77', XAUTHORITY: '/display-authority',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/display-bus', XDG_RUNTIME_DIR: '/display-runtime',
      HOME: '/foreign-home', USERPROFILE: '/foreign-profile', TMPDIR: '/foreign-temp',
      XDG_CONFIG_HOME: '/foreign-config', XDG_CACHE_HOME: '/foreign-cache', XDG_DATA_HOME: '/foreign-data',
      DEEPSEEK_API_KEY: 'fake-secret', OPENAI_API_KEY: 'fake-secret', ANTHROPIC_API_KEY: 'fake-secret',
      AWS_SECRET_ACCESS_KEY: 'fake-secret', DSH_HOME: '/foreign-dsh', DSH_INJECT: 'fake-secret',
      NODE_OPTIONS: '--require=fake-secret', NODE_PATH: '/fake-secret', ELECTRON_RUN_AS_NODE: '1',
    }, '/owned', '/owned/held-home')
    expect(env).toMatchObject({
      PATH: '/usr/bin:/bin', DISPLAY: ':77', XAUTHORITY: '/display-authority',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/display-bus', XDG_RUNTIME_DIR: '/display-runtime',
      HOME: join('/owned', 'user-home'), USERPROFILE: join('/owned', 'user-home'),
      XDG_CONFIG_HOME: join('/owned', 'config'), XDG_CACHE_HOME: join('/owned', 'cache'), XDG_DATA_HOME: join('/owned', 'data'),
      XDG_STATE_HOME: join('/owned', 'state'), TMPDIR: join('/owned', 'tmp'), TMP: join('/owned', 'tmp'), TEMP: join('/owned', 'tmp'),
      DSH_HOME: '/owned/held-home', DSH_TELEMETRY_DISABLED: '1',
    })
    expect(JSON.stringify(env)).not.toContain('fake-secret')
    expect(JSON.stringify(env)).not.toContain('/foreign')
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.NODE_PATH).toBeUndefined()
    expect(env.DSH_INJECT).toBeUndefined()
  })
})

describe.skipIf(process.platform === 'win32')('Linux simulated writer fixture ownership', () => {
  it('owns distinct live writers concurrently and awaits their exit', async () => {
    const fixtures: LinuxWriterFixture[] = []
    let release!: () => void
    const bothReady = new Promise<void>((resolve) => { release = resolve })
    const results = await Promise.allSettled([0, 1].map(async () => withLinuxWriterFixture(async (fixture) => {
      fixtures.push(fixture)
      if (fixtures.length === 2) release()
      await bothReady
      expect(processAlive(fixture.pid)).toBe(true)
      expect(await readFile(fixture.sentinel, 'utf8')).toBe('owned writer data\n')
      expect(new Set(fixtures.map(value => value.root)).size).toBe(2)
      expect(new Set(fixtures.map(value => value.pid)).size).toBe(2)
    }).finally(release)))
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
    for (const fixture of fixtures) {
      expect(processAlive(fixture.pid)).toBe(false)
      await expect(access(fixture.root)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('reaps the writer and removes its root when the consumer fails', async () => {
    let observed: LinuxWriterFixture | undefined
    await expect(withLinuxWriterFixture(async (fixture) => {
      observed = fixture
      throw new Error('consumer failure')
    })).rejects.toThrow('consumer failure')
    if (observed === undefined) throw new Error('Fixture was not started')
    expect(processAlive(observed.pid)).toBe(false)
    await expect(access(observed.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
