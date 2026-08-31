import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopStagePnpmInvocation,
  stageDesktop,
  validateDesktopControlHostPatch,
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
    - id: desktop-control-host
      name: '@deepseek-ai/dsh-desktop-control-host'
    - id: dsh-market
      name: 'dshmarket'
    - id: desktop-system-update
      name: '@deepseek-ai/dsh-client-ui-settings-system-update'
    - id: desktop-control-ui
      name: '@deepseek-ai/dsh-client-ui-desktop-control'
`
const REPO_ROOT = resolve('/repo')
const DEFAULT_STAGE = join(REPO_ROOT, 'apps/desktop/.stage')
const DEFAULT_NATIVE_BINARIES = [join(DEFAULT_STAGE, 'node_modules/node-pty/prebuilds/darwin-x64/pty.node')] as const
const DEFAULT_MARKET_PACKAGE_DIRECTORIES = [
  join(DEFAULT_STAGE, 'node_modules/.pnpm/dshmarket/node_modules/dshmarket'),
] as const
const DEFAULT_NATIVE_BIN = join(DEFAULT_STAGE, 'native-bin')
const DEFAULT_PLATFORM_DIR = join(DEFAULT_NATIVE_BIN, 'darwin-x64')
const DEFAULT_HELPER = join(DEFAULT_PLATFORM_DIR, 'computer-use-helper')
const MACHO_X64 = Uint8Array.of(0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01)

function fakeDependencies(
  filesPresent = true,
  nativeBinaries: readonly string[] = DEFAULT_NATIVE_BINARIES,
  semanticOverrides: Readonly<Record<string, string>> = {},
  marketPackageDirectories: readonly string[] = DEFAULT_MARKET_PACKAGE_DIRECTORIES,
  desktopPatch = VALID_DESKTOP_PATCH,
): StageDesktopDependencies & {
  verifyOfficialClientBuild(root: string): void
  commands: Array<[string, readonly string[]]>
  copies: Array<[string, string]>
  events: string[]
  removed: string[]
  validated: string[]
  read: string[]
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>
  realpath(path: string): Promise<string>
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
    'node_modules/dshmarket/lib/routes.js': "code: 'self-protected'; restoreProfileManifestSnapshot()",
    ...semanticOverrides,
  }
  return {
    platform: 'darwin',
    arch: 'x64',
    commands,
    copies,
    events,
    removed,
    validated,
    read,
    verifyOfficialClientBuild: (root) => { events.push(`verify-official:${root}`) },
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
    findComputerUseHelpers: async root => [join(root, 'darwin-x64/computer-use-helper')],
    readBinary: async () => MACHO_X64,
    isExecutable: async () => true,
    lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
    realpath: async path => resolve(path),
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

    const result = await stageDesktop(REPO_ROOT, dependencies)

    expect(dependencies.commands).toEqual([
      ['pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'deploy', '--legacy', DEFAULT_STAGE]],
      [process.execPath, [join(REPO_ROOT, 'scripts/verify-desktop-stage-main-import.mjs'), DEFAULT_STAGE]],
    ])
    expect(dependencies.copies).toEqual([
      [join(REPO_ROOT, 'apps/desktop/lib'), join(DEFAULT_STAGE, 'lib')],
      [join(REPO_ROOT, 'apps/desktop/renderer'), join(DEFAULT_STAGE, 'renderer')],
      [join(REPO_ROOT, 'apps/desktop/assets'), join(DEFAULT_STAGE, 'assets')],
      [join(REPO_ROOT, 'apps/desktop/build'), join(DEFAULT_STAGE, 'build')],
      [join(REPO_ROOT, 'apps/desktop/electron-builder.yml'), join(DEFAULT_STAGE, 'electron-builder.yml')],
      [join(REPO_ROOT, 'apps/desktop/desktop.cordis.patch.yml'), join(DEFAULT_STAGE, 'desktop.cordis.patch.yml')],
      [join(REPO_ROOT, 'apps/desktop/update-metadata.json'), join(DEFAULT_STAGE, 'update-metadata.json')],
      [
        join(REPO_ROOT, 'apps/desktop/native-bin/darwin-x64'),
        join(DEFAULT_STAGE, 'native-bin/darwin-x64'),
      ],
      [join(REPO_ROOT, 'THIRD_PARTY_NOTICES.md'), join(DEFAULT_STAGE, 'THIRD_PARTY_NOTICES.md')],
    ])
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh/lib/bin.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-client-ui-brand-official/lib/client.js')
    expect(result.validatedFiles).toEqual(expect.arrayContaining([
      'node_modules/@deepseek-ai/dsh-agent-presets/presets/backend/preset.yml',
      'node_modules/@deepseek-ai/dsh-agent-presets/presets/backend/agent.cordis.yml',
      'node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/preset.yml',
      'node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml',
    ]))
    expect(result.validatedFiles).toContain('desktop.cordis.patch.yml')
    expect(result.validatedFiles).toContain('build/installer.nsh')
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
    expect(result.validatedFiles).toEqual(expect.arrayContaining([
      'node_modules/@deepseek-ai/dsh-desktop-control-protocol/package.json',
      'node_modules/@deepseek-ai/dsh-desktop-control-protocol/protocol-v1.json',
      'node_modules/@deepseek-ai/dsh-desktop-control-protocol/lib/index.js',
      'node_modules/@deepseek-ai/dsh-browser-control/package.json',
      'node_modules/@deepseek-ai/dsh-browser-control/lib/index.js',
      'node_modules/@deepseek-ai/dsh-browser-control/lib/invariant.js',
      'node_modules/@deepseek-ai/dsh-computer-control/package.json',
      'node_modules/@deepseek-ai/dsh-computer-control/lib/index.js',
      'node_modules/@deepseek-ai/dsh-computer-control/lib/invariant.js',
      'node_modules/@deepseek-ai/dsh-desktop-control-host/package.json',
      'node_modules/@deepseek-ai/dsh-desktop-control-host/lib/index.js',
      'node_modules/@deepseek-ai/dsh-desktop-control-host/lib/invariant.js',
    ]))
    expect(result.validatedFiles).toContain('node_modules/pnpm/bin/pnpm.mjs')
    expect(result.validatedFiles).toContain('lib/preload.cjs')
    expect(result.validatedFiles).toContain('lib/update-helper.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-desktop-managed-memory/package.json')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-desktop-managed-memory/lib/index.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-desktop-managed-memory/lib/client.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-desktop-managed-evolution/package.json')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-desktop-managed-evolution/lib/index.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-desktop-managed-evolution/lib/client.js')
    expect(result.validatedFiles).toContain('update-metadata.json')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-client-ui-settings-system-update/lib/client.js')
    expect(result.validatedFiles).toEqual(expect.arrayContaining([
      'node_modules/@deepseek-ai/dsh-client-ui-desktop-control/package.json',
      'node_modules/@deepseek-ai/dsh-client-ui-desktop-control/lib/client.js',
      'node_modules/@deepseek-ai/dsh-tool-computer-control/package.json',
      'node_modules/@deepseek-ai/dsh-tool-computer-control/lib/index.js',
      'node_modules/@deepseek-ai/dsh-tool-computer-control/lib/invariant.js',
    ]))
    expect(result.validatedFiles).not.toContain('lib/preload.js')
    expect(result.validatedFiles).toContain('assets/icon-source.png')
    expect(result.validatedFiles).toContain('assets/icon.icns')
    expect(result.validatedFiles).toContain('assets/icon.ico')
    expect(result.validatedFiles).not.toContain('assets/icon-source-rounded.png')
    expect(result.validatedFiles).toContain('node_modules/node-pty/prebuilds/darwin-x64/pty.node')
    expect(result.validatedFiles).toContain('native-bin/darwin-x64/computer-use-helper')
  })

  it('rejects stale or non-official client artifacts before deleting or deploying', async () => {
    const dependencies = fakeDependencies()
    dependencies.verifyOfficialClientBuild = () => {
      throw new Error('client artifacts differ from the official build record')
    }

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/client artifacts differ/i)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it('rejects a wrong, duplicate, or non-executable staged native helper', async () => {
    const wrong = fakeDependencies()
    wrong.readBinary = async () => Uint8Array.of(0x4d, 0x5a)
    await expect(stageDesktop(REPO_ROOT, wrong)).rejects.toThrow(/Mach-O|architecture/i)

    const duplicate = fakeDependencies()
    duplicate.findComputerUseHelpers = async () => [DEFAULT_HELPER, join(DEFAULT_STAGE, 'native-bin/win32-x64/computer-use-helper.exe')]
    await expect(stageDesktop(REPO_ROOT, duplicate)).rejects.toThrow(/exactly one.*helper/i)

    const nonExecutable = fakeDependencies()
    nonExecutable.isExecutable = async () => false
    await expect(stageDesktop(REPO_ROOT, nonExecutable)).rejects.toThrow(/executable/i)
  })

  it('rejects a staged native helper that is a symbolic link', async () => {
    const dependencies = fakeDependencies()
    dependencies.lstat = async () => ({ isFile: () => false, isSymbolicLink: () => true })

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/regular file.*symbolic link/i)
  })

  it('rejects a staged native helper whose real path escapes the selected platform directory', async () => {
    const dependencies = fakeDependencies()
    dependencies.realpath = async path => path === DEFAULT_HELPER
      ? resolve('/outside/computer-use-helper')
      : resolve(path)

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/real path.*selected platform directory/i)
  })

  it('rejects a selected platform directory whose real path escapes the staged native-bin directory', async () => {
    const dependencies = fakeDependencies()
    dependencies.realpath = async (path) => {
      if (path === DEFAULT_PLATFORM_DIR) return resolve('/outside/darwin-x64')
      if (path === DEFAULT_HELPER) return resolve('/outside/darwin-x64/computer-use-helper')
      return resolve(path)
    }

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/platform directory real path.*staged native-bin directory/i)
  })

  it('preflights the canonical messenger row before deleting or deploying', async () => {
    const dependencies = fakeDependencies()

    await stageDesktop(REPO_ROOT, dependencies)

    expect(dependencies.events.slice(0, 3)).toEqual([
      `verify-official:${REPO_ROOT}`,
      `read:${join(REPO_ROOT, 'apps/desktop/desktop.cordis.patch.yml')}`,
      `remove:${DEFAULT_STAGE}`,
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

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/exactly one canonical session-messenger row/i)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it('rejects a duplicate or configured Desktop control Host row before mutation', async () => {
    const duplicate = `
