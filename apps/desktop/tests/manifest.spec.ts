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
    expect(manifest.devDependencies.electron).toBe('43.4.0')
    expect(manifest.devDependencies['electron-builder']).toBe('26.15.3')
    expect(manifest.devDependencies['@electron/rebuild']).toBe('4.2.0')
    expect(manifest.devDependencies.playwright).toBe('^1.49.0')
    expect(manifest.scripts['pack:dir']).toContain('--mac dir --x64')
    expect(manifest.scripts['pack:dmg']).toContain('--mac dmg --x64')
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
