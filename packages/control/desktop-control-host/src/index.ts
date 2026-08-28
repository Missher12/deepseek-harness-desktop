/** Desktop-only Host providers and owned-child control IPC lifecycle. @module @deepseek-ai/dsh-desktop-control-host */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import { DesktopBrowserControl } from './browser-provider.ts'
import { DesktopComputerControl } from './computer-provider.ts'
import {
  ControlLeaseCache,
  ControlLifecycleCoordinator,
  DesktopControlIpcClient,
  createProcessControlLink,
  type DesktopControlIpcLink,
  type DesktopControlRequester,
  type DesktopControlTransportLog,
} from './ipc-client.ts'

export {
  ControlLeaseCache,
  ControlLifecycleCoordinator,
  DEFAULT_CONTROL_CLEANUP_TIMEOUT_MS,
  DesktopControlIpcClient,
  DesktopControlIpcError,
  MAX_CONTROL_TOMBSTONES,
  MAX_PENDING_CONTROL_REQUESTS,
  createProcessControlLink,
} from './ipc-client.ts'
export type {
  DesktopControlIpcLink,
  DesktopControlRequester,
  DesktopControlTransportLog,
} from './ipc-client.ts'
export { DesktopBrowserControl } from './browser-provider.ts'
export { DesktopComputerControl } from './computer-provider.ts'

/** Mounted Host resources proving both providers share one requester and cache. */
export interface DesktopControlHostRuntime {
  readonly requester: DesktopControlRequester
  readonly client?: DesktopControlIpcClient
  readonly leaseCache: ControlLeaseCache
  readonly lifecycle: ControlLifecycleCoordinator
  readonly browser: DesktopBrowserControl
  readonly computer: DesktopComputerControl
}

/** Injectable Host installation seams used by the owned process adapter and focused tests. */
export interface DesktopControlHostOptions {
  readonly link?: DesktopControlIpcLink
  readonly requester?: DesktopControlRequester
  readonly now?: () => number
  readonly log?: (event: DesktopControlTransportLog) => void
}

/**
 * Install exactly one Host requester/cache pair and both service providers.
 * With no real Node IPC channel, it intentionally registers nothing so ordinary CLI/Web boot is unaffected.
 * @param ctx - Trusted Harness Host context that will own the two providers and lifecycle listeners.
 * @param options - Exact owned-child link or an injected requester used by focused tests.
 * @returns The shared Host runtime, or undefined when this process has no Electron-owned IPC channel.
 */
export function installDesktopControlHost(
  ctx: Context,
  options: DesktopControlHostOptions | undefined,
): DesktopControlHostRuntime | undefined {
  const link = options?.link
  const cache = new ControlLeaseCache()
  const client = options?.requester === undefined && link !== undefined
    ? new DesktopControlIpcClient(link, {
      leaseCache: cache,
      ...(options?.now === undefined ? {} : { now: options.now }),
      ...(options?.log === undefined ? {} : { log: options.log }),
    })
    : undefined
  const requester = options?.requester ?? client
  if (requester === undefined) return undefined
  const browser = new DesktopBrowserControl(ctx, requester, cache)
  const computer = new DesktopComputerControl(ctx, requester, cache)
  const lifecycle = new ControlLifecycleCoordinator(requester, cache,
    options?.now === undefined ? {} : { now: options.now })

  const stopCreated = ctx.on('session/created', (session) => { lifecycle.sessionCreated(session) })
  const stopTurn = ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    await lifecycle.turnStopping(agent.session, signal)
  })
  const stopEvent = ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') lifecycle.observeTurnEnd(session)
  })
  const stopFlush = ctx.on('session/flush', async (session) => { await lifecycle.flush(session) })
  const stopDisposed = ctx.on('session/disposed', (session) => { lifecycle.disposeSession(session) })
  ctx.effect(() => async () => {
    await lifecycle.dispose()
    stopCreated()
    stopTurn()
    stopEvent()
    stopFlush()
    stopDisposed()
    client?.dispose()
  }, 'desktop-control-host: drain control tails before listener teardown')

  return Object.freeze({
    requester,
    ...(client === undefined ? {} : { client }),
    leaseCache: cache,
    lifecycle,
    browser,
    computer,
  })
}

/** Cordis plugin name used by the immutable Desktop-only patch. */
export const name = 'desktop-control-host'

/** Mount only when this Harness process owns a Node IPC channel to Electron. */
export function apply(ctx: Context): void {
  const link = createProcessControlLink()
  if (link === undefined) return
  installDesktopControlHost(ctx, { link })
}
