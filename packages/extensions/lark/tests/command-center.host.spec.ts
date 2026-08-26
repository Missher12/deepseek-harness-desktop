import { describe, expect, test, vi } from 'vitest'
import {
  COMMAND_CENTER_MARKDOWN,
  CommandCenterService,
  foldSessionUsage,
  type CommandCenterHarness,
  type ModelDirectory,
} from '../src/command-center.ts'
import type { AdmittedMessage } from '../src/commands.ts'
import type { BindingRecord, CallbackNonceRecord, OwnerRecord } from '../src/state.ts'

const owner: OwnerRecord = {
  id: 'owner', openId: 'ou_owner', chatId: 'oc_dm', generation: 1,
  pairedAt: 1000, updatedAt: 1000,
}

const binding: BindingRecord = {
  id: 'owner', ownerOpenId: owner.openId, chatId: owner.chatId,
  workspaceId: 'workspace-1', projectPath: '/project', sessionId: 'session-1',
  generation: 1, state: 'active', boundAt: 1000, updatedAt: 1000,
}

const message = (text: string): AdmittedMessage => ({
  eventId: `event:${text}`, messageId: `message:${text}`,
  openId: owner.openId, chatId: owner.chatId, text,
})

const models: ModelDirectory = {
  current: { provider: 'deepseek', model: 'coder', reasoningEffort: 'high' },
  routable: true,
  failures: [],
  groups: [{
    id: 'deepseek', name: 'DeepSeek', models: [{
      id: 'coder', name: 'Coder',
      reasoning: {
        efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
        defaultEffort: 'low',
      },
    }],
  }],
}

