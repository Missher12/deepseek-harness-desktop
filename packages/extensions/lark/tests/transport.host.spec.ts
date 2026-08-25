import { describe, expect, test, vi } from 'vitest'
import { LarkTransport, resolveLarkDomain, redactDiagnostic } from '../src/transport.ts'

function fakeSdk() {
  const register = vi.fn()
  const start = vi.fn(async () => {})
  const close = vi.fn()
  const create = vi.fn(async () => ({ data: { message_id: 'om_1', chat_id: 'oc_1' } }))
  const patch = vi.fn(async () => ({}))
  return {
    register, start, close, create, patch,
    factory: {
      domain: (brand: string) => `domain:${brand}`,
      createClient: vi.fn(() => ({ im: { message: { create, patch } } })),
      createDispatcher: vi.fn(() => ({ register })),
      createWsClient: vi.fn(() => ({ start, close })),
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

    expect(sdk.register).toHaveBeenCalledWith(expect.objectContaining({
      'im.message.receive_v1': expect.any(Function),
      'card.action.trigger': expect.any(Function),
    }))
    expect(Object.keys(sdk.register.mock.calls[0]![0])).toEqual(['im.message.receive_v1', 'card.action.trigger'])
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
    expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({
      params: { receive_id_type: 'chat_id' },
      data: expect.objectContaining({ receive_id: 'oc_1', msg_type: 'interactive' }),
    }))
    expect(sdk.patch).toHaveBeenCalledWith(expect.objectContaining({ path: { message_id: 'om_1' } }))
  })
})
