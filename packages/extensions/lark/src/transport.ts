import * as Lark from '@larksuiteoapi/node-sdk'

export type LarkBrand = 'feishu' | 'lark'

interface MessageClient {
  im: {
    message: {
      create(request: unknown): Promise<{ data?: { message_id?: string; chat_id?: string } }>
      patch(request: unknown): Promise<unknown>
    }
  }
}

interface Dispatcher {
  register(handlers: Record<string, (event: unknown) => unknown>): unknown
}

interface SocketClient {
  start(options: { eventDispatcher: Dispatcher }): Promise<unknown> | unknown
  close(options: { force: true }): void
}

export interface LarkSdkFactory {
  domain(brand: string): unknown
  createClient(options: Record<string, unknown>): MessageClient
  createDispatcher(options: Record<string, unknown>): Dispatcher
  createWsClient(options: Record<string, unknown>): SocketClient
}

const officialSdk: LarkSdkFactory = {
  domain: brand => brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
  createClient: options => new Lark.Client(options as unknown as ConstructorParameters<typeof Lark.Client>[0]) as unknown as MessageClient,
  createDispatcher: options => new Lark.EventDispatcher(options) as unknown as Dispatcher,
  createWsClient: options => new Lark.WSClient(
    options as unknown as ConstructorParameters<typeof Lark.WSClient>[0],
  ) as unknown as SocketClient,
}

export function resolveLarkDomain(brand: LarkBrand, sdk: Pick<LarkSdkFactory, 'domain'> = officialSdk): unknown {
  return sdk.domain(brand)
}

export function redactDiagnostic(input: {
  appId?: string
  appSecret?: string
  error?: string
}): { credentialStatus: 'configured' | 'missing'; error?: string } {
  const configured = Boolean(input.appId && input.appSecret)
  const error = input.error === undefined
    ? undefined
    : input.appSecret
      ? input.error.replaceAll(input.appSecret, '[REDACTED]')
      : input.error
  return error === undefined
    ? { credentialStatus: configured ? 'configured' : 'missing' }
    : { credentialStatus: configured ? 'configured' : 'missing', error }
}

export interface LarkEventHandlers {
  onMessage(event: unknown): unknown
  onCardAction(event: unknown): unknown
}

export interface LarkTransportOptions {
  appId: string
  appSecret: string
  domain: LarkBrand
  sdk?: LarkSdkFactory
  onError?: (error: Error) => void
}

/** Official-SDK transport with an explicit, abort-bound WebSocket lifetime. */
export class LarkTransport {
  private readonly sdk: LarkSdkFactory
  private readonly client: MessageClient
  private socket: SocketClient | undefined
  private removeAbort: (() => void) | undefined

  constructor(private readonly options: LarkTransportOptions) {
    if (!options.appId || !options.appSecret) throw new Error('Lark credentials are not configured')
    this.sdk = options.sdk ?? officialSdk
    this.client = this.sdk.createClient({
      appId: options.appId,
      appSecret: options.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain: resolveLarkDomain(options.domain, this.sdk),
      source: 'deepseek-harness',
    })
  }

  async start(handlers: LarkEventHandlers, signal: AbortSignal): Promise<void> {
    this.stop()
    const dispatcher = this.sdk.createDispatcher({})
    dispatcher.register({
      'im.message.receive_v1': handlers.onMessage,
      'card.action.trigger': handlers.onCardAction,
    })
    const socket = this.sdk.createWsClient({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
      domain: resolveLarkDomain(this.options.domain, this.sdk),
      source: 'deepseek-harness',
      onError: (error: Error) => this.options.onError?.(error),
    })
    this.socket = socket
    const abort = () => this.stop()
    signal.addEventListener('abort', abort, { once: true })
    this.removeAbort = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) return abort()
    try {
      const started = socket.start({ eventDispatcher: dispatcher })
      void Promise.resolve(started).catch((error: unknown) => {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
        this.stop()
      })
    } catch (error) {
      this.stop()
      throw error
    }
  }

  stop(): void {
    this.removeAbort?.()
    this.removeAbort = undefined
    if (this.socket !== undefined) {
      try { this.socket.close({ force: true }) } catch { /* already closed */ }
      this.socket = undefined
    }
  }

  async sendText(chatId: string, text: string): Promise<{ messageId: string; chatId: string }> {
    return this.createMessage(chatId, 'text', { text })
  }

  async sendCard(chatId: string, card: unknown): Promise<{ messageId: string; chatId: string }> {
    return this.createMessage(chatId, 'interactive', card)
  }

  async updateCard(messageId: string, card: unknown): Promise<void> {
    await this.client.im.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(card) },
    })
  }

  private async createMessage(
    chatId: string,
    type: 'text' | 'interactive',
    content: unknown,
  ): Promise<{ messageId: string; chatId: string }> {
    const response = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: type, content: JSON.stringify(content) },
    })
    return {
      messageId: response.data?.message_id ?? '',
      chatId: response.data?.chat_id ?? chatId,
    }
  }
}
