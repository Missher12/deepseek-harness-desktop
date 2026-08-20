import { PassThrough } from 'node:stream'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as desktopPluginRuntime from '../src/index.ts'
import {
  installDesktopPluginServices,
  resolveDesktopPluginRuntimeFacts,
  resolvePackagedPnpmEntry,
  type DesktopPluginRuntimeFacts,
} from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const facts: DesktopPluginRuntimeFacts = {
  profileName: 'web',
  profileDir: '/private/dsh/profiles/web',
  homeDir: '/private/dsh',
  executable: '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
  cliEntry: '/Applications/DeepSeek Harness.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js',
  pnpmEntry: '/Applications/DeepSeek Harness.app/Contents/Resources/app/node_modules/pnpm/bin/pnpm.cjs',
}

function harness(streams: 'both' | 'no-stdout' | 'no-stderr' = 'both') {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let settle!: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  let reject!: (error: Error) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, rejectPromise) => {
    settle = resolve
    reject = rejectPromise
  })
  const terminate = vi.fn()
  const waitForExit = vi.fn().mockResolvedValue(true)
  const spawn = vi.fn((_options: unknown) => ({
    pid: 4815,
    stdin: undefined,
    stdout: streams === 'no-stdout' ? undefined : stdout,
    stderr: streams === 'no-stderr' ? undefined : stderr,
    collected: {},
    done,
    terminate,
    waitForExit,
  }))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('subprocess', { spawn } as never)
  const services = installDesktopPluginServices(ctx, facts)
  return { ctx, services, spawn, stdout, stderr, settle, reject, terminate, waitForExit }
}

