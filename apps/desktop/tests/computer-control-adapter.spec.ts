import { describe, expect, it, vi } from 'vitest'
import {
  ComputerRef,
  ControlLeaseId,
  ImmutablePng,
  PngTransferId,
  RequestId,
  SessionId,
  type BridgeRequest,
  type ControlLeaseAcquireRequest,
  type DecodedDesktopControlEnvelope,
  type HelperInputReleaseRequest,
  type HelperRequest,
} from '@deepseek-ai/dsh-desktop-control-protocol'
import type { ActiveControlLease } from '../src/control/control-lease.ts'
import type { PreparedLeaseInstall } from '../src/control/control-coordinator.ts'
import {
  ComputerDesktopControlAdapter,
  resolveComputerHelperBinaryPath,
  type ComputerHelperClient,
} from '../src/control/computer-adapter.ts'

const SESSION = SessionId('computer-adapter-session')
const LEASE = ControlLeaseId('10000000-0000-4000-8000-000000000001')

function requestBase<K extends BridgeRequest['requestKind']>(requestKind: K) {
  return {
    protocolVersion: 1 as const,
    messageKind: 'request' as const,
    requestKind,
    requestId: RequestId('20000000-0000-4000-8000-000000000001'),
    sessionId: SESSION,
    deadlineUnixMs: 99_999,
  }
}

function okEnvelope(
  request: HelperRequest,
  result: Readonly<Record<string, unknown>>,
  png?: DecodedDesktopControlEnvelope['png'],
): DecodedDesktopControlEnvelope {
  return Object.freeze({
    message: Object.freeze({
      protocolVersion: 1,
      messageKind: 'response',
      responseKind: 'ok',
      requestKind: request.requestKind,
      requestId: request.requestId,
      result,
    }),
    ...(png === undefined ? {} : { png }),
  }) as DecodedDesktopControlEnvelope
}

class FakeHelper implements ComputerHelperClient {
  running = true
  readonly requests: HelperRequest[] = []
  readonly controls: Parameters<ComputerHelperClient['sendControl']>[0][] = []
  readonly events: string[] = []
  readonly recoveryRequests: HelperInputReleaseRequest[] = []
  stopWhenIdleCalls = 0
  recoveryResponder: (
    request: HelperInputReleaseRequest,
  ) => Promise<DecodedDesktopControlEnvelope> = async request => okEnvelope(request, { released: true })
  responder: (request: HelperRequest) => Promise<DecodedDesktopControlEnvelope> = async (request) => {
    switch (request.requestKind) {
      case 'status': return okEnvelope(request, { viewing: 'granted', assistive: 'unknown', supported: true })
      case 'list': return okEnvelope(request, { apps: [] })
      case 'snapshot': return okEnvelope(request, {
        appId: request.appId,
        windowId: request.windowId,
        snapshotRevision: request.snapshotRevision,
        semanticText: '',
        refs: [],
      })
      case 'wait': return okEnvelope(request, { waited: true, snapshotRevision: request.snapshotRevision })
      case 'stop': return okEnvelope(request, { stopped: true })
      case 'lease.install': return okEnvelope(request, { installed: true, leaseRevision: request.leaseRevision })
      case 'input.release': return okEnvelope(request, { released: true })
      default: return okEnvelope(request, { acted: true, snapshotRevision: request.snapshotRevision })
    }
  }

  async request(request: HelperRequest): Promise<DecodedDesktopControlEnvelope> {
    this.requests.push(request)
    this.events.push(`request:${request.requestKind}`)
    return await this.responder(request)
  }

  sendControl(control: Parameters<ComputerHelperClient['sendControl']>[0]): void {
    this.controls.push(control)
    this.events.push(`control:${control.controlKind}`)
  }

  shutdown(): Promise<void> {
    this.events.push('shutdown')
    return Promise.resolve()
  }

  stopWhenIdle(): Promise<void> {
    this.stopWhenIdleCalls += 1
    this.events.push('stop-when-idle')
    return Promise.resolve()
  }

  async recoverInput(request: HelperInputReleaseRequest): Promise<DecodedDesktopControlEnvelope> {
    this.recoveryRequests.push(request)
    this.events.push('recover:input.release')
    return await this.recoveryResponder(request)
  }
}

function adapter(helper: FakeHelper): ComputerDesktopControlAdapter {
  let next = 10
  return new ComputerDesktopControlAdapter({
    helper,
    factsTimeoutMs: 432,
    cleanupTimeoutMs: 876,
    mintRequestId: () => RequestId(`30000000-0000-4000-8000-${String(next++).padStart(12, '0')}`),
  })
}

