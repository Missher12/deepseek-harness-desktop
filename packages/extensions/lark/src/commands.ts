import type { QueueAttachment } from './state.ts'

/** Normalized Feishu message facts consumed after identity admission. */
export interface AdmittedMessage {
  eventId: string
  messageId: string
  openId: string
  chatId: string
  text: string
  media?: { kind: 'image' | 'file'; key: string; name: string }
  attachments?: readonly QueueAttachment[]
  senderType?: string
  chatType?: string
  appId?: string
}

type Admission =
  | { kind: 'owner'; message?: AdmittedMessage }
  | { kind: 'unpaired'; chatId: string; pairingCode: string }
  | { kind: 'rejected' }

interface CommandDependencies {
  transport: { sendText(chatId: string, text: string): Promise<unknown> }
  cards: { sendProjectCard(message: AdmittedMessage): Promise<void> }
  commandCenter: {
    send(message: AdmittedMessage): Promise<void>
    handleText(message: AdmittedMessage, text: string): Promise<'handled' | 'enqueue' | 'unknown'>
  }
  binding: {
    unbind(message: AdmittedMessage): Promise<void>
    statusText(message: AdmittedMessage): Promise<string>
  }
  inbox: {
    enqueue(message: AdmittedMessage): Promise<'accepted' | 'duplicate' | 'unbound'>
    steer(text: string, message?: AdmittedMessage): Promise<void>
    stop(message: AdmittedMessage): Promise<void>
  }
  identity: {
    admit(message: AdmittedMessage): Promise<Admission>
    commitEvent?(eventId: string): Promise<void>
  }
  prepareOwnerMessage?(message: AdmittedMessage): Promise<AdmittedMessage>
}

const HELP = '发送 / 查看完整 Harness 命令中心。'

/** Exact command fast path; ordinary text alone reaches the durable Harness inbox. */
export class CommandRouter {
  constructor(private readonly deps: CommandDependencies) {}

  /**
   * Admit and route one normalized Feishu message.
   * @param input - Inbound message and exact identity facts.
   */
  async message(input: AdmittedMessage): Promise<void> {
    const admission = await this.deps.identity.admit(input)
    if (admission.kind === 'rejected') return
    if (admission.kind === 'unpaired') {
      await this.deps.transport.sendText(admission.chatId, `配对码：${admission.pairingCode}`)
      return
    }
    const prepared = this.deps.prepareOwnerMessage === undefined
      ? input
      : await this.deps.prepareOwnerMessage(input)
    await this.routeOwner(prepared)
  }

  /**
   * Route the fixed bot-menu project entry action.
   * @param input - Inbound menu event normalized as a message.
   */
  async menuAction(input: AdmittedMessage): Promise<void> {
    const admission = await this.deps.identity.admit(input)
    if (admission.kind !== 'owner') return
    if (input.text === '进入项目') {
      await this.commit(input.eventId)
      await this.deps.cards.sendProjectCard(input)
    }
  }

  private async routeOwner(message: AdmittedMessage): Promise<void> {
    const text = message.text.trim()
    if (text === '/') {
      await this.commit(message.eventId)
      await this.deps.commandCenter.send(message)
      return
    }
    if (text === '/进入' || text === '/切换') {
      await this.commit(message.eventId)
      await this.deps.cards.sendProjectCard(message)
      return
    }
    if (text === '/解绑') {
      await this.commit(message.eventId)
      await this.deps.binding.unbind(message)
      await this.deps.transport.sendText(message.chatId, '已解绑当前会话。')
      return
    }
    if (text === '/状态') {
      await this.commit(message.eventId)
      await this.deps.transport.sendText(message.chatId, await this.deps.binding.statusText(message))
      return
    }
    if (text === '/帮助') {
      await this.commit(message.eventId)
      await this.deps.commandCenter.send(message)
      return
    }
    if (text.startsWith('/插话 ')) {
      await this.commit(message.eventId)
      const body = text.slice('/插话 '.length).trim()
      if (body.length > 0) await this.deps.inbox.steer(body)
      else await this.deps.transport.sendText(message.chatId, '用法：/插话 <内容>')
      return
    }
    if (text === '/停止') {
      await this.commit(message.eventId)
      await this.deps.inbox.stop(message)
      return
    }
    if (text.startsWith('/')) {
      const result = await this.deps.commandCenter.handleText(message, text)
      if (result === 'enqueue') {
        const queued = await this.deps.inbox.enqueue(message)
        if (queued === 'unbound') {
          await this.deps.transport.sendText(message.chatId, await this.deps.binding.statusText(message))
        }
      } else if (result === 'unknown') {
        await this.commit(message.eventId)
        await this.deps.transport.sendText(message.chatId, HELP)
      }
      return
    }
    const result = await this.deps.inbox.enqueue(message)
    if (result === 'unbound') {
      await this.deps.transport.sendText(message.chatId, await this.deps.binding.statusText(message))
    }
  }

  private async commit(eventId: string): Promise<void> {
    await this.deps.identity.commitEvent?.(eventId)
  }
}
