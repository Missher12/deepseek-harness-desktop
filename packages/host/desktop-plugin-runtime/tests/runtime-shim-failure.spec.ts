import { existsSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { installDesktopPluginServices, type DesktopPluginRuntimeFacts } from '../src/index.ts'

const shimFailure = vi.hoisted(() => ({ directory: undefined as string | undefined }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdtempSync: (...args: Parameters<typeof actual.mkdtempSync>) => {
      const directory = actual.mkdtempSync(...args)
      shimFailure.directory = directory
      return directory
    },
    writeFileSync: () => { throw new Error('disk full') },
  }
})

const facts: DesktopPluginRuntimeFacts = {
  profileName: 'web',
  profileDir: '/private/dsh/profiles/web',
  homeDir: '/private/dsh',
  executable: '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
  cliEntry: '/Applications/DeepSeek Harness.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js',
  pnpmEntry: '/Applications/DeepSeek Harness.app/Contents/Resources/app/node_modules/pnpm/bin/pnpm.cjs',
}

describe('Desktop plugin runtime shim failure', () => {
  it('removes a partially created private directory when writing the wrapper fails', async () => {
    const ctx = new Context()
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    const service = installDesktopPluginServices(ctx, facts).pnpm as unknown as { ensureNodeShim(): string }

    expect(() => service.ensureNodeShim()).toThrow('disk full')
    expect(shimFailure.directory).toBeDefined()
    expect(existsSync(shimFailure.directory!)).toBe(false)
    await ctx.fiber.dispose()
  })
})
