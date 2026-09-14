import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { apply, inject } from '../src/index.ts'

it('announces only an official startup commit and cancels a pending announcement on disposal', async () => {
  const ctx = new Context()
  let callback: (() => void) | undefined
  const dispose = vi.fn(() => { callback = undefined })
  ctx.provide('appReady', { onReady(listener: () => void) { callback = listener; return dispose } })
  const output = vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    const owner = ctx.plugin({ inject, apply })
    await owner.await()
    expect(output).not.toHaveBeenCalled()
    callback?.()
    expect(output).toHaveBeenCalledExactlyOnceWith('dsh desktop: host-ready')
    await owner.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect(callback).toBeUndefined()
  } finally { await ctx.fiber.dispose(); output.mockRestore() }
})
