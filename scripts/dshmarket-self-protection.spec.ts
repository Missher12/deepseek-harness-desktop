import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginCommandRuntime } from '../apps/desktop/node_modules/dshmarket/lib/types/dsh-cli.d.ts'

type MountMarketRoutes = typeof import('../apps/desktop/node_modules/dshmarket/lib/types/routes.d.ts').mountMarketRoutes

const root = resolve(import.meta.dirname, '..')
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'))
const packageRoot = dirname(desktopRequire.resolve('dshmarket/package.json'))
const routesUrl = pathToFileURL(join(packageRoot, 'src/routes.ts')).href
const { mountMarketRoutes } = await import(routesUrl) as { mountMarketRoutes: MountMarketRoutes }

type Handler = (request: never, response: never) => void | Promise<void>

interface Testbed {
  dispatch(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }>
  dispose(): void
}

function makeProfile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dshmarket-self-protection-'))
  mkdirSync(join(directory, 'node_modules/dsh-loop'), { recursive: true })
  mkdirSync(join(directory, 'node_modules/dshmarket'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    dependencies: { 'dsh-loop': '^1.0.0', dshmarket: '1.10.1' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-loop'] } },
  }))
  writeFileSync(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  writeFileSync(join(directory, 'node_modules/dsh-loop/package.json'), JSON.stringify({ name: 'dsh-loop', version: '1.0.0', dsh: {} }))
  writeFileSync(join(directory, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'dshmarket', version: '1.10.1', dsh: {} }))
  return directory
}

