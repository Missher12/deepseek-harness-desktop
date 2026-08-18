import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopStagePnpmInvocation,
  stageDesktop,
  validateReasoningEffortPatch,
  type StageDesktopDependencies,
} from './stage-desktop.ts'

const VALID_DESKTOP_PATCH = `
- insert:
    - id: desktop-plugin-runtime
      name: '@deepseek-ai/dsh-host-desktop-plugin-runtime'
    - id: reasoning-effort
      name: '@deepseek-ai/dsh-reasoning-effort'
    - id: session-messenger
      name: '@deepseek-ai/dsh-session-messenger'
    - id: dsh-market
      name: 'dshmarket'
`
const DEFAULT_NATIVE_BINARIES = ['/repo/apps/desktop/.stage/node_modules/node-pty/prebuilds/darwin-x64/pty.node'] as const
const DEFAULT_MARKET_PACKAGE_DIRECTORIES = [
  '/repo/apps/desktop/.stage/node_modules/.pnpm/dshmarket/node_modules/dshmarket',
] as const

function fakeDependencies(
  filesPresent = true,
  nativeBinaries: readonly string[] = DEFAULT_NATIVE_BINARIES,
  semanticOverrides: Readonly<Record<string, string>> = {},
  marketPackageDirectories: readonly string[] = DEFAULT_MARKET_PACKAGE_DIRECTORIES,
  desktopPatch = VALID_DESKTOP_PATCH,
): StageDesktopDependencies & {
  commands: Array<[string, readonly string[]]>
  copies: Array<[string, string]>
  events: string[]
  removed: string[]
  validated: string[]
  read: string[]
} {
  const commands: Array<[string, readonly string[]]> = []
  const copies: Array<[string, string]> = []
  const events: string[] = []
  const removed: string[] = []
  const validated: string[] = []
  const read: string[] = []
  const semanticFiles: Readonly<Record<string, string>> = {
    'node_modules/dshmarket/package.json': JSON.stringify({ name: 'dshmarket', version: '1.10.1' }),
    'node_modules/dshmarket/src/client/MarketSection.tsx': 'data-dshmarket-layout="compact"',
    'node_modules/dshmarket/client/client.js': 'data-dshmarket-layout compact',
    'node_modules/dshmarket/client/client.js.map': 'data-dshmarket-layout compact sourcesContent',
    'node_modules/dshmarket/lib/routes.js': "code: 'self-protected'",
    ...semanticOverrides,
  }
  return {
    commands,
    copies,
    events,
    removed,
    validated,
    read,
    remove: async (path) => { removed.push(path); events.push(`remove:${path}`) },
    pnpmInvocation: args => ({ command: 'pnpm', args }),
    run: (command, args) => { commands.push([command, args]); events.push(`run:${command}`) },
    copy: async (source, target) => { copies.push([source, target]) },
    isFile: async (path) => {
      validated.push(path)
      return filesPresent
    },
    readText: async (path) => {
      read.push(path)
      const portablePath = path.replaceAll('\\', '/')
      if (portablePath.endsWith('apps/desktop/desktop.cordis.patch.yml')) {
        events.push(`read:${path}`)
        return desktopPatch
      }
      const entry = Object.entries(semanticFiles).find(([suffix]) => portablePath.endsWith(suffix))
      if (entry === undefined) throw new Error(`Unexpected semantic read: ${path}`)
      return entry[1]
    },
    findPackageDirectories: async () => marketPackageDirectories,
    findNativeBinaries: async () => nativeBinaries,
  }
}

