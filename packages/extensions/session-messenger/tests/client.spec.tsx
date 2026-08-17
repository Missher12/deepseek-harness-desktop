// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  SNAPSHOT_PATH,
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
    messageId: `${deliveryId}-message`,
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
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as { __DSH_SESSION_MESSENGER__?: unknown }).__DSH_SESSION_MESSENGER__
})

describe('session messenger Client registration', () => {
  it('registers only one Harness footer action and removes it through the slot disposer', () => {
    const registrations: Array<{ name: string; options: Record<string, unknown>; component: unknown }> = []
    const disposers: Array<() => void> = []
    const localeDispose = vi.fn()
    const slotDispose = vi.fn()
    const ctx = {
      effect(setup: () => (() => void) | undefined) {
        const dispose = setup()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      locale: { register: vi.fn(() => localeDispose) },
      slots: {
        inject(name: string, register: () => unknown) {
          expect(name).toBe('sidebar.footer.action')
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
    expect(inject).toEqual(['locale', 'slots'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({
      name: 'sidebar.footer.action',
      options: { id: 'session-messenger', locale: 'sessionMessenger' },
      component: MessengerStatus,
    })
    for (const dispose of disposers.reverse()) dispose()
    expect(localeDispose).toHaveBeenCalledOnce()
    expect(slotDispose).toHaveBeenCalledOnce()
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
    await waitFor(() => { expect(acknowledge).toHaveBeenCalledWith(CURRENT, ['reply']) })
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
    expect(tokens.every(token => token?.startsWith('--dsw-') ?? false)).toBe(true)
    const platformTokens = [
      'design-platform.css',
      'gradient-shadow-text.css',
    ].map(file => readFileSync(
      join(process.cwd(), 'packages/client/ui-theme/src/styles', file),
      'utf8',
    )).join('\n')
    for (const token of tokens) expect(platformTokens).toContain(`${token}:`)
  })
})

describe('session messenger streaming-fetch transport', () => {
  it('uses POST with the capability header for snapshot, events, and acknowledgement', async () => {
    window.__DSH_SESSION_MESSENGER__ = {
      snapshotPath: SNAPSHOT_PATH,
      ackPath: ACK_PATH,
      eventsPath: EVENTS_PATH,
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
    ]
    const fetcher = vi.fn<typeof fetch>(async () => {
      const response = responses.shift()
      if (response === undefined) throw new Error('unexpected fetch')
      return response
    })
    const transport = createHttpMessengerTransport(window.__DSH_SESSION_MESSENGER__, fetcher)

    expect(await transport.snapshot()).toEqual(snapshot([], 7))
    const received: MessengerEvent[] = []
    await transport.events(7, (event) => { received.push(event) }, new AbortController().signal)
    expect(received).toEqual([event])
    expect(await transport.acknowledge(CURRENT, ['streamed'])).toBe(1)

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([SNAPSHOT_PATH, EVENTS_PATH, ACK_PATH])
    const snapshotInit = fetcher.mock.calls[0]?.[1]
    const eventsInit = fetcher.mock.calls[1]?.[1]
    const ackInit = fetcher.mock.calls[2]?.[1]
    expect(snapshotInit?.method).toBe('POST')
    expect(new Headers(snapshotInit?.headers).get(MESSENGER_CAPABILITY_HEADER)).toBe('browser-capability')
    expect(eventsInit?.method).toBe('POST')
    expect(new Headers(eventsInit?.headers).get(MESSENGER_CAPABILITY_HEADER)).toBe('browser-capability')
    expect(new Headers(eventsInit?.headers).get('last-event-id')).toBe('7')
    expect(ackInit?.method).toBe('POST')
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
