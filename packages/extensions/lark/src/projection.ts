/** Safe token counters projected from Harness usage events. */
export interface ProjectedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** Safe tool title, kind, and lifecycle status. */
export interface ProjectedTool {
  callId: string
  title: string
  kind: string
  status: 'running' | 'completed' | 'failed'
}

/** Pending or resolved approval facts safe for the paired owner. */
export interface ProjectedApproval {
  approvalId: string
  rpcId?: string
  toolName: string
  status: 'pending' | 'resolved'
  allowValue?: unknown
  denyValue?: unknown
}

/** Complete redacted state rendered into one Feishu turn card. */
export interface TurnProjectionState {
  sessionId: string
  turn?: number
  status: 'placeholder' | 'streaming' | 'completed' | 'cancelled' | 'failed'
  text: string
  tools: ProjectedTool[]
  approvals: ProjectedApproval[]
  usage?: ProjectedUsage
  startedAt?: number
  elapsedMs: number
}

type UnknownRecord = Record<string, unknown>

const record = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? value as UnknownRecord : undefined

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined

/** Fold the exact bound Session's mux frames into a deliberately redacted card state. */
export class TurnProjection {
  private state: TurnProjectionState

  constructor(private readonly sessionId: string) {
    this.state = {
      sessionId, status: 'placeholder', text: '', tools: [], approvals: [], elapsedMs: 0,
    }
  }

  /**
   * Fold one mux frame when it belongs to the exact bound Session.
   * @param input - Untrusted mux frame.
   * @returns A cloned safe projection snapshot.
   */
  apply(input: unknown): TurnProjectionState {
    const frame = record(input)
    if (frame === undefined || frame.sessionId !== this.sessionId) return this.snapshot()
    if (frame.type === 'approval/requested') this.approvalRequested(frame)
    if (frame.type === 'approval/resolved') this.approvalResolved(frame)
    if (frame.type !== 'session/event') return this.snapshot()
    const sessionEvent = record(frame.event)
    const data = record(sessionEvent?.data)
    const eventType = string(sessionEvent?.type)
    const time = number(sessionEvent?.time)
    if (data === undefined || eventType === undefined) return this.snapshot()
    if (eventType === 'turn/start') {
      const turn = number(data.turn)
      this.state = {
        sessionId: this.sessionId,
        status: 'streaming', text: '', tools: [], approvals: [],
        ...(turn === undefined ? {} : { turn }),
        ...(time === undefined ? {} : { startedAt: time }),
        elapsedMs: 0,
      }
    } else if (eventType === 'assistant/chunk') {
      const chunk = record(data.chunk)
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') this.state.text += chunk.text
    } else if (eventType === 'assistant/message') {
      const message = record(data.message)
      const content = Array.isArray(message?.content) ? message.content : []
      const visible = content.flatMap((block) => {
        const value = record(block)
        return value?.type === 'text' && typeof value.text === 'string' ? [value.text] : []
      }).join('')
      if (visible.length >= this.state.text.length) this.state.text = visible
      const usage = record(data.usage)
      if (usage !== undefined) this.addUsage(usage)
    } else if (eventType === 'tool/call') {
      this.toolCall(data, record(frame.view))
    } else if (eventType === 'tool/result') {
      this.toolResult(data, record(frame.view))
    } else if (eventType === 'turn/end' && number(data.turn) === this.state.turn) {
      const reason = record(data.reason)
      const kind = string(reason?.kind)
      this.state.status = kind === 'completed'
        ? 'completed'
        : kind === 'aborted' || kind === 'disposed' ? 'cancelled' : 'failed'
    }
    if (time !== undefined && this.state.startedAt !== undefined) {
      this.state.elapsedMs = Math.max(this.state.elapsedMs, time - this.state.startedAt)
    }
    return this.snapshot()
  }

  /**
   * Read the current projection without sharing mutable state.
   * @returns A cloned safe projection snapshot.
   */
  snapshot(): TurnProjectionState {
    return structuredClone(this.state)
  }

  /**
   * Attach state-backed actions to one pending projected approval.
   * @param approvalId - Exact pending approval identifier.
   * @param allowValue - Signed allow-once action value.
   * @param denyValue - Signed deny action value.
   * @returns A cloned safe projection snapshot.
   */
  setApprovalActions(approvalId: string, allowValue: unknown, denyValue: unknown): TurnProjectionState {
    this.state.approvals = this.state.approvals.map(item =>
      item.approvalId === approvalId ? { ...item, allowValue, denyValue } : item)
    return this.snapshot()
  }

  private addUsage(value: UnknownRecord): void {
    const cacheReadTokens = number(value.cacheReadTokens)
    const cacheWriteTokens = number(value.cacheWriteTokens)
    const reasoningTokens = number(value.reasoningTokens)
    const next: ProjectedUsage = {
      inputTokens: number(value.inputTokens) ?? 0,
      outputTokens: number(value.outputTokens) ?? 0,
      ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
      ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    }
    const current = this.state.usage
    this.state.usage = current === undefined ? next : {
      inputTokens: current.inputTokens + next.inputTokens,
      outputTokens: current.outputTokens + next.outputTokens,
      cacheReadTokens: (current.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0),
      cacheWriteTokens: (current.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0),
      reasoningTokens: (current.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
    }
  }

  private toolCall(data: UnknownRecord, wrappedView: UnknownRecord | undefined): void {
    if (wrappedView?.for !== 'call') return
    const view = record(wrappedView.view)
    const callId = string(data.callId)
    const title = string(view?.title)
    const kind = string(view?.card)
    if (callId === undefined || title === undefined || kind === undefined) return
    this.state.tools = [
      ...this.state.tools.filter(tool => tool.callId !== callId),
      { callId, title, kind, status: 'running' },
    ]
  }

  private toolResult(data: UnknownRecord, wrappedView: UnknownRecord | undefined): void {
    if (wrappedView?.for !== 'result') return
    const view = record(wrappedView.view)
    const message = record(data.message)
    const source = record(message?.source)
    const callId = string(source?.callId)
    if (callId === undefined) return
    const previous = this.state.tools.find(tool => tool.callId === callId)
    const title = string(view?.title) ?? previous?.title ?? 'Tool'
    const kind = string(view?.card) ?? previous?.kind ?? 'generic'
    this.state.tools = [
      ...this.state.tools.filter(tool => tool.callId !== callId),
      { callId, title, kind, status: record(data.error) === undefined ? 'completed' : 'failed' },
    ]
  }

  private approvalRequested(frame: UnknownRecord): void {
    const approvalId = string(frame.approvalId)
    const toolName = string(frame.toolName)
    if (approvalId === undefined || toolName === undefined) return
    const rpcId = string(frame.rpcId)
    this.state.approvals = [
      ...this.state.approvals.filter(item => item.approvalId !== approvalId),
      {
        approvalId, toolName, status: 'pending',
        ...(rpcId === undefined ? {} : { rpcId }),
      },
    ]
  }

  private approvalResolved(frame: UnknownRecord): void {
    const approvalId = string(frame.approvalId)
    if (approvalId === undefined) return
    this.state.approvals = this.state.approvals.map(item =>
      item.approvalId === approvalId ? { ...item, status: 'resolved' } : item)
  }
}
