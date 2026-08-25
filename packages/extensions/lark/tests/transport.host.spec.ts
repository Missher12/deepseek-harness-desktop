import { describe, expect, test, vi } from 'vitest'
import { Readable } from 'node:stream'
import { LarkTransport, resolveLarkDomain, redactDiagnostic } from '../src/transport.ts'

function fakeSdk() {
  let registered: Record<string, (event: unknown) => unknown> = {}
  const register = vi.fn((handlers: Record<string, (event: unknown) => unknown>) => {
    registered = handlers
  })
  const start = vi.fn(async () => {})
  const close = vi.fn()
  const create = vi.fn(async (_request: unknown) => ({ data: { message_id: 'om_1', chat_id: 'oc_1' } }))
  const patch = vi.fn(async (_request: unknown) => ({}))
  const getResource = vi.fn(async (_request: unknown) => ({
    getReadableStream: () => Readable.from([Buffer.from('resource')]),
    headers: { 'content-type': 'image/png; charset=binary' },
  }))
  return {
    register, start, close, create, patch, getResource,
    registered: () => registered,
    factory: {
      domain: (brand: string) => `domain:${brand}`,
      createClient: vi.fn(() => ({ im: { message: { create, patch }, messageResource: { get: getResource } } })),
      createDispatcher: vi.fn(() => ({ register })),
      createWsClient: vi.fn((options: Record<string, unknown>) => ({
        start: async () => {
          await start()
          ;(options.onReady as (() => void) | undefined)?.()
        },
        close,
      })),
    },
  }
}

describe('LarkTransport', () => {
  test('requires both credentials without exposing either value', () => {
    const sdk = fakeSdk()
    expect(() => new LarkTransport({ appId: '', appSecret: 'secret-value', domain: 'feishu', sdk: sdk.factory }))
      .toThrow('Lark credentials are not configured')
    expect(redactDiagnostic({ appId: 'cli_abc', appSecret: 'secret-value', error: 'bad secret-value' }))
      .toEqual({ credentialStatus: 'configured', error: 'bad [REDACTED]' })
  })

  test('maps Feishu and Lark explicitly', () => {
    expect(resolveLarkDomain('feishu', { domain: b => `domain:${b}` })).toBe('domain:feishu')
    expect(resolveLarkDomain('lark', { domain: b => `domain:${b}` })).toBe('domain:lark')
  })

  test('registers only message and card actions and force-closes on abort', async () => {
    const sdk = fakeSdk()
    const abort = new AbortController()
    const transport = new LarkTransport({
      appId: 'cli_app', appSecret: 'secret-value', domain: 'feishu', sdk: sdk.factory,
    })
    await transport.start({ onMessage: vi.fn(), onCardAction: vi.fn() }, abort.signal)

    expect(Object.keys(sdk.registered())).toEqual(['im.message.receive_v1', 'card.action.trigger'])
    expect(typeof sdk.registered()['im.message.receive_v1']).toBe('function')
    expect(typeof sdk.registered()['card.action.trigger']).toBe('function')
    abort.abort()
    expect(sdk.close).toHaveBeenCalledWith({ force: true })
  })

  test('sends and patches interactive cards through the official client shape', async () => {
    const sdk = fakeSdk()
    const transport = new LarkTransport({
      appId: 'cli_app', appSecret: 'secret-value', domain: 'lark', sdk: sdk.factory,
    })
    await expect(transport.sendCard('oc_1', { elements: [] })).resolves.toEqual({ messageId: 'om_1', chatId: 'oc_1' })
    await transport.updateCard('om_1', { elements: [{ tag: 'markdown', content: 'ok' }] })
    expect(sdk.create.mock.calls[0]?.[0]).toMatchObject({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_1', msg_type: 'interactive' },
    })
    expect(sdk.patch.mock.calls[0]?.[0]).toMatchObject({ path: { message_id: 'om_1' } })
  })

  test('downloads message resources through the owning message with a hard byte bound', async () => {
    const sdk = fakeSdk()
    const transport = new LarkTransport({
      appId: 'cli_app', appSecret: 'secret-value', domain: 'feishu', sdk: sdk.factory,
    })
    await expect(transport.downloadMessageResource('om_1', 'img_1', 'image', 16)).resolves.toEqual({
      data: new Uint8Array(Buffer.from('resource')), contentType: 'image/png',
    })
    expect(sdk.getResource).toHaveBeenCalledWith({
      path: { message_id: 'om_1', file_key: 'img_1' }, params: { type: 'image' },
    })
    await expect(transport.downloadMessageResource('om_1', 'img_1', 'image', 2))
      .rejects.toThrow(/30 MiB limit/)
  })
})
