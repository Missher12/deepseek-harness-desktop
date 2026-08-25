import { describe, expect, test } from 'vitest'
import {
  bindingRecordSchema,
  callbackNonceRecordSchema,
  cardRecordSchema,
  larkDomainSpec,
  ownerRecordSchema,
  queueRecordSchema,
  stagedFileRecordSchema,
} from '../src/state.ts'

const now = 1_777_111_000_000

describe('dsh-lark durable state v1', () => {
  test('declares only plugin-owned records and no secret slot', () => {
    expect(larkDomainSpec.name).toBe('dsh_lark')
    expect(larkDomainSpec.version).toBe(1)
    expect(Object.keys(larkDomainSpec.tables).sort()).toEqual([
      'bindings', 'cards', 'files', 'inbox', 'nonces', 'owners',
    ])
    expect(JSON.stringify(larkDomainSpec).toLowerCase()).not.toContain('secret')
  })

  test('validates the owner and exact active binding', () => {
    expect(ownerRecordSchema.parse({
      id: 'owner', openId: 'ou_owner', chatId: 'oc_dm', generation: 2,
      pairedAt: now, updatedAt: now,
    })).toMatchObject({ id: 'owner', generation: 2 })

    expect(bindingRecordSchema.parse({
      id: 'owner', ownerOpenId: 'ou_owner', chatId: 'oc_dm',
      projectPath: '/Users/owner/project', sessionId: 'session-1', generation: 3,
      state: 'active', boundAt: now, updatedAt: now,
    })).toMatchObject({ state: 'active', sessionId: 'session-1' })
  })

  test('validates write-ahead queue lifecycle records', () => {
    const common = {
      id: 'event-1', eventId: 'event-1', sequence: 1, bindingGeneration: 3,
      sessionId: 'session-1', harnessMessageId: 'message-1', text: 'continue',
      createdAt: now, updatedAt: now,
    }
    expect(queueRecordSchema.parse({ ...common, status: 'prepared' }))
      .toMatchObject({ status: 'prepared', sequence: 1 })
    expect(queueRecordSchema.parse({ ...common, status: 'claimed', queuedAt: now, claimedAt: now, turnId: 'turn-1' }))
      .toMatchObject({ status: 'claimed', turnId: 'turn-1' })
    expect(queueRecordSchema.parse({
      ...common, status: 'terminal', queuedAt: now, claimedAt: now,
      terminalAt: now, turnId: 'turn-1', outcome: 'completed',
    })).toMatchObject({ status: 'terminal', outcome: 'completed' })
  })

  test('validates card, nonce, and private staged-file metadata', () => {
    expect(cardRecordSchema.parse({
      id: 'turn-1', sessionId: 'session-1', messageId: 'om_card', revision: 4,
      status: 'streaming', createdAt: now, updatedAt: now,
    }).revision).toBe(4)
    expect(callbackNonceRecordSchema.parse({
      id: 'nonce-1', ownerOpenId: 'ou_owner', chatId: 'oc_dm', generation: 3,
      action: 'select-session', expiresAt: now + 60_000, createdAt: now,
    }).action).toBe('select-session')
    expect(stagedFileRecordSchema.parse({
      id: 'file-1', path: '/private/dsh/lark/files/file-1.pdf', name: 'file.pdf',
      size: 1024, sha256: 'a'.repeat(64), expiresAt: now + 60_000, createdAt: now,
    }).size).toBe(1024)
  })

  test('rejects invalid ordering and unsafe staged paths', () => {
    expect(queueRecordSchema.safeParse({
      id: 'x', eventId: 'x', sequence: 0, bindingGeneration: 1,
      sessionId: 's', harnessMessageId: 'm', text: 'x', status: 'prepared',
      createdAt: now, updatedAt: now,
    }).success).toBe(false)
    expect(stagedFileRecordSchema.safeParse({
      id: 'f', path: '../project/file', name: 'file', size: 1,
      sha256: 'a'.repeat(64), expiresAt: now, createdAt: now,
    }).success).toBe(false)
  })
})