function harness() {
  let issued = 0
  let currentBinding = binding
  const transport = {
    sendCard: vi.fn(async (_chatId: string, _card: unknown) => ({ messageId: 'om_card' })),
    sendText: vi.fn(async (_chatId: string, _text: string) => ({ messageId: 'om_text' })),
  }
  const identity = {
    owner: vi.fn(async () => owner),
    issueAction: vi.fn(async (action: CallbackNonceRecord['action'], generation: number, _ttl: number, data?: Record<string, string>) => ({
      nonce: `nonce-${++issued}`, action, generation, ...(data === undefined ? {} : { data }),
    })),
    admitAction: vi.fn(async ({ value }: { value: { action: CallbackNonceRecord['action']; data?: Record<string, string> } }) => ({
      id: 'nonce', ownerOpenId: owner.openId, chatId: owner.chatId, generation: 1,
      action: value.action, data: value.data, expiresAt: 2000, createdAt: 1000, usedAt: 1100,
    })),
  }
  const bindingController = {
    active: vi.fn(async () => currentBinding),
    bindCreated: vi.fn(async (_workspaceId: string, sessionId: string) => {
      currentBinding = { ...binding, sessionId, generation: 2 }
      return currentBinding
    }),
    statusText: vi.fn(async () => '已绑定 /project · session-1'),
  }
  const native = vi.fn(async () => ({ matched: true, kind: 'success' as const, text: 'ok' }))
  const createSession = vi.fn(async () => ({ sessionId: 'session-created' }))
  const selectModel = vi.fn(async (_sessionId: string, provider: string, model: string, reasoningEffort?: string) => ({
    provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }))
  const commandHarness: CommandCenterHarness = {
    createSession,
    renameSession: vi.fn(async (_sessionId: string, title: string) => ({ title })),
    models: vi.fn(async () => models),
    selectModel,
    executeNative: native,
    skills: vi.fn(async () => [{ name: 'review-code', description: 'Review the current changes.', modelInvocable: true }]),
    tools: vi.fn(async () => ['bash', 'read', 'apply_patch']),
    tasks: vi.fn(async () => ({
      jobs: [{ id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running', startedAt: 1000 }],
      subagents: [{
        id: 'child-1', mode: 'continuable' as const, activity: 'running' as const, label: 'review',
      }],
    })),
    usage: vi.fn(async () => ({
      completedTurns: 2,
      latest: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 },
      total: { inputTokens: 30, outputTokens: 12, cacheReadTokens: 8 },
    })),
    diagnostics: vi.fn(async () => ({
      connected: true, queueDepth: 0, agentStatus: 'idle', routable: true,
      commandCount: 4, skillCount: 1, toolCount: 3, jobCount: 1, subagentCount: 1,
    })),
  }
  const commitEvent = vi.fn(async () => {})
  const openProject = vi.fn(async () => {})
  const service = new CommandCenterService({
    transport, identity, binding: bindingController, harness: commandHarness,
    commitEvent, openProject,
  })
  return {
    service, transport, identity, bindingController, commandHarness, native, createSession,
    selectModel, commitEvent, openProject,
  }
}

describe('Harness-native Feishu command center', () => {
  test('counts only final assistant usage from completed turns', () => {
    expect(foldSessionUsage([
      { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 10, outputTokens: 2 } } },
      { type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 1, outputTokens: 3, cacheReadTokens: 4 } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'assistant/message', data: { turn: 2, usage: { inputTokens: 99, outputTokens: 99 } } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted' } } },
      { type: 'assistant/message', data: { turn: 3, usage: { inputTokens: 5, outputTokens: 6 } } },
      { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
    ])).toEqual({
      completedTurns: 2,
      latest: {
        inputTokens: 5, outputTokens: 6,
        cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
      },
      total: {
        inputTokens: 16, outputTokens: 11,
        cacheReadTokens: 4, cacheWriteTokens: 0, reasoningTokens: 0,
      },
    })
  })

  test('renders the complete catalog and signs only bounded safe actions', async () => {
    const h = harness()
    expect(COMMAND_CENTER_MARKDOWN).toContain('/新建')
    expect(COMMAND_CENTER_MARKDOWN).toContain('/模型')
    expect(COMMAND_CENTER_MARKDOWN).toContain('/技能')
    expect(COMMAND_CENTER_MARKDOWN).toContain('/诊断')
    await h.service.send(message('/'))
    expect(h.transport.sendCard).toHaveBeenCalledOnce()
    const rendered = JSON.stringify(h.transport.sendCard.mock.calls[0]![1])
    expect(rendered).toContain('/重命名 &lt;标题&gt;')
    expect(rendered).not.toContain('App Secret')
    const payload = h.transport.sendCard.mock.calls[0]![1] as {
      elements: Array<{ tag: string; actions?: unknown[] }>
    }
    expect(payload.elements.filter(element => element.tag === 'action')
      .every(element => (element.actions?.length ?? 0) <= 5)).toBe(true)
    expect(h.identity.issueAction).toHaveBeenCalled()
    expect(h.identity.issueAction.mock.calls.every(call => call[0] === 'command-action')).toBe(true)
  })

  test('creates and binds a Session, and maps only fixed native commands', async () => {
    const h = harness()
    await expect(h.service.handleText(message('/新建'), '/新建')).resolves.toBe('handled')
    expect(h.createSession).toHaveBeenCalledWith('workspace-1')
    expect(h.bindingController.bindCreated).toHaveBeenCalledWith('workspace-1', 'session-created')

    await h.service.handleText(message('/目标 ship it'), '/目标 ship it')
    expect(h.native).toHaveBeenCalledWith('session-created', '/goal ship it')
    await expect(h.service.handleText(message('/danger'), '/danger')).resolves.toBe('unknown')
    expect(h.native).not.toHaveBeenCalledWith(expect.anything(), '/danger')
    await expect(h.service.handleText(message('/review-code now'), '/review-code now')).resolves.toBe('enqueue')
  })

  test('revalidates signed model and reasoning choices against the current directory', async () => {
    const h = harness()
    await h.service.handleAction({
      openId: owner.openId,
      value: { nonce: 'n1', action: 'select-model', generation: 1, data: { provider: 'deepseek', model: 'coder' } },
    })
    expect(h.selectModel).toHaveBeenCalledWith('session-1', 'deepseek', 'coder', undefined)
    await h.service.handleAction({
      openId: owner.openId,
      value: {
        nonce: 'n2', action: 'select-reasoning', generation: 1,
        data: { provider: 'deepseek', model: 'coder', effort: 'low' },
      },
    })
    expect(h.selectModel).toHaveBeenLastCalledWith('session-1', 'deepseek', 'coder', 'low')
  })

  test('renders bounded read-only views without secret-bearing payloads', async () => {
    const h = harness()
    for (const text of ['/技能', '/工具', '/任务', '/用量', '/诊断']) {
      await h.service.handleText(message(text), text)
    }
    const output = h.transport.sendText.mock.calls.map(call => call[1]).join('\n')
    expect(output).toContain('review-code')
    expect(output).toContain('apply_patch')
    expect(output).toContain('bash-1')
    expect(output).toContain('总计 50')
    expect(output).toContain('可路由：是')
    expect(output).not.toMatch(/secret|nonce-|ou_owner|oc_dm/i)
  })
})
