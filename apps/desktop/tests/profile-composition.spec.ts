import { createHash } from 'node:crypto'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginStateSnapshot } from '../src/compatibility/plugin-state.ts'
import { composeManagedProfile, type ManagedProfileInput, type OfficialProfileCompositionApi } from '../src/compatibility/profile-composition.ts'

type TestBootApi = Pick<OfficialProfileCompositionApi, 'loadOverlayPatches' | 'resolveBundleDir'> & {
  loadProfileDirectory(bin: string, directory: string, anchor: string): { layers: { packageName: string }[]; patchReload: string }
  composeEntries: (layers: unknown[][]) => unknown[]
}
const localBootUrl = pathToFileURL(resolve('packages/boot/app-boot/src/index.ts')).href
const localIncludeUrl = pathToFileURL(resolve('vendor/include/src/index.ts')).href
const { loadOverlayPatches, resolveBundleDir, composeEntries } = await import(/* @vite-ignore */ localBootUrl) as TestBootApi
const { entryListSchema } = await import(/* @vite-ignore */ localIncludeUrl) as { entryListSchema: yaml.Schema }

const OFFICIAL_SHA = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
const BASE = '@deepseek-ai/dsh-base'
const WEB = '@deepseek-ai/dsh-web-app'
const roots: string[] = []
async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}
async function json(path: string, value: unknown) { await put(path, JSON.stringify(value) + '\n') }
async function inventory(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const path of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (path.isFile()) {
      const file = join(path.parentPath, path.name)
      result[file] = createHash('sha256').update(await readFile(file)).digest('hex')
    }
  }
  return result
}
async function fixture(disabled = ['bundle-a']) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-profile-compose-')))
  roots.push(root)
  const dshHome = join(root, 'home')
  const canonicalDirectory = join(dshHome, 'profiles/web')
  const effectiveDirectory = join(dshHome, 'profiles/desktop-base')
  const officialAnchor = join(root, 'official/node_modules/@deepseek-ai/dsh/package.json')
  await json(officialAnchor, { name: '@deepseek-ai/dsh', version: '0.1.5-rc.2' })
  for (const name of [BASE, WEB, '@deepseek-ai/cordis-plugin-group', '@deepseek-ai/cordis']) {
    const directory = join(root, 'official/node_modules', name)
    await json(join(directory, 'package.json'), { name, version: '0.1.5-rc.2', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await put(join(directory, 'index.js'), 'export {}\n')
    await put(join(directory, 'cordis.patch.yml'), '[]\n')
  }
  const packages = Object.fromEntries(['bundle-a', 'bundle-b'].map(name => [name, join(canonicalDirectory, 'node_modules', name)]))
  for (const [name, directory] of Object.entries(packages)) {
    await json(join(directory, 'package.json'), { name, version: '1.0.0', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await put(join(directory, 'index.js'), 'export {}\n')
    await put(join(directory, 'cordis.patch.yml'), `- insert:\n    - id: ${name}\n      name: ${name}\n`)
    await put(join(directory, 'data/sentinel'), 'preserve data')
  }
  await json(join(canonicalDirectory, 'package.json'), {
    name: 'dsh-profile-web', private: true, dependencies: { 'bundle-a': '1.0.0', 'bundle-b': '1.0.0' },
    dsh: { profile: { bundles: [BASE, WEB, 'bundle-a', 'bundle-b'], patchReload: 'live' } },
  })
  await put(join(canonicalDirectory, 'cordis.patch.yml'), '[]\n')
  const snapshot: PluginStateSnapshot = {
    schemaVersion: 1, revision: 3, policy: { failureConfirmations: 2 },
    entries: disabled.map((name, order) => ({ name, observedVersion: '1.0.0', targetHostVersion: '0.6.0', userEnabled: false, health: 'unverified', order,
      source: { profileName: 'web', codePath: packages[name]!, dataPaths: [] }, requiredBundleNames: [] })),
  }
  const reads: string[] = [], resolutions: string[] = []
  const api: OfficialProfileCompositionApi = {
    sourceSha: OFFICIAL_SHA, entryListSchema,
    yaml: {
      load: (text, options) => yaml.load(text, options as yaml.LoadOptions),
      dump: (value, options) => yaml.dump(value, options as yaml.DumpOptions),
    },
    loadOverlayPatches: (bin, path) => {
      reads.push(path)
      return loadOverlayPatches(bin, path)
    },
    resolveBundleDir: (bin, name, anchor, profile) => {
      resolutions.push(name)
      return resolveBundleDir(bin, name, anchor, profile)
    },
  }
  const input: ManagedProfileInput = { canonicalDirectory, effectiveDirectory, dshHome, officialAnchor, snapshot }
  return { root, input, api, reads, resolutions, packages }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('canonical web to owned startup profile', () => {
  it('excludes a paused Bundle before resolving its broken manifest or YAML and preserves the canonical tree', async () => {
    const { input, api, packages, reads, resolutions } = await fixture()
    await put(join(packages['bundle-a']!, 'package.json'), 'broken manifest [')
    await put(join(packages['bundle-a']!, 'cordis.patch.yml'), 'broken yaml [')
    const before = await inventory(input.canonicalDirectory)
    const paused: PluginStateSnapshot = { ...input.snapshot, entries: input.snapshot.entries.map(item => ({
      ...item, userEnabled: true, health: 'paused', pauseReason: {
        code: 'invalid-yaml', observedVersion: '1.0.0', targetHostVersion: '0.6.0',
        summary: 'The Bundle patch failed YAML validation.', confirmations: 2,
        evidenceIds: ['0'.repeat(64), '1'.repeat(64)],
      },
    })) }
    const receipt = await composeManagedProfile({ ...input, snapshot: paused }, api)
    expect(receipt.activeBundles).toEqual([BASE, WEB, 'bundle-b'])
    expect(receipt.originalPatchReload).toBe('live')
    expect(receipt.effectivePatchReload).toBe('startup')
    expect(resolutions).not.toContain('bundle-a')
    expect(reads).not.toContain(join(packages['bundle-a']!, 'cordis.patch.yml'))
    expect(await inventory(input.canonicalDirectory)).toEqual(before)
    expect(await realpath(join(input.effectiveDirectory, 'node_modules/bundle-b'))).toBe(packages['bundle-b'])
    expect(existsSync(join(input.effectiveDirectory, 'node_modules/bundle-a'))).toBe(false)
    expect(receipt.observations.find(item => item.name === 'bundle-b')).toMatchObject({ requiredBundleNames: [], requiredRelationsVerified: true })
    const manifest = JSON.parse(await readFile(join(input.effectiveDirectory, 'package.json'), 'utf8')) as { dsh: { profile: unknown } }
    expect(manifest.dsh.profile).toEqual({ bundles: [BASE, WEB, 'bundle-b'], patchReload: 'startup' })
    expect((JSON.parse(await readFile(join(input.effectiveDirectory, 'receipt.json'), 'utf8')) as { inputHash: string }).inputHash).toBe(receipt.inputHash)
  })

  it('keeps A excluded after canonical CLI-style add/remove reconciliation and restores it only after explicit state recovery', async () => {
    const { input, api, reads, packages } = await fixture()
    await composeManagedProfile(input, api)
    const path = join(input.canonicalDirectory, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
      dependencies: Record<string, string>
    }
    manifest.dsh.profile.bundles = [BASE, WEB, 'bundle-a']
    delete manifest.dependencies['bundle-b']
    await json(path, manifest)
    const removed = await composeManagedProfile(input, api)
    expect(removed.activeBundles).toEqual([BASE, WEB])
    manifest.dsh.profile.bundles.push('bundle-b')
    manifest.dependencies['bundle-b'] = '1.0.0'
    await json(path, manifest)
    expect((await composeManagedProfile(input, api)).activeBundles).toEqual([BASE, WEB, 'bundle-b'])
    expect(reads).not.toContain(join(packages['bundle-a']!, 'cordis.patch.yml'))
    const restored = await composeManagedProfile({ ...input, snapshot: { ...input.snapshot, revision: 4, entries: [] } }, api)
    expect(restored.activeBundles).toEqual([BASE, WEB, 'bundle-a', 'bundle-b'])
  })

  it('anchors nested relative inserted modules at the original patch and round-trips official !!js nodes', async () => {
    const { input, api } = await fixture([])
    await put(join(input.canonicalDirectory, 'local.mjs'), 'export {}\n')
    await put(join(input.canonicalDirectory, 'nested/child.mjs'), 'export {}\n')
    const path = join(input.canonicalDirectory, 'cordis.patch.yml')
    await put(path, "- insert:\n  - id: local\n    name: ./local.mjs\n    config:\n      value: !!js 1 + 2\n  - id: group\n    name: '@deepseek-ai/cordis-plugin-group'\n    group: true\n    config:\n    - id: nested\n      name: ./nested/child.mjs\n      config:\n        enabled: !!js true\n")
    const expected = loadOverlayPatches('test', path)
    await composeManagedProfile(input, api)
    const serialized = await readFile(join(input.effectiveDirectory, 'cordis.patch.yml'), 'utf8')
    expect(serialized).toContain('!!js')
    expect(loadOverlayPatches('test', join(input.effectiveDirectory, 'cordis.patch.yml'))).toEqual(expected)
    expect(serialized).toContain(pathToFileURL(join(input.canonicalDirectory, 'nested/child.mjs')).href)
    await put(path, '[]\n')
    await composeManagedProfile(input, api)
    expect(loadOverlayPatches('test', join(input.effectiveDirectory, 'cordis.patch.yml'))).toEqual([])
  })

  it('keeps the original home layer above the derived user patch and applies its removal at the next composition', async () => {
    const { input, api, packages } = await fixture()
    const userPath = join(input.canonicalDirectory, 'cordis.patch.yml')
    const rootPath = join(input.dshHome, 'cordis.patch.yml')
    await put(userPath, '- id: bundle-b\n  config:\n    limit: 1\n')
    await put(rootPath, '- id: bundle-b\n  config:\n    limit: 2\n')
    const first = await composeManagedProfile(input, api)
    const bundleLayer = loadOverlayPatches('test', join(packages['bundle-b']!, 'cordis.patch.yml'))
    const effectiveUser = loadOverlayPatches('test', join(input.effectiveDirectory, 'cordis.patch.yml'))
    expect(composeEntries([bundleLayer, effectiveUser, loadOverlayPatches('test', rootPath)]))
      .toEqual([{ id: 'bundle-b', name: 'bundle-b', config: { limit: 2 } }])
    expect(await readFile(rootPath, 'utf8')).toBe('- id: bundle-b\n  config:\n    limit: 2\n')
    await put(rootPath, '[]\n')
    const second = await composeManagedProfile(input, api)
    expect(second.inputHash).not.toBe(first.inputHash)
    expect(composeEntries([bundleLayer, loadOverlayPatches('test', join(input.effectiveDirectory, 'cordis.patch.yml')),
      loadOverlayPatches('test', rootPath)]))
      .toEqual([{ id: 'bundle-b', name: 'bundle-b', config: { limit: 1 } }])
  })

  it.each(['same-directory', 'subdirectory', 'independent'] as const)('checks resolved bare alias physical ownership: %s', async (kind) => {
    const { input, api, packages } = await fixture()
    const alias = join(input.canonicalDirectory, 'node_modules/alias-a')
    const target = kind === 'independent' ? packages['bundle-b']! : kind === 'subdirectory'
      ? join(packages['bundle-a']!, 'submodule') : packages['bundle-a']!
    await mkdir(target, { recursive: true })
    if (kind === 'subdirectory') await json(join(target, 'package.json'), { name: 'alias-a', version: '1.0.0', main: './index.js' })
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await put(join(input.dshHome, 'cordis.patch.yml'), '- insert:\n  - id: alias-ref\n    name: alias-a\n')
    const result = composeManagedProfile(input, api)
    if (kind === 'independent') await expect(result).resolves.toMatchObject({ status: 'ready' })
    else await expect(result).rejects.toMatchObject({ code: 'excluded-bundle-reference' })
  })

  it.each(['root', 'preset'])('returns configuration recovery for a %s reference to an excluded Bundle', async (kind) => {
    const { input, api, resolutions } = await fixture()
    const path = kind === 'root' ? join(input.dshHome, 'cordis.patch.yml') : join(input.dshHome, '.agent-presets/custom/agent.cordis.yml')
    await put(path, kind === 'root' ? '- insert:\n  - id: conflict\n    name: bundle-a\n' : '- id: conflict\n  name: bundle-a\n')
    const before = await readFile(path)
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'excluded-bundle-reference', sourcePath: path, row: 'conflict' })
    expect(await readFile(path)).toEqual(before)
    expect(resolutions).not.toContain('bundle-a')
    expect(existsSync(input.effectiveDirectory)).toBe(false)
  })

  it('does not attribute invalid root YAML to an optional Bundle', async () => {
    const { input, api } = await fixture()
    const path = join(input.dshHome, 'cordis.patch.yml')
    await put(path, 'secret: [invalid')
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'root-yaml-invalid', sourcePath: path, bundleName: undefined })
  })

  it.each([
    ['- insert:\n  - id: relative\n    name: bundle-b\n    config:\n      path: ./cache\n', 'relative-config-unsupported'],
    ["- insert:\n  - id: include\n    name: '@deepseek-ai/cordis-plugin-include'\n    config:\n      url: ./other.yml\n", 'include-unsupported'],
    ['- id: dynamic\n  config:\n    path: !!js ctx.baseUrl\n', 'expression-unsupported'],
  ])('rejects unsupported changed path semantics', async (patch, code) => {
    const { input, api } = await fixture()
    await put(join(input.canonicalDirectory, 'cordis.patch.yml'), patch)
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code })
  })

  it('rejects an unguarded user preset even when its current text does not name the paused package', async () => {
    const { input, api } = await fixture()
    await put(join(input.dshHome, '.agent-presets/custom/agent.cordis.yml'), '- id: safe-now\n  name: bundle-b\n')
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'preset-hot-edit-uncontrolled' })
  })

  it('reports active Bundle parse errors with identity, while fixed core failures remain recovery-only', async () => {
    const { input, api, packages } = await fixture()
    await put(join(packages['bundle-b']!, 'cordis.patch.yml'), '[broken')
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'bundle-yaml-invalid', bundleName: 'bundle-b' })
    await json(join(packages['bundle-b']!, 'package.json'), { name: 'mismatch' })
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'bundle-manifest-invalid', bundleName: 'bundle-b' })
    await put(join(dirname(input.officialAnchor), '../dsh-base/cordis.patch.yml'), '[broken')
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'core-input-invalid', bundleName: undefined })
  })

  it('verifies declared canonical dependencies without reading the excluded dependency package', async () => {
    const { input, api, packages, resolutions } = await fixture()
    const path = join(packages['bundle-b']!, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { dependencies: Record<string, string> }
    manifest.dependencies = { 'bundle-a': '1.0.0' }
    await json(path, manifest)
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'excluded-bundle-dependency', bundleName: 'bundle-b', requiredBundleNames: ['bundle-a'] })
    expect(resolutions).not.toContain('bundle-a')
  })

  it('treats a valid package alias as unsupported configuration, not a corrupt Bundle manifest', async () => {
    const { input, api, packages } = await fixture()
    const path = join(packages['bundle-b']!, 'package.json')
    await json(path, { name: 'actual-package', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'bundle-alias-unsupported', bundleName: undefined })
  })

  it('refuses a foreign profile and symlinked output instead of overwriting it', async () => {
    const { input, api, root } = await fixture()
    await put(join(input.effectiveDirectory, 'package.json'), '{"keep":true}')
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'foreign-effective-directory' })
    expect(await readFile(join(input.effectiveDirectory, 'package.json'), 'utf8')).toBe('{"keep":true}')
    await rm(input.effectiveDirectory, { recursive: true })
    await mkdir(join(root, 'outside'))
    await symlink(join(root, 'outside'), input.effectiveDirectory, 'junction')
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'unsafe-path' })
    expect(await readdir(join(root, 'outside'))).toEqual([])
  })

  it('rejects a package patch escaping through an intermediate directory link', async () => {
    const { input, api, packages, root } = await fixture()
    const directory = packages['bundle-b']!
    await mkdir(join(root, 'external'))
    await put(join(root, 'external/patch.yml'), '[]\n')
    await symlink(join(root, 'external'), join(directory, 'indirect'), 'junction')
    const path = join(directory, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { dsh: { bundle: { patch: string } } }
    manifest.dsh.bundle.patch = './indirect/patch.yml'
    await json(path, manifest)
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'unsafe-path' })
  })

  it('rejects a canonical private Cordis copy instead of claiming a shared module instance', async () => {
    const { input, api } = await fixture()
    await json(join(input.canonicalDirectory, 'node_modules/@deepseek-ai/cordis/package.json'), { name: '@deepseek-ai/cordis', version: 'old' })
    await expect(composeManagedProfile(input, api)).rejects.toMatchObject({ code: 'shared-cordis-conflict' })
  })

  it('detects a newly created preset directory between input capture and publication', async () => {
    const { input, api } = await fixture()
    const directory = join(input.dshHome, '.agent-presets')
    const moving: OfficialProfileCompositionApi = { ...api, yaml: { ...api.yaml, dump: (value, options) => {
      mkdirSync(directory)
      return api.yaml.dump(value, options)
    } } }
    await expect(composeManagedProfile(input, moving)).rejects.toMatchObject({ code: 'input-changed', sourcePath: directory })
  })

  it('detects canonical input movement before publishing and preserves the previous complete generation', async () => {
    const { input, api } = await fixture()
    const first = await composeManagedProfile(input, api)
    const path = join(input.canonicalDirectory, 'cordis.patch.yml')
    const moving: OfficialProfileCompositionApi = { ...api, yaml: { ...api.yaml, dump: (value, options) => {
      writeFileSync(path, '- id: moved\n  disabled: true\n')
      return api.yaml.dump(value, options)
    } } }
    await expect(composeManagedProfile(input, moving)).rejects.toMatchObject({ code: 'input-changed' })
    expect((JSON.parse(await readFile(join(input.effectiveDirectory, 'receipt.json'), 'utf8')) as { inputHash: string }).inputHash).toBe(first.inputHash)
  })
})

