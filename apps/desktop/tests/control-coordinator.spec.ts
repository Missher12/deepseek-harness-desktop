import { describe, expect, it, vi } from 'vitest'
import {
  ControlLeaseId,
  RequestId,
  SessionId,
  type BridgeRequest,
  type ControlLeaseAcquireRequest,
  type ControlLeaseReleaseRequest,
  type DecodedDesktopControlEnvelope,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import {
  DesktopControlCoordinator,
  type DesktopControlSurfaceAdapter,
} from '../src/control/control-coordinator.ts'
import type {
  NativeApprovalDialog,
  NativeApprovalDialogOptions,
  NativeApprovalOwnerWindow,
  NativeApprovalScope,
} from '../src/control/native-approval.ts'
import { adapterPolicyFacts } from '../src/control/policy.ts'
import { DEFAULT_CONTROL_SETTINGS } from '../src/control/settings-store.ts'
import { FakeMonotonicClock } from './control-testkit.ts'

const SESSION = SessionId('coordinator-session')
const FOREIGN_SESSION = SessionId('foreign-session')
const LEASE_ID = '10000000-0000-4000-8000-000000000001'

class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void
  reject!: (reason?: unknown) => void

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

class FakeWindow implements NativeApprovalOwnerWindow {
  visible = true
  destroyed = false
  readonly listeners = new Map<'hide' | 'closed', Set<() => void>>()

  isVisible(): boolean { return this.visible }
  isDestroyed(): boolean { return this.destroyed }
  on(event: 'hide' | 'closed', listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }
  removeListener(event: 'hide' | 'closed', listener: () => void): void {
    this.listeners.get(event)?.delete(listener)
  }
}

class FakeDialog implements NativeApprovalDialog {
  readonly calls: Array<{ options: NativeApprovalDialogOptions }> = []
  readonly answers: Array<Deferred<{ response: number }>> = []

  showMessageBox(
    _window: NativeApprovalOwnerWindow,
    options: NativeApprovalDialogOptions,
  ): Promise<{ response: number }> {
    this.calls.push({ options })
    const answer = new Deferred<{ response: number }>()
    this.answers.push(answer)
    return answer.promise
  }
}

class FakeShortcutRegistrar {
  readonly callbacks = new Map<string, () => void>()
  registerResult = true

  register(accelerator: string, callback: () => void): boolean {
    if (!this.registerResult || this.callbacks.has(accelerator)) return false
    this.callbacks.set(accelerator, callback)
    return true
  }
  unregister(accelerator: string): void { this.callbacks.delete(accelerator) }
}

function requestBase<K extends BridgeRequest['requestKind']>(requestKind: K, sessionId = SESSION) {
  return {
    protocolVersion: 1 as const,
    messageKind: 'request' as const,
    requestKind,
    requestId: RequestId('20000000-0000-4000-8000-000000000001'),
    sessionId,
    deadlineUnixMs: 30_000,
  }
}

function acquire(
  surfaceKind: ControlLeaseAcquireRequest['surfaceKind'] = 'native-application',
): ControlLeaseAcquireRequest {
  return {
    ...requestBase('control.lease.acquire'),
    surfaceKind,
    targets: surfaceKind === 'native-application'
      ? [
        { appId: 'app.allowed', windowIds: ['window-a', 'window-b'] },
        { appId: 'app.denied', windowIds: ['window-x'] },
      ]
      : [],
    capabilities: ['observe', 'pointer', 'keyboard'],
  }
}

function release(leaseRevision = 1): ControlLeaseReleaseRequest {
  return {
    ...requestBase('control.lease.release'),
    requestId: RequestId('20000000-0000-4000-8000-000000000002'),
    leaseId: ControlLeaseId(LEASE_ID),
    leaseRevision,
  }
}

function status(sessionId = SESSION): Extract<BridgeRequest, { requestKind: 'desktop.status' }> {
  return { ...requestBase('desktop.status', sessionId) }
}

interface TestAcquisitionCompletion {
  accept(): void
  cancel(): Promise<void>
}

function context(options: {
  signal?: AbortSignal
  holdAcquisition?: (completion: TestAcquisitionCompletion) => void
} = {}) {
  return {
    signal: options.signal ?? new AbortController().signal,
    timeoutMs: 30_000,
    generation: 1,
    registerAcquisition(completion: TestAcquisitionCompletion): boolean {
      if (options.holdAcquisition !== undefined) options.holdAcquisition(completion)
      else completion.accept()
      return true
    },
  }
}

function ok<K extends BridgeRequest['requestKind']>(
  request: Extract<BridgeRequest, { requestKind: K }>,
  result: unknown,
): DecodedDesktopControlEnvelope {
  return {
    message: {
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestId: request.requestId,
      requestKind: request.requestKind,
      result,
    } as DecodedDesktopControlEnvelope['message'],
  }
}

function adapter(
  kind: 'browser' | 'computer',
  order: string[] = [],
): DesktopControlSurfaceAdapter {
  return {
    kind,
    supported: () => true,
    acquireFacts: async request => ({
      surfaceKind: request.surfaceKind,
      targets: request.surfaceKind === 'native-application'
        ? [
          { appId: 'app.allowed', windowIds: ['window-a'] },
          { appId: 'app.denied', windowIds: ['window-x'] },
        ]
        : [],
      capabilities: ['observe', 'pointer', 'keyboard'],
      policyAllowed: true,
    }),
    operationFacts: async () => ({
      surfaceKind: kind === 'browser' ? 'browser-ephemeral' : 'native-application',
      targets: [],
      capabilities: ['observe', 'pointer', 'keyboard'],
      policy: adapterPolicyFacts('ordinary', 'read-only'),
    }),
    dispatch: async request => ok(request, { stopped: true }),
    installLease: async () => { order.push('install') },
    rollbackLeaseInstall: async () => { order.push('rollback-install') },
    clearQueue: async () => { order.push('clear-queue') },
    stopLease: async () => { order.push('stop-surface') },
    releaseKnownInput: async () => { order.push('release-input') },
    shutdown: async () => { order.push('shutdown') },
    recoverAfterCrash: async () => { order.push('recover') },
  }
}

function setup(options: {
  browser?: DesktopControlSurfaceAdapter
  computer?: DesktopControlSurfaceAdapter
  dialog?: FakeDialog
  clock?: FakeMonotonicClock
  revalidate?: (scope: NativeApprovalScope) => boolean | Promise<boolean>
  audit?: (action: string) => void | Promise<void>
  unclaimedSession?: boolean
} = {}) {
  const dialog = options.dialog ?? new FakeDialog()
  const shortcuts = new FakeShortcutRegistrar()
  const clock = options.clock ?? new FakeMonotonicClock()
  let officialSession = options.unclaimedSession === true ? undefined : SESSION
  const coordinator = new DesktopControlCoordinator({
    clock,
    mintLeaseId: () => LEASE_ID,
    getOfficialSessionId: () => officialSession,
    claimOfficialSession: (sessionId) => {
      officialSession ??= sessionId
      return officialSession
    },
    releaseOfficialSession: (sessionId) => {
      if (officialSession === sessionId) officialSession = undefined
    },
    getAgentDisplayName: () => 'Visible Agent only',
    getSettings: () => ({
      settings: {
        ...DEFAULT_CONTROL_SETTINGS,
        ordinaryAppIds: ['app.allowed'],
        browserEnabled: true,
        computerEnabled: true,
      },
      revision: 4,
    }),
    approval: {
      dialog,
      getOwnerWindow: () => new FakeWindow(),
      revalidate: options.revalidate ?? (() => true),
      now: () => clock.now(),
    },
    shortcuts,
    browser: options.browser,
    computer: options.computer,
    cleanupTimeoutMs: 1_000,
    audit: options.audit === undefined
      ? undefined
      : { record: async (event) => { await options.audit?.(event.action) }, flush: async () => undefined },
  })
  return { coordinator, dialog, shortcuts, clock }
}

async function approve(dialog: FakeDialog): Promise<void> {
  await vi.waitFor(() => { expect(dialog.answers).toHaveLength(1) })
  dialog.answers[0]?.resolve({ response: 1 })
}

describe('DesktopControlCoordinator', () => {
  it('withholds an effective descriptor until native approval and helper install both succeed', async () => {
    const order: string[] = []
    const install = new Deferred<void>()
    const computer = adapter('computer', order)
    computer.installLease = async (snapshot) => {
      order.push('install')
      expect(snapshot.targets).toEqual([{ appId: 'app.allowed', windowIds: ['window-a'] }])
      expect(snapshot.agentId).toBe('Visible Agent only')
      await install.promise
    }
    const { coordinator, dialog, shortcuts } = setup({ computer })

    let settled = false
    const pending = coordinator.dispatch(acquire(), context()).finally(() => { settled = true })
    await approve(dialog)
    await vi.waitFor(() => { expect(order).toEqual(['install']) })
    expect(settled).toBe(false)
    install.resolve()
    const envelope = await pending

    expect(envelope.message).toMatchObject({
      responseKind: 'ok',
      requestKind: 'control.lease.acquire',
      result: {
        leaseId: LEASE_ID,
        leaseRevision: 1,
        targets: [{ appId: 'app.allowed', windowIds: ['window-a'] }],
      },
    })
    expect(JSON.stringify(envelope)).not.toContain('Visible Agent only')
    expect(JSON.stringify(envelope)).not.toContain('operations')
    expect(shortcuts.callbacks.size).toBe(1)
    await coordinator.beforeControlShutdown(new AbortController().signal)
  })

  it('fails closed and rolls back an acknowledged helper install when activation cannot complete', async () => {
    const order: string[] = []
    const computer = adapter('computer', order)
    computer.installLease = async () => {
      order.push('install')
      throw new Error('helper install failed')
    }
    const { coordinator, dialog, shortcuts } = setup({ computer })
    const pending = coordinator.dispatch(acquire(), context())
    await approve(dialog)
    const envelope = await pending

    expect(envelope.message).toMatchObject({ responseKind: 'error', error: { code: 'INTERNAL' } })
    expect(shortcuts.callbacks.size).toBe(0)
    expect(coordinator.activeLease()).toBeNull()
  })

  it('rejects an ignored abort after every adapter await and before lease activation', async () => {
    const activationFacts = new Deferred<Awaited<ReturnType<DesktopControlSurfaceAdapter['acquireFacts']>>>()
    const order: string[] = []
    const browser = adapter('browser', order)
    let factsCalls = 0
    const baseFacts = browser.acquireFacts.bind(browser)
    browser.acquireFacts = async (request, signal) => {
      factsCalls += 1
      if (factsCalls === 3) return await activationFacts.promise
      return await baseFacts(request, signal)
    }
    const controller = new AbortController()
    const { coordinator, dialog } = setup({ browser })
    const acquiring = coordinator.dispatch(
      acquire('browser-ephemeral'),
      context({ signal: controller.signal }),
    )
    await approve(dialog)
    await vi.waitFor(() => { expect(factsCalls).toBe(3) })

    controller.abort(new Error('deadline'))
    activationFacts.resolve({
      surfaceKind: 'browser-ephemeral', targets: [],
      capabilities: ['observe', 'pointer', 'keyboard'], policyAllowed: true,
    })
    await expect(acquiring).resolves.toMatchObject({
      message: { responseKind: 'error', error: { code: 'CANCELLED' } },
    })
    expect(coordinator.activeLease()).toBeNull()
  })

  it('revokes and awaits cleanup when cancellation wins after activation but before acceptance', async () => {
    const audit = new Deferred<void>()
    const order: string[] = []
    const browser = adapter('browser', order)
    const controller = new AbortController()
    let completion: TestAcquisitionCompletion | undefined
    const { coordinator, dialog } = setup({ browser, audit: async () => { await audit.promise } })
    const acquiring = coordinator.dispatch(acquire('browser-ephemeral'), context({
      signal: controller.signal,
      holdAcquisition: (value) => { completion = value },
    }))
    await approve(dialog)
    await vi.waitFor(() => { expect(coordinator.activeLease()).not.toBeNull() })
    await expect(acquiring).resolves.toMatchObject({ message: { responseKind: 'ok' } })

    controller.abort(new Error('deadline'))
    audit.resolve()
    await coordinator.drainCleanup()
    expect(completion).toBeDefined()
    expect(coordinator.activeLease()).toBeNull()
    expect(order).toEqual(['clear-queue', 'stop-surface'])
  })

  it('uses the queued timer-failure cleanup and never rolls back the same helper lease', async () => {
    const order: string[] = []
    const computer = adapter('computer', order)
    const clock = new FakeMonotonicClock()
    vi.spyOn(clock, 'setTimeout').mockImplementation(() => { throw new Error('timer failed') })
    const { coordinator, dialog } = setup({ computer, clock })
    const acquiring = coordinator.dispatch(acquire(), context())
    await approve(dialog)

    await expect(acquiring).resolves.toMatchObject({
      message: { responseKind: 'error', error: { code: 'INTERNAL' } },
    })
    await coordinator.drainCleanup()
    expect(order).toEqual(['install', 'clear-queue', 'stop-surface', 'release-input'])
    expect(coordinator.activeLease()).toBeNull()
  })

  it('returns released only after the exact lease cleanup sequence completes', async () => {
    const order: string[] = []
    const stop = new Deferred<void>()
    const browser = adapter('browser', order)
    browser.stopLease = async () => {
      order.push('stop-surface')
      await stop.promise
    }
    const { coordinator, dialog, shortcuts } = setup({ browser })
    const acquiring = coordinator.dispatch(acquire('browser-ephemeral'), context())
    await approve(dialog)
    expect((await acquiring).message).toMatchObject({ responseKind: 'ok' })
    const active = coordinator.activeLease()
    const releaseRequest = release()
    expect(active).toMatchObject({
      sessionId: releaseRequest.sessionId,
      leaseId: releaseRequest.leaseId,
      leaseRevision: releaseRequest.leaseRevision,
    })

    let settled = false
    const releasing = coordinator.dispatch(releaseRequest, context()).finally(() => { settled = true })
    const early = await Promise.race([
      releasing,
      new Promise<'pending'>((resolve) => { setTimeout(() => { resolve('pending') }, 0) }),
    ])
    expect(early).toBe('pending')
    await vi.waitFor(() => { expect(order).toEqual(['clear-queue', 'stop-surface']) })
    expect(settled).toBe(false)
    stop.resolve()
    const envelope = await releasing

    expect(envelope.message).toMatchObject({
      responseKind: 'ok', result: { released: true },
    })
    expect(shortcuts.callbacks.size).toBe(0)
  })

  it('routes expiry and helper crash through the same exact-once cleanup and recovery queue', async () => {
    const order: string[] = []
    const computer = adapter('computer', order)
    const clock = new FakeMonotonicClock()
    const { coordinator, dialog } = setup({ computer, clock })
    const acquiring = coordinator.dispatch(acquire(), context())
    await approve(dialog)
    await acquiring
    order.splice(0)

    await coordinator.helperCrashed()
    expect(order).toEqual([
      'clear-queue', 'stop-surface', 'recover', 'release-input',
    ])
    expect(coordinator.activeLease()).toBeNull()
  })

  it('starts the same awaited cleanup at the exact idle-expiry boundary', async () => {
    const order: string[] = []
    const browser = adapter('browser', order)
    const clock = new FakeMonotonicClock()
    const { coordinator, dialog } = setup({ browser, clock })
    const acquiring = coordinator.dispatch(acquire('browser-ephemeral'), context())
    await approve(dialog)
    await acquiring
    order.splice(0)

    clock.advanceTo(300_000)
    await coordinator.drainCleanup()

    expect(order).toEqual(['clear-queue', 'stop-surface'])
    expect(coordinator.activeLease()).toBeNull()
  })

  it('fails the grant closed and awaits cleanup when emergency shortcut registration fails', async () => {
    const order: string[] = []
    const browser = adapter('browser', order)
    const { coordinator, dialog, shortcuts } = setup({ browser })
    shortcuts.registerResult = false
    const acquiring = coordinator.dispatch(acquire('browser-ephemeral'), context())
    await approve(dialog)

    const envelope = await acquiring

    expect(envelope.message).toMatchObject({ responseKind: 'error', error: { code: 'INTERNAL' } })
    expect(order).toEqual(['clear-queue', 'stop-surface'])
    expect(coordinator.activeLease()).toBeNull()
  })

  it('keeps close-to-tray fail closed when required cleanup does not complete successfully', async () => {
    const browser = adapter('browser')
    browser.clearQueue = async () => { throw new Error('queue clear failed') }
    const { coordinator, dialog } = setup({ browser })
    const acquiring = coordinator.dispatch(acquire('browser-ephemeral'), context())
    await approve(dialog)
    await acquiring

    await expect(coordinator.cleanup('close-to-tray')).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(coordinator.activeLease()).toBeNull()
    await expect(coordinator.dispatch(acquire('browser-ephemeral'), context())).resolves.toMatchObject({
      message: { responseKind: 'error', error: { code: 'BUSY' } },
    })
  })

  it('keeps successful close-to-tray cleanup closed until the visible window explicitly resumes admission', async () => {
    const browser = adapter('browser')
    const { coordinator, dialog } = setup({ browser })
    const acquiring = coordinator.dispatch(acquire('browser-ephemeral'), context())
    await approve(dialog)
    await acquiring

    await coordinator.cleanup('close-to-tray')
    await expect(coordinator.dispatch(acquire('browser-ephemeral'), context())).resolves.toMatchObject({
      message: { responseKind: 'error', error: { code: 'BUSY' } },
    })
    expect(coordinator.resumeAdmission()).toBe(true)
    const resumed = coordinator.dispatch(acquire('browser-ephemeral'), context())
    await vi.waitFor(() => { expect(dialog.answers).toHaveLength(2) })
    dialog.answers[1]?.resolve({ response: 1 })
    await expect(resumed).resolves.toMatchObject({ message: { responseKind: 'ok' } })
  })

  it('returns one uniform UNAUTHORIZED error before probing adapters for a foreign session', async () => {
    const browser = adapter('browser')
    const supported = vi.spyOn(browser, 'supported')
    const { coordinator } = setup({ browser })

    const envelope = await coordinator.dispatch(status(FOREIGN_SESSION), context())

    expect(envelope.message).toMatchObject({
      responseKind: 'error', error: { code: 'UNAUTHORIZED' },
    })
    expect(supported).not.toHaveBeenCalled()
  })

  it('atomically claims the first owned-child session and permits a new one only after disposal', async () => {
    const browser = adapter('browser')
    const { coordinator } = setup({ browser, unclaimedSession: true })

    await expect(coordinator.dispatch(status(), context())).resolves.toMatchObject({
      message: { responseKind: 'ok' },
    })
    await expect(coordinator.dispatch(status(FOREIGN_SESSION), context())).resolves.toMatchObject({
      message: { responseKind: 'error', error: { code: 'UNAUTHORIZED' } },
    })
    await coordinator.revokeSession(SESSION, new AbortController().signal)
    await expect(coordinator.dispatch(status(FOREIGN_SESSION), context())).resolves.toMatchObject({
      message: { responseKind: 'ok' },
    })
  })

  it('bounds and awaits adapter shutdown even with no active lease', async () => {
    const order: string[] = []
    const browser = adapter('browser', order)
    const computer = adapter('computer', order)
    const { coordinator } = setup({ browser, computer })

    await coordinator.beforeControlShutdown(new AbortController().signal)

    expect(order).toEqual(['shutdown', 'shutdown'])
  })
})
