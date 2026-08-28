import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import * as BrowserToolInvariant from '../src/invariant.ts'

describe('tool-browser-control invariant companion', () => {
  it('reserves package ownership with an inert package-local installer', async () => {
    let installed: InvariantInstaller | undefined
    const disposer = vi.fn()
    const register = vi.fn((_name: string, candidate: InvariantInstaller) => {
      installed = candidate
      return disposer
    })
    const ctx = { invariants: { register } } as unknown as Context

    expect(BrowserToolInvariant.name).toBe('tool-browser-control-invariant')
    expect(BrowserToolInvariant.inject).toEqual(['invariants'])
    await expect(BrowserToolInvariant.apply(ctx)).resolves.toBe(disposer)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-tool-browser-control', expect.any(Function))
    expect(() => installed?.(ctx, vi.fn() as never)).not.toThrow()
  })
})
