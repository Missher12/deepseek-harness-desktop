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
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

type ResolvedStreamingCardOptions = Required<Pick<
  StreamingCardOptions, 'throttleMs' | 'now' | 'setTimer' | 'clearTimer'
>> & CardTransport

const statusText: Record<TurnProjectionState['status'], string> = {
  placeholder: '准备中', streaming: '开发中', completed: '已完成', cancelled: '已停止', failed: '失败',
}

const elapsed = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)}s`

const compactNumber = (value: number): string => {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(value))
}

const inlineFact = (value: string): string => value
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/([\\`*_{}\[\]()#+!|>~])/g, '\\$1')

const usageTotal = (state: TurnProjectionState): number | undefined => {
  const usage = state.usage
  if (usage === undefined) return undefined
  return usage.inputTokens + usage.outputTokens
    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/**
 * Build one Feishu card payload containing visible answer text and safe summaries only.
 * @param state - Current safe turn projection.
 * @returns An official interactive-card payload.
 */
export function renderTurnCard(state: TurnProjectionState): unknown {
  const toolLines = state.tools.map(tool =>
    `${tool.status === 'running' ? '◌' : tool.status === 'completed' ? '✓' : '✕'} ${tool.title}`)
  const pendingApprovals = state.approvals
    .filter(approval => approval.status === 'pending')
  const approvals = pendingApprovals.map(approval => `待确认：${approval.toolName}`)
  const tokenTotal = usageTotal(state)
  const route = state.model === undefined
    ? '模型 暂不可用'
    : [
      `模型 ${inlineFact(state.model.model)}`,
      `提供方 ${inlineFact(state.model.provider)}`,
      ...(state.model.reasoningEffort === undefined
        ? [] : [`推理 ${inlineFact(state.model.reasoningEffort)}`]),
    ].join(' · ')
  const primaryDetails = `${statusText[state.status]} · 耗时 ${elapsed(state.elapsedMs)} · ${route}`
  const usageDetails = state.usage === undefined
    ? 'Token 暂不可用'
    : [
      `↑ ${compactNumber(state.usage.inputTokens)} ↓ ${compactNumber(state.usage.outputTokens)}`,
      `Token ${compactNumber(tokenTotal ?? 0)}`,
      ...(state.usage.cacheReadTokens === undefined && state.usage.cacheWriteTokens === undefined
        ? []
        : [`缓存 ${compactNumber(state.usage.cacheReadTokens ?? 0)}/${compactNumber(state.usage.cacheWriteTokens ?? 0)}`]),
    ].join(' · ')
  const content = [
    state.text || '正在连接 Harness 会话…',
    toolLines.length === 0 ? '' : `\n---\n${toolLines.join('\n')}`,
    approvals.length === 0 ? '' : `\n${approvals.join('\n')}`,
    `\n---\n${primaryDetails}\n${usageDetails}`,
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
  private stopped = false
  private dirty = false
  private finalRequested = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private finalPromise: Promise<void> | undefined
  private resolveFinal: (() => void) | undefined

  constructor(
    private readonly options: ResolvedStreamingCardOptions,
    private readonly chatId: string,
    private readonly messageId: string,
    initial: TurnProjectionState,
  ) {
    this.current = initial
    this.lastFlush = options.now()
  }

  update(next: TurnProjectionState, final = false): Promise<void> {
    if (this.stopped || this.failed) return this.inFlight ?? Promise.resolve()
    if (next.text.length < this.current.text.length || !next.text.startsWith(this.current.text)) {
      return final ? this.requestFinal() : Promise.resolve()
    }
    this.current = structuredClone(next)
    this.dirty = true
    if (final) return this.requestFinal()
    this.pump()
    return Promise.resolve()
  }

  stop(): void {
    this.stopped = true
    this.dirty = false
    this.cancelTimer()
    this.settleFinal()
  }

  private requestFinal(): Promise<void> {
    this.finalRequested = true
    this.cancelTimer()
    this.finalPromise ??= new Promise((resolve) => { this.resolveFinal = resolve })
    this.pump()
    return this.finalPromise
  }

  private pump(): void {
    if (this.stopped || this.failed) {
      this.settleFinal()
      return
    }
    if (this.inFlight !== undefined || this.timer !== undefined) return
    if (!this.dirty) {
      if (this.finalRequested) {
        this.stopped = true
        this.settleFinal()
      }
      return
    }
    if (!this.finalRequested) {
      const wait = Math.max(0, this.options.throttleMs - (this.options.now() - this.lastFlush))
      if (wait > 0) {
        this.timer = this.options.setTimer(() => {
          this.timer = undefined
          this.pump()
        }, wait)
        return
      }
    }
    this.dirty = false
    const snapshot = structuredClone(this.current)
    const operation = this.flush(snapshot)
    this.inFlight = operation
    void operation.finally(() => {
      this.inFlight = undefined
      this.pump()
    })
  }

  private async flush(snapshot: TurnProjectionState): Promise<void> {
    try {
      await this.options.updateCard(this.messageId, renderTurnCard(snapshot))
      this.lastFlush = this.options.now()
    } catch {
      this.failed = true
      this.dirty = false
      this.cancelTimer()
      const suffix = this.current.text.length > 4000 ? '…' : ''
      try {
        await this.options.sendText(this.chatId, `${this.current.text.slice(0, 4000 - suffix.length)}${suffix}`)
      } catch {
        // Both bounded Feishu delivery paths failed; the shared mux must keep serving later turns.
      }
    }
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return
    this.options.clearTimer(this.timer)
    this.timer = undefined
  }

  private settleFinal(): void {
    this.finalRequested = false
    const resolve = this.resolveFinal
    this.resolveFinal = undefined
    this.finalPromise = undefined
    resolve?.()
  }
}

/** Creates exactly one message card per turn and owns its monotonic updates. */
export class StreamingCardController {
  private readonly resolved: ResolvedStreamingCardOptions

  constructor(options: StreamingCardOptions) {
    this.resolved = {
      ...options,
      now: options.now ?? Date.now,
      setTimer: options.setTimer ?? ((callback, ms) => setTimeout(callback, ms)),
      clearTimer: options.clearTimer ?? ((timer) => { clearTimeout(timer) }),
    }
  }

  /**
   * Create the stable placeholder card for one turn.
   * @param chatId - Exact paired private-chat identifier.
   * @param initial - Initial safe turn projection.
   * @returns The monotonic stream controller for the created card.
   */
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

  /**
   * Send the no-model project selector to an admitted owner.
   * @param message - Owner-gated inbound message.
   */
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

  /**
   * Revalidate and execute one signed project or Session selection.
   * @param input - Acting owner and signed one-use action value.
   */
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
