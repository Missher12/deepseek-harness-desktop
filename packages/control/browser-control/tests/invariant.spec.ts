import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import * as BrowserInvariant from '../src/invariant.ts'

describe('browser-control invariant companion', () => {
  it('reserves package ownership with an inert package-local installer', async () => {
    let installed: InvariantInstaller | undefined
    const disposer = vi.fn()
    const register = vi.fn((_name: string, candidate: InvariantInstaller) => {
      installed = candidate
      return disposer
    })
    const ctx = { invariants: { register } } as unknown as Context

    expect(BrowserInvariant.name).toBe('browser-control-invariant')
    expect(BrowserInvariant.inject).toEqual(['invariants'])
    await expect(BrowserInvariant.apply(ctx)).resolves.toBe(disposer)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-browser-control', expect.any(Function))
    expect(() => installed?.(ctx, vi.fn() as never)).not.toThrow()
  })
})
