export interface AdmittedMessage {
  eventId: string
  messageId: string
  openId: string
  chatId: string
  text: string
}

type Admission =
  | { kind: 'owner'; message?: AdmittedMessage }
  | { kind: 'unpaired'; chatId: string; pairingCode: string }
  | { kind: 'rejected' }

interface CommandDependencies {
  transport: { sendText(chatId: string, text: string): Promise<unknown> }
  cards: { sendProjectCard(message: AdmittedMessage): Promise<void> }
  binding: {
    unbind(message: AdmittedMessage): Promise<void>
    statusText(message: AdmittedMessage): Promise<string>
  }
  inbox: {
    enqueue(message: AdmittedMessage): Promise<void>
    steer(text: string, message?: AdmittedMessage): Promise<void>
    stop(message: AdmittedMessage): Promise<void>
  }
  identity: { admit(message: AdmittedMessage): Promise<Admission> }
}

const HELP = '命令：/ 进入项目 · /切换 · /解绑 · /状态 · /插话 <内容> · /停止 · /帮助'

/** Exact command fast path; ordinary text alone reaches the durable Harness inbox. */
export class CommandRouter {
  constructor(private readonly deps: CommandDependencies) {}

  async message(input: AdmittedMessage): Promise<void> {
    const admission = await this.deps.identity.admit(input)
    if (admission.kind === 'rejected') return
    if (admission.kind === 'unpaired') {
      await this.deps.transport.sendText(admission.chatId, `配对码：${admission.pairingCode}`)
      return
    }
    await this.routeOwner(input)
  }

  async menuAction(input: AdmittedMessage): Promise<void> {
    const admission = await this.deps.identity.admit(input)
    if (admission.kind !== 'owner') return
    if (input.text === '进入项目') await this.deps.cards.sendProjectCard(input)
  }

  private async routeOwner(message: AdmittedMessage): Promise<void> {
    const text = message.text.trim()
    if (text === '/' || text === '/进入' || text === '/切换') {
      await this.deps.cards.sendProjectCard(message)
      return
    }
    if (text === '/解绑') {
      await this.deps.binding.unbind(message)
      await this.deps.transport.sendText(message.chatId, '已解绑当前会话。')
      return
    }
    if (text === '/状态') {
      await this.deps.transport.sendText(message.chatId, await this.deps.binding.statusText(message))
      return
    }
    if (text === '/帮助') {
      await this.deps.transport.sendText(message.chatId, HELP)
      return
    }
    if (text.startsWith('/插话 ')) {
      const body = text.slice('/插话 '.length).trim()
      if (body.length > 0) await this.deps.inbox.steer(body)
      else await this.deps.transport.sendText(message.chatId, '用法：/插话 <内容>')
      return
    }
    if (text === '/停止') {
      await this.deps.inbox.stop(message)
      return
    }
    if (text.startsWith('/')) {
      await this.deps.transport.sendText(message.chatId, HELP)
      return
    }
    await this.deps.inbox.enqueue(message)
  }
}
