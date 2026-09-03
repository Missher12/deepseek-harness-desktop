import { readFile } from 'node:fs/promises'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import {
  MAX_HOP,
  MAX_MESSAGE_BYTES,
  RECEIPT_TTL_MS,
  receiptSchema,
  relayEnvelopeSchema,
  sessionMessengerDomainSpec,
} from '../src/spec.ts'

const prepared = {
  id: 'delivery-1',
  sourceSessionId: 'source',
  targetSessionId: 'target',
  messageId: 'message-1',
  mode: 'inject',
  status: 'prepared',
  createdAt: 1_000,
  updatedAt: 1_000,
  expiresAt: 1_000 + RECEIPT_TTL_MS,
  replyToken: 'reply-token',
  hop: 0,
  wakeRequested: false,
  envelope: { body: 'hello' },
} as const

describe('session messenger receipt boundary', () => {
  it('scaffolds one public dual-face Web package', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string
      version: string
      exports: Record<string, unknown>
      dsh: { bundle: { patch: string }; client: { platform: string } }
      files: string[]
    }
    expect(manifest.name).toBe('@deepseek-ai/dsh-session-messenger')
    expect(manifest.version).toBe('0.1.2-alpha.5')
    expect(Object.keys(manifest.exports)).toEqual(expect.arrayContaining([
      '.', './client', './cordis.patch.yml', './package.json',
    ]))
    expect(manifest.dsh).toMatchObject({
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web' },
    })
    expect(manifest.files).toEqual([
      'lib/index.js',
      'lib/client.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ])
  })

  it('publishes one canonical bundle patch row', async () => {
    const patch = yaml.load(
      await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'),
    )

    expect(patch).toEqual([{
      insert: [{
        id: 'session-messenger',
        name: '@deepseek-ai/dsh-session-messenger',
      }],
    }])
  })

  it('declares the one versioned receipt domain', () => {
    expect(sessionMessengerDomainSpec.name).toBe('session_messenger')
    expect(sessionMessengerDomainSpec.version).toBe(1)
    expect(Object.keys(sessionMessengerDomainSpec.tables)).toEqual(['receipts'])
  })

  it('requires the bounded relay envelope on recoverable statuses', () => {
    expect(receiptSchema.parse(prepared)).toMatchObject(prepared)
    expect(receiptSchema.safeParse({ ...prepared, envelope: undefined }).success).toBe(false)
    expect(receiptSchema.safeParse({
      ...prepared,
      status: 'delivery-recovery-pending',
      recoveryReason: 'post-enqueue-status-write-indeterminate',
      envelope: undefined,
    }).success).toBe(false)
  })

  it('removes message bodies from delivered and terminal records', () => {
    const delivered = receiptSchema.parse({
      ...prepared,
      status: 'delivered',
      deliveredAt: 1_001,
    })
    const rejected = receiptSchema.parse({
      ...prepared,
      status: 'rejected',
      settledAt: 1_001,
      errorCode: 'target-archived',
    })
    expect(delivered).not.toHaveProperty('envelope')
    expect(rejected).not.toHaveProperty('envelope')
  })

  it('enforces UTF-8 bytes rather than JavaScript code units', () => {
    expect(relayEnvelopeSchema.safeParse({ body: 'x'.repeat(MAX_MESSAGE_BYTES) }).success).toBe(true)
    expect(relayEnvelopeSchema.safeParse({ body: '鲸'.repeat(MAX_MESSAGE_BYTES / 3 + 1) }).success).toBe(false)
  })

  it('accepts only the exact 24-hour lifetime and hop range 0 through 8', () => {
    expect(receiptSchema.safeParse({ ...prepared, hop: MAX_HOP }).success).toBe(true)
    expect(receiptSchema.safeParse({ ...prepared, hop: -1 }).success).toBe(false)
    expect(receiptSchema.safeParse({ ...prepared, hop: MAX_HOP + 1 }).success).toBe(false)
    expect(receiptSchema.safeParse({ ...prepared, expiresAt: prepared.expiresAt - 1 }).success).toBe(false)
    expect(receiptSchema.safeParse({ ...prepared, expiresAt: prepared.expiresAt + 1 }).success).toBe(false)
  })

  it('discriminates every durable status and rejects unknown states', () => {
    const statuses = [
      'prepared',
      'delivery-recovery-pending',
      'delivered',
      'claimed',
      'discarded',
      'failed',
      'aborted',
      'rejected',
      'expired',
      'replied',
    ] as const
    for (const status of statuses) {
      const candidate = status === 'prepared'
        ? prepared
        : status === 'delivery-recovery-pending'
          ? { ...prepared, status, recoveryReason: 'indeterminate' }
          : status === 'delivered'
            ? { ...prepared, status, deliveredAt: 1_001 }
            : status === 'claimed'
              ? { ...prepared, status, deliveredAt: 1_001, claimedAt: 1_002 }
              : status === 'replied'
                ? { ...prepared, status, deliveredAt: 1_001, repliedAt: 1_002, replyDeliveryId: 'delivery-2' }
                : { ...prepared, status, settledAt: 1_002, errorCode: `delivery-${status}` }
      expect(receiptSchema.safeParse(candidate).success, status).toBe(true)
    }
    expect(receiptSchema.safeParse({ ...prepared, status: 'mystery' }).success).toBe(false)
  })
})
