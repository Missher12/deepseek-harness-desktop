// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  MessengerStatus,
  type MessengerStatusProps,
} from '../src/client/MessengerStatus.tsx'
import {
  apply,
  inject,
} from '../src/client/index.tsx'
import { MessengerDrawer, type MessengerDrawerProps } from '../src/client/MessengerDrawer.tsx'
import { MessengerHeaderButton, type MessengerHeaderButtonProps } from '../src/client/MessengerHeaderButton.tsx'
import { MessengerUiController } from '../src/client/MessengerUiController.ts'
import { en } from '../src/client/locales.ts'
import {
  MessengerStore,
  createHttpMessengerTransport,
  type MessengerEvent,
  type MessengerSnapshot,
  type NotificationReceipt,
} from '../src/client/store.ts'
import {
  ACK_PATH,
  EVENTS_PATH,
  MESSENGER_CAPABILITY_HEADER,
  REPLY_PATH,
  SEND_PATH,
  SNAPSHOT_PATH,
  STOP_PATH,
} from '../src/http.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return { ...actual, writeClipboard: vi.fn() }
})

const CURRENT = 'current-session' as SessionId

function notification(
  deliveryId: string,
  status: NotificationReceipt['status'] = 'delivered',
  overrides: Partial<NotificationReceipt> = {},
): NotificationReceipt {
  return {
    deliveryId,
    sourceSessionId: CURRENT,
    targetSessionId: 'target-session' as SessionId,
    messageId: MessageId(`${deliveryId}-message`),
    status,
    wakeRequested: false,
    updatedAt: 10,
    acknowledged: false,
    ...overrides,
  }
}

function sessionState(current: SessionId | undefined = CURRENT): SessionListState {
  return {
    ids: current === undefined ? [] : [current],
    byId: current === undefined ? {} : {
      [current]: {
        id: current,
        displayTitle: 'Current',
        running: false,
        blank: false,
        updatedAt: 1,
      },
    },
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function useSessionsOf(state: SessionListState): MessengerStatusProps['useSessions'] {
  return select => select(state)
}

function t(key: keyof typeof en, params?: Record<string, unknown>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
}

function renderStatus(store: MessengerStore, wide = true, state = sessionState()) {
  return render(<MessengerStatus
    wide={wide}
    useSessions={useSessionsOf(state)}
    store={store}
    t={t}
  />)
}

function snapshot(receipts: NotificationReceipt[], lastEventId = 0): MessengerSnapshot {
  return { lastEventId, receipts }
}

function uuidLike(index: number): string {
  const suffix = String(index).padStart(12, '0')
  return `${String(index).padStart(8, '0')}-1111-4111-8111-${suffix}`
}

beforeEach(() => {
  vi.mocked(writeClipboard).mockReset()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as { __DSH_SESSION_MESSENGER__?: unknown }).__DSH_SESSION_MESSENGER__
})

describe('session messenger Client registration', () => {
  it('provides transport and mounts only the outgoing chat renderer', () => {
    const registrations: Array<{ name: string; options: Record<string, unknown>; component: unknown }> = []
    const disposers: Array<() => void> = []
    const localeDispose = vi.fn()
    const slotDispose = vi.fn()
    const ctx = {
      reflect: { provide: vi.fn(() => vi.fn()) },
      uiConversation: { events: { register: vi.fn(() => vi.fn()) } },
      effect(setup: () => (() => void) | undefined) {
        const dispose = setup()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      locale: { register: vi.fn(() => localeDispose) },
      slots: {
        inject(_name: string, register: () => (() => void) | undefined) {
          const dispose = register()
          if (typeof dispose === 'function') disposers.push(dispose)
        },
        register(options: Record<string, unknown>, component: unknown) {
          registrations.push({ name: String(options.name), options, component })
          return slotDispose
        },
      },
    }

    apply(ctx as never)
    expect(inject).toEqual(['locale', 'slots', 'uiConversation'])
    expect(registrations.map(entry => entry.name)).toEqual(['conversation.chat.node'])
    expect(registrations[0]?.options).toMatchObject({ key: 'session-relay-outgoing' })
    expect(ctx.reflect.provide).toHaveBeenCalledWith('sessionMessengerClient', expect.any(Object))
    expect(ctx.uiConversation.events.register).toHaveBeenCalledOnce()
    for (const dispose of disposers.reverse()) dispose()
    expect(localeDispose).toHaveBeenCalledOnce()
    expect(slotDispose).toHaveBeenCalledOnce()
  })
})

describe('MessengerUiController', () => {
  it('clamps and numerically persists width, closes on Session switch, and listens for relay replies', () => {
    const values = new Map([['dsh.session-messenger.drawer-width', '480']])
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    }
    const controller = new MessengerUiController(storage)
    expect(controller.getSnapshot().width).toBe(480)
    controller.setWidth(900)
    expect(controller.getSnapshot().width).toBe(560)
    expect(values.get('dsh.session-messenger.drawer-width')).toBe('560')
    controller.open(CURRENT)
    expect(controller.getSnapshot().open).toBe(true)
    controller.selectSession('other-session' as SessionId)
    expect(controller.getSnapshot().open).toBe(false)

    const stop = controller.listen()
    window.dispatchEvent(new CustomEvent('dsh-session-messenger:reply', {
      detail: { deliveryId: 'delivery-1', senderSessionId: 'source-session' },
    }))
    expect(controller.getSnapshot()).toMatchObject({
      open: true,
      reply: { deliveryId: 'delivery-1', senderSessionId: 'source-session' },
    })
    stop()
  })
})

function selectorHook<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void }) {
  return <U,>(select: (snapshot: T) => U): U => useSyncExternalStore(
    source.subscribe.bind(source),
    () => select(source.getSnapshot()),
    () => select(source.getSnapshot()),
  )
}

