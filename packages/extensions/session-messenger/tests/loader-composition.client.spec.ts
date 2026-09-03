/**
 * Product composition account for the independently removable messenger:
 * the real Host Loader/runtime surfaces and the real Client Loader/slot
 * surface. Thin fixtures supply only external Host
 * policy and storage boundaries; messenger exports and runtime registries are
 * never copied into the test.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Inbox } from '@deepseek-ai/dsh-agent'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import ClientModuleRegistry from '@deepseek-ai/dsh-client-modules'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import CodeRuntime from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import * as SessionMessengerClient from '../src/client/index.tsx'
import {
  ACK_PATH,
  EVENTS_PATH,
  MESSENGER_BOOTSTRAP_GLOBAL,
  REPLY_PATH,
  SEND_PATH,
  SNAPSHOT_PATH,
} from '../src/http.ts'
import * as SessionMessenger from '../src/index.ts'
import { createSessionMessengerToolDefinitions } from '../src/tools.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-messenger'
const CLIENT_SPECIFIER = `${PACKAGE_NAME}/client`
const TOOL_NAMES = createSessionMessengerToolDefinitions(
  () => { throw new Error('schema-only coordinator') },
  () => { throw new Error('schema-only waiter') },
).map(definition => definition.name)

const temporaryRoots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  await Promise.all(temporaryRoots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) }))
})

class StubCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fixture'

  run(_request: CodeRunRequest): Promise<CodeRunResult> {
    return Promise.resolve({ logs: [] })
  }
}

/** One ordinary live Agent backed by the real Session/Inbox durability path. */
function ordinaryAgent(ctx: Context, id: string): Agent {
  const session = Session.create(SessionId(id))
  const agentRef: { current?: Agent } = {}
  const currentAgent = (): Agent => {
    if (agentRef.current === undefined) throw new Error('agent is not initialized')
    return agentRef.current
  }
  const inbox = new Inbox(session, {
    inserted(message) { ctx.emit('agent/inbox/inserted', { agent: currentAgent(), message }) },
    discarded(message) { ctx.emit('agent/inbox/discarded', { agent: currentAgent(), message }) },
    claimed(message, turn) { ctx.emit('agent/inbox/claimed', { agent: currentAgent(), message, turn }) },
  })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    status: 'idle',
    ctx,
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: task => task(new AbortController().signal),
    send(message, target) { inbox.append(target, message) },
    followup(message) { inbox.append('next-turn', message) },
    steer(message) { inbox.prepend('next-step', message) },
    inject(message) { inbox.prepend('next-step', message) },
  }
  agentRef.current = agent
  return agent
}

/** Install only the Host-owned policy/storage seams messenger injects. */
function provideHostBoundaries(ctx: Context): { source: Agent; target: Agent } {
  const source = ordinaryAgent(ctx, 'source-session')
  const target = ordinaryAgent(ctx, 'target-session')
  const agents = new Map([[source.id, source], [target.id, target]])
  const records = new Map<string, unknown>()
  ctx.provide('storageDomain', {
    async open() {
      return {
        table: () => ({
          get: (id: string) => records.get(id),
          entries: () => records.entries(),
          put: async (id: string, value: unknown) => { records.set(id, structuredClone(value)) },
          delete: async (id: string) => records.delete(id),
        }),
        close: () => Promise.resolve(),
      }
    },
  })
  ctx.provide('workspaceRegistry', { archivedSessionIds: [] })
  ctx.provide('typert', {
    lookups: {
      get: (name: string) => name === 'agent'
        ? { resolve: (id: SessionId) => Promise.resolve(agents.get(id)) }
        : undefined,
    },
  })
  ctx.provide('agents', {
    get: (id: SessionId) => agents.get(id),
    isOwnedBy: () => false,
  })
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([...agents.values()].map(agent => agent.session.header)),
    inspect: async (id: SessionId) => {
      const agent = agents.get(id)
      if (agent === undefined) throw new Error('session not found')
      return { events: agent.session.snapshotEvents() }
    },
  })
  return { source, target }
}

async function writeResolvableMessengerPackage(root: string): Promise<void> {
  const packageRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh-session-messenger')
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), await readFile(new URL('../package.json', import.meta.url)))
  await writeFile(join(packageRoot, 'lib/client.js'), 'export {}\n')
}

async function bootLoader(
  lines: readonly string[],
  modules: ReadonlyMap<string, unknown>,
  setup?: (ctx: Context) => void,
  prepare?: (root: string) => Promise<void>,
): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-messenger-loader-'))
  temporaryRoots.push(root)
  await prepare?.(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  setup?.(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return { ctx, root }
}

function messengerEntry(ctx: Context, specifier = PACKAGE_NAME) {
  const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === specifier)
  if (entry === undefined) throw new Error(`missing Loader entry: ${specifier}`)
  return entry
}

function occurrences(value: string, token: string): number {
  return value.split(token).length - 1
}