function prepared(): PreparedLeaseInstall {
  return Object.freeze({
    leaseId: LEASE,
    leaseRevision: 7,
    sessionId: SESSION,
    surfaceKind: 'native-application',
    targets: Object.freeze([{ appId: 'app.one', windowIds: Object.freeze(['window.two']) }]),
    capabilities: Object.freeze(['observe'] as const),
    idleExpiresAfterMs: 30_000,
    hardExpiresAfterMs: 300_000,
    agentId: 'Agent',
    quotas: Object.freeze({ operations: 100, snapshots: 10, pointerActions: 10, keyActions: 10, textBytes: 1_024 }),
  })
}

function active(): ActiveControlLease {
  return Object.freeze({
    ...prepared(),
    sessionId: SESSION,
    generation: 3,
    issuedAt: 0,
    lastActionAt: 0,
    hardExpiresAt: 300_000,
    remaining: prepared().quotas,
  })
}

describe('ComputerDesktopControlAdapter', () => {
  it('resolves only an exact regular helper in packaged and staged development layouts', () => {
    const regular = vi.fn(() => ({ isFile: () => true, isSymbolicLink: () => false }))
    expect(resolveComputerHelperBinaryPath({
      platform: 'darwin', arch: 'x64', isPackaged: true,
      resourcesPath: '/Applications/DeepSeek.app/Contents/Resources',
      desktopDirectory: '/repo/apps/desktop', lstat: regular,
    })).toBe('/Applications/DeepSeek.app/Contents/Resources/native/computer-use-helper')
    expect(resolveComputerHelperBinaryPath({
      platform: 'win32', arch: 'x64', isPackaged: false,
      resourcesPath: 'C:\\unused', desktopDirectory: '/repo/apps/desktop', lstat: regular,
    })).toBe('/repo/apps/desktop/native-bin/win32-x64/computer-use-helper.exe')
    expect(resolveComputerHelperBinaryPath({
      platform: 'linux', arch: 'x64', isPackaged: false,
      resourcesPath: '/unused', desktopDirectory: '/repo/apps/desktop', lstat: regular,
    })).toBeUndefined()
    expect(regular).toHaveBeenCalledTimes(2)

    for (const lstat of [
      () => { throw new Error('missing') },
      () => ({ isFile: () => true, isSymbolicLink: () => true }),
      () => ({ isFile: () => false, isSymbolicLink: () => false }),
    ]) {
      expect(resolveComputerHelperBinaryPath({
        platform: 'darwin', arch: 'x64', isPackaged: false,
        resourcesPath: '/unused', desktopDirectory: '/repo/apps/desktop', lstat,
      })).toBeUndefined()
    }
  })

  it('stays idle and unsupported without a verified helper provider', async () => {
    const computer = new ComputerDesktopControlAdapter({
      mintRequestId: () => RequestId('30000000-0000-4000-8000-000000000001'),
    })
    expect(computer.kind).toBe('computer')
    expect(computer.supported()).toBe(false)
    await expect(computer.dispatch(requestBase('computer.status'), {
      signal: new AbortController().signal,
      timeoutMs: 100,
      generation: 1,
      registerAcquisition: () => true,
    })).rejects.toMatchObject({ code: 'NOT_SUPPORTED' })
    await computer.shutdown(new AbortController().signal)
  })

  it('derives grant facts from helper list and narrows exact requested pairs and capabilities', async () => {
    const helper = new FakeHelper()
    helper.responder = async request => okEnvelope(request, { apps: [
      { appId: 'app.one', name: 'One', windows: [
        { windowId: 'window.one', title: 'One' },
        { windowId: 'window.two', title: 'Two' },
      ] },
      { appId: 'app.other', name: 'Other', windows: [{ windowId: 'window.x', title: 'X' }] },
    ] })
    const request: ControlLeaseAcquireRequest = {
      ...requestBase('control.lease.acquire'),
      surfaceKind: 'native-application',
      targets: [
        { appId: 'app.one', windowIds: ['window.two', 'window.missing'] },
        { appId: 'app.missing', windowIds: ['window.x'] },
      ],
      capabilities: ['observe', 'pointer', 'keyboard'],
    }

    await expect(adapter(helper).acquireFacts(request, new AbortController().signal)).resolves.toEqual({
      surfaceKind: 'native-application',
      targets: [{ appId: 'app.one', windowIds: ['window.two'] }],
      capabilities: ['observe'],
      policyAllowed: true,
    })
    expect(helper.requests).toEqual([{
      protocolVersion: 1,
      messageKind: 'request',
      requestKind: 'list',
      requestId: RequestId('30000000-0000-4000-8000-000000000010'),
      sessionId: SESSION,
      timeoutMs: 432,
    }])
  })

  it('maps the complete dispatched computer roster without leaking absolute deadlines or lease fields to status/list', async () => {
    const helper = new FakeHelper()
    const computer = adapter(helper)
    const target = { leaseId: LEASE, leaseRevision: 7, appId: 'app.one', windowId: 'window.two', snapshotRevision: 9 }
    const ref = ComputerRef('computer:00000000000000000000000000000001')
    const requests: BridgeRequest[] = [
      requestBase('computer.status'),
      { ...requestBase('computer.list') },
      { ...requestBase('computer.snapshot'), ...target, includeImage: false },
      { ...requestBase('computer.focus'), ...target },
      { ...requestBase('computer.click'), ...target, ref, button: 'left' },
      { ...requestBase('computer.double-click'), ...target, x: 1, y: 2, button: 'right' },
      { ...requestBase('computer.drag'), ...target, fromX: 1, fromY: 2, toX: 3, toY: 4, button: 'left' },
      { ...requestBase('computer.type'), ...target, ref, text: 'hello' },
      { ...requestBase('computer.key'), ...target, key: 'A', modifiers: ['Meta'] },
      { ...requestBase('computer.scroll'), ...target, ref, deltaX: 1, deltaY: -2 },
      { ...requestBase('computer.wait'), ...target, durationMs: 25 },
    ]

    for (const request of requests) {
      const result = await computer.dispatch(request, {
        signal: new AbortController().signal,
        timeoutMs: 321,
        generation: 1,
        registerAcquisition: () => true,
      })
      expect(result.message.requestKind).toBe(request.requestKind)
    }
    expect(helper.requests.map(request => request.requestKind)).toEqual([
      'status', 'list', 'snapshot', 'focus', 'click', 'double-click', 'drag', 'type', 'key', 'scroll', 'wait',
    ])
    for (const request of helper.requests) {
      expect(request.timeoutMs).toBe(321)
      expect(request).not.toHaveProperty('deadlineUnixMs')
    }
    expect(helper.requests[0]).not.toHaveProperty('leaseId')
    expect(helper.requests[1]).not.toHaveProperty('leaseId')
  })

  it('preserves the adjacent immutable PNG envelope while remapping snapshot response kind', async () => {
    const helper = new FakeHelper()
    const png = Object.freeze({
      transferId: PngTransferId('40000000-0000-4000-8000-000000000001'),
      png: new ImmutablePng(new Uint8Array([1, 2, 3])),
    })
    helper.responder = async request => okEnvelope(request, {
      appId: 'app.one', windowId: 'window.two', snapshotRevision: 9,
      semanticText: '', refs: [],
    }, png)
    const result = await adapter(helper).dispatch({
      ...requestBase('computer.snapshot'), leaseId: LEASE, leaseRevision: 7,
      appId: 'app.one', windowId: 'window.two', snapshotRevision: 9, includeImage: true,
    }, {
      signal: new AbortController().signal,
      timeoutMs: 250,
      generation: 1,
      registerAcquisition: () => true,
    })

    expect(result.message.requestKind).toBe('computer.snapshot')
    expect(result.png).toBe(png)
  })

  it('does not complete lease installation until an exact helper acknowledgement arrives', async () => {
    const helper = new FakeHelper()
    let acknowledge!: () => void
    helper.responder = request => new Promise((resolve) => {
      acknowledge = () => { resolve(okEnvelope(request, { installed: true, leaseRevision: 7 })) }
    })
    const computer = adapter(helper)
    let settled = false
    const install = computer.installLease(prepared(), {
      signal: new AbortController().signal,
      timeoutMs: 654,
    }).then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(helper.requests[0]).toEqual({
      protocolVersion: 1, messageKind: 'request', requestKind: 'lease.install',
      requestId: RequestId('30000000-0000-4000-8000-000000000010'), sessionId: SESSION,
      timeoutMs: 654, leaseId: LEASE, leaseRevision: 7, agentId: 'Agent',
      targets: [{ appId: 'app.one', windowIds: ['window.two'] }], capabilities: ['observe'],
      quotas: { operations: 100, snapshots: 10, pointerActions: 10, keyActions: 10, textBytes: 1_024 },
      idleExpiresAfterMs: 30_000, hardExpiresAfterMs: 300_000,
    })
    acknowledge()
    await install
    expect(settled).toBe(true)
  })

  it('journals possible held input before dispatch and uses the live helper during normal release', async () => {
    const helper = new FakeHelper()
    let finish!: () => void
    helper.responder = request => request.requestKind === 'key'
      ? new Promise((resolve) => {
        finish = () => { resolve(okEnvelope(request, { acted: true, snapshotRevision: 10 })) }
      })
      : Promise.resolve(okEnvelope(request, request.requestKind === 'input.release'
        ? { released: true }
        : { stopped: true }))
    const computer = adapter(helper)
    const dispatched = computer.dispatch({
      ...requestBase('computer.key'), leaseId: LEASE, leaseRevision: 7,
      appId: 'app.one', windowId: 'window.two', snapshotRevision: 9,
      key: 'A', modifiers: ['Meta', 'Shift'],
    }, {
      signal: new AbortController().signal, timeoutMs: 321, generation: 1,
      registerAcquisition: () => true,
    })
    await Promise.resolve()
    await computer.releaseKnownInput(active(), new AbortController().signal)
    finish()
    await dispatched

    expect(helper.requests.find(request => request.requestKind === 'input.release')).toMatchObject({
      sessionId: SESSION,
      keys: ['A', 'Meta', 'Shift'],
      buttons: [],
    })
    expect(helper.events).toContain('stop-when-idle')
  })

  it('freezes possible held input on unexpected exit and recovers it once through a fresh helper', async () => {
    const helper = new FakeHelper()
    const computer = adapter(helper)
    helper.responder = async (request) => {
      if (request.requestKind !== 'click') return okEnvelope(request, { stopped: true })
      computer.unexpectedHelperExit()
      helper.running = false
      throw Object.assign(new Error('closed'), { code: 'DISCONNECTED' })
    }
    await expect(computer.dispatch({
      ...requestBase('computer.click'), leaseId: LEASE, leaseRevision: 7,
      appId: 'app.one', windowId: 'window.two', snapshotRevision: 9,
      x: 1, y: 2, button: 'right',
    }, {
      signal: new AbortController().signal, timeoutMs: 321, generation: 1,
      registerAcquisition: () => true,
    })).rejects.toMatchObject({ code: 'DISCONNECTED' })

    await Promise.all([
      computer.recoverAfterCrash(new AbortController().signal),
      computer.recoverAfterCrash(new AbortController().signal),
    ])
    expect(helper.recoveryRequests).toHaveLength(1)
    expect(helper.recoveryRequests[0]).toMatchObject({ sessionId: SESSION, keys: [], buttons: ['right'] })
  })

  it('retains a frozen journal after recovery failure and uses a fresh retry', async () => {
    const helper = new FakeHelper()
    const computer = adapter(helper)
    helper.responder = async (request) => {
      if (request.requestKind !== 'key') return okEnvelope(request, { stopped: true })
      computer.unexpectedHelperExit()
      helper.running = false
      throw Object.assign(new Error('closed'), { code: 'DISCONNECTED' })
    }
    let attempt = 0
    helper.recoveryResponder = async (request) => {
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('changed'), { code: 'BINARY_MISMATCH' })
      return okEnvelope(request, { released: true })
    }
    await expect(computer.dispatch({
      ...requestBase('computer.key'), leaseId: LEASE, leaseRevision: 7,
      appId: 'app.one', windowId: 'window.two', snapshotRevision: 9,
      key: 'A', modifiers: ['Meta'],
    }, {
      signal: new AbortController().signal, timeoutMs: 321, generation: 1,
      registerAcquisition: () => true,
    })).rejects.toMatchObject({ code: 'DISCONNECTED' })

    await expect(computer.recoverAfterCrash(new AbortController().signal))
      .rejects.toMatchObject({ code: 'BINARY_MISMATCH' })
    expect(computer.supported()).toBe(false)
    await expect(computer.recoverAfterCrash(new AbortController().signal)).resolves.toBeUndefined()

    expect(helper.recoveryRequests).toHaveLength(2)
    expect(computer.supported()).toBe(true)
  })

  it('clears the journal after a normal result and never attempts empty recovery', async () => {
    const helper = new FakeHelper()
    const computer = adapter(helper)
    await computer.dispatch({
      ...requestBase('computer.key'), leaseId: LEASE, leaseRevision: 7,
      appId: 'app.one', windowId: 'window.two', snapshotRevision: 9,
      key: 'A', modifiers: ['Meta'],
    }, {
      signal: new AbortController().signal, timeoutMs: 321, generation: 1,
      registerAcquisition: () => true,
    })
    computer.unexpectedHelperExit()
    await computer.recoverAfterCrash(new AbortController().signal)

    expect(helper.recoveryRequests).toEqual([])
  })

  it('exposes fixed-session observation calls and closes the helper after concurrent UI status/list', async () => {
    const helper = new FakeHelper()
    const computer = adapter(helper)
    const uiSession = SessionId('desktop-computer-ui')
    const [status, list] = await Promise.all([
      computer.status(uiSession),
      computer.list(uiSession, new AbortController().signal),
    ])

    expect(status.supported).toBe(true)
    expect(list.apps).toEqual([])
    expect(helper.requests.map(request => request.requestKind)).toEqual(['status', 'list'])
    expect(helper.requests.every(request => request.sessionId === uiSession)).toBe(true)
    expect(helper.stopWhenIdleCalls).toBe(2)
  })
})
