import { describe, expect, test } from 'vitest'
import { IdentityService, type IdentityStore } from '../src/identity.ts'
import type { CallbackNonceRecord, OwnerRecord } from '../src/state.ts'

function memoryStore(): IdentityStore {
  let owner: OwnerRecord | undefined
  const seen = new Set<string>()
  const nonces = new Map<string, CallbackNonceRecord>()
  return {
    getOwner: async () => owner,
    putOwner: async (value) => { owner = value },
    hasEvent: async id => seen.has(id),
    markEvent: async (id) => { seen.add(id) },
    getNonce: async id => nonces.get(id),
    putNonce: async (value) => { nonces.set(value.id, value) },
  }
}

const dm = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'evt_1', messageId: 'om_1', senderOpenId: 'ou_owner', senderType: 'user',
  chatId: 'oc_dm', chatType: 'p2p', ...overrides,
})

describe('owner identity fence', () => {
  test('rejects groups, self echoes, and non-user events before pairing', async () => {
    const identity = new IdentityService(memoryStore(), { botOpenId: 'ou_bot', pairingCode: () => 'ABCD-1234' })
    await expect(identity.admit(dm({ chatType: 'group' }))).resolves.toEqual({ kind: 'rejected' })
    await expect(identity.admit(dm({ senderOpenId: 'ou_bot' }))).resolves.toEqual({ kind: 'rejected' })
    await expect(identity.admit(dm({ senderType: 'app' }))).resolves.toEqual({ kind: 'rejected' })
  })

  test('pairs exactly one pending private user with no project disclosure', async () => {
    const store = memoryStore()
    const identity = new IdentityService(store, { pairingCode: () => 'ABCD-1234', now: () => 1000 })
    await expect(identity.admit(dm())).resolves.toEqual({
      kind: 'unpaired', chatId: 'oc_dm', pairingCode: 'ABCD-1234',
    })
    await expect(identity.pairOwner('ABCD-1234')).resolves.toMatchObject({
      id: 'owner', openId: 'ou_owner', chatId: 'oc_dm', generation: 1,
    })
    await expect(identity.pairOwner('ABCD-1234')).rejects.toThrow(/already paired/)
  })

  test('requires exact owner and chat and durably deduplicates accepted events', async () => {
    const store = memoryStore()
    const identity = new IdentityService(store, { pairingCode: () => 'ABCD-1234', now: () => 1000 })
    await identity.admit(dm())
    await identity.pairOwner('ABCD-1234')
    await expect(identity.admit(dm({ eventId: 'evt_2' }))).resolves.toMatchObject({ kind: 'owner' })
    await identity.commitEvent('evt_2')
    await expect(identity.admit(dm({ eventId: 'evt_3', chatId: 'oc_other' }))).resolves.toEqual({ kind: 'rejected' })
    await expect(identity.admit(dm({ eventId: 'evt_2' }))).resolves.toEqual({ kind: 'rejected' })
  })

  test('card actions are exact-owner, current-generation, expiring, and one-use', async () => {
    let now = 1000
    const store = memoryStore()
    const identity = new IdentityService(store, {
      pairingCode: () => 'ABCD-1234', nonce: () => 'nonce-1', now: () => now,
    })
    await identity.admit(dm())
    await identity.pairOwner('ABCD-1234')
    const value = await identity.issueAction('select-session', 1, 500)
    await expect(identity.admitAction({ openId: 'ou_other', chatId: 'oc_dm', value })).rejects.toThrow(/owner/)
    await expect(identity.admitAction({ openId: 'ou_owner', chatId: 'oc_dm', value: { ...value, generation: 2 } }))
      .rejects.toThrow(/generation/)
    await expect(identity.admitAction({ openId: 'ou_owner', chatId: 'oc_dm', value })).resolves.toMatchObject({
      action: 'select-session', generation: 1,
    })
    await expect(identity.admitAction({ openId: 'ou_owner', chatId: 'oc_dm', value })).rejects.toThrow(/used/)
    const second = await identity.issueAction('select-project', 1, 500)
    now = 2000
    await expect(identity.admitAction({ openId: 'ou_owner', chatId: 'oc_dm', value: second })).rejects.toThrow(/expired/)
  })

  test('accepts an exact card payload regardless of object key order', async () => {
    const store = memoryStore()
    const identity = new IdentityService(store, {
      pairingCode: () => 'ABCD-1234', nonce: () => 'nonce-1', now: () => 1000,
    })
    await identity.admit(dm())
    await identity.pairOwner('ABCD-1234')
    const value = await identity.issueAction('select-session', 1, 500, {
      workspaceId: 'workspace-1', sessionId: 'session-1',
    })

    await expect(identity.admitAction({
      openId: 'ou_owner',
      chatId: 'oc_dm',
      value: {
        ...value,
        data: { sessionId: 'session-other', workspaceId: 'workspace-1' },
      },
    })).rejects.toThrow(/payload/)
    await expect(identity.admitAction({
      openId: 'ou_owner',
      chatId: 'oc_dm',
      value: {
        ...value,
        data: { sessionId: 'session-1', workspaceId: 'workspace-1' },
      },
    })).resolves.toMatchObject({ action: 'select-session' })
  })
})
