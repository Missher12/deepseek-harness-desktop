import { describe, expect, it, vi } from 'vitest'
import { createDesktopPreferences } from '../src/client/preferences.ts'
import type { DesktopShellBridge } from '../src/client/contracts.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function bridge() {
  const initial = deferred<unknown>()
  const write = deferred<unknown>()
  let listener: (value: unknown) => void = () => {}
  const unsubscribe = vi.fn()
  const writePreference = vi.fn(() => write.promise)
  const api: DesktopShellBridge = {
    presentation: { titlebar: 'native' },
    onCommand: () => () => {},
    getDesktopPreferences: () => initial.promise,
    setDesktopPreference: writePreference,
    onDesktopPreferences(next) { listener = next; return unsubscribe },
  }
  return { api, initial, write, writePreference, emit: (value: unknown) => { listener(value) }, unsubscribe }
}

describe('native close preference projection', () => {
  it('keeps a native event newer than an outstanding initial read and projects only close behavior', async () => {
    const b = bridge()
    const prefs = createDesktopPreferences(b.api)
    const off = prefs.start()
    b.emit({ closeBehavior: 'quit', tieredPricingEstimates: true })
    b.initial.resolve({ closeBehavior: 'keep-running', tieredPricingEstimates: false })
    await b.initial.promise
    expect(prefs.source.getSnapshot()).toEqual({ closeBehavior: 'quit', status: 'ready', saving: false })
    off()
    expect(b.unsubscribe).toHaveBeenCalledOnce()
    b.emit({ closeBehavior: 'keep-running' })
    expect(prefs.source.getSnapshot().closeBehavior).toBe('quit')
  })
  it('writes only closeBehavior, serializes gestures, and discards stale completions after unload', async () => {
    const b = bridge()
    const prefs = createDesktopPreferences(b.api)
    const off = prefs.start()
    b.initial.resolve({ closeBehavior: 'quit' })
    await b.initial.promise
    const pending = prefs.setCloseBehavior('keep-running')
    await prefs.setCloseBehavior('quit')
    expect(b.writePreference).toHaveBeenCalledExactlyOnceWith({ key: 'closeBehavior', value: 'keep-running' })
    expect(prefs.source.getSnapshot().saving).toBe(true)
    off()
    const old = prefs.source.getSnapshot()
    b.write.resolve({ closeBehavior: 'keep-running' })
    await pending
    expect(prefs.source.getSnapshot()).toBe(old)
  })
  it('rejects invalid native preferences and supports retry after a failed read', async () => {
    const b = bridge()
    const prefs = createDesktopPreferences(b.api)
    prefs.start()
    b.initial.resolve({ closeBehavior: 'delete-all' })
    await b.initial.promise
    await Promise.resolve()
    expect(prefs.source.getSnapshot().status).toBe('error')
    b.api.getDesktopPreferences = async () => ({ closeBehavior: 'quit' })
    await prefs.reload()
    expect(prefs.source.getSnapshot().status).toBe('ready')
    const write = prefs.setCloseBehavior('keep-running')
    b.write.reject(new Error('secret native detail'))
    await write
    expect(prefs.source.getSnapshot()).toEqual({ closeBehavior: 'quit', status: 'error', saving: false })
  })
})
