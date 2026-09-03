import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import { BrowserSkillProbe, BROWSER_SKILL_STATUS_PATH } from './browser-skill.ts'
import { listWorkspace, readWorkspaceFile } from './files.ts'
import { gitDiff, gitStatus } from './review.ts'
import { WorkbenchTerminalRegistry } from './terminal.ts'

/** Exact route for directory listings. */
export const LIST_PATH = '/plugins/dsh-desktop-workbench/files/list'
/** Exact route for file previews. */
export const READ_PATH = '/plugins/dsh-desktop-workbench/files/read'
/** Exact route for Git status. */
export const REVIEW_PATH = '/plugins/dsh-desktop-workbench/review/status'
/** Exact route for Git diffs. */
export const DIFF_PATH = '/plugins/dsh-desktop-workbench/review/diff'
/** Exact route for terminal creation. */
export const TERMINAL_OPEN_PATH = '/plugins/dsh-desktop-workbench/terminal/open'
/** Exact route for terminal mutation. */
export const TERMINAL_ACTION_PATH = '/plugins/dsh-desktop-workbench/terminal/action'
/** Exact route for bounded terminal snapshots. */
export const TERMINAL_SNAPSHOT_PATH = '/plugins/dsh-desktop-workbench/terminal/snapshot'
/** Generation capability header name. */
export const WORKBENCH_CAPABILITY_HEADER = 'x-dsh-desktop-workbench-capability'
const BODY_LIMIT = 4096

function exactHeader(req: IncomingMessage, name: string): string | undefined {
  let value: string | undefined
  let count = 0
  for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() !== name.toLowerCase()) continue
    count += 1
    value = req.rawHeaders[index + 1]
  }
  return count === 1 ? value : undefined
}

function matches(left: string | undefined, right: string): boolean {
  if (left === undefined) return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function respond(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(Buffer.byteLength(body)) })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    length += bytes.length
    if (length > BODY_LIMIT) throw new Error('payload too large')
    chunks.push(bytes)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid request')
  return value as Record<string, unknown>
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value)
}

function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && !value.includes('\0')
}

function workspaceOf(ctx: Context, sessionId: string): string {
  const session = ctx.sessions.get(SessionId(sessionId))
  const cwd = session?.header.cwd
  if (cwd === undefined) throw new Error('session workspace unavailable')
  return cwd
}

/**
 * Install exact capability-bound workbench routes.
 * @param ctx - Host context providing sessions, WebServer, and subprocess.
 */
