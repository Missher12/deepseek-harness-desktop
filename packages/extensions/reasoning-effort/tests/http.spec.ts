import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  SettingsProvider,
  settingsNamespace,
  type SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import {
  PREFERENCE_CAPABILITY_HEADER,
  PREFERENCE_PATH,
  createPreferenceHttpHandler,
  injectPreferenceCapability,
} from '../src/http.ts'
import {
  REASONING_EFFORT_SETTINGS_NAMESPACE,
  apply,
  inject,
} from '../src/index.ts'

const PORT = 50_288
const AUTHORITY = `127.0.0.1:${String(PORT)}`
const ORIGIN = `http://${AUTHORITY}`
const CAPABILITY = 'test-only-capability'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  readonly writes: Array<{ ns: SettingsNamespace; section: Record<string, unknown> }> = []

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve({})
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.writes.push({ ns, section: structuredClone(section) })
    return Promise.resolve()
  }
}

interface ResponseState {
  status?: number
  headers: Record<string, string>
  body: string
}

function request(
  method: string,
  headers: Record<string, string>,
  body?: string | Buffer,
): IncomingMessage {
  const req = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)]) as unknown as IncomingMessage
  Object.assign(req, {
    url: PREFERENCE_PATH,
    method,
    headers,
  })
  return req
}

function response(): { res: ServerResponse; state: ResponseState } {
  const state: ResponseState = { headers: {}, body: '' }
  const chunks: Buffer[] = []
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status
      state.headers = Object.fromEntries(
        Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      )
      return this
    },
    write(chunk: string | Uint8Array) {
      chunks.push(Buffer.from(chunk))
      return true
    },
    end(this: { writableEnded: boolean }, chunk?: string | Uint8Array) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
      state.body = Buffer.concat(chunks).toString('utf8')
      this.writableEnded = true
      return this
    },
  }) as unknown as ServerResponse
  return { res, state }
}

