import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const state = vi.hoisted(() => ({ failure: undefined as unknown }))

vi.mock('../src/manifest.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/manifest.ts')>()
  return {
    ...actual,
    assertProtocolManifest: () => {
      if (state.failure !== undefined) throw state.failure
    },
  }
})

describe('protocol invariant companion', () => {
  it('registers the static manifest check and reports Error and non-Error failures', async () => {
    let installed: InvariantInstaller | undefined
    const disposer = vi.fn()
    const register = vi.fn((_name: string, candidate: InvariantInstaller) => {
      installed = candidate
      return disposer
    })
    const ctx = { invariants: { register } } as unknown as Context
    const { apply, inject, name } = await import('../src/invariant.ts')
    expect(name).toBe('desktop-control-protocol-invariant')
    expect(inject).toEqual(['invariants'])
    await expect(apply(ctx)).resolves.toBe(disposer)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-desktop-control-protocol', expect.any(Function))
    const fail: InvariantFailure = vi.fn((message: string): never => {
      throw new Error(message)
    })
    if (installed === undefined) throw new Error('invariant was not registered')
    const invariant = installed
    state.failure = undefined
    void invariant(ctx, fail)
    expect(fail).not.toHaveBeenCalled()
    state.failure = new Error('bad manifest')
    expect(() => invariant(ctx, fail)).toThrow('bad manifest')
    expect(fail).toHaveBeenLastCalledWith('bad manifest')
    state.failure = 'bad manifest'
    expect(() => invariant(ctx, fail)).toThrow('desktop-control protocol manifest validation failed')
    expect(fail).toHaveBeenLastCalledWith('desktop-control protocol manifest validation failed')
  })
})
