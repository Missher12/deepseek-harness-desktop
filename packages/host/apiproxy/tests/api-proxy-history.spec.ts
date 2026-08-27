/** Prompt-anchor projection carried by the ordinary-session tail history page. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`history-${String(nextRpc++)}`), payload }
}

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create()
  ctx.agents.register({
    id: session.id,
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
  } as Agent)
  return { ctx, session }
}

function appendUser(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

const api = (ctx: Context) => createApiProxy(ctx, {
  defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
  cwd: '/tmp',
})

describe('session.history prompt anchors', () => {
  it('projects opening and steering prompts from the immutable tail cut', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    appendUser(session, '  first\n\tprompt  ')
    appendUser(session, 'steer this turn')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    appendUser(session, `${'鲸'.repeat(50)} ignored tail`)

    const response = await api(ctx).sessions.history(request({ sessionId: session.id }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value).toMatchObject({
      promptAnchors: [
        { seq: 1, turn: 1, time: expect.any(Number), kind: 'turn-opening', preview: 'first prompt' },
        { seq: 2, turn: 1, time: expect.any(Number), kind: 'steering', preview: 'steer this turn' },
        { seq: 5, turn: 2, time: expect.any(Number), kind: 'turn-opening', preview: '鲸'.repeat(48) },
      ],
    })
    await ctx.fiber.dispose()
  })

  it('omits the all-history index from older pagination responses', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    appendUser(session, 'first')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const response = await api(ctx).sessions.history(request({
      sessionId: session.id,
      beforeSeq: 3,
      maxMessages: 1,
    }))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect('promptAnchors' in response.result.value).toBe(false)
    await ctx.fiber.dispose()
  })
})
