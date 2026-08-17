import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  installDesktopPluginServices,
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

function harness() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let settle!: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    settle = resolve
  })
  const terminate = vi.fn()
  const waitForExit = vi.fn().mockResolvedValue(true)
  const spawn = vi.fn(() => ({
    pid: 4815,
    stdin: undefined,
    stdout,
    stderr,
    collected: {},
    done,
    terminate,
    waitForExit,
  }))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('subprocess', { spawn } as never)
  const services = installDesktopPluginServices(ctx, facts)
  return { ctx, services, spawn, stdout, stderr, settle, terminate, waitForExit }
}

describe('Desktop plugin runtime services', () => {
  it('resolves the packaged pnpm bin through its supported package root export', () => {
    expect(resolvePackagedPnpmEntry()).toMatch(/\/pnpm\/bin\/pnpm\.mjs$/u)
  })

  it('publishes an immutable active profile and runs packaged dsh plugin with packaged pnpm', async () => {
    const { services, spawn, settle, waitForExit } = harness()

    expect(services.profiles.current).toEqual({
      name: 'web',
      dir: '/private/dsh/profiles/web',
    })
    expect(Object.isFrozen(services.profiles.current)).toBe(true)
    expect(services.profiles.list()).toEqual([services.profiles.current])

    const operation = services.pnpm.runPlugin(['add', 'fixture-plugin'], '/Users/example/project')
    expect(spawn).toHaveBeenCalledWith({
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
        DSH_DESKTOP_PNPM_ENTRY: facts.pnpmEntry,
        ELECTRON_RUN_AS_NODE: '1',
      },
    })
    expect(operation.stdout).toBeDefined()
    expect(operation.stderr).toBeDefined()
    settle({ exitCode: 0, signal: null })
    await expect(operation.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(waitForExit).toHaveBeenCalledOnce()
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
})
