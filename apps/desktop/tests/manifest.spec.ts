import { existsSync, readFileSync } from 'node:fs'
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
  files?: string[]
  mac?: {
    icon?: string
    identity?: string | null
    hardenedRuntime?: boolean
    binaries?: string[]
    extraResources?: Array<{ from?: string; to?: string }>
  }
  win?: {
    icon?: string
    target?: Array<{ target?: string; arch?: string[] }>
    extraResources?: Array<{ from?: string; to?: string }>
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
  it('wires the verified on-demand native helper into the computer coordinator surface', () => {
    const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(mainSource).toContain('resolveComputerHelperBinaryPath')
    expect(mainSource).toContain('new NativeHelperProcess')
    expect(mainSource).toContain('new ComputerDesktopControlAdapter')
    expect(mainSource).toContain('onUnexpectedExit')
    expect(mainSource).toContain('computer: computerControlAdapter')
    expect(mainSource).toContain("capabilities: ['observe', 'pointer', 'keyboard']")
    expect(mainSource).toContain('app.isPackaged')
    expect(mainSource).toContain('process.resourcesPath')
    expect(mainSource).toContain("(process.platform === 'darwin' || process.platform === 'win32')")
    expect(mainSource).toContain('lstatBinary: lstatSync')
    expect(mainSource).toContain('readBinary: readFileSync')
    expect(mainSource).toContain("SessionId('desktop-computer-ui')")
    expect(mainSource).toContain('provider: {')
    expect(mainSource).toContain('computerControlAdapter.status(COMPUTER_CONTROL_UI_SESSION)')
    expect(mainSource).toMatch(
      /computerControlAdapter\.list\(\s*COMPUTER_CONTROL_UI_SESSION,\s*signal,?\s*\)/,
    )
    expect(mainSource.indexOf('computerControlAdapter.unexpectedHelperExit()')).toBeLessThan(
      mainSource.indexOf('controlCoordinator.helperCrashed()'),
    )
    expect(mainSource).toContain('active?.sessionId ?? officialControlSession')
    expect(mainSource).toContain('now: () => Math.floor(performance.now())')
  })

  it('maps browser enablement to a distinct native confirmation', () => {
    const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(mainSource).toContain("mutation.kind === 'set-browser-enabled'")
    expect(mainSource).toContain('Enable Browser Agent control for the visible workbench browser?')
  })

  it('uses one rounded icon source with native macOS and Windows containers', () => {
    const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(existsSync(new URL('../assets/icon-source.png', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../assets/icon.icns', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../assets/icon.ico', import.meta.url))).toBe(true)
    expect(mainSource).toContain('../assets/icon-source.png')
    expect(mainSource).not.toContain('../assets/icon-source-rounded.png')
  })

  it('ships Harness and pins the Electron toolchain', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as DesktopManifest

    expect(manifest).toMatchObject({
      name: '@deepseek-ai/dsh-desktop',
      version: '0.4.10',
      packageManager: 'pnpm@11.7.0',
      private: true,
      main: 'lib/main.js',
    })
    expect(manifest.dependencies['@deepseek-ai/dsh']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-home-paths']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-web-frontend']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-reasoning-effort']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-session-messenger']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-desktop-control-protocol']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-browser-control']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-computer-control']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-desktop-control-host']).toBe('workspace:^')
    expect(manifest.devDependencies.electron).toBe('43.4.0')
    expect(manifest.devDependencies['electron-builder']).toBe('26.15.3')
    expect(manifest.devDependencies['@electron/rebuild']).toBe('4.2.0')
    expect(manifest.devDependencies.playwright).toBe('^1.49.0')
    expect(manifest.scripts['pack:dir']).toContain('--mac dir --x64')
    expect(manifest.scripts['pack:dmg']).toContain('--mac dmg --x64')
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

  it('signs the packaged native helper with the same Mac identity as the app', () => {
    const builder = yaml.load(
      readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8'),
    ) as BuilderConfiguration

    expect(builder.mac).toMatchObject({
      identity: '-',
      hardenedRuntime: false,
      binaries: ['Contents/Resources/native/computer-use-helper'],
    })
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
    expect(client).toContain("export const inject = ['locale', 'modelDirectories', 'sessions', 'slots', 'remote', 'remote.session']")
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

  it('mounts one canonical internal Desktop control Host and externalizes the shared codec', () => {
    const patches = yaml.load(
      readFileSync(new URL('../desktop.cordis.patch.yml', import.meta.url), 'utf8'),
    ) as DesktopPatch[]
    const rows = patches.flatMap(patch => patch.insert ?? [])
    const bundleConfig = readFileSync(new URL('../tsdown.config.ts', import.meta.url), 'utf8')
    const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(rows.filter(row => row.id === 'desktop-control-host'
      || row.name === '@deepseek-ai/dsh-desktop-control-host')).toEqual([{
      id: 'desktop-control-host',
      name: '@deepseek-ai/dsh-desktop-control-host',
    }])
    expect(bundleConfig).toContain("'@deepseek-ai/dsh-desktop-control-protocol'")
    expect(mainSource).toContain('new DesktopControlBridgeServer')
    expect(mainSource).toContain('controlLifecycle: controlBridge')
    expect(mainSource).toContain('backend: controlCoordinator')
    expect(mainSource).not.toContain('backend: unavailableDesktopControlBackend')
    expect(mainSource.match(/controlCoordinator\.resumeAdmission\(\)/g)).toHaveLength(2)
  })

  it('keeps the sandboxed preload dependency closure electron-only', () => {
    const bundleConfig = readFileSync(new URL('../tsdown.config.ts', import.meta.url), 'utf8')
    const preloadConfig = bundleConfig.slice(bundleConfig.indexOf("entry: { preload: 'lib/types/preload.js' }"))
    const preloadSource = readFileSync(new URL('../src/preload.ts', import.meta.url), 'utf8')
    const preloadApiSource = readFileSync(new URL('../src/preload-api.ts', import.meta.url), 'utf8')
    const browserUiSource = readFileSync(new URL('../src/browser/ui-contracts.ts', import.meta.url), 'utf8')

    expect(preloadConfig).toContain("neverBundle: ['electron']")
    expect(preloadConfig).not.toContain('alwaysBundle')
    expect(preloadSource).toContain("from './browser/ui-contracts.ts'")
    expect(preloadApiSource).toContain("from './browser/ui-contracts.ts'")
    expect(browserUiSource).not.toMatch(/@deepseek-ai|node:/u)
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
          expect.objectContaining({ name: '@deepseek-ai/dsh-missher-brain', spec: 'builtin:0.1.2-alpha.2', category: 'memory' }),
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
    expect(rootManifest.scripts['desktop:setup']).toContain('build:official')
    expect(rootManifest.scripts['desktop:setup']).not.toMatch(/pnpm run build(?:\s|$)/u)
    expect(builder.mac?.icon).toBe('assets/icon.icns')
    expect(builder.mac?.extraResources).toEqual([{
      from: 'native-bin/darwin-x64/computer-use-helper',
      to: 'native/computer-use-helper',
    }])
    expect(builder.win).toMatchObject({
      target: [{ target: 'nsis', arch: ['x64'] }],
      icon: 'assets/icon.ico',
      extraResources: [{
        from: 'native-bin/win32-x64/computer-use-helper.exe',
        to: 'native/computer-use-helper.exe',
      }],
    })
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
  })

  it('delegates the authoritative module-fallback heal to the CLI exactly once', () => {
    const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(mainSource).not.toContain('healProfilesModuleFallback')
    expect(mainSource).not.toContain('module fallback: ready')
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