describe('stageDesktop', () => {
  it('spawns pnpm through its JavaScript entrypoint without a platform shell', () => {
    expect(desktopStagePnpmInvocation(
      ['--filter', '@deepseek-ai/dsh-desktop'],
      { npm_execpath: 'C:\\pnpm\\pnpm.cjs' },
      'C:\\node\\node.exe',
    )).toEqual({
      command: 'C:\\node\\node.exe',
      args: ['C:\\pnpm\\pnpm.cjs', '--filter', '@deepseek-ai/dsh-desktop'],
    })
  })

  it('fails closed when pnpm does not expose its JavaScript entrypoint', () => {
    expect(() => desktopStagePnpmInvocation([], {}, '/node')).toThrow(/npm_execpath.*pnpm package script/i)
  })

  it('deploys production dependencies and validates the complete app closure', async () => {
    const dependencies = fakeDependencies()

    const result = await stageDesktop('/repo', dependencies)

    expect(dependencies.commands).toEqual([
      ['pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'deploy', '--legacy', '/repo/apps/desktop/.stage']],
    ])
    expect(dependencies.copies).toEqual([
      ['/repo/apps/desktop/lib', '/repo/apps/desktop/.stage/lib'],
      ['/repo/apps/desktop/renderer', '/repo/apps/desktop/.stage/renderer'],
      ['/repo/apps/desktop/assets', '/repo/apps/desktop/.stage/assets'],
      ['/repo/apps/desktop/electron-builder.yml', '/repo/apps/desktop/.stage/electron-builder.yml'],
      ['/repo/apps/desktop/desktop.cordis.patch.yml', '/repo/apps/desktop/.stage/desktop.cordis.patch.yml'],
      ['/repo/THIRD_PARTY_NOTICES.md', '/repo/apps/desktop/.stage/THIRD_PARTY_NOTICES.md'],
    ])
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh/lib/bin.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
    expect(result.validatedFiles).toContain('desktop.cordis.patch.yml')
    expect(result.validatedFiles).toContain('THIRD_PARTY_NOTICES.md')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-host-desktop-plugin-runtime/lib/index.js')
    expect(result.validatedFiles).toContain('node_modules/dshmarket/lib/index.js')
    expect(result.validatedFiles).toContain('node_modules/dshmarket/lib/routes.js')
    expect(result.validatedFiles).toContain('node_modules/dshmarket/package.json')
    expect(result.validatedFiles).toContain('node_modules/dshmarket/src/client/MarketSection.tsx')
    expect(result.validatedFiles).toContain('node_modules/dshmarket/client/client.js')
    expect(result.validatedFiles).toContain('node_modules/dshmarket/client/client.js.map')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-reasoning-effort/lib/index.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-reasoning-effort/lib/client.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-reasoning-effort/LICENSE')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-reasoning-effort/THIRD_PARTY_NOTICES.md')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-reasoning-effort/lib/assets/chibi-runner-strip.png')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-session-messenger/package.json')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-session-messenger/lib/index.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-session-messenger/lib/client.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-session-messenger/cordis.patch.yml')
    expect(result.validatedFiles).toContain('node_modules/pnpm/bin/pnpm.mjs')
    expect(result.validatedFiles).toContain('lib/preload.cjs')
    expect(result.validatedFiles).not.toContain('lib/preload.js')
    expect(result.validatedFiles).toContain('assets/icon-source.png')
    expect(result.validatedFiles).toContain('assets/icon.icns')
    expect(result.validatedFiles).toContain('assets/icon.ico')
    expect(result.validatedFiles).not.toContain('assets/icon-source-rounded.png')
    expect(result.validatedFiles).toContain('node_modules/node-pty/prebuilds/darwin-x64/pty.node')
  })

  it('preflights the canonical messenger row before deleting or deploying', async () => {
    const dependencies = fakeDependencies()

    await stageDesktop('/repo', dependencies)

    expect(dependencies.events.slice(0, 3)).toEqual([
      'read:/repo/apps/desktop/desktop.cordis.patch.yml',
      'remove:/repo/apps/desktop/.stage',
      'run:pnpm',
    ])
  })

  it('rejects a non-canonical messenger overlay without deleting the prior stage', async () => {
    const dependencies = fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {}, DEFAULT_MARKET_PACKAGE_DIRECTORIES, [
      '- insert:',
      '    - id: reasoning-effort',
      "      name: '@deepseek-ai/dsh-reasoning-effort'",
      '    - id: session-messenger',
      "      name: '@deepseek-ai/dsh-session-messenger'",
      '      config: {}',
      '    - id: session-messenger',
      "      name: '@deepseek-ai/dsh-session-messenger'",
      '',
    ].join('\n'))

    await expect(stageDesktop('/repo', dependencies)).rejects.toThrow(/exactly one canonical session-messenger row/i)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it('rejects a later patch targeting the canonical messenger row before mutation', async () => {
    const dependencies = fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {}, DEFAULT_MARKET_PACKAGE_DIRECTORIES, [
      '- insert:',
      '    - id: reasoning-effort',
      "      name: '@deepseek-ai/dsh-reasoning-effort'",
      '    - id: session-messenger',
      "      name: '@deepseek-ai/dsh-session-messenger'",
      '- id: session-messenger',
      '  disabled: true',
      '',
    ].join('\n'))

    await expect(stageDesktop('/repo', dependencies)).rejects.toThrow(/exactly one canonical session-messenger row/i)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it('fails closed when a required file or native module is absent', async () => {
    await expect(stageDesktop('/repo', fakeDependencies(false))).rejects.toThrow(/missing required file/i)
    await expect(stageDesktop('/repo', fakeDependencies(true, []))).rejects.toThrow(/native.*\.node/i)
  })

  it('fails closed when either reasoning-effort runtime half or attributed asset is absent', async () => {
    for (const missing of [
      'node_modules/@deepseek-ai/dsh-reasoning-effort/lib/index.js',
      'node_modules/@deepseek-ai/dsh-reasoning-effort/lib/client.js',
      'node_modules/@deepseek-ai/dsh-reasoning-effort/LICENSE',
      'node_modules/@deepseek-ai/dsh-reasoning-effort/THIRD_PARTY_NOTICES.md',
      'node_modules/@deepseek-ai/dsh-reasoning-effort/lib/assets/chibi-runner-strip.png',
    ]) {
      const dependencies = fakeDependencies()
      dependencies.isFile = async path => !path.endsWith(missing)
      await expect(stageDesktop('/repo', dependencies)).rejects.toThrow(`missing required file: ${missing}`)
    }
  })

  it('rejects duplicate upstream and fork effort rows before deleting or deploying', async () => {
    const duplicate = `
- insert:
    - id: reasoning-effort-upstream
      name: 'dsh-reasoning-effort'
    - id: reasoning-effort
      name: '@deepseek-ai/dsh-reasoning-effort'
`
    expect(() => { validateReasoningEffortPatch(duplicate) }).toThrow(/exactly one.*reasoning-effort/i)

    const dependencies = fakeDependencies()
    dependencies.readText = async () => duplicate
    await expect(stageDesktop('/repo', dependencies)).rejects.toThrow(/exactly one.*reasoning-effort/i)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it('fails closed when the staged market is unpatched, incoherent, or duplicated', async () => {
    await expect(stageDesktop('/repo', fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {
      'node_modules/dshmarket/package.json': JSON.stringify({ name: 'dshmarket', version: '1.10.0' }),
    }))).rejects.toThrow(/dshmarket@1\.10\.1/i)
    await expect(stageDesktop('/repo', fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {
      'node_modules/dshmarket/client/client.js': 'unpatched client bundle',
    }))).rejects.toThrow(/compact.*client/i)
    await expect(stageDesktop('/repo', fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {
      'node_modules/dshmarket/client/client.js.map': 'stale source map',
    }))).rejects.toThrow(/compact.*source map/i)
    await expect(stageDesktop('/repo', fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {
      'node_modules/dshmarket/lib/routes.js': 'unprotected host bundle',
    }))).rejects.toThrow(/self-protection/i)
    await expect(stageDesktop('/repo', fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {}, [
      '/repo/apps/desktop/.stage/node_modules/.pnpm/one/node_modules/dshmarket',
      '/repo/apps/desktop/.stage/node_modules/.pnpm/two/node_modules/dshmarket',
    ]))).rejects.toThrow(/exactly one dshmarket/i)
  })

  it('removes only the exact desktop stage directory', async () => {
    const dependencies = fakeDependencies()
    await stageDesktop('/repo', dependencies)

    expect(dependencies.removed).toEqual([join('/repo', 'apps/desktop/.stage')])
  })

  it('allows only a dedicated external short stage directory', async () => {
    const externalStage = '/runner-temp/dsh-desktop-stage'
    const dependencies = fakeDependencies(true, [
      `${externalStage}/node_modules/node-pty/prebuilds/win32-x64/pty.node`,
    ])

    const result = await stageDesktop('/repo', dependencies, externalStage)

    expect(dependencies.removed).toEqual([externalStage])
    expect(dependencies.commands[0]?.[1]).toContain(externalStage)
    expect(result.stageDir).toBe(externalStage)
    await expect(stageDesktop('/repo', fakeDependencies(), '/runner-temp/other')).rejects.toThrow(/unexpected deletion target/i)
  })
})
