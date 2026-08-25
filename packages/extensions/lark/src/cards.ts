import type { TurnProjectionState } from './projection.ts'
import type { AdmittedMessage } from './commands.ts'
import type { BindingController, SessionRow } from './binding.ts'
import type { CardActionValue, IdentityService } from './identity.ts'

interface CardTransport {
  sendCard(chatId: string, card: unknown): Promise<{ messageId: string; chatId: string }>
  updateCard(messageId: string, card: unknown): Promise<void>
  sendText(chatId: string, text: string): Promise<unknown>
}

interface StreamingCardOptions extends CardTransport {
  throttleMs: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const statusText: Record<TurnProjectionState['status'], string> = {
  placeholder: '准备中', streaming: '开发中', completed: '已完成', cancelled: '已停止', failed: '失败',
}

const elapsed = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)}s`

const usageTotal = (state: TurnProjectionState): number | undefined => {
  const usage = state.usage
  if (usage === undefined) return undefined
  return usage.inputTokens + usage.outputTokens
    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/** One Feishu card payload; it contains visible answer text and safe summaries only. */
export function renderTurnCard(state: TurnProjectionState): unknown {
  const toolLines = state.tools.map(tool =>
    `${tool.status === 'running' ? '◌' : tool.status === 'completed' ? '✓' : '✕'} ${tool.title}`)
  const pendingApprovals = state.approvals
    .filter(approval => approval.status === 'pending')
  const approvals = pendingApprovals.map(approval => `待确认：${approval.toolName}`)
  const tokenTotal = usageTotal(state)
  const details = `耗时 ${elapsed(state.elapsedMs)} · Token ${tokenTotal ?? '暂不可用'}`
  const content = [
    state.text || '正在连接 Harness 会话…',
    toolLines.length === 0 ? '' : `\n---\n${toolLines.join('\n')}`,
    approvals.length === 0 ? '' : `\n${approvals.join('\n')}`,
    `\n---\n${details}`,
  ].join('')
  return {
    config: { wide_screen_mode: true, update_multi: true, enable_forward: false },
    header: {
      template: state.status === 'failed' ? 'red' : state.status === 'completed' ? 'green' : 'blue',
      title: { tag: 'plain_text', content: `DeepSeek Harness · ${statusText[state.status]}` },
    },
    elements: [
      { tag: 'markdown', content },
      ...pendingApprovals.flatMap(approval => approval.allowValue === undefined || approval.denyValue === undefined
        ? []
        : [{
          tag: 'action', layout: 'bisected', actions: [
            { tag: 'button', type: 'primary', text: { tag: 'plain_text', content: '允许一次' }, value: approval.allowValue },
            { tag: 'button', type: 'danger', text: { tag: 'plain_text', content: '拒绝' }, value: approval.denyValue },
          ],
        }]),
    ],
  }
}

class TurnCardStream {
  private current: TurnProjectionState
  private lastFlush: number
  private failed = false
  private tail = Promise.resolve()

  constructor(
    private readonly options: Required<Pick<StreamingCardOptions, 'throttleMs' | 'now' | 'sleep'>> & CardTransport,
    private readonly chatId: string,
    private readonly messageId: string,
    initial: TurnProjectionState,
  ) {
    this.current = initial
    this.lastFlush = options.now()
  }

  update(next: TurnProjectionState, final = false): Promise<void> {
    if (next.text.length < this.current.text.length || !next.text.startsWith(this.current.text)) return Promise.resolve()
    this.current = structuredClone(next)
    const operation = this.tail.then(() => this.flush(final), () => this.flush(final))
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async flush(final: boolean): Promise<void> {
    if (this.failed) return
    const wait = final ? 0 : Math.max(0, this.options.throttleMs - (this.options.now() - this.lastFlush))
    if (wait > 0) await this.options.sleep(wait)
    try {
      await this.options.updateCard(this.messageId, renderTurnCard(this.current))
      this.lastFlush = this.options.now()
    } catch {
      this.failed = true
      const suffix = this.current.text.length > 4000 ? '…' : ''
      await this.options.sendText(this.chatId, `${this.current.text.slice(0, 4000 - suffix.length)}${suffix}`)
    }
  }
}

/** Creates exactly one message card per turn and owns its monotonic updates. */
export class StreamingCardController {
  private readonly resolved: Required<Pick<StreamingCardOptions, 'throttleMs' | 'now' | 'sleep'>> & CardTransport

  constructor(options: StreamingCardOptions) {
    this.resolved = {
      ...options,
      now: options.now ?? Date.now,
      sleep: options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
    }
  }

  async open(chatId: string, initial: TurnProjectionState): Promise<TurnCardStream> {
    const sent = await this.resolved.sendCard(chatId, renderTurnCard(initial))
    return new TurnCardStream(this.resolved, chatId, sent.messageId, structuredClone(initial))
  }
}

interface SelectionTransport {
  sendCard(chatId: string, card: unknown): Promise<unknown>
  sendText(chatId: string, text: string): Promise<unknown>
}

/** No-model project/session picker with state-backed, one-use action values. */
export class SelectionCardService {
  constructor(
    private readonly binding: BindingController,
    private readonly identity: IdentityService,
    private readonly transport: SelectionTransport,
  ) {}

  async sendProjectCard(message: AdmittedMessage): Promise<void> {
    const owner = await this.identity.owner()
    if (owner === undefined) throw new Error('Lark owner is not paired')
    const projects = await this.binding.listProjects()
    const actions = await Promise.all(projects.map(async project => ({
      tag: 'button',
      text: { tag: 'plain_text', content: project.title },
      type: 'primary',
      value: await this.identity.issueAction(
        'select-project', owner.generation, 5 * 60_000, { workspaceId: project.workspaceId },
      ),
    })))
    const paths = projects.map(project => `**${project.title}**\n${project.path}`).join('\n\n') || '没有可选项目。'
    await this.transport.sendCard(message.chatId, selectionCard('进入项目', paths, actions))
  }

  async handleAction(input: { openId: string; value: CardActionValue }): Promise<void> {
    const owner = await this.identity.owner()
    if (owner === undefined) throw new Error('Lark owner is not paired')
    const action = await this.identity.admitAction({
      openId: input.openId, chatId: owner.chatId, value: input.value,
    })
    const workspaceId = action.data?.workspaceId
    if (action.action === 'select-project' && workspaceId !== undefined) {
      await this.sendSessionCard(owner.chatId, owner.generation, workspaceId)
      return
    }
    const sessionId = action.data?.sessionId
    if (action.action === 'select-session' && workspaceId !== undefined && sessionId !== undefined) {
      const bound = await this.binding.bind(workspaceId, sessionId)
      await this.transport.sendText(owner.chatId, `已进入 ${bound.projectPath}\n会话 ${bound.sessionId}`)
    }
  }

  private async sendSessionCard(chatId: string, generation: number, workspaceId: string): Promise<void> {
    const sessions = await this.binding.listSessions(workspaceId)
    const actions = await Promise.all(sessions.map(async session => ({
      tag: 'button',
      text: { tag: 'plain_text', content: session.running ? `运行中 · ${session.sessionId}` : session.sessionId },
      type: session.running ? 'primary' : 'default',
      value: await this.identity.issueAction(
        'select-session', generation, 5 * 60_000, { workspaceId, sessionId: session.sessionId },
      ),
    })))
    const summary = sessions.length === 0 ? '没有可选的普通会话。' : sessions.map(sessionSummary).join('\n')
    await this.transport.sendCard(chatId, selectionCard('选择会话', summary, actions))
  }
}

const sessionSummary = (session: SessionRow): string =>
  `${session.running ? '🟢' : '⚪'} ${session.sessionId}`

const selectionCard = (title: string, markdown: string, actions: unknown[]): unknown => ({
  config: { wide_screen_mode: true, enable_forward: false },
  header: { template: 'blue', title: { tag: 'plain_text', content: title } },
  elements: [
    { tag: 'markdown', content: markdown },
    ...(actions.length === 0 ? [] : [{ tag: 'action', actions, layout: 'flow' }]),
  ],
})
