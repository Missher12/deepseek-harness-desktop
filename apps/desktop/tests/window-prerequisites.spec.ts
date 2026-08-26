import { describe, expect, it, vi } from 'vitest'
import { readDesktopWindowPrerequisites } from '../src/window/prerequisites.ts'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('readDesktopWindowPrerequisites', () => {
  it('reads persisted bounds while preferences are still loading', async () => {
    const preferences = deferred<undefined>()
    const bounds = deferred<{ x: number; y: number; width: number; height: number }>()
    const readBounds = vi.fn(() => bounds.promise)

    const pending = readDesktopWindowPrerequisites(preferences.promise, readBounds)
    expect(readBounds).toHaveBeenCalledOnce()
    bounds.resolve({ x: 10, y: 20, width: 900, height: 700 })
    preferences.resolve(undefined)

    await expect(pending).resolves.toEqual({ x: 10, y: 20, width: 900, height: 700 })
  })
})
