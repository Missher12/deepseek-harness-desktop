import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserError } from '../src/browser/contracts.ts'
import {
  BrowserTakeoverAuthority,
  installBrowserTakeoverIpc,
  type BrowserPersistentGiveIntent,
  type BrowserTakeoverIpcRegistry,
} from '../src/browser/takeover.ts'
import type { BrowserSurfaceResource } from '../src/browser/surface-manager.ts'

class Deferred<T = void> {
  readonly promise: Promise<T>
  resolve!: (value: T | PromiseLike<T>) => void
  constructor() { this.promise = new Promise((resolve) => { this.resolve = resolve }) }
}

function resource(): BrowserSurfaceResource {
  return {
    surfaceId: 'human-surface', partition: 'persist:dsh-workbench-browser', kind: 'human-persistent',
    installSecurityHandlers: () => ({ dispose() {} }),
    mount: async () => {}, hide: async () => {}, detachDebugger: async () => {},
    teardownView: async () => {}, clearStorage: async () => {},
  }
}

function setup(overrides: {
  capture?: () => BrowserPersistentGiveIntent | undefined
  consume?: (intent: BrowserPersistentGiveIntent) => Promise<BrowserSurfaceResource>
  stop?: (sessionId: string) => Promise<void>
} = {}) {
  const intent = Object.freeze({ instanceId: 'human-instance-2', generation: 2 })
  const statuses: unknown[] = []
  const authority = new BrowserTakeoverAuthority({
    source: {
      captureVisiblePersistentIntent: overrides.capture ?? (() => intent),
      consumeVisiblePersistentIntent: overrides.consume ?? (async () => resource()),
    },
    stopActiveSession: overrides.stop ?? (async () => {}),
    emit: (status) => { statuses.push(status) },
  })
  return { authority, intent, statuses }
}

describe('browser takeover authority', () => {
  it('stores only a main-owned visible persistent intent and consumes it for the official session', async () => {
    const consume = vi.fn(async () => resource())
    const { authority, intent } = setup({ consume })

    expect(await authority.give()).toEqual({ phase: 'given', signedInWarning: true })
    expect(await authority.consumeVerifiedPersistentGiveIntent('official-session')).toMatchObject({
      surfaceId: 'human-surface', kind: 'human-persistent',
    })
    expect(consume).toHaveBeenCalledWith(intent)
    expect(authority.status()).toEqual({ phase: 'agent', signedInWarning: true })
  })

  it('fails a stale Give closed instead of silently creating an ephemeral fallback', async () => {
    const { authority } = setup({
      consume: async () => { throw new AgentBrowserError('STALE_REF', 'human view changed') },
    })
    await authority.give()

    await expect(authority.consumeVerifiedPersistentGiveIntent('official-session'))
      .rejects.toMatchObject({ code: 'STALE_REF' })
    expect(authority.status()).toEqual({ phase: 'human', signedInWarning: true })
  })

  it('keeps Stop pending until the active session cleanup finishes', async () => {
    const gate = new Deferred()
    const stop = vi.fn(async () => { await gate.promise })
    const { authority } = setup({ stop })
    await authority.give()
    await authority.consumeVerifiedPersistentGiveIntent('official-session')

    const pending = authority.stop()
    expect(authority.status().phase).toBe('stopping')
    expect(stop).toHaveBeenCalledWith('official-session')
    gate.resolve()
    await expect(pending).resolves.toEqual({ phase: 'human', signedInWarning: true })
  })
})

describe('browser takeover IPC', () => {
  it('accepts only a trusted main-frame sender and exactly zero renderer arguments', async () => {
    const { authority } = setup()
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
    const registry: BrowserTakeoverIpcRegistry = {
      handle: (channel, handler) => { handlers.set(channel, handler) },
      removeHandler: (channel) => { handlers.delete(channel) },
    }
    const trusted = Object.freeze({ trusted: true })
    const dispose = installBrowserTakeoverIpc({
      registry,
      authority,
      isTrustedMainFrame: event => event === trusted,
    })

    await expect(handlers.get('desktop:browser-takeover-give')?.(trusted)).resolves.toMatchObject({ phase: 'given' })
    await expect(handlers.get('desktop:browser-takeover-status')?.(trusted, {})).rejects.toThrow(/argument/u)
    await expect(handlers.get('desktop:browser-takeover-stop')?.({}, undefined)).rejects.toThrow(/sender/u)
    dispose()
    expect(handlers.size).toBe(0)
  })
})
