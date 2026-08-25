import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { resolveOrdinarySession } from '@deepseek-ai/dsh-session-messenger'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-workspace'
import { ApprovalBridge } from './approval.ts'
import { LarkAttachmentService } from './attachments.ts'
import { BindingController, type BindingCatalog } from './binding.ts'
import {
  SelectionCardService,
  StreamingCardController,
} from './cards.ts'
import { CommandRouter, type AdmittedMessage } from './commands.ts'
import {
  Config as LarkConfigSchema,
  LARK_APP_ID_REF,
  LARK_APP_SECRET_REF,
  type Config as LarkConfig,
} from './config.ts'
import {
  createLarkCapability,
  createLarkControlHandler,
  injectLarkCapability,
  LARK_CONTROL_PATH,
  type LarkControlPort,
} from './http.ts'
import { IdentityService, type CardActionValue } from './identity.ts'
import { DurableLarkInbox, type RemoteAgent } from './inbox.ts'
import { TurnProjection, type TurnProjectionState } from './projection.ts'
import { LarkRuntimeController } from './runtime.ts'
import { larkDomainSpec } from './state.ts'
import { LarkTransport } from './transport.ts'

export * from './approval.ts'
export * from './attachments.ts'
export * from './binding.ts'
export * from './cards.ts'
export * from './commands.ts'
export * from './config.ts'
export * from './http.ts'
export * from './identity.ts'
export * from './inbox.ts'
export * from './projection.ts'
export * from './runtime.ts'
export * from './state.ts'
export * from './transport.ts'

export const name = 'lark'
export const Config = LarkConfigSchema
export const inject = [
  'settings', 'credentials', 'storageDomain', 'apiProxy', 'attachments',
  'workspaceRegistry', 'typert', 'agents', 'webServer',
]

type UnknownRecord = Record<string, unknown>
const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? value as UnknownRecord : undefined

