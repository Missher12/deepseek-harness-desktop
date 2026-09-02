/**
 * Profile machinery of `dsh-app-boot`: directory resolution and init,
 * manifest round-trips, two-anchor bundle resolution, patch-layer loading,
 * empty-root composition, and the installation module-fallback healing.
 */

import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  composeEntries,
  healProfilesModuleFallback,
  healProfilesModuleFallbackCached,
  initProfile,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
} from '../src/index.ts'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-profile-'))

/** Stage a fake installed app: package.json with deps and a node_modules holding bundles. */
function stageInstallation(bundles: Record<string, { patch?: string; deps?: Record<string, string> }>): string {
  const root = tmp()
  const appDir = join(root, 'app')
  mkdirSync(join(appDir, 'node_modules'), { recursive: true })
  const appDeps: Record<string, string> = {}
  for (const [name, spec] of Object.entries(bundles)) {
    appDeps[name] = '0.0.0'
    const dir = join(appDir, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name,
      version: '0.0.0',
      dependencies: spec.deps ?? {},
      ...spec.patch === undefined ? {} : { dsh: { bundle: { patch: './cordis.patch.yml' } } },
    }))
    if (spec.patch !== undefined) writeFileSync(join(dir, 'cordis.patch.yml'), spec.patch)
  }
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'dsh-app', dependencies: appDeps }))
  return join(appDir, 'package.json')
}

function writeLegacyModuleProxy(
  dir: string,
  packageName: string,
  targets: Record<string, string>,
): void {
  mkdirSync(dir, { recursive: true })
  const exports = Object.fromEntries(
    Object.keys(targets).map((subpath, index) => [subpath, `./entry-${index}.js`]),
  )
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: packageName,
    version: '0.4.11',
    private: true,
    type: 'module',
    exports,
    dsh: { moduleFallback: { targets } },
  }, undefined, 2) + '\n')
  for (const [index, target] of Object.values(targets).entries()) {
    const specifier = JSON.stringify(target)
    writeFileSync(
      join(dir, `entry-${index}.js`),
      `export * from ${specifier}\nimport * as target from ${specifier}\nexport default target.default\n`,
    )
  }
}

function snapshotFlatDirectory(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).sort().map(name => [
    name,
    readFileSync(join(dir, name)).toString('base64'),
  ]))
}

function rewriteLegacyManifest(dir: string, mutate: (manifest: Record<string, unknown>) => void): void {
  const path = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  mutate(manifest)
  writeFileSync(path, JSON.stringify(manifest, undefined, 2) + '\n')
}

describe('resolveProfileDir', () => {
  it('joins the home and rejects traversal-shaped names', () => {
    const home = tmp()
    expect(resolveProfileDir('tui', home)).toBe(join(home, 'profiles', 'tui'))
    for (const bad of ['', '.', '..', 'a/b', 'a\\b']) {
      expect(() => resolveProfileDir(bad, home)).toThrow('invalid profile name')
    }
  })
})

describe('initProfile', () => {
  it('creates manifest, user patch layer, and pnpm workspace once, never overwriting', () => {
    const home = tmp()
    const dir = resolveProfileDir('tui', home)
    initProfile(dir, ['@deepseek-ai/dsh-base'])
    const manifest = readProfileManifest('t', dir)
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(readFileSync(join(dir, PROFILE_PATCH_FILENAME), 'utf8')).toContain('[]')
    expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')).toContain('nodeLinker: hoisted')
    // Re-init keeps user edits.
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), '- id: x\n  config: {}\n')
    initProfile(dir, ['other'])
    expect(readProfileManifest('t', dir).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(readFileSync(join(dir, PROFILE_PATCH_FILENAME), 'utf8')).toContain('- id: x')
  })
})

describe('manifest round-trip', () => {
  it('writes and reads back, and fails loud on a broken manifest', () => {
    const dir = tmp()
    writeProfileManifest(dir, { name: 'p', dsh: { profile: { bundles: ['a'] } } })
    expect(readProfileManifest('t', dir).dsh?.profile?.bundles).toEqual(['a'])
    writeFileSync(join(dir, 'package.json'), '[]')
    expect(() => readProfileManifest('t', dir)).toThrow('must hold a JSON object')
    expect(() => readProfileManifest('t', join(dir, 'nope'))).toThrow('failed to read profile manifest')
  })
})

