import * as Lark from '@larksuiteoapi/node-sdk'
import type { Readable } from 'node:stream'
import { DEFAULT_MAX_MEDIA_BYTES } from './config.ts'

/** Supported official API domain brand. */
export type LarkBrand = 'feishu' | 'lark'

interface MessageClient {
  im: {
    message: {
      create(request: unknown): Promise<{ data?: { message_id?: string; chat_id?: string } }>
      patch(request: unknown): Promise<unknown>
    }
    messageResource: {
      get(request: unknown): Promise<{
        getReadableStream(): Readable
        headers?: Record<string, unknown>
      }>
    }
  }
}

interface Dispatcher {
  register(handlers: Record<string, (event: unknown) => unknown>): unknown
}

interface SocketClient {
  start(options: { eventDispatcher: Dispatcher }): void | Promise<void>
  close(options: { force: true }): void
}

/** Injectable official-SDK construction seam used by transport tests. */
export interface LarkSdkFactory {
  domain(brand: string): unknown
  createClient(options: Record<string, unknown>): MessageClient
  createDispatcher(options: Record<string, unknown>): Dispatcher
  createWsClient(options: Record<string, unknown>): SocketClient
}

const officialSdk: LarkSdkFactory = {
  domain: brand => brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
  createClient: options => new Lark.Client(options as unknown as ConstructorParameters<typeof Lark.Client>[0]) as unknown as MessageClient,
  createDispatcher: options => new Lark.EventDispatcher(options),
  createWsClient: options => new Lark.WSClient(
    options as unknown as ConstructorParameters<typeof Lark.WSClient>[0],
  ),
}

/**
 * Resolve one configured brand to the official SDK domain constant.
 * @param brand - Feishu China or global Lark domain.
 * @param sdk - Official-SDK domain resolver or a test seam.
 * @returns The SDK domain constant.
 */
export function resolveLarkDomain(brand: LarkBrand, sdk: Pick<LarkSdkFactory, 'domain'> = officialSdk): unknown {
  return sdk.domain(brand)
}

/**
 * Reduce a connection diagnostic to credential presence and redacted error text.
 * @param input - Credential presence and optional raw error.
 * @returns A browser-safe diagnostic.
 */
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

/** Inbound event handlers registered on the long-connection dispatcher. */
export interface LarkEventHandlers {
  onMessage(event: unknown): unknown
  onCardAction(event: unknown): unknown
}

/** Credentials, domain, lifecycle callbacks, and optional SDK test seam. */
export interface LarkTransportOptions {
  appId: string
  appSecret: string
  domain: LarkBrand
  sdk?: LarkSdkFactory
  onError?: (error: Error) => void
  onConnectionChange?: (connected: boolean) => void
  handshakeTimeoutMs?: number
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

  /**
   * Start and await the official long-connection handshake.
   * @param handlers - Owner-gated message and card-action callbacks.
   * @param signal - Activation-scoped cancellation signal.
   */
  async start(handlers: LarkEventHandlers, signal: AbortSignal): Promise<void> {
    this.stop()
    const dispatcher = this.sdk.createDispatcher({})
    dispatcher.register({
      'im.message.receive_v1': event => handlers.onMessage(event),
      'card.action.trigger': event => handlers.onCardAction(event),
    })
    let settled = false
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const connected = () => {
      this.options.onConnectionChange?.(true)
      if (!settled) {
        settled = true
        resolveReady()
      }
    }
    const failed = (error: Error) => {
      this.options.onConnectionChange?.(false)
      this.options.onError?.(error)
      if (!settled) {
        settled = true
        rejectReady(error)
      }
    }
    const socket = this.sdk.createWsClient({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
      domain: resolveLarkDomain(this.options.domain, this.sdk),
      source: 'deepseek-harness',
      autoReconnect: true,
      handshakeTimeoutMs: this.options.handshakeTimeoutMs ?? 15_000,
      onReady: connected,
      onReconnecting: () => { this.options.onConnectionChange?.(false) },
      onReconnected: connected,
      onError: failed,
    })
    this.socket = socket
    const abort = () => {
      if (!settled) {
        settled = true
        rejectReady(new Error('Lark connection was aborted'))
      }
      this.stop()
    }
    signal.addEventListener('abort', abort, { once: true })
    this.removeAbort = () => { signal.removeEventListener('abort', abort) }
    if (signal.aborted) {
      settled = true
      this.stop()
      return
    }
    try {
      const started = socket.start({ eventDispatcher: dispatcher })
      void Promise.resolve(started).catch((error: unknown) => {
        failed(error instanceof Error ? error : new Error(String(error)))
        this.stop()
      })
      await ready
    } catch (error) {
      this.stop()
      throw error
    }
  }

  /** Force-close this activation's long connection and abort listener. */
  stop(): void {
    this.removeAbort?.()
    this.removeAbort = undefined
    if (this.socket !== undefined) {
      try { this.socket.close({ force: true }) } catch { /* already closed */ }
      this.socket = undefined
    }
    this.options.onConnectionChange?.(false)
  }

  /**
   * Send one bounded text message.
   * @param chatId - Exact paired private-chat identifier.
   * @param text - Owner-facing visible text.
   * @returns The created Feishu message identity.
   */
  async sendText(chatId: string, text: string): Promise<{ messageId: string; chatId: string }> {
    return this.createMessage(chatId, 'text', { text })
  }

  /**
   * Send one interactive card.
   * @param chatId - Exact paired private-chat identifier.
   * @param card - Official interactive-card payload.
   * @returns The created Feishu message identity.
   */
  async sendCard(chatId: string, card: unknown): Promise<{ messageId: string; chatId: string }> {
    return this.createMessage(chatId, 'interactive', card)
  }

  /**
   * Replace one existing interactive card.
   * @param messageId - Exact Feishu card message identifier.
   * @param card - Next official interactive-card payload.
   */
  async updateCard(messageId: string, card: unknown): Promise<void> {
    await this.client.im.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(card) },
    })
  }

  /**
   * Download one image or file owned by an admitted message under a hard bound.
   * @param messageId - Exact owning Feishu message identifier.
   * @param fileKey - Resource key from the admitted event.
   * @param type - Official resource kind.
   * @param maxBytes - Maximum accepted resource size.
   * @returns Resource bytes and normalized content type when available.
   */
  async downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file',
    maxBytes = DEFAULT_MAX_MEDIA_BYTES,
  ): Promise<{ data: Uint8Array; contentType?: string }> {
    const response = await this.client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    })
    const stream = response.getReadableStream()
    const chunks: Buffer[] = []
    let size = 0
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
      size += chunk.byteLength
      if (size > maxBytes) {
        stream.destroy(new Error('Lark resource exceeds the configured 30 MiB limit'))
        throw new Error('Lark resource exceeds the configured 30 MiB limit')
      }
      chunks.push(chunk)
    }
    const rawContentType = response.headers?.['content-type']
    const contentType = typeof rawContentType === 'string'
      ? rawContentType.split(';', 1)[0]?.trim().toLowerCase()
      : undefined
    return {
      data: new Uint8Array(Buffer.concat(chunks)),
      ...(contentType === undefined ? {} : { contentType }),
    }
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
