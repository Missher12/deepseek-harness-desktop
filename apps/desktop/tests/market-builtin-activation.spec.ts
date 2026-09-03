import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const marketRoot = dirname(require.resolve('dshmarket/package.json'))
const marketRoutes = await import(pathToFileURL(join(marketRoot, 'src/routes.ts')).href) as {
  builtinIsLive?: (
    name: string,
    plugin: { runtimeNames?: string[] },
    live: ReadonlySet<string>,
  ) => boolean
}

describe('Desktop built-in plugin activation', () => {
  it('resolves a display package through its exact managed Loader name', () => {
    expect(typeof marketRoutes.builtinIsLive).toBe('function')
    expect(marketRoutes.builtinIsLive?.(
      'dsh-missher-memory',
      { runtimeNames: ['@deepseek-ai/dsh-desktop-managed-memory'] },
      new Set(['@deepseek-ai/dsh-desktop-managed-memory']),
    )).toBe(true)
  })

  it('keeps an unloaded built-in in restart state', () => {
    expect(marketRoutes.builtinIsLive?.(
      'dsh-missher-memory',
      { runtimeNames: ['@deepseek-ai/dsh-desktop-managed-memory'] },
      new Set(['@deepseek-ai/dsh-desktop-managed-memory-disabled']),
    )).toBe(false)
  })

  it('still recognizes a built-in whose display and Loader names match', () => {
    expect(marketRoutes.builtinIsLive?.(
      '@deepseek-ai/dsh-missher-brain',
      {},
      new Set(['@deepseek-ai/dsh-missher-brain']),
    )).toBe(true)
  })
})
