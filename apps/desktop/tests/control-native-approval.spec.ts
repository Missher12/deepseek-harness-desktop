import {
  ControlLeaseId,
  SessionId,
  type ControlLeaseCapability,
  type ControlLeaseSurfaceKind,
  type ControlLeaseTarget,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import { describe, expect, it } from 'vitest'
import {
  NativeApprovalCoordinator,
  type NativeApprovalDialog,
  type NativeApprovalDialogOptions,
  type NativeApprovalOwnerWindow,
  type NativeApprovalScope,
  type NativeApprovalTicket,
} from '../src/control/native-approval.ts'

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

  isVisible(): boolean {
    return this.visible
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  on(event: 'hide' | 'closed', listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  removeListener(event: 'hide' | 'closed', listener: () => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  hide(): void {
    this.visible = false
    this.emit('hide')
  }

  close(): void {
    this.destroyed = true
    this.visible = false
    this.emit('closed')
  }

  private emit(event: 'hide' | 'closed'): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
}

class FakeDialog implements NativeApprovalDialog {
  readonly calls: Array<{ window: NativeApprovalOwnerWindow; options: NativeApprovalDialogOptions }> = []
  readonly answers: Array<Deferred<{ response: number }>> = []
  error: Error | undefined

  showMessageBox(
    window: NativeApprovalOwnerWindow,
    options: NativeApprovalDialogOptions,
  ): Promise<{ response: number }> {
    this.calls.push({ window, options })
    if (this.error !== undefined) return Promise.reject(this.error)
    const answer = new Deferred<{ response: number }>()
    this.answers.push(answer)
    return answer.promise
  }
}

const TARGETS: readonly ControlLeaseTarget[] = Object.freeze([
  Object.freeze({ appId: 'app.ordinary', windowIds: Object.freeze(['window-1']) }),
])
const CAPABILITIES: readonly ControlLeaseCapability[] = Object.freeze(['observe', 'pointer'])

function scope(overrides: Partial<NativeApprovalScope> = {}): NativeApprovalScope {
  return {
    purpose: 'lease',
    sessionId: SessionId('session-a'),
    leaseId: ControlLeaseId('10000000-0000-4000-8000-000000000001'),
    leaseRevision: 7,
    surfaceKind: 'native-application' satisfies ControlLeaseSurfaceKind,
    targets: TARGETS,
    capabilities: CAPABILITIES,
    allowlistRevision: 3,
    ...overrides,
  }
}

function coordinator(
  dialog: FakeDialog,
  window: FakeWindow | undefined,
  revalidate: (candidate: NativeApprovalScope) => boolean | Promise<boolean> = () => true,
): NativeApprovalCoordinator {
  return new NativeApprovalCoordinator({ dialog, getOwnerWindow: () => window, revalidate })
}

function expectTicket(value: unknown): asserts value is NativeApprovalTicket {
  expect(value).not.toBe('DENIED')
  expect(value).not.toBe('BUSY')
  expect(typeof value).toBe('object')
}

describe('native control approval', () => {
  it('uses a cancel-default native challenge and accepts only its explicit allow response', async () => {
    const dialog = new FakeDialog()
    const window = new FakeWindow()
    const approvals = coordinator(dialog, window)

    const approved = approvals.request(scope())
    expect(dialog.calls).toHaveLength(1)
    expect(dialog.calls[0]?.options).toMatchObject({
      buttons: ['Cancel', 'Allow'],
      cancelId: 0,
      defaultId: 0,
      noLink: true,
    })
    dialog.answers[0]?.resolve({ response: 1 })
    expectTicket(await approved)

    const cancelled = approvals.request(scope({ leaseRevision: 8 }))
    dialog.answers[1]?.resolve({ response: 0 })
    await expect(cancelled).resolves.toBe('DENIED')
  })

  it('distinguishes an unavailable challenge from an explicit user denial', async () => {
    const missingDialog = new FakeDialog()
    await expect(coordinator(missingDialog, undefined).request(scope())).resolves.toBe('UNAVAILABLE')
    expect(missingDialog.calls).toHaveLength(0)

    const hidden = new FakeWindow()
    hidden.visible = false
    const hiddenDialog = new FakeDialog()
    await expect(coordinator(hiddenDialog, hidden).request(scope())).resolves.toBe('UNAVAILABLE')
    expect(hiddenDialog.calls).toHaveLength(0)

    const destroyed = new FakeWindow()
    destroyed.destroyed = true
    const destroyedDialog = new FakeDialog()
    await expect(coordinator(destroyedDialog, destroyed).request(scope())).resolves.toBe('UNAVAILABLE')
    expect(destroyedDialog.calls).toHaveLength(0)

    const abortedDialog = new FakeDialog()
    await expect(coordinator(abortedDialog, new FakeWindow()).request(
      scope(),
      AbortSignal.abort('caller stopped'),
    )).resolves.toBe('UNAVAILABLE')
    expect(abortedDialog.calls).toHaveLength(0)
  })

  it('rejects every second challenge as BUSY, including an exact structural copy', async () => {
    const dialog = new FakeDialog()
    const window = new FakeWindow()
    const firstCoordinator = coordinator(dialog, window)
    const secondCoordinator = coordinator(dialog, window)
    const first = firstCoordinator.request(scope())
    const same = secondCoordinator.request(scope({
      targets: [{ appId: 'app.ordinary', windowIds: ['window-1'] }],
      capabilities: ['observe', 'pointer'],
    }))

    await expect(same).resolves.toBe('BUSY')
    for (let index = 0; index < 25; index += 1) {
      await expect(firstCoordinator.request(scope())).resolves.toBe('BUSY')
    }
    await expect(secondCoordinator.request(scope({ allowlistRevision: 4 }))).resolves.toBe('BUSY')
    expect(dialog.calls).toHaveLength(1)

    dialog.answers[0]?.resolve({ response: 1 })
    expectTicket(await first)
  })

  it.each(['hide', 'close', 'abort'] as const)(
    'fails closed immediately when a pending challenge receives %s and ignores a later allow',
    async (event) => {
      const dialog = new FakeDialog()
      const window = new FakeWindow()
      const controller = new AbortController()
      const approvals = coordinator(dialog, window)
      const pending = approvals.request(scope(), controller.signal)

      if (event === 'hide') window.hide()
      else if (event === 'close') window.close()
      else controller.abort('cancelled')

      await expect(pending).resolves.toBe('UNAVAILABLE')
      expect(dialog.calls[0]?.options.signal?.aborted).toBe(true)
      dialog.answers[0]?.resolve({ response: 1 })
      await Promise.resolve()
      await Promise.resolve()
    },
  )

  it('ignores a competing caller abort and lets only the original owner cancel its challenge', async () => {
    const dialog = new FakeDialog()
    const window = new FakeWindow()
    const approvals = coordinator(dialog, window)
    const first = approvals.request(scope())
    const controller = new AbortController()
    await expect(approvals.request(scope(), controller.signal)).resolves.toBe('BUSY')

    controller.abort('coalesced caller stopped')
    dialog.answers[0]?.resolve({ response: 1 })
    await expect(first).resolves.not.toBe('DENIED')
  })

  it('returns an opaque one-use ticket and burns it before exact-scope revalidation', async () => {
    const dialog = new FakeDialog()
    const approvals = coordinator(dialog, new FakeWindow())
    const exactScope = scope()
    const pending = approvals.request(exactScope)
    dialog.answers[0]?.resolve({ response: 1 })
    const ticket = await pending

    expect(ticket).not.toBe('APPROVED')
    expect(ticket).not.toBe('DENIED')
    expect(ticket).not.toBe('UNAVAILABLE')
    expect(ticket).not.toBe('BUSY')
    expect(Reflect.ownKeys(ticket as object)).toEqual([])
    expect(JSON.stringify(ticket)).toBe('{}')
    let observedTicketCount = -1
    expect(approvals.consumeBeforeDispatch(ticket, exactScope, () => {
      observedTicketCount = approvals.ticketCount
      return true
    })).toBe(true)
    expect(observedTicketCount).toBe(0)
    expect(approvals.consumeBeforeDispatch(ticket, exactScope, () => true)).toBe(false)

    const second = approvals.request(scope({ leaseRevision: 8 }))
    dialog.answers[1]?.resolve({ response: 1 })
    const changed = await second
    expect(approvals.consumeBeforeDispatch(changed, scope({ leaseRevision: 9 }), () => true)).toBe(false)
    expect(approvals.consumeBeforeDispatch(changed, scope({ leaseRevision: 8 }), () => true)).toBe(false)
  })

  it('denies dialog exceptions and a window that silently becomes invalid', async () => {
    const throwingDialog = new FakeDialog()
    throwingDialog.error = new Error('native dialog failed')
    await expect(coordinator(throwingDialog, new FakeWindow()).request(scope())).resolves.toBe('UNAVAILABLE')

    const dialog = new FakeDialog()
    const window = new FakeWindow()
    const pending = coordinator(dialog, window).request(scope())
    window.destroyed = true
    dialog.answers[0]?.resolve({ response: 1 })
    await expect(pending).resolves.toBe('UNAVAILABLE')
  })

  it.each([
    ['session', (candidate: NativeApprovalScope) => candidate.sessionId === SessionId('session-b')],
    ['target', (candidate: NativeApprovalScope) => candidate.targets[0]?.windowIds[0] === 'window-2'],
    ['lease revision', (candidate: NativeApprovalScope) => candidate.leaseRevision === 8],
    ['allowlist', (candidate: NativeApprovalScope) => candidate.allowlistRevision === 4],
  ] as const)('denies a late allow when official %s state has changed', async (_label, isCurrent) => {
    const dialog = new FakeDialog()
    const pending = coordinator(dialog, new FakeWindow(), isCurrent).request(scope())
    dialog.answers[0]?.resolve({ response: 1 })
    await expect(pending).resolves.toBe('UNAVAILABLE')
  })

  it('rejects renderer-style approval claims instead of treating data as authority', async () => {
    const dialog = new FakeDialog()
    const untrusted = { ...scope(), approved: true }
    await expect(coordinator(dialog, new FakeWindow()).request(untrusted as NativeApprovalScope)).resolves.toBe('UNAVAILABLE')
    expect(dialog.calls).toHaveLength(0)
  })

  it('rejects malformed surface/target combinations before opening a dialog', async () => {
    const dialog = new FakeDialog()
    const result = coordinator(dialog, new FakeWindow()).request(scope({
      surfaceKind: 'browser-human-persistent',
      targets: TARGETS,
    }))
    expect(dialog.calls).toHaveLength(0)
    await expect(result).resolves.toBe('UNAVAILABLE')
  })

  it('requires revalidation to return the boolean true exactly', async () => {
    const dialog = new FakeDialog()
    const untypedApproval = (() => 'yes') as unknown as (
      candidate: NativeApprovalScope,
    ) => boolean
    const pending = coordinator(dialog, new FakeWindow(), untypedApproval).request(scope())
    dialog.answers[0]?.resolve({ response: 1 })
    await expect(pending).resolves.toBe('UNAVAILABLE')
  })

  it('binds a persistent-browser native challenge to one exact main-authored action digest', async () => {
    const dialog = new FakeDialog()
    const approvals = coordinator(dialog, new FakeWindow())
    const missingDigest = approvals.request(scope({
      purpose: 'browser-action',
      surfaceKind: 'browser-human-persistent',
      targets: [],
    }))
    dialog.answers[0]?.resolve({ response: 0 })
    await expect(missingDigest).resolves.toBe('UNAVAILABLE')
    expect(dialog.calls).toHaveLength(0)

    const digest = 'a'.repeat(64)
    const pending = approvals.request({
      ...scope({
        purpose: 'browser-action',
        surfaceKind: 'browser-human-persistent',
        targets: [],
      }),
      actionDigest: digest,
    })
    expect(dialog.calls[0]?.options.detail).toContain(digest.slice(0, 12))
    await expect(approvals.request({
      ...scope({
        purpose: 'browser-action',
        surfaceKind: 'browser-human-persistent',
        targets: [],
      }),
      actionDigest: 'b'.repeat(64),
    })).resolves.toBe('BUSY')
    dialog.answers[0]?.resolve({ response: 1 })
    expectTicket(await pending)
  })
})