describe('Messenger header drawer', () => {
  it('opens from the header, sends once, retains a failed draft, and restores focus on Escape', async () => {
    const controller = new MessengerUiController({ getItem: () => null, setItem: () => undefined })
    const store = new MessengerStore({ snapshot: vi.fn(), events: vi.fn(), acknowledge: vi.fn(async () => 0) })
    const send = vi.fn(async () => { throw new Error('target-not-found') })
    const reply = vi.fn()
    const common = {
      useMessenger: selectorHook(store),
      useMessengerUi: selectorHook(controller),
      selectSession: (id: SessionId) => { controller.selectSession(id) },
      toggle: (id: SessionId) => { controller.toggle(id) },
      close: () => { controller.close() },
      setWidth: (width: number) => { controller.setWidth(width) },
      clearReply: () => { controller.clearReply() },
      send,
      reply,
      acknowledge: vi.fn(async () => 0),
      t,
    }
    const headerProps = { ...common, sessionId: CURRENT } as unknown as MessengerHeaderButtonProps
    const drawerProps = {
      ...common,
      useSessions: useSessionsOf(sessionState()),
    } as unknown as MessengerDrawerProps
    render(<>
      <MessengerHeaderButton {...headerProps} />
      <MessengerDrawer {...drawerProps} />
    </>)

    const trigger = screen.getByRole('button', { name: /Session messages/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Session messages' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Target Session ID'), { target: { value: 'target-session' } })
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Start target Agent' }).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
    const submit = screen.getByRole('button', { name: 'Send message' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => { expect(send).toHaveBeenCalledTimes(1) })
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message').value).toBe('hello')
    expect(await screen.findByText('target-not-found')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Session messages' })).toBeNull() })
    expect(document.activeElement).toBe(trigger)
  })

  it('opens the receipt-bound reply form from the visible relay event', () => {
    const controller = new MessengerUiController({ getItem: () => null, setItem: () => undefined })
    const stop = controller.listen()
    window.dispatchEvent(new CustomEvent('dsh-session-messenger:reply', {
      detail: { deliveryId: 'delivery-2', senderSessionId: 'sender-2' },
    }))
    const store = new MessengerStore({ snapshot: vi.fn(), events: vi.fn(), acknowledge: vi.fn(async () => 0) })
    const drawerProps = {
      useMessenger: selectorHook(store),
      useMessengerUi: selectorHook(controller),
      useSessions: useSessionsOf(sessionState()),
      selectSession: (id: SessionId) => { controller.selectSession(id) },
      toggle: (id: SessionId) => { controller.toggle(id) },
      close: () => { controller.close() },
      setWidth: (width: number) => { controller.setWidth(width) },
      clearReply: () => { controller.clearReply() },
      send: vi.fn(),
      reply: vi.fn(),
      acknowledge: vi.fn(),
      t,
    } as unknown as MessengerDrawerProps
    render(<MessengerDrawer {...drawerProps} />)
    expect(screen.getByRole('dialog', { name: 'Session messages' })).toBeTruthy()
    expect(screen.getByText('sender-2')).toBeTruthy()
    expect(screen.getByText('delivery-2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeTruthy()
    stop()
  })

  it('uses a bounded right drawer with a full-width narrow layout and reduced motion', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/extensions/session-messenger/src/client/MessengerStatus.module.css'),
      'utf8',
    )
    expect(source).toContain('min-width: 320px')
    expect(source).toContain('max-width: 560px')
    expect(source).toContain('width: 100vw')
    expect(source).toContain('@media (max-width: 640px)')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

describe('MessengerStatus', () => {
  it('shows pending, unread, and error states with visible text plus glyphs', () => {
    const transport = {
      snapshot: vi.fn(),
      events: vi.fn(),
      acknowledge: vi.fn(async () => 0),
    }
    const store = new MessengerStore(transport)
    store.replaceSnapshot(snapshot([
      notification('pending', 'claimed'),
      notification('reply', 'delivered', {
        sourceSessionId: 'other-session' as SessionId,
        targetSessionId: CURRENT,
        replyToDeliveryId: 'original',
      }),
      notification('failed', 'failed', { errorCode: 'delivery-failed', updatedAt: 30 }),
    ]))
    renderStatus(store)

    const trigger = screen.getByRole('button', { name: /Session messages/ })
    expect(trigger.querySelector('svg')).not.toBeNull()
    fireEvent.click(trigger)
    for (const text of ['1 pending', '1 unread', 'Latest error: delivery-failed']) {
      const row = screen.getByText(text).closest('[data-messenger-state]')
      expect(row?.querySelector('svg'), text).not.toBeNull()
    }
    expect(screen.getByRole('status').textContent).toContain('1 unread')
  })

  it('copies the exact ordinary current Session ID and never reports a refused write as success', async () => {
    const store = new MessengerStore({
      snapshot: vi.fn(),
      events: vi.fn(),
      acknowledge: vi.fn(async () => 0),
    })
    vi.mocked(writeClipboard).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    renderStatus(store)
    fireEvent.click(screen.getByRole('button', { name: /Session messages/ }))
    const copy = screen.getByRole('button', { name: 'Copy current Session ID' })

    fireEvent.click(copy)
    await waitFor(() => { expect(writeClipboard).toHaveBeenLastCalledWith(CURRENT) })
    expect(await screen.findByText('Copy failed')).toBeTruthy()
    expect(screen.queryByText('Session ID copied')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toBe('Copy failed')

    fireEvent.click(copy)
    expect(await screen.findByText('Session ID copied')).toBeTruthy()
    expect(writeClipboard).toHaveBeenLastCalledWith(CURRENT)
    expect(screen.getByRole('status').textContent).toBe('Session ID copied')

    fireEvent.click(screen.getByRole('button', { name: 'Close session messages' }))
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toBe('Session ID copied')
  })

  it('acknowledges only current unread reply notifications without deleting receipt metadata', async () => {
    const acknowledge = vi.fn(async () => 1)
    const store = new MessengerStore({ snapshot: vi.fn(), events: vi.fn(), acknowledge })
    store.replaceSnapshot(snapshot([
      notification('reply', 'delivered', {
        sourceSessionId: 'other-session' as SessionId,
        targetSessionId: CURRENT,
        replyToDeliveryId: 'original',
      }),
    ]))
    renderStatus(store)
    fireEvent.click(screen.getByRole('button', { name: /Session messages/ }))
    expect(screen.getByText('1 unread')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }))
    await waitFor(() => {
      expect(acknowledge).toHaveBeenCalledWith(CURRENT, ['reply'], expect.any(AbortSignal))
    })
    await waitFor(() => { expect(screen.getByText('0 unread')).toBeTruthy() })
    expect(store.getSnapshot().receipts.get('reply')).toMatchObject({
      deliveryId: 'reply',
      acknowledged: true,
    })
    expect(store.getSnapshot().receipts.size).toBe(1)
  })

  it('uses native buttons in wide and rail layouts and keeps live feedback screen-reader visible', () => {
    const store = new MessengerStore({
      snapshot: vi.fn(),
      events: vi.fn(),
      acknowledge: vi.fn(async () => 0),
    })
    const view = renderStatus(store, false)
    const trigger = screen.getByRole('button', { name: /Session messages/ })
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(view.container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('announces acknowledgement failures through the single polite status region', async () => {
    const store = new MessengerStore({
      snapshot: vi.fn(),
      events: vi.fn(),
      acknowledge: vi.fn(async () => { throw new Error('network down') }),
    })
    store.replaceSnapshot(snapshot([
      notification('reply', 'delivered', {
        sourceSessionId: 'other-session' as SessionId,
        targetSessionId: CURRENT,
        replyToDeliveryId: 'original',
      }),
    ]))
    renderStatus(store)
    fireEvent.click(screen.getByRole('button', { name: /Session messages/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }))

    expect(await screen.findByText('Could not mark notifications read')).toBeTruthy()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toBe('Could not mark notifications read')
  })

  it('keeps the compact panel usable at 200% zoom and removes motion on user request', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/extensions/session-messenger/src/client/MessengerStatus.module.css'),
      'utf8',
    )
    expect(source).toContain('width: min(320px, calc(100vw - 24px))')
    expect(source).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')
    expect(source).toContain('overflow-wrap: anywhere')
    expect(source).toContain('@media (max-width: 480px)')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
    expect(source).toContain('transition: none')
    const tokens = [...source.matchAll(/var\((--[^,)]+)/gu)].map(match => match[1])
    expect(tokens.length).toBeGreaterThan(0)
    const platformOwnedTokens = tokens.filter(token => token?.startsWith('--dsw-') ?? false)
    expect(platformOwnedTokens.length).toBeGreaterThan(0)
    const platformTokens = [
      'design-platform.css',
      'gradient-shadow-text.css',
    ].map(file => readFileSync(
      join(process.cwd(), 'packages/client/ui-theme/src/styles', file),
      'utf8',
    )).join('\n')
    for (const token of platformOwnedTokens) expect(platformTokens).toContain(`${token}:`)
  })
})

describe('session messenger streaming-fetch transport', () => {
  it('uses POST with the capability header for snapshot, events, and acknowledgement', async () => {
    window.__DSH_SESSION_MESSENGER__ = {
      snapshotPath: SNAPSHOT_PATH,
      ackPath: ACK_PATH,
      eventsPath: EVENTS_PATH,
      sendPath: SEND_PATH,
      replyPath: REPLY_PATH,
      stopPath: STOP_PATH,
      capabilityHeader: MESSENGER_CAPABILITY_HEADER,
      capability: 'browser-capability',
    }
    const event: MessengerEvent = {
      id: 8,
      kind: 'receipt',
      receipt: notification('streamed'),
    }
    const eventBody = `id: 8\nevent: receipt\ndata: ${JSON.stringify(event)}\n\n`
    const responses = [
      new Response(JSON.stringify(snapshot([], 7)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(eventBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
      new Response(JSON.stringify({ acknowledged: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(JSON.stringify({ deliveryId: 'sent', messageId: 'sent-message', status: 'delivered', wakeRequested: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(JSON.stringify({ deliveryId: 'reply', messageId: 'reply-message', status: 'delivered', wakeRequested: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]
    const fetcher = vi.fn<typeof fetch>(async () => {
      const response = responses.shift()
      if (response === undefined) throw new Error('unexpected fetch')
      return response
    })
    const transport = createHttpMessengerTransport(window.__DSH_SESSION_MESSENGER__, fetcher)
    if (transport.send === undefined || transport.reply === undefined) {
      throw new Error('operator transport unavailable')
    }

    const signal = new AbortController().signal
    expect(await transport.snapshot(signal)).toEqual(snapshot([], 7))
    const received: MessengerEvent[] = []
    await transport.events(7, (event) => { received.push(event) }, new AbortController().signal)
    expect(received).toEqual([event])
    expect(await transport.acknowledge(CURRENT, ['streamed'], signal)).toBe(1)
    expect(await transport.send(CURRENT, 'target-session' as SessionId, 'hello', false, signal))
      .toMatchObject({ deliveryId: 'sent' })
    expect(await transport.reply(CURRENT, 'delivery-1', 'answer', true, signal))
      .toMatchObject({ deliveryId: 'reply' })

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      SNAPSHOT_PATH, EVENTS_PATH, ACK_PATH, SEND_PATH, REPLY_PATH,
    ])
    const snapshotInit = fetcher.mock.calls[0]?.[1]
    const eventsInit = fetcher.mock.calls[1]?.[1]
    const ackInit = fetcher.mock.calls[2]?.[1]
    expect(snapshotInit?.method).toBe('POST')
    expect(snapshotInit?.signal).toBe(signal)
    expect(new Headers(snapshotInit?.headers).get(MESSENGER_CAPABILITY_HEADER)).toBe('browser-capability')
    expect(eventsInit?.method).toBe('POST')
    expect(new Headers(eventsInit?.headers).get(MESSENGER_CAPABILITY_HEADER)).toBe('browser-capability')
    expect(new Headers(eventsInit?.headers).get('last-event-id')).toBe('7')
    expect(ackInit?.method).toBe('POST')
    expect(ackInit?.signal).toBe(signal)
    expect(new Headers(ackInit?.headers).get(MESSENGER_CAPABILITY_HEADER)).toBe('browser-capability')
    expect(new Headers(ackInit?.headers).get('content-type')).toBe('application/json')
    expect(ackInit?.body).toBe(JSON.stringify({ sessionId: CURRENT, deliveryIds: ['streamed'] }))
  })

  it('deduplicates replayed event ids after an authoritative snapshot', () => {
    const store = new MessengerStore({
      snapshot: vi.fn(),
      events: vi.fn(),
      acknowledge: vi.fn(async () => 0),
    })
    store.replaceSnapshot(snapshot([notification('base')], 4))
    store.accept({ id: 4, kind: 'receipt', receipt: notification('stale') })
    store.accept({ id: 5, kind: 'receipt', receipt: notification('fresh') })
    expect([...store.getSnapshot().receipts.keys()]).toEqual(['base', 'fresh'])
    expect(store.getSnapshot().lastEventId).toBe(5)
    expect(() => {
      store.accept({ id: 7, kind: 'receipt', receipt: notification('gap') })
    }).toThrow('event cursor gap')
    expect(store.getSnapshot().lastEventId).toBe(5)
  })

  it('reconnects snapshot-first after a non-contiguous stream event repairs stale state', async () => {
    vi.useFakeTimers()
    const authoritative = snapshot([notification('authoritative')], 6)
    const snapshotRequest = vi.fn()
      .mockResolvedValueOnce(snapshot([notification('stale')], 4))
      .mockResolvedValue(authoritative)
    let stream = 0
    const events = vi.fn(async (
      _afterId: number,
      listener: (event: MessengerEvent) => void,
    ) => {
      stream += 1
      if (stream === 1) {
        listener({ id: 6, kind: 'receipt', receipt: notification('gap') })
      }
    })
    const store = new MessengerStore({
      snapshot: snapshotRequest,
      events,
      acknowledge: vi.fn(async () => 0),
    })
    const stop = await store.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().phase).toBe('error')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(snapshotRequest).toHaveBeenCalledTimes(2)
    expect(events.mock.calls.map(([afterId]) => afterId)).toEqual([4, 6])
    expect([...store.getSnapshot().receipts.keys()]).toEqual(['authoritative'])
    await stop()
  })

  it('aborts a hanging snapshot and reaches quiescence without publishing after disposal', async () => {
    let observedSignal: AbortSignal | undefined
    let release!: () => void
    const snapshotRequest = vi.fn((signal?: AbortSignal) => new Promise<MessengerSnapshot>((resolve, reject) => {
      observedSignal = signal
      release = () => { resolve(snapshot([notification('late')], 1)) }
      signal?.addEventListener('abort', () => { reject(new Error('snapshot aborted')) }, { once: true })
    }))
    const store = new MessengerStore({
      snapshot: snapshotRequest,
      events: vi.fn(),
      acknowledge: vi.fn(async () => 0),
    })
    await store.start()
    await Promise.resolve()

    const disposal = Promise.resolve(store.dispose())
    release()
    await disposal

    expect(observedSignal).toBeInstanceOf(AbortSignal)
    expect(observedSignal?.aborted).toBe(true)
    expect(store.getSnapshot().receipts.size).toBe(0)
    expect(store.getSnapshot().phase).not.toBe('connected')
  })

  it('aborts a hanging acknowledgement and never applies its late result after disposal', async () => {
    let observedSignal: AbortSignal | undefined
    let release!: () => void
    const acknowledge = vi.fn((
      _sessionId: SessionId,
      _deliveryIds: readonly string[],
      signal?: AbortSignal,
    ) => new Promise<number>((resolve, reject) => {
      observedSignal = signal
      release = () => { resolve(1) }
      signal?.addEventListener('abort', () => { reject(new Error('acknowledgement aborted')) }, { once: true })
    }))
    const store = new MessengerStore({ snapshot: vi.fn(), events: vi.fn(), acknowledge })
    store.replaceSnapshot(snapshot([
      notification('reply', 'delivered', {
        sourceSessionId: 'other-session' as SessionId,
        targetSessionId: CURRENT,
        replyToDeliveryId: 'original',
      }),
    ]))
    const acknowledgement = store.acknowledge(CURRENT, ['reply']).then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    )
    await Promise.resolve()

    const disposal = Promise.resolve(store.dispose())
    release()
    await disposal

    expect(observedSignal).toBeInstanceOf(AbortSignal)
    expect(observedSignal?.aborted).toBe(true)
    expect(await acknowledgement).toBe('rejected')
    expect(store.getSnapshot().receipts.get('reply')?.acknowledged).toBe(false)
  })

  it('aborts the previous snapshot on restart and ignores its late stale result', async () => {
    let firstSignal: AbortSignal | undefined
    let resolveFirst!: (value: MessengerSnapshot) => void
    const snapshotRequest = vi.fn((signal?: AbortSignal) => {
      if (snapshotRequest.mock.calls.length === 1) {
        firstSignal = signal
        return new Promise<MessengerSnapshot>((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve(snapshot([notification('authoritative')], 2))
    })
    const events = vi.fn(async () => undefined)
    const store = new MessengerStore({
      snapshot: snapshotRequest,
      events,
      acknowledge: vi.fn(async () => 0),
    })
    await store.start()
    await Promise.resolve()
    let restarted = false
    const restart = store.start().then((stop) => {
      restarted = true
      return stop
    })
    await Promise.resolve()
    expect(restarted).toBe(false)
    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(firstSignal?.aborted).toBe(true)
    resolveFirst(snapshot([notification('stale')], 1))
    const stop = await restart

    expect([...store.getSnapshot().receipts.keys()]).toEqual(['authoritative'])
    await stop()
    await store.dispose()
  })

  it('applies a replayed removal so snapshots and streams converge', async () => {
    const removed: MessengerEvent = {
      id: 5,
      kind: 'remove',
      deliveryId: 'base',
    }
    const body = `id: 5\nevent: remove\ndata: ${JSON.stringify(removed)}\n\n`
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    const transport = createHttpMessengerTransport({
      snapshotPath: SNAPSHOT_PATH,
      ackPath: ACK_PATH,
      eventsPath: EVENTS_PATH,
      sendPath: SEND_PATH,
      replyPath: REPLY_PATH,
      stopPath: STOP_PATH,
      capabilityHeader: MESSENGER_CAPABILITY_HEADER,
      capability: 'browser-capability',
    }, fetcher)
    const store = new MessengerStore(transport)
    store.replaceSnapshot(snapshot([notification('base')], 4))

    await transport.events(4, (event) => { store.accept(event) }, new AbortController().signal)

    expect(store.getSnapshot().receipts.has('base')).toBe(false)
    expect(store.getSnapshot().lastEventId).toBe(5)
  })

  it('parses CRLF event separators split across streaming chunks', async () => {
    const streamed: MessengerEvent = {
      id: 9,
      kind: 'receipt',
      receipt: notification('crlf'),
    }
    const encoded = new TextEncoder()
    const chunks = [
      'id: 9\r',
      '\nevent: receipt\r\ndata: ',
      `${JSON.stringify(streamed)}\r`,
      '\n\r',
      '\n',
    ].map(chunk => encoded.encode(chunk))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const transport = createHttpMessengerTransport({
      snapshotPath: SNAPSHOT_PATH,
      ackPath: ACK_PATH,
      eventsPath: EVENTS_PATH,
      sendPath: SEND_PATH,
      replyPath: REPLY_PATH,
      stopPath: STOP_PATH,
      capabilityHeader: MESSENGER_CAPABILITY_HEADER,
      capability: 'browser-capability',
    }, fetcher)
    const received: MessengerEvent[] = []
    await transport.events(8, (event) => { received.push(event) }, new AbortController().signal)
    expect(received).toEqual([streamed])
  })

  it('does not clear local unread state when Host accepts fewer acknowledgements than requested', async () => {
    const store = new MessengerStore({
      snapshot: vi.fn(),
      events: vi.fn(),
      acknowledge: vi.fn(async () => 0),
    })
    store.replaceSnapshot(snapshot([
      notification('reply', 'delivered', {
        sourceSessionId: 'other-session' as SessionId,
        targetSessionId: CURRENT,
        replyToDeliveryId: 'original',
      }),
    ]))
    await expect(store.acknowledge(CURRENT, ['reply'])).rejects.toThrow('acknowledgement mismatch')
    expect(store.getSnapshot().receipts.get('reply')?.acknowledged).toBe(false)
  })

  it('batches more than one hundred UUID-like acknowledgements under count and byte limits', async () => {
    const deliveryIds = Array.from({ length: 120 }, (_, index) => uuidLike(index))
    const acknowledge = vi.fn(async (_sessionId: SessionId, batch: readonly string[]) => batch.length)
    const store = new MessengerStore({ snapshot: vi.fn(), events: vi.fn(), acknowledge })
    store.replaceSnapshot(snapshot(deliveryIds.map(deliveryId => notification(deliveryId, 'delivered', {
      sourceSessionId: 'other-session' as SessionId,
      targetSessionId: CURRENT,
      replyToDeliveryId: 'original',
    }))))

    await expect(store.acknowledge(CURRENT, deliveryIds)).resolves.toBe(deliveryIds.length)

    expect(acknowledge.mock.calls.length).toBeGreaterThan(1)
    const submitted = acknowledge.mock.calls.flatMap(([, batch]) => batch)
    expect(submitted).toEqual(deliveryIds)
    for (const [, batch] of acknowledge.mock.calls) {
      expect(batch.length).toBeLessThanOrEqual(128)
      const body = JSON.stringify({ sessionId: CURRENT, deliveryIds: batch })
      expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(4 * 1024)
    }
    expect([...store.getSnapshot().receipts.values()].every(receipt => receipt.acknowledged)).toBe(true)
  })

  it('keeps completed acknowledgement batches read when a later batch fails and permits retry', async () => {
    const deliveryIds = Array.from({ length: 120 }, (_, index) => uuidLike(index))
    let call = 0
    const acknowledge = vi.fn(async (_sessionId: SessionId, batch: readonly string[]) => {
      call += 1
      if (call === 2) throw new Error('temporary network failure')
      return batch.length
    })
    const store = new MessengerStore({ snapshot: vi.fn(), events: vi.fn(), acknowledge })
    store.replaceSnapshot(snapshot(deliveryIds.map(deliveryId => notification(deliveryId, 'delivered', {
      sourceSessionId: 'other-session' as SessionId,
      targetSessionId: CURRENT,
      replyToDeliveryId: 'original',
    }))))

    await expect(store.acknowledge(CURRENT, deliveryIds)).rejects.toThrow('temporary network failure')
    const completed = acknowledge.mock.calls[0]?.[1] ?? []
    const remaining = deliveryIds.filter(deliveryId => !completed.includes(deliveryId))
    expect(completed.length).toBeGreaterThan(0)
    expect(remaining.length).toBeGreaterThan(0)
    expect(completed.every(id => store.getSnapshot().receipts.get(id)?.acknowledged)).toBe(true)
    expect(remaining.every(id => !store.getSnapshot().receipts.get(id)?.acknowledged)).toBe(true)

    await expect(store.acknowledge(CURRENT, remaining)).resolves.toBe(remaining.length)
    expect(deliveryIds.every(id => store.getSnapshot().receipts.get(id)?.acknowledged)).toBe(true)
  })
})