export function installWorkbenchHttp(ctx: Context): void {
  const capability = ctx.webServer.generationValue(
    'dsh-desktop-workbench.capability',
    () => randomBytes(32).toString('base64url'),
  )
  const authority = `127.0.0.1:${String(ctx.webServer.port)}`
  const origin = `http://${authority}`
  const terminals = new WorkbenchTerminalRegistry(spec => ctx.subprocess.spawnTerminal(spec))
  const browserSkill = new BrowserSkillProbe()
  const authorized = (req: IncomingMessage): boolean => (
    req.method === 'POST'
    && exactHeader(req, 'host') === authority
    && exactHeader(req, 'origin') === origin
    && matches(exactHeader(req, WORKBENCH_CAPABILITY_HEADER), capability)
  )
  const exactPost = (
    path: string,
    action: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): WebRoute => ({
    kind: 'exact', path,
    async handler(req, res) {
      if (!authorized(req)) {
        respond(res, 403, { error: 'forbidden' })
        return
      }
      try { await action(req, res) } catch (error: unknown) {
        ctx.logger.warn(`desktop-workbench ${path} rejected: ${error instanceof Error ? error.message : String(error)}`)
        respond(res, 400, { error: error instanceof Error ? error.message : 'request failed' })
      }
    },
  })
  const authenticated = (
    path: string,
    action: (body: Record<string, unknown>) => unknown,
  ): WebRoute => exactPost(path, async (req, res) => {
    respond(res, 200, await action(await readBody(req)))
  })
  const route = (
    path: string,
    action: (root: string, child: string | undefined) => Promise<unknown>,
  ): WebRoute => exactPost(path, async (req, res) => {
    const body = await readBody(req)
    if (!safeId(body.sessionId) || (body.path !== undefined && !safePath(body.path))) throw new Error('invalid request')
    respond(res, 200, await action(workspaceOf(ctx, body.sessionId), body.path))
  })
  ctx.effect(function* () {
    yield async () => { await terminals.closeAll(); browserSkill.dispose() }
    yield ctx.webServer.register(route(LIST_PATH, (root, child) => listWorkspace(root, child)))
    yield ctx.webServer.register(route(READ_PATH, (root, child) => {
      if (child === undefined || child === '') throw new Error('file path required')
      return readWorkspaceFile(root, child)
    }))
    yield ctx.webServer.register(route(REVIEW_PATH, root => gitStatus(root)))
    yield ctx.webServer.register(route(DIFF_PATH, (root, child) => gitDiff(root, child)))
    yield ctx.webServer.register(authenticated(TERMINAL_OPEN_PATH, async (body) => {
      if (!safeId(body.sessionId)) throw new Error('invalid request')
      return await terminals.open(capability, workspaceOf(ctx, body.sessionId), numberValue(body.rows), numberValue(body.cols))
    }))
    yield ctx.webServer.register(authenticated(TERMINAL_SNAPSHOT_PATH, (body) => {
      if (!safeId(body.sessionId)) throw new Error('invalid request')
      workspaceOf(ctx, body.sessionId)
      return { terminals: terminals.list(capability) }
    }))
    yield ctx.webServer.register(authenticated(TERMINAL_ACTION_PATH, async (body) => {
      if (!safeId(body.sessionId) || !safeId(body.id) || typeof body.action !== 'string') throw new Error('invalid request')
      workspaceOf(ctx, body.sessionId)
      if (body.action === 'write' && typeof body.value === 'string') await terminals.write(capability, body.id, body.value)
      else if (body.action === 'signal' && typeof body.value === 'string') await terminals.signal(capability, body.id, body.value)
      else if (body.action === 'close') await terminals.close(capability, body.id)
      else throw new Error('invalid terminal action')
      return { ok: true }
    }))
    yield ctx.webServer.register(authenticated(BROWSER_SKILL_STATUS_PATH, (body) => {
      if (!safeId(body.sessionId)) throw new Error('invalid request')
      workspaceOf(ctx, body.sessionId)
      return browserSkill.status()
    }))
    yield ctx.webServer.tapIndex(html => injectWorkbenchBootstrap(html, capability))
  }, 'desktop-workbench: read-only HTTP bridge')
}

/**
 * Inject the frozen generation capability into the trusted Client document.
 * @param html - base index document.
 * @param capability - generation-scoped random capability.
 * @returns index document with one early bootstrap script.
 */
export function injectWorkbenchBootstrap(html: string, capability: string): string {
  const data = {
    listPath: LIST_PATH, readPath: READ_PATH, reviewPath: REVIEW_PATH, diffPath: DIFF_PATH,
    terminalOpenPath: TERMINAL_OPEN_PATH, terminalActionPath: TERMINAL_ACTION_PATH,
    terminalSnapshotPath: TERMINAL_SNAPSHOT_PATH,
    browserSkillStatusPath: BROWSER_SKILL_STATUS_PATH,
    capabilityHeader: WORKBENCH_CAPABILITY_HEADER, capability,
  }
  const value = JSON.stringify(data).replaceAll('<', '\\u003c')
  const script = `<script data-dsh-desktop-workbench-bootstrap>window.__DSH_DESKTOP_WORKBENCH__=Object.freeze(${value})</script>`
  const head = html.indexOf('<head>')
  return head === -1 ? `${script}${html}` : `${html.slice(0, head + 6)}${script}${html.slice(head + 6)}`
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
