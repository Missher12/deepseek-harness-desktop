import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { MessengerDeliveryResult, MessengerStore } from './store.ts'

/** Smallest supported desktop drawer width. */
export const MESSENGER_DRAWER_MIN_WIDTH = 320
/** Largest supported desktop drawer width. */
export const MESSENGER_DRAWER_MAX_WIDTH = 560
/** Initial drawer width when the browser has no valid preference. */
export const MESSENGER_DRAWER_DEFAULT_WIDTH = 400
/** Browser-local numeric width preference. */
export const MESSENGER_DRAWER_WIDTH_KEY = 'dsh.session-messenger.drawer-width'

/** Receipt-bound reply target selected from a visible relay disclosure. */
export interface MessengerReplyTarget {
  readonly deliveryId: string
  readonly senderSessionId: string
}

/** Immutable drawer visibility, geometry, and active-reply state. */
export interface MessengerUiSnapshot {
  readonly open: boolean
  readonly width: number
  readonly reply: MessengerReplyTarget | null
}

/** Plain callbacks and bare observable hooks shared by both slot entries. */
export interface MessengerUiInjected {
  readonly hooks: {
    readonly messenger: MessengerStore
    readonly messengerUi: MessengerUiController
  }
  readonly selectSession: (sessionId: SessionId | undefined) => void
  readonly toggle: (sessionId: SessionId) => void
  readonly close: () => void
  readonly setWidth: (width: number) => void
  readonly clearReply: () => void
  readonly send: (
    sourceSessionId: SessionId,
    targetSessionId: SessionId,
    message: string,
    wake: boolean,
  ) => Promise<MessengerDeliveryResult>
  readonly reply: (
    sourceSessionId: SessionId,
    deliveryId: string,
    message: string,
    wake: boolean,
  ) => Promise<MessengerDeliveryResult>
  readonly acknowledge: (sessionId: SessionId, deliveryIds: readonly string[]) => Promise<number>
}

interface WidthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const SAFE_ID = /^[\x21-\x7e]{1,256}$/

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return MESSENGER_DRAWER_DEFAULT_WIDTH
  return Math.min(MESSENGER_DRAWER_MAX_WIDTH, Math.max(MESSENGER_DRAWER_MIN_WIDTH, Math.round(value)))
}

function browserStorage(): WidthStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function initialWidth(storage: WidthStorage | undefined): number {
  if (storage === undefined) return MESSENGER_DRAWER_DEFAULT_WIDTH
  try {
    const raw = storage.getItem(MESSENGER_DRAWER_WIDTH_KEY)
    if (raw === null || !/^\d{1,4}$/u.test(raw)) return MESSENGER_DRAWER_DEFAULT_WIDTH
    return clampWidth(Number(raw))
  } catch {
    return MESSENGER_DRAWER_DEFAULT_WIDTH
  }
}

/** Shared observable controlling the separate header and shell-overlay entries. */
export class MessengerUiController {
  private state: MessengerUiSnapshot
  private readonly listeners = new Set<() => void>()
  private selectedSession: SessionId | undefined

  constructor(private readonly storage: WidthStorage | undefined = browserStorage()) {
    this.state = { open: false, width: initialWidth(storage), reply: null }
  }

  /**
   * Read the current drawer state without mutation.
   * @returns the immutable UI-controller snapshot.
   */
  readonly getSnapshot = (): MessengerUiSnapshot => this.state

  /**
   * Subscribe to drawer state replacements.
   * @param listener - callback invoked after each published state change.
   * @returns a disposer that removes the callback.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Track the displayed ordinary session and close stale drawer state on change.
   * @param sessionId - currently displayed ordinary session, when present.
   */
  selectSession(sessionId: SessionId | undefined): void {
    if (this.selectedSession === undefined) {
      this.selectedSession = sessionId
      return
    }
    if (this.selectedSession === sessionId) return
    this.selectedSession = sessionId
    this.publish({ ...this.state, open: false, reply: null })
  }

  /**
   * Open the drawer for the displayed ordinary session.
   * @param sessionId - session that owns the drawer interaction.
   */
  open(sessionId: SessionId): void {
    this.selectSession(sessionId)
    this.publish({ ...this.state, open: true })
  }

  /**
   * Toggle the drawer for the displayed ordinary session.
   * @param sessionId - session that owns the drawer interaction.
   */
  toggle(sessionId: SessionId): void {
    this.selectSession(sessionId)
    this.publish({ ...this.state, open: !this.state.open })
  }

  /** Close the drawer and clear any receipt-bound reply selection. */
  close(): void {
    if (!this.state.open && this.state.reply === null) return
    this.publish({ ...this.state, open: false, reply: null })
  }

  /** Clear the receipt-bound reply selection without closing the drawer. */
  clearReply(): void {
    if (this.state.reply === null) return
    this.publish({ ...this.state, reply: null })
  }

  /**
   * Clamp, publish, and best-effort persist the drawer width.
   * @param width - requested width in CSS pixels.
   */
  setWidth(width: number): void {
    const clamped = clampWidth(width)
    if (clamped === this.state.width) return
    this.publish({ ...this.state, width: clamped })
    try {
      this.storage?.setItem(MESSENGER_DRAWER_WIDTH_KEY, String(clamped))
    } catch {
      // Private browsing and storage policy may reject persistence; geometry still updates.
    }
  }

  /**
   * Open the drawer with one validated receipt-bound reply target.
   * @param reply - delivery and source identities selected from the relay disclosure.
   */
  openReply(reply: MessengerReplyTarget): void {
    this.publish({ ...this.state, open: true, reply })
  }

  /**
   * Listen once per Client plugin lifetime for visible relay-card reply actions.
   * @returns a disposer that removes the browser event listener.
   */
  listen(): () => void {
    if (typeof window === 'undefined') return () => {}
    const receive = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) return
      const value = detail as Record<string, unknown>
      if (typeof value.deliveryId !== 'string' || !SAFE_ID.test(value.deliveryId)
        || typeof value.senderSessionId !== 'string' || !SAFE_ID.test(value.senderSessionId)) return
      this.openReply({ deliveryId: value.deliveryId, senderSessionId: value.senderSessionId })
    }
    window.addEventListener('dsh-session-messenger:reply', receive)
    return () => { window.removeEventListener('dsh-session-messenger:reply', receive) }
  }

  private publish(next: MessengerUiSnapshot): void {
    if (next.open === this.state.open && next.width === this.state.width && next.reply === this.state.reply) return
    this.state = next
    for (const listener of [...this.listeners]) listener()
  }
}