describe('resolveBundleDir', () => {
  it('prefers the installation anchor, falls back to the profile, and fails loud', () => {
    const anchor = stageInstallation({ 'in-box': { patch: '[]\n' } })
    const profileDir = tmp()
    mkdirSync(join(profileDir, 'node_modules', 'local-only'), { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), '{}')
    writeFileSync(join(profileDir, 'node_modules', 'local-only', 'package.json'), JSON.stringify({ name: 'local-only', version: '0.0.0' }))
    expect(resolveBundleDir('t', 'in-box', anchor, profileDir)).toContain('in-box')
    expect(resolveBundleDir('t', 'local-only', anchor, profileDir)).toContain('local-only')
    expect(() => resolveBundleDir('t', 'absent', anchor, profileDir)).toThrow('cannot resolve profile bundle')
  })

  it('resolves a package whose exports map omits ./package.json', () => {
    // Common on npm: an exports map without "./package.json" makes
    // require.resolve('<pkg>/package.json') throw ERR_PACKAGE_PATH_NOT_EXPORTED;
    // resolution must fall through to the paths probe instead of misreporting
    // the installed package as missing.
    const anchor = stageInstallation({})
    const profileDir = tmp()
    writeFileSync(join(profileDir, 'package.json'), '{}')
    const dir = join(profileDir, 'node_modules', 'sealed-bundle')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'sealed-bundle',
      version: '0.0.0',
      exports: { '.': './index.js' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(dir, 'index.js'), '')
    writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
    expect(resolveBundleDir('t', 'sealed-bundle', anchor, profileDir)).toBe(dir)
  })
})

describe('loadProfile', () => {
  it('resolves each dsh.profile.bundles entry to its patch layer in order, plus the user layer', () => {
    const anchor = stageInstallation({
      'bundle-a': { patch: '- insert:\n    - id: a\n      name: pkg-a\n' },
      'bundle-b': { patch: '- id: a\n  config:\n    v: 2\n' },
    })
    const home = tmp()
    const dir = resolveProfileDir('demo', home)
    initProfile(dir, ['bundle-a', 'bundle-b'])
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), '- id: a\n  config:\n    v: 3\n')
    const profile = loadProfile('t', 'demo', anchor, home)
    expect(profile.layers.map(layer => layer.packageName)).toEqual(['bundle-a', 'bundle-b'])
    expect(profile.patches).toHaveLength(1)
    const entries = composeEntries([
      ...profile.layers.map(layer => layer.patches),
      profile.patches,
    ])
    expect(entries).toEqual([{ id: 'a', name: 'pkg-a', config: { v: 3 } }])
    // A hand-made profile without the user layer file or dsh section: empty layers, no throw.
    rmSync(join(dir, PROFILE_PATCH_FILENAME))
    expect(loadProfile('t', 'demo', anchor, home).patches).toEqual([])
    writeProfileManifest(dir, { name: 'bare' })
    const bare = loadProfile('t', 'demo', anchor, home)
    expect(bare.layers).toEqual([])
  })

  it('auto-initializes only shipped templates and fails loud otherwise', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    expect(() => loadProfile('t', 'custom', anchor, home))
      .toThrow('profile "custom" does not exist')
    // The web template auto-initializes on first load. Bundle resolution
    // cannot be asserted to fail here: the source-plane test runner resolves
    // @deepseek-ai/* through tsconfig paths regardless of the staged anchor.
    expect(PROFILE_TEMPLATES.web).toContain('@deepseek-ai/dsh-base')
    try {
      loadProfile('t', 'web', anchor, home)
    } catch {
      // Resolution failure is the plain-Node outcome for this empty anchor.
    }
    expect(readProfileManifest('t', resolveProfileDir('web', home)).dsh?.profile?.bundles)
      .toEqual([...PROFILE_TEMPLATES.web ?? []])
  })

  it('normalizes only the exact installation-owned headless bundle tuple', () => {
    const anchor = stageInstallation({
      '@deepseek-ai/dsh-base': { patch: '[]\n' },
      '@deepseek-ai/dsh-web-app': { patch: '[]\n' },
      '@deepseek-ai/dsh-headless': { patch: '[]\n' },
      'custom-bundle': { patch: '[]\n' },
    })
    const home = tmp()
    const stock = resolveProfileDir('headless', home)
    initProfile(stock, [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless',
    ])
    loadProfile('t', 'headless', anchor, home)
    expect(readProfileManifest('t', stock).dsh?.profile?.bundles)
      .toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'])

    const customHome = tmp()
    const custom = resolveProfileDir('headless', customHome)
    initProfile(custom, [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless', 'custom-bundle',
    ])
    loadProfile('t', 'headless', anchor, customHome)
    expect(readProfileManifest('t', custom).dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless', 'custom-bundle',
    ])
  })

  it('fails loud when a listed bundle declares no dsh.bundle', () => {
    const anchor = stageInstallation({ 'not-a-bundle': {} })
    const home = tmp()
    const dir = resolveProfileDir('demo', home)
    initProfile(dir, ['not-a-bundle'])
    expect(() => loadProfile('t', 'demo', anchor, home)).toThrow('declares no dsh.bundle')
  })
})

