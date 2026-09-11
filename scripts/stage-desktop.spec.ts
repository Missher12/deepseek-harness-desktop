import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  validateDesktopProductPatch,
  assertNoDesktopControlArtifacts,
  desktopStagePnpmInvocation,
  stageDesktop,
  validateReasoningEffortPatch,
  validateStagedFlock,
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
    - id: desktop-system-update
      name: '@deepseek-ai/dsh-client-ui-settings-system-update'
`
const REPO_ROOT = resolve('/repo')
const DEFAULT_STAGE = join(REPO_ROOT, 'apps/desktop/.stage')
const DEFAULT_NATIVE_BINARIES = [join(DEFAULT_STAGE, 'node_modules/node-pty/prebuilds/darwin-x64/pty.node')] as const
const DEFAULT_MARKET_PACKAGE_DIRECTORIES = [
  join(DEFAULT_STAGE, 'node_modules/.pnpm/dshmarket/node_modules/dshmarket'),
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
    'node_modules/dshmarket/lib/routes.js': "code: 'self-protected'; restoreProfileManifestSnapshot()",
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
    realPath: async path => path,
    resolveModule: (_specifier, importer) => join(importer, '../../../node-addon-system/lib/flock.js'),
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
    findForbiddenControlArtifacts: async () => [],

  }
}

describe('desktop control release boundary', () => {
  it('rejects exact packaged control artifacts without fuzzy false positives', () => {
    expect(() => {
      assertNoDesktopControlArtifacts(['node_modules/@deepseek-ai/dsh-tool-agent-control/package.json'])
    }).toThrow(/dsh-tool-agent-control/u)
    expect(() => {
      assertNoDesktopControlArtifacts(['extensions/chromium/edge/manifest.json'])
    }).toThrow(/extensions\/chromium/u)
    expect(() => {
      assertNoDesktopControlArtifacts(['native/computer-use-helper/bin/helper'])
    }).toThrow(/computer-use-helper/u)
    expect(() => {
      assertNoDesktopControlArtifacts(['node_modules/example-browser-control-guide/package.json'])
    }).not.toThrow()
  })

  it('fails staging when deploy contains a forbidden control artifact', async () => {
    const dependencies = fakeDependencies()
    dependencies.findForbiddenControlArtifacts = async () => [
      join(DEFAULT_STAGE, 'node_modules/@deepseek-ai/dsh-control-runtime/package.json'),
    ]

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/dsh-control-runtime/u)
  })
})

describe('staged flock resolution', () => {
  it.each(['nested', 'missing', 'external-dependency', 'external-worker'] as const)(
    'checks real Node resolution and physical containment for %s', async (mode) => {
      const scratch = await mkdtemp(join(tmpdir(), 'dsh-stage-flock-'))
      try {
        const stage = join(scratch, 'stage')
        const scope = join(stage, 'node_modules/@deepseek-ai')
        const workerPackage = join(mode === 'external-worker' ? scratch : stage, 'node_modules/.pnpm/jsonl/node_modules/@deepseek-ai/dsh-session-persistence-jsonl')
        await mkdir(join(workerPackage, 'lib'), { recursive: true })
        await writeFile(join(workerPackage, 'lib/worker.cjs'), '')
        await mkdir(scope, { recursive: true })
        await symlink(workerPackage, join(scope, 'dsh-session-persistence-jsonl'), 'junction')
        const entryPackage = join(mode === 'external-dependency' ? scratch : stage, 'node_modules/.pnpm/system/node_modules/@deepseek-ai/node-addon-system')
        if (mode !== 'missing') {
          await mkdir(join(entryPackage, 'lib'), { recursive: true })
          await writeFile(join(entryPackage, 'package.json'), JSON.stringify({
            name: '@deepseek-ai/node-addon-system', exports: { './flock': './lib/flock.js' },
          }))
          await writeFile(join(entryPackage, 'lib/flock.js'), '')
          await symlink(entryPackage, join(workerPackage, '../node-addon-system'), 'junction')
        }
        if (mode === 'nested') {
          await expect(validateStagedFlock(stage)).resolves.toBe(
            'node_modules/.pnpm/system/node_modules/@deepseek-ai/node-addon-system/lib/flock.js',
          )
          await expect(realpath(join(scope, 'node-addon-system'))).rejects.toMatchObject({ code: 'ENOENT' })
        } else {
          await expect(validateStagedFlock(stage)).rejects.toThrow(
            // A source loader may resolve the missing package into the workspace; containment must reject that fallback.
            mode === 'missing' ? /Cannot find module|outside the stage directory/ : /outside the stage directory/,
          )
        }
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    },
  )
})

describe('stageDesktop', () => {
  it('resolves nested flock from the staged JSONL worker without requiring a top-level link', async () => {
    const nested = join(DEFAULT_STAGE, 'node_modules/.pnpm/system/node_modules/@deepseek-ai/node-addon-system/lib/flock.js')
    const dependencies = {
      ...fakeDependencies(),
      realPath: async (path: string) => path,
      resolveModule: (specifier: string, importer: string) => {
        expect(specifier).toBe('@deepseek-ai/node-addon-system/flock')
        expect(importer).toBe(join(DEFAULT_STAGE, 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/worker.cjs'))
        return nested
      },
      isFile: async (path: string) => path !== join(DEFAULT_STAGE, 'node_modules/@deepseek-ai/node-addon-system/lib/flock.js'),
    }

    const result = await stageDesktop(REPO_ROOT, dependencies)

    expect(result.validatedFiles).toContain('node_modules/.pnpm/system/node_modules/@deepseek-ai/node-addon-system/lib/flock.js')
  })

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
    ])
    expect(dependencies.copies).toEqual([
      [join(REPO_ROOT, 'apps/desktop/lib'), join(DEFAULT_STAGE, 'lib')],
      [join(REPO_ROOT, 'apps/desktop/renderer'), join(DEFAULT_STAGE, 'renderer')],
      [join(REPO_ROOT, 'apps/desktop/assets'), join(DEFAULT_STAGE, 'assets')],
      [join(REPO_ROOT, 'apps/desktop/build'), join(DEFAULT_STAGE, 'build')],
      [join(REPO_ROOT, 'apps/desktop/electron-builder.yml'), join(DEFAULT_STAGE, 'electron-builder.yml')],
      [join(REPO_ROOT, 'apps/desktop/electron-builder.linux.yml'), join(DEFAULT_STAGE, 'electron-builder.linux.yml')],
      [join(REPO_ROOT, 'apps/desktop/desktop.cordis.patch.yml'), join(DEFAULT_STAGE, 'desktop.cordis.patch.yml')],
      [join(REPO_ROOT, 'apps/desktop/update-metadata.json'), join(DEFAULT_STAGE, 'update-metadata.json')],
      [join(REPO_ROOT, 'THIRD_PARTY_NOTICES.md'), join(DEFAULT_STAGE, 'THIRD_PARTY_NOTICES.md')],
    ])
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh/lib/bin.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
    expect(result.validatedFiles).toContain('desktop.cordis.patch.yml')
    expect(result.validatedFiles).toContain('build/installer.nsh')
    expect(result.validatedFiles).toContain('THIRD_PARTY_NOTICES.md')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-host-desktop-plugin-runtime/lib/index.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-attachment-local/lib/pdf-worker.cjs')
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
    expect(result.validatedFiles).toContain('lib/update-helper.js')
    expect(result.validatedFiles).toContain('update-metadata.json')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-client-ui-settings-system-update/lib/client.js')
    expect(result.validatedFiles).not.toContain('lib/preload.js')
    expect(result.validatedFiles).toContain('assets/icon-source.png')
    expect(result.validatedFiles).toContain('assets/icon.icns')
    expect(result.validatedFiles).toContain('assets/icon.ico')
    expect(result.validatedFiles).toContain('assets/icon-windows-source.png')
    expect(result.validatedFiles).toContain('assets/icon-windows.ico')
    expect(result.validatedFiles).toContain('assets/tray-windows-16.png')
    expect(result.validatedFiles).toContain('assets/tray-windows-20.png')
    expect(result.validatedFiles).toContain('assets/tray-windows-24.png')
    expect(result.validatedFiles).toContain('assets/tray-windows-32.png')
    expect(result.validatedFiles).not.toContain('assets/icon-source-rounded.png')
    expect(result.validatedFiles).toContain('node_modules/node-pty/prebuilds/darwin-x64/pty.node')
  })

  it('preflights the canonical messenger row before deleting or deploying', async () => {
    const dependencies = fakeDependencies()

    await stageDesktop(REPO_ROOT, dependencies)

    expect(dependencies.events.slice(0, 3)).toEqual([
      `read:${join(REPO_ROOT, 'apps/desktop/desktop.cordis.patch.yml')}`,
      `remove:${DEFAULT_STAGE}`,
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

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/exactly one canonical session-messenger row/i)
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

    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/exactly one canonical session-messenger row/i)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it.each(['@deepseek-ai/dsh-desktop-workbench', '@wxg-prc-cpg/browser-skill-dsh-plugin', '@deepseek-ai/dsh-missher-brain', 'dsh-missher-memory', 'dsh-missher-evolution'])('rejects a removed plugin %s before mutation', async (name) => {
    const patch = `${VALID_DESKTOP_PATCH}    - id: retired-feature\n      name: '${name}'\n`
    expect(() => { validateDesktopProductPatch(patch) }).toThrow(/forbidden/)
    const dependencies = fakeDependencies(true, DEFAULT_NATIVE_BINARIES, {}, DEFAULT_MARKET_PACKAGE_DIRECTORIES, patch)
    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(/forbidden/)
    expect(dependencies.removed).toEqual([])
    expect(dependencies.commands).toEqual([])
  })

  it.each([
    'node_modules/@deepseek-ai/dsh-subprocess-local/lib/runner.js',
    'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/worker.cjs',
    'node_modules/@deepseek-ai/node-addon-system/lib/flock.js',
  ])('refuses a stage missing the upgraded core runtime entry %s', async (missing) => {
    const dependencies = fakeDependencies()
    dependencies.isFile = async path => !path.replaceAll('\\', '/').endsWith(missing)
    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(`missing required file: ${missing}`)
  })

  it('fails closed when a required file or native module is absent', async () => {
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(false))).rejects.toThrow(/missing required file/i)
    await expect(stageDesktop(REPO_ROOT, fakeDependencies(true, []))).rejects.toThrow(/native.*\.node/i)
  })

  it('fails closed when the separately bundled PDF worker is absent', async () => {
    const dependencies = fakeDependencies()
    dependencies.isFile = async path => !path.replaceAll('\\', '/').endsWith(
      'node_modules/@deepseek-ai/dsh-attachment-local/lib/pdf-worker.cjs',
    )
    await expect(stageDesktop(REPO_ROOT, dependencies)).rejects.toThrow(
      'missing required file: node_modules/@deepseek-ai/dsh-attachment-local/lib/pdf-worker.cjs',
    )
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
