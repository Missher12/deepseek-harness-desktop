import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface DesktopManifest {
  name: string
  version: string
  packageManager: string
  private: boolean
  main: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}

interface BuilderConfiguration {
  asarUnpack?: string[]
  files?: string[]
  mac?: { icon?: string }
  win?: {
    electronLanguages?: string[]
    files?: string[]
    icon?: string
    target?: Array<{ target?: string; arch?: string[] }>
  }
  nsis?: {
    include?: string
    oneClick?: boolean
    perMachine?: boolean
    allowElevation?: boolean
    allowToChangeInstallationDirectory?: boolean
    createDesktopShortcut?: boolean
    createStartMenuShortcut?: boolean
    runAfterFinish?: boolean
    deleteAppDataOnUninstall?: boolean
    shortcutName?: string
    artifactName?: string
  }
}

interface DesktopPatch {
  insert?: Array<Record<string, unknown>>
}

describe('desktop package manifest', () => {
  it('keeps Browser and Computer Control modules out of the Desktop product', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as DesktopManifest
    const patch = readFileSync(new URL('../desktop.cordis.patch.yml', import.meta.url), 'utf8')
    const builder = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
    const serializedDependencies = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).join('\n')
    const forbidden = [
      'tool-agent-control',
      'tool-browser-control',
      'tool-computer-control',
      'ui-desktop-control',
      'control-runtime',
      'computer-use-helper',
      'extensions/chromium',
    ]

    for (const artifact of forbidden) {
      expect(serializedDependencies, artifact).not.toContain(artifact)
      expect(patch, artifact).not.toContain(artifact)
      expect(builder, artifact).not.toContain(artifact)
    }
  })

  it('keeps the Mac icon unchanged and uses dedicated small-scale Windows assets', () => {
    const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(existsSync(new URL('../assets/icon-source.png', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../assets/icon.icns', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../assets/icon.ico', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../assets/icon-windows-source.png', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../assets/icon-windows.ico', import.meta.url))).toBe(true)
    for (const size of [16, 20, 24, 32]) {
      expect(existsSync(new URL(`../assets/tray-windows-${String(size)}.png`, import.meta.url))).toBe(true)
    }
    expect(mainSource).toContain('../assets/icon-source.png')
    expect(mainSource).toContain('../assets/icon-windows.ico')
    expect(mainSource).toContain('../assets/tray-windows-16.png')
    expect(mainSource).toContain('../assets/tray-windows-20.png')
    expect(mainSource).toContain('../assets/tray-windows-24.png')
    expect(mainSource).toContain('../assets/tray-windows-32.png')
    expect(mainSource).toContain('nativeImage.createFromPath')
    expect(mainSource).toContain('isEmpty()')
  })

  it('ships Harness and pins the Electron toolchain', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as DesktopManifest

    expect(manifest).toMatchObject({
      name: '@deepseek-ai/dsh-desktop',
      version: '0.5.2',
      packageManager: 'pnpm@11.7.0',
      private: true,
      main: 'lib/main.js',
    })
    expect(manifest.dependencies['@deepseek-ai/dsh']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-home-paths']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-web-frontend']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-reasoning-effort']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-session-messenger']).toBe('workspace:^')
    expect(manifest.devDependencies.electron).toBe('43.4.0')
    expect(manifest.devDependencies['electron-builder']).toBe('26.15.3')
    expect(manifest.devDependencies['@electron/rebuild']).toBe('4.2.0')
    expect(manifest.devDependencies.playwright).toBe('^1.49.0')
    expect(manifest.scripts['pack:dir']).toContain('--mac dir --x64')
    expect(manifest.scripts['pack:dmg']).toContain('--mac dmg --x64')
    expect(manifest.scripts['benchmark:startup']).toBe(
      'node --import tsx/esm ../../scripts/desktop-startup-benchmark.ts',
    )
    expect(manifest.scripts['inventory:package']).toBe(
      'node --import tsx/esm ../../scripts/desktop-package-inventory.ts',
    )
  })

  it('builds Mac desktop artifacts with the official client brand profile', () => {
    const rootManifest = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as Pick<DesktopManifest, 'scripts'>

    expect(rootManifest.scripts['desktop:stage']).toBe(
      'pnpm run build:official && pnpm run desktop:stage:built',
    )
    expect(rootManifest.scripts['desktop:pack']).toContain('desktop:stage')
    expect(rootManifest.scripts['desktop:dmg']).toContain('desktop:stage')
  })

  it('keeps one authoritative turn navigator and rejects the rc.2 PromptRail', () => {
    // The alpha.5 TurnNavigator is the sole runtime navigation authority.
    expect(existsSync(new URL(
      '../../../packages/client/ui-chat/src/client/chat/TurnNavigator.tsx',
      import.meta.url,
    ))).toBe(true)
    // The rc.2 PromptRail must not resurface beside it, either as source or
    // as a Desktop composition row.
    expect(existsSync(new URL(
      '../../../packages/client/ui-conversation/src/client/chat/PromptRail.tsx',
      import.meta.url,
    ))).toBe(false)
    expect(existsSync(new URL(
      '../../../packages/client/ui-chat/src/client/chat/PromptRail.tsx',
      import.meta.url,
    ))).toBe(false)
    const desktopPatch = readFileSync(
      new URL('../desktop.cordis.patch.yml', import.meta.url),
      'utf8',
    )
    expect(desktopPatch).not.toMatch(/PromptRail/u)
    expect(desktopPatch).not.toMatch(/ui-conversation.*rail/u)
  })

  it('keeps packaged update metadata aligned with the Desktop and Harness versions', () => {
    const desktop = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    const harness = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    const metadata = JSON.parse(
      readFileSync(new URL('../update-metadata.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>

    expect(metadata).toEqual({
      schema: 1,
      desktopVersion: desktop.version,
      harnessVersion: harness.version,
      platform: 'darwin',
      arch: 'x64',
      channel: 'release',
    })
  })

  it('mounts exactly one attributed reasoning-effort fork in the Desktop patch', () => {
    const patch = yaml.load(
      readFileSync(new URL('../desktop.cordis.patch.yml', import.meta.url), 'utf8'),
    ) as Array<{ insert?: Array<{ id?: string; name?: string }> }>
    const rows = patch.flatMap(operation => operation.insert ?? [])
      .filter(row => row.id === 'reasoning-effort'
        || row.name === 'dsh-reasoning-effort'
        || row.name === '@deepseek-ai/dsh-reasoning-effort')

    expect(rows).toEqual([{
      id: 'reasoning-effort',
      name: '@deepseek-ai/dsh-reasoning-effort',
    }])
  })

  it('mounts exactly one dormant BrowserSkill row with the packaged CLI on PATH', () => {
    const patch = yaml.load(
      readFileSync(new URL('../desktop.cordis.patch.yml', import.meta.url), 'utf8'),
    ) as Array<{ insert?: Array<{ id?: string; name?: string; config?: Record<string, unknown> }> }>
    const rows = patch.flatMap(operation => operation.insert ?? [])
      .filter(row => row.id === 'browser-skill'
        || row.name === '@wxg-prc-cpg/browser-skill-dsh-plugin')

    expect(rows).toEqual([{
      id: 'browser-skill',
      name: '@wxg-prc-cpg/browser-skill-dsh-plugin',
      config: { bskPath: 'bsk', lazyTools: true, observationEnabled: false },
    }])
  })

  it('exposes exactly the six phase-one BrowserSkill tools with no evaluate, record, or CDP surface', () => {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('@wxg-prc-cpg/browser-skill-dsh-plugin')
    const source = readFileSync(entry, 'utf8')
    const names = [...source.matchAll(/name:\s*"(browser_[a-z_]+)"/gu)].map(match => match[1]!)

    expect([...new Set(names)].sort()).toEqual([
      'browser_assist',
      'browser_inspect',
      'browser_interact',
      'browser_page',
      'browser_session',
      'browser_tabs',
    ])
    for (const name of names) {
      expect(name, name).not.toMatch(/evaluate|record|cdp/u)
    }
  })

  it('keeps module, missing-service, and apply failures outside the activated Web UI', () => {
    const host = readFileSync(
      new URL('../../../packages/extensions/reasoning-effort/src/index.ts', import.meta.url),
      'utf8',
    )
    const client = readFileSync(
      new URL('../../../packages/extensions/reasoning-effort/src/client/index.tsx', import.meta.url),
      'utf8',
    )
    const boot = readFileSync(
      new URL('../../../packages/client/web/src/boot.ts', import.meta.url),
      'utf8',
    )

    expect(host).toContain("export const inject = ['settings', 'webServer']")
    expect(client).toContain("export const inject = ['locale', 'modelDirectories', 'sessions', 'slots']")
    expect(boot).toContain('entry.fiber === undefined')
    expect(boot).toContain("state === 'pending'")
    expect(boot).toContain('failures.push(`${name}: ${state}`)')
    expect(boot).toContain('did not activate')
    expect(boot).toContain('await this.runPluginBoot(ctx, prefetching)')
    expect(boot).toContain('await this.mountApp(ctx)')
    expect(boot).toContain('await loader.await()\n    this.assertEntriesActive(ctx)')
  })

  it('mounts one canonical session messenger row in the Desktop-only overlay', () => {
    const patches = yaml.load(
      readFileSync(new URL('../desktop.cordis.patch.yml', import.meta.url), 'utf8'),
    ) as DesktopPatch[]
    const rows = patches.flatMap(patch => patch.insert ?? [])

    expect(rows.filter(row => row.id === 'session-messenger')).toEqual([{
      id: 'session-messenger',
      name: '@deepseek-ai/dsh-session-messenger',
    }])
    expect(rows.find(row => row.id === 'dsh-market')).toMatchObject({
      id: 'dsh-market',
      name: 'dshmarket',
    })
  })

  it('ships one ordered default-on external-brain stack from immutable release archives', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as DesktopManifest
    const patches = yaml.load(
      readFileSync(new URL('../desktop.cordis.patch.yml', import.meta.url), 'utf8'),
    ) as DesktopPatch[]
    const rows = patches.flatMap(patch => patch.insert ?? [])

    expect(manifest.dependencies['dsh-missher-memory']).toBe(
      'https://github.com/Missher12/dsh-missher-memory/releases/download/v0.2.0/dsh-missher-memory-0.2.0.tgz',
    )
    expect(manifest.dependencies['dsh-missher-evolution']).toBe(
      'https://github.com/Missher12/dsh-missher-evolution/releases/download/v0.1.1/dsh-missher-evolution-0.1.1.tgz',
    )
    expect(manifest.dependencies['@deepseek-ai/dsh-missher-brain']).toBe('workspace:^')
    expect(rows.findIndex(row => row.id === 'missher-brain')).toBeLessThan(rows.findIndex(row => row.id === 'desktop-missher-memory'))
    expect(rows.findIndex(row => row.id === 'desktop-missher-memory')).toBeLessThan(rows.findIndex(row => row.id === 'desktop-missher-evolution'))
    expect(rows.filter(row => row.id === 'missher-brain')).toEqual([{
      id: 'missher-brain', name: '@deepseek-ai/dsh-missher-brain',
    }])
    expect(rows.filter(row => row.id === 'desktop-missher-memory')).toEqual([{
      id: 'desktop-missher-memory',
      name: '@deepseek-ai/dsh-desktop-managed-memory',
      config: {
        enabled: true,
        captureEnabled: true,
        recallEnabled: true,
        consolidationEnabled: true,
      },
    }])
    expect(rows.filter(row => row.id === 'desktop-missher-evolution')).toEqual([{
      id: 'desktop-missher-evolution',
      name: '@deepseek-ai/dsh-desktop-managed-evolution',
      config: { enabled: true, maintenanceIntervalHours: 24, maxInjectedRules: 4 },
    }])

    expect(rows.find(row => row.id === 'dsh-market')).toEqual({
      id: 'dsh-market',
      name: 'dshmarket',
      config: {
        builtins: [
          expect.objectContaining({ name: '@deepseek-ai/dsh-missher-brain', spec: 'builtin:0.1.1-rc.2', category: 'memory' }),
          expect.objectContaining({
            name: 'dsh-missher-memory',
            spec: 'builtin:0.2.0',
            runtimeNames: ['@deepseek-ai/dsh-desktop-managed-memory'],
            category: 'memory',
          }),
          expect.objectContaining({
            name: 'dsh-missher-evolution',
            spec: 'builtin:0.1.1',
            runtimeNames: ['@deepseek-ai/dsh-desktop-managed-evolution'],
            category: 'agent',
          }),
        ],
      },
    })

    const marketPatch = readFileSync(
      new URL('../../../patches/dshmarket@1.10.1.patch', import.meta.url),
      'utf8',
    )
    expect(marketPatch).toContain('builtins?: BuiltinPlugin[]')
    expect(marketPatch).toContain('protected: [...protectedPackageNames]')
    expect(marketPatch).toContain('data-dshmarket-protected-package')
  })

  it('describes the memory coordinator without the obsolete External Brain product name', () => {
    const desktopPatch = readFileSync(new URL('../desktop.cordis.patch.yml', import.meta.url), 'utf8')
    expect(desktopPatch).not.toContain('外置大脑')
    expect(desktopPatch).not.toContain('External-brain')
    expect(desktopPatch).toContain('记忆与学习协调器')
    expect(desktopPatch).toContain('Memory & Learning coordinator')
  })

  it('builds one visible per-user Windows x64 Setup with progress, shortcuts, and launch-after-install', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as DesktopManifest
    const rootManifest = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as Pick<DesktopManifest, 'scripts'>
    const builder = yaml.load(
      readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'),
    ) as BuilderConfiguration

    expect(manifest.scripts['pack:setup']).toContain('--win nsis --x64')
    expect(rootManifest.scripts['desktop:setup:built']).toContain('pack:setup')
    expect(rootManifest.scripts['desktop:setup']).toContain('desktop:setup:built')
    expect(builder.mac?.icon).toBe('assets/icon.icns')
    expect(builder.win).toMatchObject({
      target: [{ target: 'nsis', arch: ['x64'] }],
      icon: 'assets/icon-windows.ico',
      electronLanguages: ['en-US', 'zh-CN'],
    })
    expect(builder.asarUnpack).toEqual(['node_modules/**'])
    expect(builder.nsis).toMatchObject({
      include: 'build/installer.nsh',
      oneClick: false,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      shortcutName: 'DeepSeek Harness',
      artifactName: 'DeepSeek-Harness-Setup-${version}-win-x64.${ext}',
      installerIcon: 'assets/icon-windows.ico',
      uninstallerIcon: 'assets/icon-windows.ico',
    })
    const installer = readFileSync(
      new URL('../build/installer.nsh', import.meta.url),
      'utf8',
    )
    expect(installer).toContain('!macro customWelcomePage')
    expect(installer).toContain('!insertmacro MUI_PAGE_WELCOME')
    expect(installer).toContain('StrCpy $isForceCurrentInstall "1"')
    expect(installer).toContain('ShowInstDetails show')
    expect(installer).toContain('DetailPrint')
    expect(builder.files).toContain('!node_modules/**/*.map')
    expect(builder.files).toContain('!node_modules/**/*.d.ts')
    expect(builder.files).toContain('!node_modules/**/*.d.cts')
    expect(builder.files).toContain('!node_modules/**/*.d.mts')
    expect(builder.files).toContain('!node_modules/**/*.tsbuildinfo')
    expect(builder.files).toContain('!**/.env')
    expect(builder.files).toContain('!**/.env.*')
    expect(builder.files).toContain('!**/.credentials.yaml')
    expect(builder.files).toContain('!**/.dsh/**')
    expect(builder.files).toContain(
      '!node_modules/@deepseek-ai/dsh-session-telemetry-otel/node_modules/@opentelemetry/resources/**',
    )
    expect(builder.win?.files).toEqual(expect.arrayContaining([
      '!node_modules/node-pty/prebuilds/linux-*/**',
      '!node_modules/@napi-rs/canvas-darwin-*/**',
      '!node_modules/@napi-rs/canvas-linux-*/**',
      '!node_modules/@napi-rs/canvas-win32-arm64-msvc/**',
      '!node_modules/@img/sharp-darwin-*/**',
      '!node_modules/@img/sharp-libvips-darwin-*/**',
      '!node_modules/@img/sharp-libvips-linux*/**',
      '!node_modules/@img/sharp-linux*/**',
      '!node_modules/@img/sharp-win32-arm64/**',
      '!node_modules/@img/sharp-win32-ia32/**',
      '!node_modules/@koromix/koffi-darwin-*/**',
      '!node_modules/@koromix/koffi-linux-*/**',
      '!node_modules/@koromix/koffi-win32-arm64/**',
      '!node_modules/@koromix/koffi-win32-ia32/**',
      '!node_modules/node-addon-require-builtin-darwin-*/**',
      '!node_modules/node-addon-require-builtin-linux-*/**',
      '!node_modules/node-addon-require-builtin-win32-arm64-msvc/**',
      '!node_modules/node-addon-require-builtin-win32-ia32-msvc/**',
      '!node_modules/**/*.pdb',
    ]))
  })

  it('exercises uninstall from a realistic short per-user install path', () => {
    const smoke = readFileSync(
      new URL('../../../scripts/windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain("[Environment]::GetFolderPath('LocalApplicationData')")
    expect(smoke).toContain("$smokeId = 'dh' + [Guid]::NewGuid().ToString('N').Substring(0, 6)")
    expect(smoke).toContain('$temporaryRoot = Join-Path $localAppData $smokeId')
    expect(smoke).not.toContain('dsh-setup-smoke-')
    expect(smoke).toContain('$startInfo.Arguments = "/S /D=$InstallRoot"')
    expect(smoke).not.toContain('/D=$requestedInstallRoot')
    expect(smoke).not.toContain('[IO.Path]::GetTempPath()')
  })

  it('exercises the patched marketplace and both protected and ordinary package routes', () => {
    const smoke = readFileSync(new URL('./packaged-smoke.ts', import.meta.url), 'utf8')

    expect(smoke).toContain('data-dshmarket-layout="reference"')
    expect(smoke).toContain('data-dshmarket-installed-rail')
    expect(smoke).toContain('data-dshmarket-mode="personal"')
    expect(smoke).toContain('data-dshmarket-plugin-row')
    expect(smoke).toContain('data-dshmarket-primary-action')
    expect(smoke).toContain('data-dshmarket-overflow-menu')
    expect(smoke).toContain('button[data-package="dsh-missher-memory"]')
    expect(smoke).toContain('data-dshmarket-protected-package')
    expect(smoke).toContain("'/dsh-market/update'")
    expect(smoke).toContain("'/dsh-market/uninstall'")
    expect(smoke).toContain("code: 'self-protected'")
  })

  it('keeps the desktop-only market patch isolated in release and Wine dependency layouts', () => {
    const singleExeBuild = readFileSync(
      new URL('../../../scripts/build-exe-for-python-sdk.ts', import.meta.url),
      'utf8',
    )
    const wineGate = readFileSync(
      new URL('../../../scripts/wine-windows-gates.sh', import.meta.url),
      'utf8',
    )

    expect(singleExeBuild).toContain("'--config.allow-unused-patches=true'")
    expect(wineGate).toContain('ln -s ../../../node_modules/dshmarket apps/desktop/node_modules/dshmarket')
  })

  it('exercises the native reasoning slider and visible in-chat session relay', () => {
    const smoke = readFileSync(new URL('./packaged-smoke.ts', import.meta.url), 'utf8')

    expect(smoke).toContain('desktop-smoke-reasoning-${platform}.png')
    expect(smoke).toContain("locator('[data-messenger-trigger]').count()).toBe(0)")
    expect(smoke).toContain("locator('[data-session-relay-incoming]')")
    expect(smoke).not.toContain("locator('[data-relay-card]')")
    expect(smoke).toContain('desktop-smoke-visible-message')
    expect(smoke).not.toContain('desktop-smoke-visible-reply')
    expect(smoke).toContain('desktop-smoke-messenger-${platform}.png')
    expect(smoke).toContain('desktop-smoke-workbench-${platform}.png')
    expect(smoke).toContain("getByRole('button', { name: /^(?:Open workbench|打开工作台)$/u })")
    expect(smoke).not.toContain("platform === 'win32'\n    ? await seedWindowsClipboardSmokeState")
    expect(smoke).toContain("new File(['packaged document drop'], 'desktop-dropped-notes.md'")
    expect(smoke).toContain("new DragEvent('drop'")
    expect(smoke).toContain('desktop-dropped-notes\\.md')
    expect(smoke).toContain('Attach file|添加附件')
    expect(smoke).not.toContain('Add image|添加图片')
    expect(smoke).toContain('Memory & Learning|记忆与学习')
    expect(smoke).not.toContain('Project Memory|项目记忆')
  })

  it('includes the repository standalone runtime dependency closure', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as DesktopManifest
    const runtimeManifest = JSON.parse(
      readFileSync(
        new URL('../../../python/sdk-runtime/package.json', import.meta.url),
        'utf8',
      ),
    ) as Pick<DesktopManifest, 'dependencies'>

    const missingDependencies = Object.entries(runtimeManifest.dependencies).filter(
      ([name, version]) => manifest.dependencies[name] !== version,
    )

    expect(missingDependencies).toEqual([])
  })

  it('includes every workspace package mounted by the Web CLI profile', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as DesktopManifest
    const cliManifest = JSON.parse(
      readFileSync(new URL('../../cli/package.json', import.meta.url), 'utf8'),
    ) as Pick<DesktopManifest, 'dependencies'>

    const missingDependencies = Object.entries(cliManifest.dependencies)
      .filter(([, version]) => version.startsWith('workspace:'))
      .filter(([name, version]) => manifest.dependencies[name] !== version)

    expect(missingDependencies).toEqual([])
  })

  it.each([
    '../../../packages/bundle/base/package.json',
    '../../../packages/bundle/web-app/package.json',
  ])('includes every dynamic dependency declared by %s', (relativeManifest) => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as DesktopManifest
    const bundleManifest = JSON.parse(
      readFileSync(new URL(relativeManifest, import.meta.url), 'utf8'),
    ) as Pick<DesktopManifest, 'dependencies'>

    const missingDependencies = Object.entries(bundleManifest.dependencies)
      .filter(([, version]) => version.startsWith('workspace:'))
      .filter(([name, version]) => manifest.dependencies[name] !== version)

    expect(missingDependencies).toEqual([])
  })
})
