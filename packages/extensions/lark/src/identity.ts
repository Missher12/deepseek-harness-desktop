import { randomBytes, randomUUID } from 'node:crypto'
import type { CallbackNonceRecord, OwnerRecord } from './state.ts'

/** Durable owner, event-deduplication, and one-use nonce store. */
export interface IdentityStore {
  getOwner(): Promise<OwnerRecord | undefined>
  putOwner(owner: OwnerRecord): Promise<void>
  hasEvent(eventId: string): Promise<boolean>
  markEvent(eventId: string): Promise<void>
  getNonce(id: string): Promise<CallbackNonceRecord | undefined>
  putNonce(nonce: CallbackNonceRecord): Promise<void>
}

/** Identity facts extracted from one inbound Feishu event. */
export interface InboundIdentity {
  eventId: string
  messageId: string
  senderOpenId: string
  senderType: string
  chatId: string
  chatType: string
}

type CallbackAction = CallbackNonceRecord['action']

/** Signed state-backed action value sent inside an interactive card. */
export interface CardActionValue {
  nonce: string
  action: CallbackAction
  generation: number
  data?: Record<string, string>
}

interface IdentityOptions {
  botOpenId?: string
  now?: () => number
  pairingCode?: () => string
  nonce?: () => string
  pairingTtlMs?: number
}

interface PendingPairing {
  code: string
  openId: string
  chatId: string
  expiresAt: number
}

const defaultPairingCode = (): string => {
  const code = randomBytes(4).toString('hex').toUpperCase()
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

const sameActionData = (
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean => {
  const expected = left ?? {}
  const actual = right ?? {}
  const keys = Object.keys(expected)
  return keys.length === Object.keys(actual).length
    && keys.every(key => Object.hasOwn(actual, key) && actual[key] === expected[key])
}

/** One-owner admission and state-backed, one-use card-action authorization. */
export class IdentityService {
  private readonly now: () => number
  private readonly code: () => string
  private readonly nonce: () => string
  private readonly pairingTtlMs: number
  private pending: PendingPairing | undefined

  constructor(private readonly store: IdentityStore, private readonly options: IdentityOptions = {}) {
    this.now = options.now ?? Date.now
    this.code = options.pairingCode ?? defaultPairingCode
    this.nonce = options.nonce ?? randomUUID
    this.pairingTtlMs = options.pairingTtlMs ?? 10 * 60_000
  }

  /**
   * Admit the exact paired private-chat owner or issue a pending pairing code.
   * @param input - Normalized sender, chat, and event facts.
   * @returns Owner, unpaired, or rejected admission state.
   */
  async admit(input: InboundIdentity): Promise<
    | { kind: 'owner' }
    | { kind: 'unpaired'; chatId: string; pairingCode: string }
    | { kind: 'rejected' }
  > {
    if (input.chatType !== 'p2p' || input.senderType !== 'user'
      || (this.options.botOpenId !== undefined && input.senderOpenId === this.options.botOpenId)) {
      return { kind: 'rejected' }
    }
    const owner = await this.store.getOwner()
    if (owner === undefined) {
      if (this.pending === undefined || this.pending.expiresAt <= this.now()
        || this.pending.openId !== input.senderOpenId || this.pending.chatId !== input.chatId) {
        this.pending = {
          code: this.code(), openId: input.senderOpenId, chatId: input.chatId,
          expiresAt: this.now() + this.pairingTtlMs,
        }
      }
      return { kind: 'unpaired', chatId: input.chatId, pairingCode: this.pending.code }
    }
    if (owner.openId !== input.senderOpenId || owner.chatId !== input.chatId) return { kind: 'rejected' }
    if (await this.store.hasEvent(input.eventId)) return { kind: 'rejected' }
    return { kind: 'owner' }
  }

  /**
   * Commit a fast-path command event before performing its external effect.
   * @param eventId - Exact Feishu event identifier.
   */
  async commitEvent(eventId: string): Promise<void> {
    if (await this.store.hasEvent(eventId)) throw new Error('Lark event was already handled')
    await this.store.markEvent(eventId)
  }

  /**
   * Confirm the current pending owner from a local Harness action.
   * @param code - Short pairing code shown only in the candidate private chat.
   * @returns The newly persisted owner record.
   */
  async pairOwner(code: string): Promise<OwnerRecord> {
    if (await this.store.getOwner() !== undefined) throw new Error('Lark owner is already paired')
    const pending = this.pending
    if (pending === undefined || pending.expiresAt <= this.now() || pending.code !== code) {
      throw new Error('Lark pairing code is invalid or expired')
    }
    const now = this.now()
    const owner: OwnerRecord = {
      id: 'owner', openId: pending.openId, chatId: pending.chatId,
      generation: 1, pairedAt: now, updatedAt: now,
    }
    await this.store.putOwner(owner)
    this.pending = undefined
    return owner
  }

  /**
   * Read the current paired owner.
   * @returns The currently paired owner, when one exists.
   */
  owner(): Promise<OwnerRecord | undefined> {
    return this.store.getOwner()
  }

  /**
   * Persist and issue one expiring card action.
   * @param action - Bounded action kind.
   * @param generation - Exact current owner generation.
   * @param ttlMs - Action lifetime in milliseconds.
   * @param data - Small action-specific string payload.
   * @returns The card-safe action value.
   */
  async issueAction(
    action: CallbackAction,
    generation: number,
    ttlMs = 5 * 60_000,
    data?: Record<string, string>,
  ): Promise<CardActionValue> {
    const owner = await this.requireOwner()
    if (owner.generation !== generation) throw new Error('Lark card generation is stale')
    const now = this.now()
    const record: CallbackNonceRecord = {
      id: this.nonce(), ownerOpenId: owner.openId, chatId: owner.chatId,
      generation, action, createdAt: now, expiresAt: now + ttlMs,
      ...(data === undefined ? {} : { data }),
    }
    await this.store.putNonce(record)
    return { nonce: record.id, action, generation, ...(data === undefined ? {} : { data }) }
  }

  /**
   * Atomically consume one owner-bound, generation-bound card action.
   * @param input - Acting identity and returned card value.
   * @returns The consumed durable nonce record.
   */
  async admitAction(input: {
    openId: string
    chatId: string
    value: CardActionValue
  }): Promise<CallbackNonceRecord> {
    const owner = await this.requireOwner()
    if (input.openId !== owner.openId || input.chatId !== owner.chatId) throw new Error('Lark card action owner mismatch')
    if (input.value.generation !== owner.generation) throw new Error('Lark card action generation mismatch')
    const record = await this.store.getNonce(input.value.nonce)
    if (record === undefined || record.action !== input.value.action || record.generation !== input.value.generation) {
      throw new Error('Lark card action nonce mismatch')
    }
    if (!sameActionData(record.data, input.value.data)) {
      throw new Error('Lark card action payload mismatch')
    }
    if (record.usedAt !== undefined) throw new Error('Lark card action nonce was already used')
    if (record.expiresAt <= this.now()) throw new Error('Lark card action expired')
    const used = { ...record, usedAt: this.now() }
    await this.store.putNonce(used)
    return used
  }

  private async requireOwner(): Promise<OwnerRecord> {
    const owner = await this.store.getOwner()
    if (owner === undefined) throw new Error('Lark owner is not paired')
    return owner
  }
}