describe('Desktop plugin runtime services', () => {
  it('keeps its subprocess injection through the real Loader export shape', () => {
    expect('default' in desktopPluginRuntime).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(desktopPluginRuntime) as Record<string, unknown>
    expect(unwrapped).toBe(desktopPluginRuntime)
    expect(unwrapped.name).toBe('desktop-plugin-runtime')
    expect(unwrapped.inject).toEqual(['subprocess'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('resolves the packaged pnpm bin through its supported package root export', () => {
    expect(resolvePackagedPnpmEntry()).toMatch(/[\\/]pnpm[\\/]bin[\\/]pnpm\.mjs$/u)
  })

  it('validates string and object pnpm manifest bin shapes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'desktop-pnpm-manifest-'))
    const manifest = join(dir, 'package.json')
    try {
      writeFileSync(manifest, JSON.stringify({ bin: 'bin/pnpm.cjs' }))
      expect(resolvePackagedPnpmEntry(manifest)).toBe(join(dir, 'bin/pnpm.cjs'))
      writeFileSync(manifest, JSON.stringify({ bin: { pnpm: '' } }))
      expect(() => resolvePackagedPnpmEntry(manifest)).toThrow(/safe pnpm bin/)
      writeFileSync(manifest, JSON.stringify({ bin: { pnpm: 'bad\0entry' } }))
      expect(() => resolvePackagedPnpmEntry(manifest)).toThrow(/safe pnpm bin/)
      writeFileSync(manifest, JSON.stringify({}))
      expect(() => resolvePackagedPnpmEntry(manifest)).toThrow(/safe pnpm bin/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves default and explicit process facts and rejects a missing CLI entry', () => {
    expect(resolveDesktopPluginRuntimeFacts()).toMatchObject({ profileName: 'web' })
    expect(resolveDesktopPluginRuntimeFacts('custom')).toMatchObject({ profileName: 'custom' })
    const cliEntry = process.argv[1]
    try {
      process.argv[1] = undefined as never
      expect(() => resolveDesktopPluginRuntimeFacts()).toThrow(/CLI entry is unavailable/)
    } finally {
      process.argv[1] = cliEntry as string
    }
  })

  it('publishes an immutable active profile and runs packaged dsh plugin with packaged pnpm', async () => {
    const { services, spawn, settle, waitForExit } = harness()

    expect(services.profiles.current).toEqual({
      name: 'web',
      dir: '/private/dsh/profiles/web',
    })
    expect(Object.isFrozen(services.profiles.current)).toBe(true)
    expect(services.profiles.list()).toEqual([services.profiles.current])
    await expect(services.profiles.select('web')).resolves.toBeUndefined()
    await expect(services.profiles.select('other')).rejects.toThrow(/switching is not available/)

    const operation = services.pnpm.runPlugin(['add', 'fixture-plugin'], '/Users/example/project')
    expect(spawn).toHaveBeenCalledOnce()
    const spawnOptions = spawn.mock.calls[0]?.[0] as {
      argv: string[]
      cwd: string
      stdio: { stdin: string; stdout: string; stderr: string }
      graceMs: number
      env: Record<string, string>
    } | undefined
    expect(spawnOptions).toMatchObject({
      argv: [
        facts.executable,
        facts.cliEntry,
        'plugin',
        '--profile',
        'web',
        'add',
        'fixture-plugin',
      ],
      cwd: '/Users/example/project',
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 3000,
      env: {
        CI: 'true',
        DSH_HOME: facts.homeDir,
        DSH_DESKTOP_NODE_EXECUTABLE: facts.executable,
        DSH_DESKTOP_PNPM_ENTRY: facts.pnpmEntry,
        ELECTRON_RUN_AS_NODE: '1',
      },
    })
    expect(typeof spawnOptions?.env.PATH).toBe('string')
    expect(operation.stdout).toBeDefined()
    expect(operation.stderr).toBeDefined()
    settle({ exitCode: 0, signal: null })
    await expect(operation.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(waitForExit).toHaveBeenCalledOnce()
  })

  it('prepends a private node shim for pnpm lifecycle scripts and removes it on teardown', async () => {
    const fixture = harness()
    const operation = fixture.services.pnpm.runPlugin(['add', 'fixture-plugin'], '/tmp')
    const options = fixture.spawn.mock.calls[0]?.[0] as { env: Record<string, string> }
    const childPath = options.env.PATH
    if (childPath === undefined) throw new Error('missing child PATH')
    const shimDir = childPath.split(delimiter)[0]
    if (shimDir === undefined) throw new Error('missing node shim directory')
    const shim = join(shimDir, process.platform === 'win32' ? 'node.cmd' : 'node')

    expect(existsSync(shim)).toBe(true)
    expect(readFileSync(shim, 'utf8')).toContain('DSH_DESKTOP_NODE_EXECUTABLE')
    if (process.platform !== 'win32') {
      const smoke = spawnSync('node', ['-e', 'process.stdout.write("shim-ok")'], {
        encoding: 'utf8',
        env: {
          PATH: shimDir,
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          ELECTRON_RUN_AS_NODE: '1',
        },
      })
      expect(smoke.status).toBe(0)
      expect(smoke.stdout).toBe('shim-ok')
    }

    fixture.settle({ exitCode: 0, signal: null })
    await operation.done
    await fixture.ctx.fiber.dispose()
    expect(existsSync(shimDir)).toBe(false)
  })

  it('reuses its shim, supports an empty ambient PATH, and emits both platform wrappers', async () => {
    const originalPath = process.env.PATH
    delete process.env.PATH
    try {
      const fixture = harness()
      const service = fixture.services.pnpm as unknown as { ensureNodeShim(): string }
      const shimDir = service.ensureNodeShim()
      expect(service.ensureNodeShim()).toBe(shimDir)
      const operation = fixture.services.pnpm.runPlugin(['update'], '/tmp')
      expect((fixture.spawn.mock.calls[0]?.[0] as { env: Record<string, string> }).env.PATH).toBe(shimDir)
      fixture.settle({ exitCode: 0, signal: null })
      await operation.done
      await fixture.ctx.fiber.dispose()
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }

    for (const [platformName, shimName, expectedBody] of [
      ['win32', 'node.cmd', '@echo off\r\n'],
      ['linux', 'node', '#!/bin/sh\n'],
    ] as const) {
      const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue(platformName)
      const fixture = harness()
      try {
        const service = fixture.services.pnpm as unknown as { ensureNodeShim(): string }
        const shimDir = service.ensureNodeShim()
        expect(readFileSync(join(shimDir, shimName), 'utf8')).toContain(expectedBody)
      } finally {
        await fixture.ctx.fiber.dispose()
        platform.mockRestore()
      }
    }
  })

  it('rejects unsafe inputs and serializes one operation for the generation', async () => {
    const { services, settle } = harness()
    expect(() => services.pnpm.runPlugin([], '/tmp')).toThrow(/must not be empty/i)
    expect(() => services.pnpm.runPlugin(['add', 'bad\0value'], '/tmp')).toThrow(/must not contain NUL/i)
    expect(() => services.pnpm.runPlugin(['update'], 'relative')).toThrow(/absolute path without NUL/i)

    const operation = services.pnpm.runPlugin(['update'], '/tmp')
    expect(() => services.pnpm.runPlugin(['install'], '/tmp')).toThrow(/already running/i)
    settle({ exitCode: 0, signal: null })
    await operation.done
  })

  it('rejects unsafe service facts and missing piped subprocess streams', () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    expect(() => installDesktopPluginServices(ctx, { ...facts, profileName: 'bad/name' }))
      .toThrow(/profile name/)

    const noStdout = harness('no-stdout')
    expect(() => noStdout.services.pnpm.runPlugin(['add', 'x'], '/tmp')).toThrow(/piped output/)
    expect(noStdout.terminate).toHaveBeenCalledOnce()
    const noStderr = harness('no-stderr')
    expect(() => noStderr.services.pnpm.runPlugin(['add', 'x'], '/tmp')).toThrow(/piped output/)
    expect(noStderr.terminate).toHaveBeenCalledOnce()
  })

  it('forwards an optional signal and keeps a newer active marker on old settlement', async () => {
    const fixture = harness()
    const controller = new AbortController()
    const operation = fixture.services.pnpm.runPlugin(['update'], '/tmp', controller.signal)
    expect(fixture.spawn.mock.calls[0]?.[0]).toMatchObject({ signal: controller.signal })
    ;(fixture.services.pnpm as unknown as { active: unknown }).active = { newer: true }
    fixture.settle({ exitCode: 0, signal: null })
    await operation.done
    expect((fixture.services.pnpm as unknown as { active: unknown }).active).toEqual({ newer: true })
  })

  it('cancels the whole managed tree on request and during service teardown', async () => {
    const first = harness()
    const operation = first.services.pnpm.runPlugin(['update'], '/tmp')
    operation.cancel()
    expect(first.terminate).toHaveBeenCalledOnce()
    first.settle({ exitCode: null, signal: 'SIGTERM' })
    await operation.done

    const second = harness()
    const active = second.services.pnpm.runPlugin(['install'], '/tmp')
    const disposal = second.ctx.fiber.dispose()
    await vi.waitFor(() => { expect(second.terminate).toHaveBeenCalledOnce() })
    second.settle({ exitCode: null, signal: 'SIGTERM' })
    await disposal
    await active.done
    expect(() => second.services.pnpm.runPlugin(['update'], '/tmp')).toThrow(/closed/i)
  })

  it('absorbs an active subprocess rejection while tearing down', async () => {
    const fixture = harness()
    const operation = fixture.services.pnpm.runPlugin(['update'], '/tmp')
    const disposal = fixture.ctx.fiber.dispose()
    fixture.reject(new Error('subprocess failed during teardown'))
    await expect(operation.done).rejects.toThrow(/subprocess failed/)
    await expect(disposal).resolves.toBeUndefined()
  })

  it('mounts through the loader apply face with default and explicit profiles', () => {
    for (const profile of [undefined, 'custom'] as const) {
      const ctx = new Context()
      contexts.push(ctx)
      ctx.provide('subprocess', { spawn: vi.fn() } as never)
      if (profile === undefined) desktopPluginRuntime.apply(ctx)
      else desktopPluginRuntime.apply(ctx, { profile })
      expect((ctx.get('desktopProfiles') as { current: { name: string } }).current.name)
        .toBe(profile ?? 'web')
    }
  })
})