describe('real Host Loader composition', () => {
  it('assembles native/Code tools and removes every ephemeral surface while retaining committed messages', { timeout: 60_000 }, async () => {
    let agents!: { source: Agent; target: Agent }
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@fixture/code-runtime', StubCodeRuntime],
      ['@deepseek-ai/dsh-host-webserver', HttpServer],
      [PACKAGE_NAME, SessionMessenger],
      ['@fixture/client-modules', ClientModuleRegistry],
    ])
    const { ctx } = await bootLoader([
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@fixture/code-runtime'",
      "- name: '@deepseek-ai/dsh-host-webserver'",
      '  config:',
      "    host: '127.0.0.1'",
      '    port: 0',
      `- name: '${PACKAGE_NAME}'`,
      "- name: '@fixture/client-modules'",
    ], modules, (host) => { agents = provideHostBoundaries(host) }, writeResolvableMessengerPackage)

    const native = await ctx.systemPrompt.assemble({ agent: agents.source })
    expect(native.tools.map(tool => tool.name).sort()).toEqual([...TOOL_NAMES].sort())
    let codeScope!: ReturnType<typeof createScope>
    const codeOwner = ctx.plugin(Object.assign((host: Context) => {
      codeScope = createScope(host, agents.source)
      codeScope.ctx.tools.presentAs('ptc')
    }, { inject: ['tools', 'systemPrompt'] }))
    await codeOwner.await()
    const code = await ctx.systemPrompt.assemble({ agent: agents.source, scope: agents.source })
    expect(code.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    const sdk = code.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
    for (const name of TOOL_NAMES) expect(sdk).toContain(name)
    await codeOwner.dispose()

    for (const path of [SNAPSHOT_PATH, ACK_PATH, EVENTS_PATH, SEND_PATH, REPLY_PATH]) {
      expect((await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}${path}`)).status).toBe(403)
    }
    expect((await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}/plugins/dsh-session-messenger/other`)).status).toBe(404)
    const tapped = ctx.webServer.applyIndexTaps('<html><head></head></html>')
    expect(tapped).toContain(MESSENGER_BOOTSTRAP_GLOBAL)
    expect(occurrences(tapped, 'data-dsh-session-messenger-bootstrap')).toBe(1)
    expect(ctx.clientModules.graph().entries.filter(entry => entry.id === PACKAGE_NAME)).toHaveLength(1)

    const sent = await ctx.tools.execute({
      callId: ToolCallId('loader-send'),
      signal: new AbortController().signal,
      agent: agents.source,
      name: TOOL_NAMES[0]!,
      arguments: { target_session_id: agents.target.id, message: 'retained after unload' },
    })
    if (sent.value === undefined) throw new Error(`loader send failed: ${JSON.stringify(sent)}`)
    const deliveryId = (sent.value as { deliveryId: string }).deliveryId
    const committed = structuredClone(agents.target.session.snapshotEvents())
    expect(committed.some(event => event.type === 'agent/inbox/spliced')).toBe(true)
    const waiting = ctx.tools.execute({
      callId: ToolCallId('loader-wait'),
      signal: new AbortController().signal,
      agent: agents.source,
      name: TOOL_NAMES[3]!,
      arguments: { delivery_id: deliveryId, timeout_ms: 55_000 },
    })
    await Promise.resolve()

    await messengerEntry(ctx).update({ disabled: true })
    expect(ctx.tools.schemas().map(schema => schema.name).filter(name => TOOL_NAMES.includes(name as never))).toEqual([])
    for (const path of [SNAPSHOT_PATH, ACK_PATH, EVENTS_PATH, SEND_PATH, REPLY_PATH]) {
      expect((await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}${path}`)).status).toBe(404)
    }
    const untapped = ctx.webServer.applyIndexTaps('<html><head></head></html>')
    expect(untapped).not.toContain(MESSENGER_BOOTSTRAP_GLOBAL)
    await vi.waitFor(() => {
      expect(ctx.clientModules.graph().entries.some(entry => entry.id === PACKAGE_NAME)).toBe(false)
    })
    await expect(waiting).resolves.toMatchObject({ value: { status: 'disposed', errorCode: 'disposed' } })
    expect(agents.target.session.snapshotEvents()).toEqual(committed)
  })
})

describe('real Client Loader composition', () => {
  it('owns no header or drawer surface because relays render in the chat timeline', async () => {
    const LocaleProvider = {
      name: 'fixture-locale',
      apply(ctx: Context) { ctx.provide('locale', new LocaleRuntime(ctx)) },
    }
    const SurfaceOwner = {
      name: 'fixture-surface-owner',
      inject: ['slots'],
      apply(ctx: Context) {
        ctx.slots.register({
          name: 'root',
          children: {
            'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
            'shell.overlay': { kind: 'list', scope: 'root' },
          },
        } as never, () => null)
      },
    }
    const { ctx } = await bootLoader([
      "- name: '@deepseek-ai/dsh-client-runtime/client'",
      "- name: '@fixture/locale'",
      "- name: '@fixture/surface-owner'",
      `- name: '${CLIENT_SPECIFIER}'`,
    ], new Map<string, unknown>([
      ['@deepseek-ai/dsh-client-runtime/client', SlotRegistry],
      ['@fixture/locale', LocaleProvider],
      ['@fixture/surface-owner', SurfaceOwner],
      [CLIENT_SPECIFIER, SessionMessengerClient],
    ]))

    const header = ctx.slots.entries('conversation.session.header.utilities')
    const overlay = ctx.slots.entries('shell.overlay')
    expect(header).toEqual([])
    expect(overlay).toEqual([])
    const messengerOccupants = ctx.slots.snapshot().flatMap(function visit(node): string[] {
      return [
        ...node.occupants
          .filter(occupant => occupant.id === 'session-messenger' || occupant.id === 'session-messenger-drawer')
          .map(() => node.name),
        ...node.children.flatMap(visit),
      ]
    })
    expect(messengerOccupants).toEqual([])

    await messengerEntry(ctx, CLIENT_SPECIFIER).update({ disabled: true })
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(ctx.slots.entries('shell.overlay')).toEqual([])
    expect(ctx.slots.snapshot().flatMap(node => node.occupants)
      .some(row => row.id === 'session-messenger' || row.id === 'session-messenger-drawer')).toBe(false)
  })
})