const runtime = resolve('.artifacts/s2/official-runtime')
it.skipIf(!existsSync(join(runtime, 'package.json')))('round-trips through the fixed built official app-boot and include exports', async () => {
  const { input } = await fixture()
  const require = createRequire(join(runtime, 'package.json'))
  const boot = await import(/* @vite-ignore */ pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href) as TestBootApi
  const include = await import(/* @vite-ignore */ pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-include')).href) as { entryListSchema: unknown }
  const receipt = await composeManagedProfile({ ...input, officialAnchor: join(runtime, 'node_modules/@deepseek-ai/dsh/package.json') }, {
    sourceSha: OFFICIAL_SHA, loadOverlayPatches: boot.loadOverlayPatches, resolveBundleDir: boot.resolveBundleDir,
    entryListSchema: include.entryListSchema,
    yaml: {
      load: (text, options) => yaml.load(text, options as yaml.LoadOptions),
      dump: (value, options) => yaml.dump(value, options as yaml.DumpOptions),
    },
  })
  expect(receipt.activeBundles).toEqual([BASE, WEB, 'bundle-b'])
  const loaded = boot.loadProfileDirectory('fixed-official', input.effectiveDirectory, join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'))
  expect(loaded.layers.map((layer: { packageName: string }) => layer.packageName)).toEqual([BASE, WEB, 'bundle-b'])
  expect(loaded.patchReload).toBe('startup')
})