- insert:
    - id: reasoning-effort
      name: '@deepseek-ai/dsh-reasoning-effort'
    - id: session-messenger
      name: '@deepseek-ai/dsh-session-messenger'
    - id: desktop-control-host
      name: '@deepseek-ai/dsh-desktop-control-host'
      config: {}
    - id: another-control-host
      name: '@deepseek-ai/dsh-desktop-control-host'
`
    expect(() => { validateDesktopControlHostPatch(duplicate) }).toThrow(/exactly one canonical desktop-control-host row/i)
    const dependencies = fakeDependencies(
      true,
      DEFAULT_NATIVE_BINARIES,
      {},
      DEFAULT_MARKET_PACKAGE_DIRECTORIES,
      duplicate,
    )
    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/exactly one canonical desktop-control-host row/i)
    expect(dependencies.removed).toEqual([])
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

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/exactly one canonical session-messenger row/i)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it('fails closed when a required file or native module is absent', async () => {
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(false))).rejects.toThrow(/missing required file/i)
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(true, []))).rejects.toThrow(/native.*\.node/i)
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
      dependencies.isFile = async path => !path.replaceAll('\\', '/').endsWith(missing)
      await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(`missing required file: ${missing}`)
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
    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/exactly one.*reasoning-effort/i)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it('fails closed when the staged market is unpatched, incoherent, or duplicated', async () => {
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {
      'node_modules/dshmarket/package.json': JSON.stringify({ name: 'dshmarket', version: '1.10.0' }),
    }))).rejects.toThrow(/dshmarket@1\.10\.1/i)
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {
      'node_modules/dshmarket/client/client.js': 'unpatched client bundle',
    }))).rejects.toThrow(/compact.*client/i)
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {
      'node_modules/dshmarket/client/client.js.map': 'stale source map',
    }))).rejects.toThrow(/compact.*source map/i)
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {
      'node_modules/dshmarket/lib/routes.js': 'unprotected host bundle',
    }))).rejects.toThrow(/self-protection/i)
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {}, [
      join(DEFAULT_STAGE, 'node_modules/.pnpm/one/node_modules/dshmarket'),
      join(DEFAULT_STAGE, 'node_modules/.pnpm/two/node_modules/dshmarket'),
    ]))).rejects.toThrow(/exactly one dshmarket/i)
  })

  it('removes only the exact desktop stage directory', async () => {
    const dependencies = fakeDependencies()
    await stageDesktop(REPO_ROOT, dependencies)

    expect(dependencies.removed).toEqual([DEFAULT_STAGE])
  })

  it('allows only a dedicated external short stage directory', async () => {
    const externalStage = resolve('/runner-temp/dsh-desktop-stage')
    const dependencies = fakeDependencies(true, [
      join(externalStage, 'node_modules/node-pty/prebuilds/win32-x64/pty.node'),
    ])

    const result = await stageDesktop(REPO_ROOT, dependencies, externalStage)

    expect(dependencies.removed).toEqual([externalStage])
    expect(dependencies.commands[0]?.[1]).toContain(externalStage)
    expect(result.stageDir).toBe(externalStage)
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(), resolve('/runner-temp/other'))).rejects.toThrow(/unexpected deletion target/i)
  })
})