function createTestbed(profileDirectory: string, runtime: PluginCommandRuntime): Testbed {
  const routes = new Map<string, Handler>()
  const host = {
    webServer: {
      register(route: { path: string; handler: Handler }) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    loader: { entries: () => [] },
    plugin: () => ({ await: () => Promise.resolve(), dispose: () => {} }),
    on: () => () => {},
  }
  const dispose = mountMarketRoutes(host, {
    profile: 'web',
    profileDirectory,
    allowRestart: false,
  }, runtime)
  return {
    dispose,
    async dispatch(path, body) {
      const handler = routes.get(path)
      if (handler === undefined) throw new Error(`missing route: ${path}`)
      const requestBody = Buffer.from(JSON.stringify(body))
      const request = {
        method: 'POST',
        url: path,
        headers: { host: '127.0.0.1:43123', origin: 'http://127.0.0.1:43123' },
        socket: { remoteAddress: '127.0.0.1' },
        async *[Symbol.asyncIterator]() { yield requestBody },
      }
      let status = 0
      let payload = ''
      const response = {
        writeHead(code: number) { status = code },
        end(value?: string) { payload = value ?? '' },
      }
      await handler(request as never, response as never)
      return { status, json: JSON.parse(payload) as Record<string, unknown> }
    },
  }
}

describe('active marketplace self-protection', () => {
  let profileDirectory = ''
  let runPlugin: ReturnType<typeof vi.fn<PluginCommandRuntime['runPlugin']>>
  let bed: Testbed

  beforeEach(() => {
    profileDirectory = makeProfile()
    runPlugin = vi.fn(async (_profile, args) => {
      const name = args.at(-1) === 'dsh-loop@latest' ? 'dsh-loop' : 'dshmarket'
      const file = join(profileDirectory, 'node_modules', name, 'package.json')
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      manifest.version = name === 'dsh-loop' ? '1.1.0' : '1.11.0'
      writeFileSync(file, JSON.stringify(manifest))
      return { exitCode: 0, timedOut: false, stdout: '', stderr: '', cancelled: false }
    })
    bed = createTestbed(profileDirectory, {
      runPlugin,
      probePnpm: () => Promise.resolve(true),
      provisionPnpm: () => Promise.resolve({ ok: true }),
      cancelActive: () => false,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '1.11.0' }), { status: 200 })))
  })

  afterEach(() => {
    bed.dispose()
    vi.unstubAllGlobals()
    rmSync(profileDirectory, { recursive: true, force: true })
  })

  it.each([
    ['/dsh-market/toggle', { name: 'dshmarket', enabled: false }],
    ['/dsh-market/toggle', { name: 'dsh-market', enabled: false }],
    ['/dsh-market/uninstall', { name: 'dshmarket' }],
    ['/dsh-market/uninstall', { name: 'dsh-market' }],
    ['/dsh-market/update', { name: 'dshmarket' }],
    ['/dsh-market/update', { name: 'dsh-market' }],
  ])('rejects %s for the active market before executing a package command', async (path, body) => {
    const result = await bed.dispatch(path, body)
    expect(result).toEqual({ status: 409, json: { ok: false, code: 'self-protected' } })
    expect(runPlugin).not.toHaveBeenCalled()
  })

  it('preserves ordinary plugin update success through the existing runner', async () => {
    const result = await bed.dispatch('/dsh-market/update', { name: 'dsh-loop' })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true })
    expect(runPlugin).toHaveBeenCalledWith('web', ['add', 'dsh-loop@latest'])
  })

  it('rolls back both manifest fields when a plugin update is cancelled', async () => {
    const before = readFileSync(join(profileDirectory, 'package.json'), 'utf8')
    runPlugin.mockImplementationOnce(async () => {
      const file = join(profileDirectory, 'package.json')
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }
      manifest.dependencies['dsh-ghost'] = '0.2.1'
      manifest.dsh.profile.bundles.push('dsh-ghost')
      writeFileSync(file, JSON.stringify(manifest))
      return { exitCode: 130, timedOut: false, stdout: '', stderr: '', cancelled: true }
    })

    const result = await bed.dispatch('/dsh-market/update', { name: 'dsh-loop' })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: false, cancelled: true })
    expect(JSON.parse(readFileSync(join(profileDirectory, 'package.json'), 'utf8')))
      .toEqual(JSON.parse(before))
  })

  it('repairs only a proven-missing bundle residue after creating a backup', async () => {
    const file = join(profileDirectory, 'package.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dsh.profile.bundles.push('@example/missing-carrier')
    writeFileSync(file, JSON.stringify(manifest))

    const result = await bed.dispatch('/dsh-market/repair-bundle-residue', { name: '@example/missing-carrier' })
    expect(result).toMatchObject({
      status: 200,
      json: { ok: true, removed: '@example/missing-carrier', restartRequired: true },
    })
    const repaired = JSON.parse(readFileSync(file, 'utf8')) as typeof manifest
    expect(repaired.dsh.profile.bundles).not.toContain('@example/missing-carrier')
    const [backupName] = readdirSync(join(profileDirectory, '.dsh-market-backups'))
    if (backupName === undefined) throw new Error('expected a bundle residue backup')
    expect(readFileSync(join(profileDirectory, '.dsh-market-backups', backupName), 'utf8'))
      .toContain('@example/missing-carrier')
  })

  it('keeps self-update and self-uninstall stable while an ordinary operation is busy', async () => {
    let finish: (() => void) | undefined
    const pending = new Promise<Awaited<ReturnType<PluginCommandRuntime['runPlugin']>>>((resolve) => {
      finish = () => {
        resolve({
          exitCode: 1,
          timedOut: false,
          stdout: '',
          stderr: 'expected smoke hold',
          cancelled: false,
        })
      }
    })
    runPlugin.mockImplementationOnce(async () => await pending)

    const ordinary = bed.dispatch('/dsh-market/update', { name: 'dsh-loop' })
    await vi.waitFor(() => { expect(runPlugin).toHaveBeenCalledOnce() })

    await expect(bed.dispatch('/dsh-market/update', { name: 'dshmarket' }))
      .resolves.toEqual({ status: 409, json: { ok: false, code: 'self-protected' } })
    await expect(bed.dispatch('/dsh-market/uninstall', { name: 'dsh-market' }))
      .resolves.toEqual({ status: 409, json: { ok: false, code: 'self-protected' } })

    finish?.()
    await ordinary
  })
})
