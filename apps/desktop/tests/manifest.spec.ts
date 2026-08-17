import { existsSync, readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface DesktopManifest {
  name: string
  packageManager: string
  private: boolean
  main: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}

interface BuilderConfiguration {
  files?: string[]
  mac?: { icon?: string }
  win?: {
    icon?: string
    target?: Array<{ target?: string; arch?: string[] }>
  }
  nsis?: {
    oneClick?: boolean
    perMachine?: boolean
    allowElevation?: boolean
    createDesktopShortcut?: boolean
    createStartMenuShortcut?: boolean
    runAfterFinish?: boolean
    deleteAppDataOnUninstall?: boolean
    shortcutName?: string
    artifactName?: string
  }
}

describe('desktop package manifest', () => {
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
      packageManager: 'pnpm@11.7.0',
      private: true,
      main: 'lib/main.js',
    })
    expect(manifest.dependencies['@deepseek-ai/dsh']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-home-paths']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-web-frontend']).toBe('workspace:^')
    expect(manifest.dependencies['@deepseek-ai/dsh-reasoning-effort']).toBe('workspace:^')
    expect(manifest.devDependencies.electron).toBe('43.4.0')
    expect(manifest.devDependencies['electron-builder']).toBe('26.15.3')
    expect(manifest.devDependencies['@electron/rebuild']).toBe('4.2.0')
    expect(manifest.devDependencies.playwright).toBe('^1.49.0')
    expect(manifest.scripts['pack:dir']).toContain('--mac dir --x64')
    expect(manifest.scripts['pack:dmg']).toContain('--mac dmg --x64')
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
      new URL('../../../packages/client/web/src/boot.tsx', import.meta.url),
      'utf8',
    )

    expect(host).toContain("export const inject = ['settings', 'webServer']")
    expect(client).toContain("export const inject = ['locale', 'modelDirectories', 'sessions', 'slots']")
    expect(boot).toContain('entry.fiber === undefined')
    expect(boot).toContain("state === 'pending'")
    expect(boot).toContain('failures.push(`${name}: ${state}`)')
    expect(boot).toContain('did not activate')
    expect(boot).toContain('await this.runPluginBoot(prefetching)\n      this.settled.set(true)')
    expect(boot).toContain('await loader.await()\n    this.assertEntriesActive()')
  })

  it('builds one per-user Windows x64 Setup with shortcuts and launch-after-install', () => {
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
      icon: 'assets/icon.ico',
    })
    expect(builder.nsis).toMatchObject({
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      shortcutName: 'DeepSeek Harness',
      artifactName: 'DeepSeek-Harness-Setup-${version}-win-x64.${ext}',
    })
    expect(builder.files).toContain('!node_modules/**/*.map')
    expect(builder.files).toContain('!node_modules/**/*.d.ts')
    expect(builder.files).toContain('!node_modules/**/*.d.cts')
    expect(builder.files).toContain('!node_modules/**/*.d.mts')
    expect(builder.files).toContain('!node_modules/**/*.tsbuildinfo')
    expect(builder.files).toContain(
      '!node_modules/@deepseek-ai/dsh-session-telemetry-otel/node_modules/@opentelemetry/resources/**',
    )
  })

  it('exercises uninstall from a realistic short per-user install path', () => {
    const smoke = readFileSync(
      new URL('../../../scripts/windows-desktop-setup-smoke.ps1', import.meta.url),
      'utf8',
    )

    expect(smoke).toContain("[Environment]::GetFolderPath('LocalApplicationData')")
    expect(smoke).not.toContain('[IO.Path]::GetTempPath()')
  })

  it('exercises the patched marketplace and both protected and ordinary package routes', () => {
    const smoke = readFileSync(new URL('./packaged-smoke.ts', import.meta.url), 'utf8')

    expect(smoke).toContain('data-dshmarket-layout="compact"')
    expect(smoke).toContain('data-dshmarket-plugin-row')
    expect(smoke).toContain('data-dshmarket-primary-action')
    expect(smoke).toContain("'/dsh-market/update'")
    expect(smoke).toContain("'/dsh-market/uninstall'")
    expect(smoke).toContain("code: 'self-protected'")
  })

  it('exercises the native reasoning slider and session-messenger footer', () => {
    const smoke = readFileSync(new URL('./packaged-smoke.ts', import.meta.url), 'utf8')

    expect(smoke).toContain('desktop-smoke-reasoning-${platform}.png')
    expect(smoke).toContain('data-messenger-state="pending"')
    expect(smoke).toContain('Copy current Session ID')
    expect(smoke).toContain('desktop-smoke-messenger-${platform}.png')
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