const textContent = (message: UnknownRecord): string | undefined => {
  if (message.message_type !== 'text') return undefined
  try {
    const content: unknown = JSON.parse(String(message.content ?? ''))
    const value = asRecord(content)?.text
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function parseInboundMessage(value: unknown, expectedAppId: string): AdmittedMessage | undefined {
  const data = asRecord(value)
  if (data === undefined || (typeof data.app_id === 'string' && data.app_id !== expectedAppId)) return undefined
  const sender = asRecord(data.sender)
  const senderId = asRecord(sender?.sender_id)
  const message = asRecord(data.message)
  const openId = senderId?.open_id
  const messageId = message?.message_id
  const chatId = message?.chat_id
  const text = message === undefined ? undefined : textContent(message)
  if (typeof openId !== 'string' || typeof messageId !== 'string'
    || typeof chatId !== 'string' || text === undefined) return undefined
  return {
    eventId: typeof data.event_id === 'string' ? data.event_id : messageId,
    messageId,
    openId,
    chatId,
    text,
    senderType: typeof sender?.sender_type === 'string' ? sender.sender_type : '',
    chatType: typeof message?.chat_type === 'string' ? message.chat_type : '',
    ...(typeof data.app_id === 'string' ? { appId: data.app_id } : {}),
  }
}

function parseCardAction(value: unknown): { openId: string; value: CardActionValue } | undefined {
  const data = asRecord(value)
  const operator = asRecord(data?.operator)
  const action = asRecord(data?.action)
  const actionValue = asRecord(action?.value)
  const openId = typeof data?.open_id === 'string'
    ? data.open_id
    : typeof operator?.open_id === 'string' ? operator.open_id : undefined
  if (openId === undefined || actionValue === undefined
    || typeof actionValue.nonce !== 'string' || typeof actionValue.action !== 'string'
    || typeof actionValue.generation !== 'number') return undefined
  const rawData = asRecord(actionValue.data)
  const entries = rawData === undefined ? undefined : Object.entries(rawData)
  if (entries?.some(([, item]) => typeof item !== 'string')) return undefined
  return {
    openId,
    value: {
      nonce: actionValue.nonce,
      action: actionValue.action as CardActionValue['action'],
      generation: actionValue.generation,
      ...(entries === undefined ? {} : { data: Object.fromEntries(entries) as Record<string, string> }),
    },
  }
}

const responseValue = <T>(response: { result: { ok: boolean; value?: T } }, label: string): T => {
  if (!response.result.ok) throw new Error(`${label} failed`)
  return response.result.value as T
}

const request = <T>(payload: T) => ({ rpcId: RpcId(randomUUID()), payload })

const agentAdapter = (agent: Agent): RemoteAgent => ({
  id: agent.id,
  followup: (message) => { agent.followup(message) },
  steer: (message) => { agent.steer(message) },
  cancel: (cause, options) => { agent.cancel(cause, options) },
  inbox: agent.inbox,
  hasHistoricalMessage: (messageId: MessageId, turn?: number) => {
    const hasMessage = agent.session.events.some(event =>
      event.type === 'user/message' && event.data.id === messageId)
    if (!hasMessage || turn === undefined) return hasMessage
    return agent.session.events.some(event => event.type === 'turn/end' && event.data.turn === turn)
  },
})

interface ActiveTurn {
  projection: TurnProjection
  stream: Awaited<ReturnType<StreamingCardController['open']>>
}

/** Install the complete Host half over existing Harness services. */
export async function apply(ctx: Context, base: LarkConfig = {}): Promise<void> {
  const settings = ctx.settings.register(settingsNamespace('lark'), LarkConfigSchema, { base })
  const domain = await ctx.storageDomain.open(larkDomainSpec)
  const owners = domain.table('owners')
  const events = domain.table('events')
  const bindings = domain.table('bindings')
  const inboxTable = domain.table('inbox')
  const cards = domain.table('cards')
  const nonces = domain.table('nonces')
  const files = domain.table('files')

  const identity = new IdentityService({
    getOwner: async () => owners.get('owner'),
    putOwner: async (owner) => { await owners.put('owner', owner) },
    hasEvent: async eventId => events.get(eventId) !== undefined
      || [...inboxTable.entries()].some(([, row]) => row.eventId === eventId),
    markEvent: async (eventId) => { await events.put(eventId, { id: eventId, receivedAt: Date.now() }) },
    getNonce: async id => nonces.get(id),
    putNonce: async (nonce) => { await nonces.put(nonce.id, nonce) },
  })

  const catalog: BindingCatalog = {
    listWorkspaces: async () => {
      const value = responseValue(await ctx.apiProxy.workspace.list(request({})), 'workspace.list')
      return {
        items: value.items.map(item => ({
          workspaceId: item.workspaceId, title: item.title, path: item.path,
          sessionIds: [...item.sessionIds],
        })),
        archivedSessionIds: [...value.archivedSessionIds],
      }
    },
    listSessions: async () => {
      const value = responseValue(await ctx.apiProxy.sessions.list(request({})), 'session.list')
      return value.items.map(item => ({
        sessionId: item.sessionId, updatedAt: item.updatedAt, running: item.running,
        blank: item.blank,
        ...(item.parentSessionId === undefined ? {} : { parentSessionId: item.parentSessionId }),
        ...(item.origin === undefined ? {} : { origin: item.origin }),
        ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
      }))
    },
    resolveOrdinarySession: async (sessionId) => {
      const agent = await resolveOrdinarySession(ctx, sessionId)
      return {
        id: agent.id,
        ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
      }
    },
  }
  const binding = new BindingController(catalog, {
    get: async () => bindings.get('owner'),
    put: async (value) => { await bindings.put('owner', value) },
    delete: async () => { await bindings.delete('owner') },
  }, () => identity.owner())

  const queue = new DurableLarkInbox({
    store: {
      list: async () => [...inboxTable.entries()].map(([, row]) => row),
      put: async (row) => { await inboxTable.put(row.id, row) },
    },
    getBinding: async () => bindings.get('owner'),
    resolveAgent: async sessionId => agentAdapter(await resolveOrdinarySession(ctx, sessionId)),
  })
  const attachments = new LarkAttachmentService({
    imageStore: ctx.attachments,
    stagingRoot: dshHomePath('lark', 'files'),
    files: {
      list: async () => [...files.entries()].map(([, row]) => row),
      put: async (row) => { await files.put(row.id, row) },
      delete: async (id) => { await files.delete(id) },
    },
    ...(settings.get().maxMediaBytes === undefined ? {} : { maxBytes: settings.get().maxMediaBytes }),
    ...(settings.get().fileRetentionMs === undefined ? {} : { retentionMs: settings.get().fileRetentionMs }),
  })

  let transport: LarkTransport | undefined
  const transportFacade = {
    sendText: async (chatId: string, text: string) => requireTransport(transport).sendText(chatId, text),
    sendCard: async (chatId: string, card: unknown) => requireTransport(transport).sendCard(chatId, card),
    updateCard: async (messageId: string, card: unknown) => requireTransport(transport).updateCard(messageId, card),
  }
  const selection = new SelectionCardService(binding, identity, transportFacade)
  const commandIdentity = {
    admit: async (message: AdmittedMessage) => identity.admit({
      eventId: message.eventId,
      messageId: message.messageId,
      senderOpenId: message.openId,
      senderType: message.senderType ?? '',
      chatId: message.chatId,
      chatType: message.chatType ?? '',
    }),
    commitEvent: (eventId: string) => identity.commitEvent(eventId),
  }
  const router = new CommandRouter({
    transport: transportFacade,
    cards: selection,
    binding,
    inbox: queue,
    identity: commandIdentity,
  })

  const approval = new ApprovalBridge(ctx.apiProxy)
  const streaming = new StreamingCardController({
    ...transportFacade,
    throttleMs: settings.get().streamThrottleMs ?? 350,
  })
  const activeTurns = new Map<string, ActiveTurn>()
  let muxAbort: AbortController | undefined
  let muxTask: Promise<void> | undefined

  const onMuxFrame = async (rpcId: string, frame: MuxFrame): Promise<void> => {
    if (!('sessionId' in frame)) return
    const current = bindings.get('owner')
    if (current === undefined || current.state !== 'active' || current.sessionId !== frame.sessionId) return
    if (frame.type === 'session/event' && frame.event.type === 'turn/end') {
      await queue.onTurnEnd(frame.sessionId, frame.event.data.turn, turnOutcome(frame.event.data.reason))
    }
    if (frame.type === 'session/event' && frame.event.type === 'turn/start') {
      const projection = new TurnProjection(frame.sessionId)
      const initial: TurnProjectionState = {
        sessionId: frame.sessionId, turn: frame.event.data.turn,
        status: 'placeholder', text: '', tools: [], approvals: [], elapsedMs: 0,
      }
      const stream = await streaming.open(current.chatId, initial)
      activeTurns.set(`${frame.sessionId}:${String(frame.event.data.turn)}`, { projection, stream })
    }
    const turn = frameTurn(frame)
    const key = turn === undefined
      ? [...activeTurns.keys()].findLast(candidate => candidate.startsWith(`${frame.sessionId}:`))
      : `${frame.sessionId}:${String(turn)}`
    if (key === undefined) return
    const active = activeTurns.get(key)
    if (active === undefined) return
    let next = active.projection.apply({ ...frame, rpcId })
    if (frame.type === 'approval/requested') {
      const owner = owners.get('owner')
      if (owner !== undefined) {
        const data = {
          rpcId, sessionId: frame.sessionId,
          approvalId: frame.approvalId,
        }
        const [allow, deny] = await Promise.all([
          identity.issueAction('approve-once', owner.generation, 10 * 60_000, data),
          identity.issueAction('deny', owner.generation, 10 * 60_000, data),
        ])
        next = active.projection.setApprovalActions(frame.approvalId, allow, deny)
      }
    }
    const final = frame.type === 'session/event' && frame.event.type === 'turn/end'
    await active.stream.update(next, final)
    if (final) activeTurns.delete(key)
  }

  const mux = {
    start: async () => {
      muxAbort = new AbortController()
      const signal = muxAbort.signal
      muxTask = (async () => {
        try {
          for await (const message of ctx.apiProxy.events.mux(request({}), signal)) {
            await onMuxFrame(message.rpcId, message.payload)
          }
        } catch (error) {
          if (!signal.aborted) throw error
        }
      })()
      void muxTask.catch(() => {})
    },
    stop: async () => {
      muxAbort?.abort()
      await muxTask?.catch(() => {})
      muxAbort = undefined
      muxTask = undefined
      activeTurns.clear()
    },
  }

  let ingressAbort: AbortController | undefined
  const transportLifecycle = {
    start: async () => {
      const config = settings.get()
      const appId = await ctx.credentials.resolve(credentialRef(config.appIdRef ?? LARK_APP_ID_REF))
      const appSecret = await ctx.credentials.resolve(credentialRef(config.appSecretRef ?? LARK_APP_SECRET_REF))
      if (appId === undefined || appSecret === undefined) throw new Error('Lark credentials are not configured')
      const next = new LarkTransport({
        appId: appId.value,
        appSecret: appSecret.value,
        domain: config.domain ?? 'feishu',
      })
      ingressAbort = new AbortController()
      transport = next
      await next.start({
        onMessage: async (event) => {
          const input = parseInboundMessage(event, appId.value)
          if (input === undefined) return
          if (input.text === '进入项目') await router.menuAction(input)
          else await router.message(input)
        },
        onCardAction: async (event) => {
          const input = parseCardAction(event)
          if (input === undefined) return
          if (input.value.action === 'select-project' || input.value.action === 'select-session') {
            await selection.handleAction(input)
            return
          }
          if (input.value.action === 'approve-once' || input.value.action === 'deny') {
            const owner = await identity.owner()
            if (owner === undefined) return
            const accepted = await identity.admitAction({ ...input, chatId: owner.chatId })
            const data = accepted.data
            if (data?.rpcId === undefined || data.sessionId === undefined || data.approvalId === undefined) return
            await approval.answer({
              rpcId: data.rpcId, sessionId: data.sessionId, approvalId: data.approvalId,
              action: accepted.action === 'approve-once' ? 'allow-once' : 'deny',
            })
          }
        },
      }, ingressAbort.signal)
    },
    stop: () => {
      ingressAbort?.abort()
      transport?.stop()
      ingressAbort = undefined
      transport = undefined
    },
  }

  const runtime = new LarkRuntimeController({
    transport: transportLifecycle,
    mux,
    inbox: queue,
    cleanup: () => attachments.cleanup(),
  })

  const clearTable = async <T>(table: { keys(): IterableIterator<string>; delete(key: string): Promise<T> }) => {
    for (const key of [...table.keys()]) await table.delete(key)
  }
  const resetOwnedState = async (): Promise<void> => {
    await attachments.clear()
    await Promise.all([
      clearTable(owners), clearTable(events), clearTable(bindings), clearTable(inboxTable),
      clearTable(cards), clearTable(nonces), clearTable(files),
    ])
  }
  const control: LarkControlPort = {
    status: async () => {
      const config = settings.get()
      const [appId, appSecret] = await Promise.all([
        ctx.credentials.describe(credentialRef(config.appIdRef ?? LARK_APP_ID_REF)),
        ctx.credentials.describe(credentialRef(config.appSecretRef ?? LARK_APP_SECRET_REF)),
      ])
      const bound = bindings.get('owner')
      return {
        ...runtime.status(),
        credentials: { appId: appId.configured, appSecret: appSecret.configured },
        pairing: owners.get('owner') === undefined ? 'unpaired' : 'paired',
        binding: bound === undefined ? null : { projectPath: bound.projectPath, sessionId: bound.sessionId },
        queueDepth: [...inboxTable.entries()].filter(([, row]) => !['terminal', 'cancelled'].includes(row.status)).length,
      }
    },
    enable: async () => { await runtime.enable(); await settings.update({ enabled: true }) },
    disable: async () => { await runtime.disable(); await settings.update({ enabled: false }) },
    resume: () => runtime.resumeQueue(),
    clear: async () => { await runtime.disable(); await resetOwnedState(); await settings.update({ enabled: false }) },
    pair: async (code) => { await identity.pairOwner(code) },
    repair: async () => { await runtime.disable(); await resetOwnedState(); await settings.update({ enabled: false }) },
    cleanup: () => attachments.cleanup(),
    test: async () => {
      const status = runtime.status()
      return { ok: status.connected, connected: status.connected }
    },
    setCredentials: async (appId, appSecret) => {
      const config = settings.get()
      await ctx.credentials.set(credentialRef(config.appSecretRef ?? LARK_APP_SECRET_REF), appSecret)
      await ctx.credentials.set(credentialRef(config.appIdRef ?? LARK_APP_ID_REF), appId)
    },
  }

  const capability = createLarkCapability()
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: LARK_CONTROL_PATH,
    handler: createLarkControlHandler(control, capability, ctx.webServer.port),
  }), 'lark: settings route')
  ctx.effect(
    () => ctx.webServer.tapIndex(html => injectLarkCapability(html, capability)),
    'lark: settings bootstrap',
  )
  ctx.effect(() => ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    void queue.onClaim(agent.id, message.id, turn)
  }), 'lark: inbox claim listener')
  ctx.effect(() => settings.watch(async (next, previous) => {
    if (next.enabled === previous.enabled) return
    if (next.enabled && !runtime.status().enabled) await runtime.enable()
    if (!next.enabled && runtime.status().enabled) await runtime.disable()
  }), 'lark: settings watcher')
  ctx.effect(() => async () => {
    await runtime.dispose()
    await domain.close()
  }, 'lark: runtime and storage')

  await binding.recover()
  if (settings.get().enabled) {
    try { await runtime.start(true) } catch { /* settings UI reports disconnected until credentials are fixed */ }
  }
}

const requireTransport = (transport: LarkTransport | undefined): LarkTransport => {
  if (transport === undefined) throw new Error('Lark transport is not connected')
  return transport
}

const frameTurn = (frame: MuxFrame): number | undefined => {
  if (frame.type !== 'session/event') return undefined
  const data = frame.event.data as unknown
  if (typeof data !== 'object' || data === null || !('turn' in data)) return undefined
  return typeof data.turn === 'number' ? data.turn : undefined
}

const turnOutcome = (reason: { kind: string }): 'completed' | 'cancelled' | 'failed' =>
  reason.kind === 'completed' ? 'completed' : reason.kind === 'aborted' || reason.kind === 'disposed' ? 'cancelled' : 'failed'
