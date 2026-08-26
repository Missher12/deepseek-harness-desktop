import type { BindingRecord, CallbackNonceRecord, OwnerRecord } from './state.ts'
import type { AdmittedMessage } from './commands.ts'
import type { CardActionValue } from './identity.ts'

/** Exact model route displayed and selected by the command center. */
export interface ModelSelectionView {
  provider: string
  model: string
  reasoningEffort?: string
}

/** One model-directory reasoning effort. */
export interface ReasoningEffortView {
  id: string
  name: string
  description?: string
}

/** One model in its provider group. */
export interface ModelView {
  id: string
  name: string
  description?: string
  reasoning?: { efforts: ReasoningEffortView[]; defaultEffort?: string }
}

/** One model provider group. */
export interface ModelProviderView {
  id: string
  name: string
  models: ModelView[]
}

/** Detached fresh model directory for the bound Session. */
export interface ModelDirectory {
  current: ModelSelectionView
  routable: boolean
  groups: ModelProviderView[]
  failures: Array<{ id: string; name: string; message: string }>
}

/** User-invocable Harness skill safe to show to the paired owner. */
export interface SkillView {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

/** Owner-visible background job summary. */
export interface JobSummaryView {
  id: string
  kind: string
  label: string
  status: string
  startedAt: number
  finishedAt?: number
  detail?: string
}

/** Direct subagent summary. */
export interface SubagentSummaryView {
  id: string
  mode: 'one-shot' | 'continuable' | 'diagnostic'
  activity?: 'running' | 'inactive'
  label?: string
  reason?: string
}

/** Truthful token counters from final assistant messages. */
export interface UsageCountersView {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** Session usage view without estimates. */
export interface SessionUsageView {
  completedTurns: number
  latest?: UsageCountersView
  total?: UsageCountersView
}

/** Minimal Session event shape consumed by the usage fold. */
export interface UsageEventView {
  type: string
  data: unknown
}

/** Redacted current capability health. */
export interface DiagnosticView {
  connected: boolean
  queueDepth: number
  agentStatus: string
  routable: boolean
  commandCount: number
  skillCount: number
  toolCount: number
  jobCount: number
  subagentCount: number
}

/** Harness-native operations adapted by the removable Lark package. */
export interface CommandCenterHarness {
  createSession(workspaceId: string): Promise<{ sessionId: string }>
  renameSession(sessionId: string, title: string): Promise<{ title: string }>
  models(sessionId: string): Promise<ModelDirectory>
  selectModel(
    sessionId: string,
    provider: string,
    model: string,
    reasoningEffort?: string,
  ): Promise<ModelSelectionView>
  executeNative(
    sessionId: string,
    line: string,
  ): Promise<{ matched: boolean; kind?: 'success' | 'error'; text?: string }>
  skills(sessionId: string): Promise<SkillView[]>
  tools(sessionId: string): Promise<string[]>
  tasks(sessionId: string): Promise<{ jobs: JobSummaryView[]; subagents: SubagentSummaryView[] }>
  usage(sessionId: string): Promise<SessionUsageView>
  diagnostics(sessionId: string): Promise<DiagnosticView>
}

interface CommandCenterDependencies {
  transport: {
    sendCard(chatId: string, card: unknown): Promise<unknown>
    sendText(chatId: string, text: string): Promise<unknown>
  }
  identity: {
    owner(): Promise<OwnerRecord | undefined>
    issueAction(
      action: CallbackNonceRecord['action'],
      generation: number,
      ttlMs: number,
      data?: Record<string, string>,
    ): Promise<CardActionValue>
    admitAction(input: {
      openId: string
      chatId: string
      value: CardActionValue
    }): Promise<CallbackNonceRecord>
  }
  binding: {
    active(): Promise<BindingRecord | undefined>
    bindCreated(workspaceId: string, sessionId: string): Promise<BindingRecord>
    statusText(message?: unknown): Promise<string>
  }
  harness: CommandCenterHarness
  commitEvent(eventId: string): Promise<void>
  openProject(message: AdmittedMessage): Promise<void>
}

const ACTION_TTL_MS = 5 * 60_000
const DEFAULT_REASONING = '__provider_default__'
const MAX_TEXT = 3_800
const MAX_LIST_ROWS = 40

/** Complete command syntax rendered after the owner sends exact `/`. */
export const COMMAND_CENTER_MARKDOWN = [
  '**Session**',
  '`/进入` 选择项目与 Session　`/切换` 重新选择　`/新建` 新建并进入 Session',
  '`/重命名 &lt;标题&gt;`　`/状态`　`/解绑`　`/停止`',
  '',
  '**模型与开发**',
  '`/模型`　`/推理`　`/压缩`　`/目标 &lt;内容&gt;`',
  '`/计划 [内容|off]`　`/权限 [预设]`　`/插话 &lt;内容&gt;`',
  '',
  '**发现与诊断**',
  '`/技能`　`/工具`　`/任务`　`/用量`　`/诊断`　`/帮助`',
  '',
  '普通文字会按飞书到达顺序进入当前 Harness Session；`/skill-name ...` 仅在当前 skill 目录精确匹配后进入同一持久队列。',
].join('\n')

const actionButtons = [
  ['进入项目', 'enter'],
  ['新建 Session', 'new'],
  ['选择模型', 'model'],
  ['推理档位', 'reasoning'],
  ['压缩上下文', 'compact'],
  ['当前状态', 'status'],
  ['技能', 'skills'],
  ['工具', 'tools'],
  ['任务', 'tasks'],
  ['用量', 'usage'],
  ['诊断', 'diagnostics'],
] as const

const fixedCommands = new Set([
  '新建', '重命名', '模型', '推理', '压缩', 'compact',
  '目标', 'goal', '计划', 'plan', '权限', 'permission',
  '技能', '工具', '任务', '用量', '诊断',
])

const slash = (text: string): { name: string; body: string } | undefined => {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/u.exec(text)
  if (match === null || match[1] === undefined) return undefined
  return { name: match[1], body: (match[2] ?? '').trim() }
}

const compact = (value: string, limit: number): string => {
  const points = Array.from(value.replaceAll('\n', ' ').trim())
  return points.length <= limit ? points.join('') : `${points.slice(0, limit - 1).join('')}…`
}

const bounded = (value: string): string => Array.from(value).slice(0, MAX_TEXT).join('')

const totalTokens = (usage: UsageCountersView): number => usage.inputTokens + usage.outputTokens
  + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const counters = (value: unknown): UsageCountersView | undefined => {
  const input = record(value)
  const inputTokens = count(input?.inputTokens)
  const outputTokens = count(input?.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const cacheReadTokens = count(input?.cacheReadTokens)
  const cacheWriteTokens = count(input?.cacheWriteTokens)
  const reasoningTokens = count(input?.reasoningTokens)
  return {
    inputTokens, outputTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

const addCounters = (
  current: UsageCountersView | undefined,
  next: UsageCountersView,
): UsageCountersView => ({
  inputTokens: (current?.inputTokens ?? 0) + next.inputTokens,
  outputTokens: (current?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: (current?.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0),
  cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0),
  reasoningTokens: (current?.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
})

/**
 * Fold final assistant usage from completed turns without counting stream chunks.
 * @param events - Ordered Session events to aggregate.
 * @returns Truthful usage totals for completed turns only.
 */
export function foldSessionUsage(events: readonly UsageEventView[]): SessionUsageView {
  const completed = new Set<number>()
  for (const event of events) {
    if (event.type !== 'turn/end') continue
    const data = record(event.data)
    const reason = record(data?.reason)
    const turn = count(data?.turn)
    if (turn !== undefined && reason?.kind === 'completed') completed.add(turn)
  }
  const latestTurn = completed.size === 0 ? undefined : Math.max(...completed)
  let latest: UsageCountersView | undefined
  let total: UsageCountersView | undefined
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const data = record(event.data)
    const turn = count(data?.turn)
    const usage = counters(data?.usage)
    if (turn === undefined || usage === undefined || !completed.has(turn)) continue
    total = addCounters(total, usage)
    if (turn === latestTurn) latest = addCounters(latest, usage)
  }
  return {
    completedTurns: completed.size,
    ...(latest === undefined ? {} : { latest }),
    ...(total === undefined ? {} : { total }),
  }
}

const usageLine = (label: string, usage: UsageCountersView): string => [
  `${label} ${totalTokens(usage).toLocaleString('en-US')}`,
  `输入 ${usage.inputTokens.toLocaleString('en-US')}`,
  `输出 ${usage.outputTokens.toLocaleString('en-US')}`,
  `缓存读 ${String(usage.cacheReadTokens ?? 0)}`,
  `缓存写 ${String(usage.cacheWriteTokens ?? 0)}`,
  ...(usage.reasoningTokens === undefined ? [] : [`推理 ${usage.reasoningTokens.toLocaleString('en-US')}`]),
].join(' · ')

const card = (title: string, markdown: string, actions: unknown[] = []): unknown => ({
  config: { wide_screen_mode: true, enable_forward: false },
  header: { template: 'blue', title: { tag: 'plain_text', content: title } },
  elements: [
    { tag: 'markdown', content: bounded(markdown) },
    ...Array.from({ length: Math.ceil(actions.length / 5) }, (_, index) => ({
      tag: 'action', actions: actions.slice(index * 5, index * 5 + 5), layout: 'flow',
    })),
  ],
})

const button = (label: string, value: CardActionValue, primary = false): unknown => ({
  tag: 'button',
  text: { tag: 'plain_text', content: compact(label, 80) },
  type: primary ? 'primary' : 'default',
  value,
})

/** Owner-only no-model Harness command center. */
export class CommandCenterService {
  constructor(private readonly deps: CommandCenterDependencies) {}

  /**
   * Send the complete command catalog after exact `/` or `/帮助`.
   * @param message - Admitted paired-owner message that requested the catalog.
   */
  async send(message: AdmittedMessage): Promise<void> {
    const owner = await this.requireOwner()
    const actions = await Promise.all(actionButtons.map(async ([label, command], index) => button(
      label,
      await this.deps.identity.issueAction(
        'command-action', owner.generation, ACTION_TTL_MS, { command },
      ),
      index < 2,
    )))
    await this.deps.transport.sendCard(message.chatId, card('Harness 命令中心', COMMAND_CENTER_MARKDOWN, actions))
  }

  /**
   * Execute one supported text command or admit an exact current skill invocation.
   * @param message - Admitted paired-owner message to route.
   * @param text - Normalized message text to interpret.
   * @returns Whether the router should stop, enqueue the unchanged message, or show unknown help.
   */
  async handleText(
    message: AdmittedMessage,
    text: string,
  ): Promise<'handled' | 'enqueue' | 'unknown'> {
    const parsed = slash(text)
    if (parsed === undefined) return 'unknown'
    if (!fixedCommands.has(parsed.name)) {
      const active = await this.deps.binding.active()
      if (active === undefined) return 'unknown'
      try {
        const skills = await this.deps.harness.skills(active.sessionId)
        return skills.some(skill => skill.name === parsed.name) ? 'enqueue' : 'unknown'
      } catch {
        return 'unknown'
      }
    }
    await this.deps.commitEvent(message.eventId)
    await this.contain(message.chatId, () => this.runText(message, parsed.name, parsed.body))
    return 'handled'
  }

  /**
   * Revalidate and execute a signed one-use command/model/reasoning action.
   * @param input - Owner identity and signed card action value from Feishu.
   */
  async handleAction(input: { openId: string; value: CardActionValue }): Promise<void> {
    const owner = await this.requireOwner()
    const action = await this.deps.identity.admitAction({
      openId: input.openId, chatId: owner.chatId, value: input.value,
    })
    await this.contain(owner.chatId, async () => {
      if (action.action === 'command-action') {
        const command = action.data?.command
        if (command === undefined || !actionButtons.some(([, candidate]) => candidate === command)) {
          throw new Error('unknown command-center action')
        }
        await this.runAction(owner, command)
        return
      }
      if (action.action === 'select-model-provider') {
        const provider = action.data?.provider
        if (provider === undefined) throw new Error('model provider is missing')
        await this.sendModels(owner, provider)
        return
      }
      if (action.action === 'select-model') {
        await this.selectModel(owner, action.data)
        return
      }
      if (action.action === 'select-reasoning') {
        await this.selectReasoning(owner, action.data)
      }
    })
  }

  private async runText(message: AdmittedMessage, name: string, body: string): Promise<void> {
    if (name === '新建') {
      if (body.length > 0) return this.sendUsage(message.chatId, '/新建')
      await this.createSession(message.chatId)
      return
    }
    if (name === '重命名') {
      if (body.length === 0 || Array.from(body).length > 256) return this.sendUsage(message.chatId, '/重命名 <标题>')
      const active = await this.requireActive(message.chatId)
      if (active === undefined) return
      const renamed = await this.deps.harness.renameSession(active.sessionId, body)
      await this.deps.transport.sendText(message.chatId, `已重命名为：${compact(renamed.title, 256)}`)
      return
    }
    if (name === '模型') {
      if (body.length > 0) return this.sendUsage(message.chatId, '/模型')
      await this.sendProviders(await this.requireOwner())
      return
    }
    if (name === '推理') {
      if (body.length > 0) return this.sendUsage(message.chatId, '/推理')
      await this.sendReasoning(await this.requireOwner())
      return
    }
    if (name === '技能') return this.sendSkills(message.chatId)
    if (name === '工具') return this.sendTools(message.chatId)
    if (name === '任务') return this.sendTasks(message.chatId)
    if (name === '用量') return this.sendUsageView(message.chatId)
    if (name === '诊断') return this.sendDiagnostics(message.chatId)

    const native = name === '压缩' ? 'compact'
      : name === '目标' ? 'goal'
        : name === '计划' ? 'plan'
          : name === '权限' ? 'permission'
            : name
    await this.runNative(message.chatId, native, body)
  }

  private async runAction(owner: OwnerRecord, command: string): Promise<void> {
    const message: AdmittedMessage = {
      eventId: `card:${command}`, messageId: `card:${command}`,
      openId: owner.openId, chatId: owner.chatId, text: `/${command}`,
    }
    if (command === 'enter') return this.deps.openProject(message)
    if (command === 'new') return this.createSession(owner.chatId)
    if (command === 'model') return this.sendProviders(owner)
    if (command === 'reasoning') return this.sendReasoning(owner)
    if (command === 'compact') return this.runNative(owner.chatId, 'compact', '')
    if (command === 'status') {
      await this.deps.transport.sendText(owner.chatId, await this.deps.binding.statusText())
      return
    }
    if (command === 'skills') return this.sendSkills(owner.chatId)
    if (command === 'tools') return this.sendTools(owner.chatId)
    if (command === 'tasks') return this.sendTasks(owner.chatId)
    if (command === 'usage') return this.sendUsageView(owner.chatId)
    if (command === 'diagnostics') return this.sendDiagnostics(owner.chatId)
  }

  private async createSession(chatId: string): Promise<void> {
    const active = await this.requireActive(chatId)
    if (active === undefined) return
    if (active.workspaceId === undefined) {
      await this.deps.transport.sendText(chatId, '当前绑定缺少项目身份，请发送 /切换 重新选择。')
      return
    }
    const created = await this.deps.harness.createSession(active.workspaceId)
    try {
      const bound = await this.deps.binding.bindCreated(active.workspaceId, created.sessionId)
      await this.deps.transport.sendText(chatId, `已新建并进入 Session：${bound.sessionId}`)
    } catch {
      await this.deps.transport.sendText(chatId, '新 Session 已创建，但自动绑定失败。请发送 /切换 手动选择。')
    }
  }

  private async runNative(chatId: string, name: string, body: string): Promise<void> {
    const active = await this.requireActive(chatId)
    if (active === undefined) return
    const line = `/${name}${body.length === 0 ? '' : ` ${body}`}`
    const result = await this.deps.harness.executeNative(active.sessionId, line)
    if (!result.matched) {
      await this.deps.transport.sendText(chatId, `当前 Session 未加载 /${name}。`)
      return
    }
    if (result.kind === 'error') {
      await this.deps.transport.sendText(chatId, compact(result.text ?? `/${name} 执行失败。`, 1_000))
      return
    }
    await this.deps.transport.sendText(chatId, compact(result.text ?? `已执行 /${name}。`, 1_000))
  }

  private async sendProviders(owner: OwnerRecord): Promise<void> {
    const active = await this.requireActive(owner.chatId)
    if (active === undefined) return
    const directory = await this.deps.harness.models(active.sessionId)
    if (directory.groups.length === 0) {
      await this.deps.transport.sendText(owner.chatId, '当前没有可选择的模型提供方。')
      return
    }
    const actions = await Promise.all(directory.groups.slice(0, MAX_LIST_ROWS).map(async group => button(
      `${directory.current.provider === group.id ? '✓ ' : ''}${group.name}`,
      await this.deps.identity.issueAction(
        'select-model-provider', owner.generation, ACTION_TTL_MS, { provider: group.id },
      ),
      directory.current.provider === group.id,
    )))
    const failures = directory.failures.length === 0
      ? ''
      : `\n\n${String(directory.failures.length)} 个提供方目录暂不可用。`
    await this.deps.transport.sendCard(owner.chatId, card(
      '选择模型提供方',
      `当前：${directory.current.provider}/${directory.current.model}${failures}`,
      actions,
    ))
  }

  private async sendModels(owner: OwnerRecord, providerId: string): Promise<void> {
    const active = await this.requireActive(owner.chatId)
    if (active === undefined) return
    const directory = await this.deps.harness.models(active.sessionId)
    const provider = directory.groups.find(group => group.id === providerId)
    if (provider === undefined) throw new Error('model provider changed')
    const actions = await Promise.all(provider.models.slice(0, MAX_LIST_ROWS).map(async model => button(
      `${directory.current.provider === provider.id && directory.current.model === model.id ? '✓ ' : ''}${model.name}`,
      await this.deps.identity.issueAction(
        'select-model', owner.generation, ACTION_TTL_MS, { provider: provider.id, model: model.id },
      ),
      directory.current.provider === provider.id && directory.current.model === model.id,
    )))
    await this.deps.transport.sendCard(owner.chatId, card(
      `选择模型 · ${provider.name}`,
      provider.models.map(model => `- ${model.name} · ${model.id}`).slice(0, MAX_LIST_ROWS).join('\n'),
      actions,
    ))
  }

  private async selectModel(owner: OwnerRecord, data: Record<string, string> | undefined): Promise<void> {
    const active = await this.requireActive(owner.chatId)
    if (active === undefined) return
    const provider = data?.provider
    const model = data?.model
    if (provider === undefined || model === undefined) throw new Error('model choice is incomplete')
    const directory = await this.deps.harness.models(active.sessionId)
    if (!directory.groups.some(group => group.id === provider
      && group.models.some(candidate => candidate.id === model))) {
      throw new Error('model choice changed')
    }
    const selected = await this.deps.harness.selectModel(active.sessionId, provider, model, undefined)
    await this.deps.transport.sendText(owner.chatId, `已切换模型：${selected.provider}/${selected.model}`)
  }

  private async sendReasoning(owner: OwnerRecord): Promise<void> {
    const active = await this.requireActive(owner.chatId)
    if (active === undefined) return
    const directory = await this.deps.harness.models(active.sessionId)
    const provider = directory.groups.find(group => group.id === directory.current.provider)
    const model = provider?.models.find(candidate => candidate.id === directory.current.model)
    const efforts = model?.reasoning?.efforts ?? []
    if (provider === undefined || model === undefined || efforts.length === 0) {
      await this.deps.transport.sendText(owner.chatId, '当前模型没有声明可选择的推理档位。')
      return
    }
    const choices = [
      { id: DEFAULT_REASONING, name: '提供方默认' },
      ...efforts,
    ]
    const actions = await Promise.all(choices.map(async effort => button(
      `${(effort.id === DEFAULT_REASONING && directory.current.reasoningEffort === undefined)
        || effort.id === directory.current.reasoningEffort ? '✓ ' : ''}${effort.name}`,
      await this.deps.identity.issueAction('select-reasoning', owner.generation, ACTION_TTL_MS, {
        provider: provider.id, model: model.id, effort: effort.id,
      }),
      effort.id === directory.current.reasoningEffort,
    )))
    const defaultEffort = model.reasoning?.defaultEffort
    await this.deps.transport.sendCard(owner.chatId, card(
      '选择推理档位',
      `模型：${provider.id}/${model.id}${defaultEffort === undefined ? '' : `\n适配器默认：${defaultEffort}`}`,
      actions,
    ))
  }

  private async selectReasoning(owner: OwnerRecord, data: Record<string, string> | undefined): Promise<void> {
    const active = await this.requireActive(owner.chatId)
    if (active === undefined) return
    const provider = data?.provider
    const model = data?.model
    const effort = data?.effort
    if (provider === undefined || model === undefined || effort === undefined) {
      throw new Error('reasoning choice is incomplete')
    }
    const directory = await this.deps.harness.models(active.sessionId)
    if (directory.current.provider !== provider || directory.current.model !== model) {
      throw new Error('reasoning model changed')
    }
    const entry = directory.groups.find(group => group.id === provider)
      ?.models.find(candidate => candidate.id === model)
    if (effort !== DEFAULT_REASONING
      && !entry?.reasoning?.efforts.some(candidate => candidate.id === effort)) {
      throw new Error('reasoning choice changed')
    }
    const selected = await this.deps.harness.selectModel(
      active.sessionId, provider, model, effort === DEFAULT_REASONING ? undefined : effort,
    )
    await this.deps.transport.sendText(
      owner.chatId,
      `已切换推理档位：${selected.reasoningEffort ?? '提供方默认'}`,
    )
  }

  private async sendSkills(chatId: string): Promise<void> {
    const active = await this.requireActive(chatId)
    if (active === undefined) return
    const skills = await this.deps.harness.skills(active.sessionId)
    const lines = skills.slice(0, MAX_LIST_ROWS).map(skill =>
      `/${skill.name} — ${compact(skill.description, 120)}`)
    await this.deps.transport.sendText(chatId, bounded(lines.length === 0
      ? '当前 Session 没有用户可调用的 skill。'
      : `当前 skill（${String(skills.length)}）：\n${lines.join('\n')}`))
  }

  private async sendTools(chatId: string): Promise<void> {
    const active = await this.requireActive(chatId)
    if (active === undefined) return
    const tools = await this.deps.harness.tools(active.sessionId)
    await this.deps.transport.sendText(chatId, bounded(tools.length === 0
      ? '当前 Agent 没有可见工具。'
      : `当前工具（${String(tools.length)}）：${tools.slice(0, MAX_LIST_ROWS).join(' · ')}`))
  }

  private async sendTasks(chatId: string): Promise<void> {
    const active = await this.requireActive(chatId)
    if (active === undefined) return
    const tasks = await this.deps.harness.tasks(active.sessionId)
    const jobs = tasks.jobs.slice(0, MAX_LIST_ROWS).map(job =>
      `- ${job.id} · ${job.status} · ${compact(job.label, 120)}`)
    const subagents = tasks.subagents.slice(0, MAX_LIST_ROWS).map(subagent =>
      `- ${subagent.id} · ${subagent.mode}${subagent.activity === undefined ? '' : ` · ${subagent.activity}`}${subagent.label === undefined ? '' : ` · ${compact(subagent.label, 100)}`}`)
    await this.deps.transport.sendText(chatId, bounded([
      `后台任务（${String(tasks.jobs.length)}）`, jobs.join('\n') || '无',
      `subagent（${String(tasks.subagents.length)}）`, subagents.join('\n') || '无',
    ].join('\n')))
  }

  private async sendUsageView(chatId: string): Promise<void> {
    const active = await this.requireActive(chatId)
    if (active === undefined) return
    const usage = await this.deps.harness.usage(active.sessionId)
    await this.deps.transport.sendText(chatId, [
      `已完成轮次：${String(usage.completedTurns)}`,
      usage.latest === undefined ? '最近轮次：暂不可用' : usageLine('最近轮次', usage.latest),
      usage.total === undefined ? 'Session 总计：暂不可用' : usageLine('Session 总计', usage.total),
    ].join('\n'))
  }

  private async sendDiagnostics(chatId: string): Promise<void> {
    const active = await this.requireActive(chatId)
    if (active === undefined) return
    const value = await this.deps.harness.diagnostics(active.sessionId)
    const yes = (flag: boolean): string => flag ? '是' : '否'
    await this.deps.transport.sendText(chatId, [
      '飞书链路诊断',
      `已连接：${yes(value.connected)} · 队列：${String(value.queueDepth)}`,
      `Agent：${compact(value.agentStatus, 40)} · 可路由：${yes(value.routable)}`,
      `命令：${String(value.commandCount)} · skill：${String(value.skillCount)} · 工具：${String(value.toolCount)}`,
      `后台任务：${String(value.jobCount)} · subagent：${String(value.subagentCount)}`,
    ].join('\n'))
  }

  private async requireOwner(): Promise<OwnerRecord> {
    const owner = await this.deps.identity.owner()
    if (owner === undefined) throw new Error('Lark owner is not paired')
    return owner
  }

  private async requireActive(chatId: string): Promise<BindingRecord | undefined> {
    const active = await this.deps.binding.active()
    if (active !== undefined) return active
    await this.deps.transport.sendText(chatId, '尚未绑定项目和 Session。发送 /进入 开始选择。')
    return undefined
  }

  private async sendUsage(chatId: string, syntax: string): Promise<void> {
    await this.deps.transport.sendText(chatId, `用法：${syntax}`)
  }

  private async contain(chatId: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation()
    } catch {
      await this.deps.transport.sendText(chatId, '操作失败，请在 Harness 本地查看诊断后重试。')
    }
  }
}
