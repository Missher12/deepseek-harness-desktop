import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  ApiSessionAgentController,
} from '@deepseek-ai/dsh-api-session-controller/src/agent.ts'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'

function header(id: string, cwd: string | null = '/proj'): SessionHeader {
  return {
    version: 0,
    id: SessionId(id),
    createdAt: 1,
    ...(cwd === null ? {} : { cwd }),
  }
}

function observation(meta: SessionHeader, events: readonly SessionEvent[] = []): object {
  return {
    source: 'prepared',
    header: meta,
    events: [...events],
    cursor: events.at(-1)?.seq ?? -1,
    projections: { asOfSeq: events.at(-1)?.seq ?? -1, values: {} },
    retain: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }
}

async function harness(
  observeSession: (sessionId: SessionId, ctx: Context) => Promise<object>,
): Promise<{ ctx: Context; agents: ApiSessionAgentController }> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  ctx.provide('sessionQuery', {
    observeSession: (sessionId: SessionId) => observeSession(sessionId, ctx),
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  return { ctx, agents: new ApiSessionAgentController(ctx) }
}

function stubAgent(ctx: Context, session: Session): Agent {
  return { id: session.id, session, status: 'idle', ctx } as Agent
}

describe('official API Session Agent lookup', () => {
  it('maps a persisted identity without a cwd to session/not-found', async () => {
    const meta = header('missing-after-inspect', null)
    const { ctx, agents } = await harness(() => Promise.resolve(observation(meta)))
    const resume = vi.spyOn(ctx.agents, 'resume')

    await expect(agents.resolveAgent(meta.id)).resolves.toMatchObject({
      error: { code: 'session/not-found', details: { sessionId: meta.id } },
    })
    expect(resume).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('shares one cold resume across concurrent lookup callers', async () => {
    const meta = header('shared-cold-resume')
    const observeSession = vi.fn(() => Promise.resolve(observation(meta)))
    const { ctx, agents } = await harness(observeSession)
    const session = ctx.sessions.create(meta.id, { meta })
    const live = stubAgent(ctx, session)
    const gate = Promise.withResolvers<undefined>()
    const resume = vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      await gate.promise
      return { agent: live, dispose: () => Promise.resolve() }
    })

    const first = agents.resolveAgent(meta.id)
    const second = agents.resolveAgent(meta.id)
    gate.resolve()

    await expect(Promise.all([first, second])).resolves.toEqual([{ agent: live }, { agent: live }])
    expect(observeSession).toHaveBeenCalledOnce()
    expect(resume).toHaveBeenCalledOnce()
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: meta.id,
      agentOptions: { provider: 'fixture', model: 'fixture-model' },
    }))
    await ctx.fiber.dispose()
  })

  it('retains the exact resumed handle as the controller-owned disposal capability', async () => {
    const meta = header('owned-cold-resume')
    const { ctx, agents } = await harness(() => Promise.resolve(observation(meta)))
    const session = ctx.sessions.create(meta.id, { meta })
    const live = stubAgent(ctx, session)
    let detach = (): void => {}
    const dispose = vi.fn(async () => { detach() })
    vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      detach = ctx.agents.register(live)
      return { agent: live, dispose }
    })

    await expect(agents.resolveAgent(meta.id)).resolves.toEqual({ agent: live })
    await expect(agents.releaseForDelete(meta.id)).resolves.toEqual({ cold: false })
    expect(dispose).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('rejects a subagent Session published after durable inspection', async () => {
    const meta = header('owned-attach-race')
    const bench = await harness((_sessionId, ctx) => {
      ctx.sessions.create(meta.id, { meta: { ...meta, origin: 'subagent' } })
      return Promise.resolve(observation(meta))
    })
    const resume = vi.spyOn(bench.ctx.agents, 'resume')

    await expect(bench.agents.resolveAgent(meta.id)).resolves.toMatchObject({
      error: { code: 'session/agent-busy' },
    })
    expect(resume).not.toHaveBeenCalled()
    await bench.ctx.fiber.dispose()
  })

  it('reclassifies failed resumes after a live or attached subagent wins publication', async () => {
    for (const winner of ['agent', 'session'] as const) {
      const meta = header(`owned-${winner}-resume-race`)
      const { ctx, agents } = await harness(() => Promise.resolve(observation(meta)))
      vi.spyOn(ctx.agents, 'resume').mockImplementationOnce(async () => {
        const child = ctx.sessions.create(meta.id, { meta: { ...meta, origin: 'subagent' } })
        if (winner === 'agent') ctx.agents.register(stubAgent(ctx, child))
        throw new Error('session id already published')
      })

      await expect(agents.resolveAgent(meta.id)).resolves.toMatchObject({
        error: { code: 'session/agent-busy' },
      })
      await ctx.fiber.dispose()
    }
  })

  it('uses the configured lookup for Agent and Agent Host Context resolution', async () => {
    const meta = header('configured-live-lookup')
    const { ctx } = await harness(() => Promise.resolve(observation(meta)))
    const session = ctx.sessions.create(meta.id, { meta })
    const agentCtx = ctx.extend()
    const live = stubAgent(agentCtx, session)
    ctx.agents.register(live)
    const lookup = ctx.typert.lookups.get('agent')
    const hostContext = ctx.typert.contexts.getHost('agent')
    if (lookup === undefined || hostContext === undefined) {
      throw new Error('Agent lookup and Host Context adapters were not mounted')
    }

    await expect(lookup.resolve(meta.id)).resolves.toBe(live)
    await expect(hostContext.resolve(meta.id)).resolves.toBe(agentCtx)
    await ctx.fiber.dispose()
  })

  it('propagates subagent lookup failures as RemoteError without a legacy wrapper', async () => {
    const meta = { ...header('configured-subagent-lookup'), origin: 'subagent' as const }
    const { ctx } = await harness(() => Promise.resolve(observation(meta)))
    const session = ctx.sessions.create(meta.id, { meta })
    ctx.agents.register(stubAgent(ctx.extend(), session))
    const lookup = ctx.typert.lookups.get('agent')
    const hostContext = ctx.typert.contexts.getHost('agent')
    if (lookup === undefined || hostContext === undefined) {
      throw new Error('Agent lookup and Host Context adapters were not mounted')
    }

    const lookupFailure = Promise.resolve().then(() => lookup.resolve(meta.id))
    await expect(lookupFailure).rejects.toBeInstanceOf(RemoteError)
    await expect(lookupFailure).rejects.toMatchObject({ code: 'session/agent-busy' })
    const contextFailure = Promise.resolve().then(() => hostContext.resolve(meta.id))
    await expect(contextFailure).rejects.toBeInstanceOf(RemoteError)
    await expect(contextFailure).rejects.toMatchObject({ code: 'session/agent-busy' })
    await ctx.fiber.dispose()
  })
})