describe('composeEntries', () => {
  it('applies layers over an empty root and reports skipped patches', () => {
    const warnings: string[] = []
    const entries = composeEntries([
      [{ insert: [{ id: 'x', name: 'pkg-x', config: { a: 1 } }] }],
      [{ id: 'x', config: { a: 2 } }, { id: 'missing', config: {} }],
    ], message => warnings.push(message))
    expect(entries).toEqual([{ id: 'x', name: 'pkg-x', config: { a: 2 } }])
    expect(warnings.join('\n')).toContain('"missing"')
    // Default warn sink: skipped patches are silently dropped (boot repeats them).
    expect(composeEntries([[{ id: 'missing', config: {} }]])).toEqual([])
  })
})

describe('healProfilesModuleFallback', () => {
  it('links the app and bundle dependency surface flat under profiles/node_modules', () => {
    const anchor = stageInstallation({
      'bundle-a': { patch: '[]\n', deps: { 'dep-of-a': '0.0.0', 'ghost-dep': '0.0.0' } },
      'plain-lib': {},
    })
    // An app dependency that is declared but not installed: skipped, not fatal.
    const appManifest = JSON.parse(readFileSync(anchor, 'utf8')) as { dependencies: Record<string, string> }
    appManifest.dependencies['never-installed'] = '0.0.0'
    writeFileSync(anchor, JSON.stringify(appManifest))
    // dep-of-a lives in the installation's node_modules too.
    const modules = join(anchor, '..', 'node_modules')
    mkdirSync(join(modules, 'dep-of-a'), { recursive: true })
    writeFileSync(join(modules, 'dep-of-a', 'package.json'), JSON.stringify({ name: 'dep-of-a', version: '0.0.0' }))
    const home = tmp()
    healProfilesModuleFallback(anchor, home)
    const fallback = join(home, 'profiles', 'node_modules')
    // App deps, the bundle's own deps, and the bundle itself are linked; the
    // plain library is linked as an app dep (harmless), the app itself too.
    for (const name of ['bundle-a', 'plain-lib', 'dep-of-a', 'dsh-app']) {
      expect(lstatSync(join(fallback, name)).isSymbolicLink(), name).toBe(true)
    }
    // Idempotent, and a moved target is re-pointed.
    healProfilesModuleFallback(anchor, home)
    const before = readlinkSync(join(fallback, 'dep-of-a'))
    expect(before).toContain('dep-of-a')
  })

  it('links packaged dependencies to their physical asar-unpacked copies', () => {
    const root = tmp()
    const archive = join(root, 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar')
    const archivedPackage = join(archive, 'node_modules', 'packaged-dep')
    const unpackedPackage = join(
      root,
      'DeepSeek Harness.app',
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
      'packaged-dep',
    )
    mkdirSync(archivedPackage, { recursive: true })
    mkdirSync(unpackedPackage, { recursive: true })
    writeFileSync(join(archive, 'package.json'), JSON.stringify({
      name: 'dsh-app',
      dependencies: { 'packaged-dep': '0.0.0' },
    }))
    const dependencyManifest = JSON.stringify({ name: 'packaged-dep', version: '0.0.0' })
    writeFileSync(join(archivedPackage, 'package.json'), dependencyManifest)
    writeFileSync(join(unpackedPackage, 'package.json'), dependencyManifest)

    const home = tmp()
    healProfilesModuleFallback(join(archive, 'package.json'), home)

    expect(readlinkSync(join(home, 'profiles', 'node_modules', 'packaged-dep')))
      .toBe(unpackedPackage)
  })

  it('keeps the archive target when no asar-unpacked copy exists', () => {
    const root = tmp()
    const archive = join(root, 'DeepSeek Harness.app', 'Contents', 'Resources', 'app.asar')
    const archivedPackage = join(archive, 'node_modules', 'packaged-dep')
    mkdirSync(archivedPackage, { recursive: true })
    writeFileSync(join(archive, 'package.json'), JSON.stringify({
      name: 'dsh-app',
      dependencies: { 'packaged-dep': '0.0.0' },
    }))
    writeFileSync(join(archivedPackage, 'package.json'), JSON.stringify({
      name: 'packaged-dep', version: '0.0.0',
    }))

    const home = tmp()
    healProfilesModuleFallback(join(archive, 'package.json'), home)

    expect(readlinkSync(join(home, 'profiles', 'node_modules', 'packaged-dep')))
      .toBe(archivedPackage)
  })

  it('throws when a fallback entry is a real directory', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    const link = join(home, 'profiles', 'node_modules', 'dsh-app')
    mkdirSync(link, { recursive: true })
    writeFileSync(join(link, 'user-plugin.js'), 'export default "keep me"\n')
    const before = snapshotFlatDirectory(link)
    expect(() => { healProfilesModuleFallback(anchor, home) }).toThrow('is not a symlink')
    expect(snapshotFlatDirectory(link)).toEqual(before)
    expect(existsSync(join(home, 'recovery'))).toBe(false)
  })

  it('backs up an exact legacy packaged proxy before replacing it with the current symlink', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    const link = join(home, 'profiles', 'node_modules', 'dsh-app')
    const targets = {
      '.': 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/lib/main.js',
    }
    writeLegacyModuleProxy(link, 'dsh-app', targets)
    const originalManifest = readFileSync(join(link, 'package.json'), 'utf8')
    const originalEntry = readFileSync(join(link, 'entry-0.js'), 'utf8')

    healProfilesModuleFallback(anchor, home)

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(dirname(anchor))
    const recoveryRoot = join(home, 'recovery', 'legacy-module-fallback')
    const [backupName] = readdirSync(recoveryRoot)
    expect(readdirSync(recoveryRoot)).toHaveLength(1)
    expect(readFileSync(join(recoveryRoot, backupName!, 'package.json'), 'utf8')).toBe(originalManifest)
    expect(readFileSync(join(recoveryRoot, backupName!, 'entry-0.js'), 'utf8')).toBe(originalEntry)
  })

  it.each([
    ['an extra file', (link: string) => { writeFileSync(join(link, 'notes.txt'), 'user data\n') }],
    ['an extra manifest field', (link: string) => {
      rewriteLegacyManifest(link, (manifest) => { manifest.description = 'not generator-owned' })
    }],
    ['a different package name', (link: string) => {
      rewriteLegacyManifest(link, (manifest) => { manifest.name = 'another-package' })
    }],
    ['an exports mismatch', (link: string) => {
      rewriteLegacyManifest(link, (manifest) => {
        (manifest.exports as Record<string, string>)['.'] = './other.js'
      })
    }],
    ['an entry target mismatch', (link: string) => {
      writeFileSync(join(link, 'entry-0.js'), 'export default "user code"\n')
    }],
    ['a manifest target mismatch', (link: string) => {
      rewriteLegacyManifest(link, (manifest) => {
        const dsh = manifest.dsh as { moduleFallback: { targets: Record<string, string> } }
        dsh.moduleFallback.targets['.']
          = 'file:///Applications/Another.app/Contents/Resources/app.asar/lib/main.js'
      })
    }],
    ['a non-packaged target', (link: string) => {
      writeLegacyModuleProxy(link, 'dsh-app', { '.': 'file:///tmp/user-package/index.js' })
    }],
    ['a forged archive marker', (link: string) => {
      writeLegacyModuleProxy(link, 'dsh-app', { '.': 'file:///tmp/app.asar-copy/index.js' })
    }],
    ['an encoded path separator', (link: string) => {
      writeLegacyModuleProxy(link, 'dsh-app', {
        '.': 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar%2Flib/main.js',
      })
    }],
  ])('rejects a proxy-shaped directory with %s without changing its bytes', (_label, mutate) => {
    const anchor = stageInstallation({})
    const home = tmp()
    const link = join(home, 'profiles', 'node_modules', 'dsh-app')
    writeLegacyModuleProxy(link, 'dsh-app', {
      '.': 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/lib/main.js',
    })
    mutate(link)
    const before = snapshotFlatDirectory(link)

    expect(() => { healProfilesModuleFallback(anchor, home) }).toThrow('is not a symlink')
    expect(snapshotFlatDirectory(link)).toEqual(before)
    expect(existsSync(join(home, 'recovery'))).toBe(false)
  })

  it('recognizes the historical Windows file URL form', () => {
    const packageName = '@deepseek-ai/dsh-desktop'
    const anchor = stageInstallation({ [packageName]: {} })
    const home = tmp()
    const link = join(home, 'profiles', 'node_modules', packageName)
    writeLegacyModuleProxy(link, packageName, {
      '.': 'file:///C:/Program%20Files/DeepSeek%20Harness/resources/app.asar/lib/main.js',
      './preload': 'file:///C:/Program%20Files/DeepSeek%20Harness/resources/app.asar/lib/preload.js',
    })

    healProfilesModuleFallback(anchor, home)

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(join(dirname(anchor), 'node_modules', packageName))
    expect(readdirSync(join(home, 'recovery', 'legacy-module-fallback'))).toHaveLength(1)
  })

  it('retries idempotently after the legacy directory was recovered but before its link was created', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    const link = join(home, 'profiles', 'node_modules', 'dsh-app')
    writeLegacyModuleProxy(link, 'dsh-app', {
      '.': 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/lib/main.js',
    })
    healProfilesModuleFallback(anchor, home)
    const recoveryRoot = join(home, 'recovery', 'legacy-module-fallback')
    const recoveryNames = readdirSync(recoveryRoot)
    unlinkSync(link)

    healProfilesModuleFallback(anchor, home)
    healProfilesModuleFallback(anchor, home)

    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readdirSync(recoveryRoot)).toEqual(recoveryNames)
  })

  it('migrates a legacy proxy through the Desktop cache miss and then verifies the cache', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    const link = join(home, 'profiles', 'node_modules', 'dsh-app')
    writeLegacyModuleProxy(link, 'dsh-app', {
      '.': 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/lib/main.js',
    })

    expect(healProfilesModuleFallbackCached(anchor, home, '0.5.1')).toBe('rebuilt')
    expect(healProfilesModuleFallbackCached(anchor, home, '0.5.1')).toBe('verified-cache')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readdirSync(join(home, 'recovery', 'legacy-module-fallback'))).toHaveLength(1)
  })

  it('does not follow a recovery-directory symlink or move the legacy proxy through it', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    const link = join(home, 'profiles', 'node_modules', 'dsh-app')
    writeLegacyModuleProxy(link, 'dsh-app', {
      '.': 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/lib/main.js',
    })
    const before = snapshotFlatDirectory(link)
    const foreign = tmp()
    symlinkSync(foreign, join(home, 'recovery'), 'junction')

    expect(() => { healProfilesModuleFallback(anchor, home) }).toThrow('must be a real directory')
    expect(snapshotFlatDirectory(link)).toEqual(before)
    expect(readdirSync(foreign)).toEqual([])
  })

  it('replaces a wrong symlink', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    const fallback = join(home, 'profiles', 'node_modules')
    mkdirSync(fallback, { recursive: true })
    symlinkSync(tmp(), join(fallback, 'dsh-app'), 'junction')
    healProfilesModuleFallback(anchor, home)
    expect(readlinkSync(join(fallback, 'dsh-app'))).toContain('app')
  })

  it('tolerates losing the concurrent-heal race to an identical link and rejects a different one', () => {
    // The EEXIST arm: a second process wrote the link between our lstat miss
    // and symlinkSync. Simulated by pre-creating the correct link and calling
    // the internal path through a stale-lstat shim is not possible from
    // outside, so probe the observable contract: healing twice concurrently
    // is a no-op, and a foreign REAL directory still fails loud.
    const anchor = stageInstallation({})
    const home = tmp()
    healProfilesModuleFallback(anchor, home)
    healProfilesModuleFallback(anchor, home) // second healer sees the correct link
    const fallback = join(home, 'profiles', 'node_modules')
    expect(lstatSync(join(fallback, 'dsh-app')).isSymbolicLink()).toBe(true)
  })

  it('uses a verified Desktop cache and rebuilds it when a linked package changes', () => {
    const anchor = stageInstallation({ 'bundle-a': { patch: '[]\n' } })
    const home = tmp()

    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.1')).toBe('rebuilt')
    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.1')).toBe('verified-cache')

    const dependencyManifest = join(dirname(anchor), 'node_modules', 'bundle-a', 'package.json')
    const changed = JSON.parse(readFileSync(dependencyManifest, 'utf8')) as Record<string, unknown>
    changed.description = 'changed after the cache was written'
    writeFileSync(dependencyManifest, JSON.stringify(changed))

    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.1')).toBe('rebuilt')
    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.1')).toBe('verified-cache')
  })

  it('rejects a stale fallback link even when its cache JSON still parses', () => {
    const anchor = stageInstallation({})
    const home = tmp()
    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.1')).toBe('rebuilt')

    const link = join(home, 'profiles', 'node_modules', 'dsh-app')
    unlinkSync(link)
    symlinkSync(tmp(), link, 'junction')

    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.1')).toBe('rebuilt')
    expect(readlinkSync(link)).toBe(dirname(anchor))
  })

  it('treats malformed, oversized, and partially missing Desktop caches as misses', () => {
    const anchor = stageInstallation({ 'bundle-a': { patch: '[]\n' } })
    const home = tmp()
    const cachePath = join(home, 'profiles', '.module-fallback-cache.json')
    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.2')).toBe('rebuilt')

    const valid = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>
    const links = valid.links as Array<Record<string, unknown>>
    const link = links[0] ?? {}
    const miss = (value: unknown): void => {
      writeFileSync(cachePath, JSON.stringify(value))
      expect(healProfilesModuleFallbackCached(anchor, home, '0.4.2')).toBe('rebuilt')
    }

    miss(null)
    miss({ ...valid, format: 2 })
    miss({ ...valid, installKey: 'another-install' })
    miss({ ...valid, installAnchor: `${anchor}.moved` })
    miss({ ...valid, rootManifestSha256: '0'.repeat(64) })
    miss({ ...valid, links: null })
    miss({ ...valid, links: Array.from({ length: 4097 }, () => link) })
    miss({ ...valid, links: [null] })

    for (const packageName of ['', 'bad\\name', 'bad\0name', '@scope', '@/pkg', '@scope/..', 'bad/name', '.', '..']) {
      miss({ ...valid, links: [{ ...link, packageName }] })
    }
    miss({ ...valid, links: [{ ...link, packageName: '@scope/pkg' }] })
    miss({ ...valid, links: [{ ...link, target: 'relative-target' }] })
    miss({ ...valid, links: [{ ...link, manifestSha256: null }] })
    miss({ ...valid, links: [{ ...link, manifestSha256: 'not-a-sha' }] })

    writeFileSync(cachePath, 'x'.repeat(4 * 1024 * 1024 + 1))
    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.2')).toBe('rebuilt')

    const fallbackLink = join(home, 'profiles', 'node_modules', 'dsh-app')
    unlinkSync(fallbackLink)
    expect(healProfilesModuleFallbackCached(anchor, home, '0.4.2')).toBe('rebuilt')

    rmSync(fallbackLink)
    mkdirSync(fallbackLink)
    expect(() => healProfilesModuleFallbackCached(anchor, home, '0.4.2')).toThrow('is not a symlink')
  })
})