function validHeaders(method: 'GET' | 'PUT'): Record<string, string> {
  return {
    host: AUTHORITY,
    [PREFERENCE_CAPABILITY_HEADER]: CAPABILITY,
    ...(method === 'PUT' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
  }
}

function handlerHarness(initial = false) {
  let value = { chibiThumb: initial }
  let writes = 0
  const handler = createPreferenceHttpHandler({
    port: PORT,
    capability: CAPABILITY,
    read: () => value,
    write: async (next) => {
      writes += 1
      value = { ...next }
    },
  })
  return { handler, read: () => value, writes: () => writes }
}

async function invoke(
  handler: WebRoute['handler'],
  method: string,
  headers: Record<string, string>,
  body?: string | Buffer,
): Promise<ResponseState> {
  const result = response()
  await handler(request(method, headers, body), result.res)
  return result.state
}

describe('reasoning-effort preference HTTP fence', () => {
  it('serves a capability-authenticated GET and emits no CORS headers', async () => {
    const { handler } = handlerHarness(true)
    const state = await invoke(handler, 'GET', validHeaders('GET'))

    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ chibiThumb: true })
    expect(state.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(Object.keys(state.headers)).not.toContain('access-control-allow-origin')
  })

  it('allows a markerless same-host GET but refuses any supplied wrong Origin', async () => {
    const { handler } = handlerHarness()
    expect((await invoke(handler, 'GET', validHeaders('GET'))).status).toBe(200)
    expect((await invoke(handler, 'GET', {
      ...validHeaders('GET'), origin: 'http://localhost:50288',
    })).status).toBe(403)
  })

  it.each([
    ['localhost host', { host: 'localhost:50288' }],
    ['wrong port', { host: '127.0.0.1:50289' }],
    ['wrong capability', { [PREFERENCE_CAPABILITY_HEADER]: 'wrong' }],
  ])('refuses GET with %s', async (_label, changes) => {
    const { handler } = handlerHarness()
    const headers = { ...validHeaders('GET'), ...changes }
    expect((await invoke(handler, 'GET', headers)).status).toBe(403)
  })

  it('refuses GET without the per-generation capability', async () => {
    const { handler } = handlerHarness()
    expect((await invoke(handler, 'GET', { host: AUTHORITY })).status).toBe(403)
  })

  it('requires the exact Origin and capability for PUT before persisting', async () => {
    for (const headers of [
      { ...validHeaders('PUT'), origin: 'http://localhost:50288' },
      { ...validHeaders('PUT'), origin: 'http://127.0.0.1:50289' },
      Object.fromEntries(Object.entries(validHeaders('PUT')).filter(([key]) => key !== 'origin')),
      { ...validHeaders('PUT'), [PREFERENCE_CAPABILITY_HEADER]: 'wrong' },
    ]) {
      const harness = handlerHarness()
      const state = await invoke(harness.handler, 'PUT', headers, '{"chibiThumb":true}')
      expect(state.status).toBe(403)
      expect(harness.writes()).toBe(0)
    }
  })

  it('persists exactly one boolean and returns the accepted value', async () => {
    const harness = handlerHarness()
    const state = await invoke(
      harness.handler,
      'PUT',
      validHeaders('PUT'),
      JSON.stringify({ chibiThumb: true }),
    )

    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toEqual({ chibiThumb: true })
    expect(harness.read()).toEqual({ chibiThumb: true })
    expect(harness.writes()).toBe(1)
    expect(Object.keys(state.headers)).not.toContain('access-control-allow-origin')
  })

  it.each([
    ['missing field', {}],
    ['extra field', { chibiThumb: true, extra: false }],
    ['wrong type', { chibiThumb: 'true' }],
    ['array', [true]],
  ])('rejects a PUT with %s', async (_label, body) => {
    const harness = handlerHarness()
    const state = await invoke(harness.handler, 'PUT', validHeaders('PUT'), JSON.stringify(body))
    expect(state.status).toBe(400)
    expect(harness.writes()).toBe(0)
  })

  it('rejects malformed, non-JSON, and oversized bodies without persisting', async () => {
    const malformed = handlerHarness()
    expect((await invoke(malformed.handler, 'PUT', validHeaders('PUT'), '{')).status).toBe(400)

    const nonJson = handlerHarness()
    expect((await invoke(nonJson.handler, 'PUT', {
      ...validHeaders('PUT'), 'content-type': 'text/plain',
    }, '{"chibiThumb":true}')).status).toBe(415)

    const oversized = handlerHarness()
    expect((await invoke(
      oversized.handler,
      'PUT',
      validHeaders('PUT'),
      Buffer.alloc(1025, 0x20),
    )).status).toBe(413)
    expect(malformed.writes() + nonJson.writes() + oversized.writes()).toBe(0)
  })

  it('returns 405 with an exact Allow header for every other method', async () => {
    const { handler } = handlerHarness()
    for (const method of ['POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      const state = await invoke(handler, method, validHeaders('GET'))
      expect(state.status).toBe(405)
      expect(state.headers.allow).toBe('GET, PUT')
      expect(Object.keys(state.headers)).not.toContain('access-control-allow-origin')
    }
  })
})

describe('reasoning-effort Host registration', () => {
  it('injects escaped per-generation bootstrap data into the first head script', () => {
    const html = injectPreferenceCapability(
      '<html><head><script src="shell.js"></script></head></html>',
      'safe</script><script>unsafe()',
    )

    expect(html.indexOf('data-dsh-reasoning-effort-bootstrap')).toBeLessThan(html.indexOf('shell.js'))
    expect(html).toContain('safe\\u003c/script>\\u003cscript>unsafe()')
    expect(html).not.toContain('safe</script><script>unsafe()')
    expect(html).toContain(PREFERENCE_PATH)
    expect(html).toContain(PREFERENCE_CAPABILITY_HEADER)
    expect(html).not.toContain('DSH_HOME')
  })

  it('registers the durable namespace, exact route, and tap, then disposes only its own entries', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const routes: WebRoute[] = []
    const taps: Array<(html: string) => string> = []
    const unrelated: WebRoute = { kind: 'exact', path: '/unrelated', handler: () => undefined }
    routes.push(unrelated)
    ctx.provide('webServer', {
      port: PORT,
      register(route: WebRoute) {
        routes.push(route)
        return () => { routes.splice(routes.indexOf(route), 1) }
      },
      tapIndex(tap: (html: string) => string) {
        taps.push(tap)
        return () => { taps.splice(taps.indexOf(tap), 1) }
      },
    } as WebServer)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.settings.get(settingsNamespace(REASONING_EFFORT_SETTINGS_NAMESPACE)))
      .toEqual({ chibiThumb: false })
    expect(routes).toHaveLength(2)
    expect(routes[1]).toMatchObject({ kind: 'exact', path: PREFERENCE_PATH })
    expect(taps).toHaveLength(1)

    const boot = taps[0]!('<head></head>')
    const capability = /"capability":"([^"]+)"/.exec(boot)?.[1]
    expect(capability).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    const put = await invoke(routes[1]!.handler, 'PUT', {
      host: AUTHORITY,
      origin: ORIGIN,
      'content-type': 'application/json',
      [PREFERENCE_CAPABILITY_HEADER]: capability!,
    }, '{"chibiThumb":true}')
    expect(put.status).toBe(200)
    expect(ctx.settings.get(settingsNamespace(REASONING_EFFORT_SETTINGS_NAMESPACE)))
      .toEqual({ chibiThumb: true })
    expect((ctx.settings as MemorySettings).writes).toHaveLength(1)

    await fiber.dispose()
    expect(routes).toEqual([unrelated])
    expect(taps).toHaveLength(0)
    expect(ctx.settings.get(settingsNamespace(REASONING_EFFORT_SETTINGS_NAMESPACE))).toBeUndefined()
  })

  it('does not mount any Host surface until both required services exist', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    ctx.provide('webServer', {
      port: PORT,
      register(route: WebRoute) {
        routes.push(route)
        return () => { routes.splice(routes.indexOf(route), 1) }
      },
      tapIndex: () => () => undefined,
    } as WebServer)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(routes).toHaveLength(0)
    await fiber.dispose()
  })
})
