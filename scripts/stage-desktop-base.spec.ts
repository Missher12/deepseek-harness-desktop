import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recordOfficialRuntime } from './desktop-base-runtime.ts'
import { stageDesktopBase } from './stage-desktop-base.ts'

const roots: string[] = []
const nativeRows = [
  { id: 'desktop-shell', name: '@deepseek-ai/dsh-client-ui-desktop-shell' },
  { id: 'desktop-system-update', name: '@deepseek-ai/dsh-client-ui-settings-system-update' },
]
const sidebarRows = ['ui-sidebar-right', 'ui-sidebar-documentpreview', 'ui-sidebar-files']
  .map(id => ({ id, disabled: true }))
const validPatch = [{ insert: nativeRows }]
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(
  utilityManifests: Record<string, unknown> = {},
  beforeRecord?: (runtime: string) => Promise<void>,
): Promise<{
  root: string
  runtime: string
  output: string
  helper: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-base-stage-')); roots.push(root)
  const files: Record<string, string> = {
    'apps/desktop/package.json': JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.5.8', main: 'lib/main.js' }),
    'apps/desktop/lib/main.js': 'export {}', 'apps/desktop/lib/preload.cjs': '',
    'apps/desktop/lib/update-helper.js': '', 'apps/desktop/base.cordis.patch.yml': JSON.stringify(validPatch),
    'apps/desktop/renderer/loading.html': '<p>loading</p>', 'apps/desktop/renderer/failure.html': '<p>error</p>',
    'apps/desktop/assets/icon-source.png': 'fixture',
    'apps/desktop/assets/icon.icns': 'fixture', 'apps/desktop/assets/icon-windows.ico': 'fixture',
    'apps/desktop/assets/tray-windows-16.png': 'fixture', 'apps/desktop/assets/tray-windows-20.png': 'fixture',
    'apps/desktop/assets/tray-windows-24.png': 'fixture', 'apps/desktop/assets/tray-windows-32.png': 'fixture',
    'apps/desktop/electron-builder.yml': 'asar: true\n', 'apps/desktop/electron-builder.linux.yml': 'extends: ./electron-builder.yml\n',
    'apps/desktop/build/installer.nsh': 'fixture', 'apps/desktop/build/linux/after-pack.cjs': 'fixture',
    'apps/desktop/build/linux/launcher.sh': 'fixture', 'apps/desktop/build/linux/apparmor-profile': 'fixture',
    'THIRD_PARTY_NOTICES.md': 'fixture notices',
    'official/node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.2' }),
    'official/node_modules/@deepseek-ai/dsh/lib/bin.js': 'export {}',
    'official/node_modules/@deepseek-ai/dsh-atomic-write/package.json': JSON.stringify({ name: '@deepseek-ai/dsh-atomic-write', version: '0.1.5-rc.2' }),
    'official/node_modules/@deepseek-ai/dsh-atomic-write/lib/index.js': 'export {}',
    'official/node_modules/@deepseek-ai/dsh-home-paths/package.json': JSON.stringify({ name: '@deepseek-ai/dsh-home-paths', version: '0.1.5-rc.2' }),
    'official/node_modules/@deepseek-ai/dsh-home-paths/lib/index.js': 'export {}',
    'official/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/worker.cjs': '',
  }
  for (const [name, manifest] of Object.entries(utilityManifests)) {
    files[`official/node_modules/@deepseek-ai/${name}/package.json`] = JSON.stringify(manifest)
  }
  for (const [name, value] of Object.entries(files)) {
    const path = join(root, name); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, value)
  }
  for (const name of ['ui-desktop-shell', 'ui-settings-system-update']) {
    const directory = join(root, 'packages/client', name); await mkdir(join(directory, 'lib'), { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@deepseek-ai/dsh-client-${name}`, version: '0.1.5-rc.2' }))
    await writeFile(join(directory, 'lib/index.js'), 'export {}'); await writeFile(join(directory, 'lib/client.js'), 'export {}')
  }
  const runtime = join(root, 'official')
  await beforeRecord?.(runtime)
  await recordOfficialRuntime(runtime, { sourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', harnessVersion: '0.1.5-rc.2' })
  const helper = join(root, 'helper'); await mkdir(helper)
  const executable = process.platform === 'win32' ? 'node.exe' : 'node'
  const helperFiles = []
  for (const path of [executable, 'LICENSE']) {
    const bytes = Buffer.from('fixture'); await writeFile(join(helper, path), bytes)
    helperFiles.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  const archivePlatform = process.platform === 'win32' ? 'win' : process.platform
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
  await writeFile(join(helper, 'source.json'), JSON.stringify({
    schema: 1, platform: process.platform, arch: 'x64', nodeVersion: '24.17.0',
    releaseUrl: 'https://nodejs.org/download/release/v24.17.0',
    archiveName: `node-v24.17.0-${archivePlatform}-x64.${extension}`,
    archiveSha256: 'a'.repeat(64), shasumsSha256: 'b'.repeat(64), inputKind: 'files',
    execution: 'native-verified', files: helperFiles,
  }))
  return { root, runtime, output: join(root, 'candidate/dsh-desktop-stage'), helper }
}

describe('base Desktop staging', () => {
  it('rejects an enhancement added to the base patch', async () => {
    const f = await fixture()
    const path = join(f.root, 'apps/desktop/base.cordis.patch.yml')
    const entries = JSON.parse(await readFile(path, 'utf8')) as unknown[]
    entries.push({ id: 'reasoning-effort', name: '@deepseek-ai/dsh-reasoning-effort' })
    await writeFile(path, JSON.stringify(entries))
    await expect(stageDesktopBase(f.root, f.runtime, f.output, f.helper)).rejects.toThrow(/base composition/iu)
    await expect(realpath(dirname(f.output))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['non-list', {}],
    ['null', null],
    ['missing insert', []],
    ['duplicate insert', [...validPatch, { insert: nativeRows }]],
    ['duplicate adapter', [{ insert: [nativeRows[0], nativeRows[0]] }]],
    ['missing adapter', [{ insert: [nativeRows[0]] }]],
    ['unknown adapter', [{ insert: [nativeRows[0], { id: 'extra', name: '@deepseek-ai/dsh-reasoning-effort' }] }]],
    ['changed adapter identity', [{ insert: [nativeRows[0], { ...nativeRows[1], name: '@deepseek-ai/dsh-reasoning-effort' }] }]],
    ['adapter config', [{ insert: [{ ...nativeRows[0], config: { enhanced: true } }, nativeRows[1]] }]],
    ['adapter disabled', [{ insert: [{ ...nativeRows[0], disabled: false }, nativeRows[1]] }]],
    ['insert metadata', [{ insert: nativeRows, id: 'other' }]],
    ['disabled official sidebars', [...validPatch, ...sidebarRows]],
    ['disabled required sidebar service', [...validPatch, { id: 'ui-sidebar-right', disabled: true }]],
    ['official service config', [...validPatch, { id: 'ui-chat', config: {} }]],
    ['unknown row', [{ unknown: nativeRows }]],
  ])('rejects %s before creating the output parent', async (_name, patch) => {
    const f = await fixture()
    await writeFile(join(f.root, 'apps/desktop/base.cordis.patch.yml'), JSON.stringify(patch))
    await expect(stageDesktopBase(f.root, f.runtime, f.output, f.helper)).rejects.toThrow(/base composition/iu)
    await expect(realpath(dirname(f.output))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    '- insert: [',
    '- insert: []\n  insert: []\n',
    '!!js/function function () {}',
  ])('rejects malformed or unsupported YAML %s without changing an existing stage', async (patch) => {
    const f = await fixture()
    await mkdir(f.output, { recursive: true })
    await writeFile(join(f.output, 'keep'), 'old')
    await writeFile(join(f.root, 'apps/desktop/base.cordis.patch.yml'), patch)
    await expect(stageDesktopBase(f.root, f.runtime, f.output, f.helper)).rejects.toThrow(/base composition/iu)
    expect(await readFile(join(f.output, 'keep'), 'utf8')).toBe('old')
  })

  it('accepts YAML and preserves the validated patch bytes with reordered adapters', async () => {
    const f = await fixture()
    const patch = `# Preserve every service in the official Web graph.
- insert:
    - id: desktop-system-update
      name: '@deepseek-ai/dsh-client-ui-settings-system-update'
    - id: desktop-shell
      name: '@deepseek-ai/dsh-client-ui-desktop-shell'
`
    await writeFile(join(f.root, 'apps/desktop/base.cordis.patch.yml'), patch)
    await stageDesktopBase(f.root, f.runtime, f.output, f.helper)
    expect(await readFile(join(f.output, 'base.cordis.patch.yml'), 'utf8')).toBe(patch)
  })

  it.each(['dsh-atomic-write', 'dsh-home-paths'])('rejects mismatched %s identity before creating a stage', async (name) => {
    const f = await fixture({ [name]: { name: '@deepseek-ai/another-package', version: '0.1.5-rc.2' } })
    await expect(stageDesktopBase(f.root, f.runtime, f.output, f.helper)).rejects.toThrow(/shell utility identity/iu)
    await expect(realpath(dirname(f.output))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['0.1.4', undefined])('rejects shell utility version %s before creating a stage', async (version) => {
    const f = await fixture({ 'dsh-home-paths': { name: '@deepseek-ai/dsh-home-paths', version } })
    await expect(stageDesktopBase(f.root, f.runtime, f.output, f.helper)).rejects.toThrow(/shell utility identity/iu)
    await expect(realpath(dirname(f.output))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stages the verified official runtime and only the two native Client adapters', async () => {
    const f = await fixture(); const result = await stageDesktopBase(f.root, f.runtime, f.output, f.helper)
    expect(result.stageDir).toBe(await realpath(f.output))
    const staged = JSON.parse(await readFile(join(f.output, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(staged.dependencies).toEqual({ '@deepseek-ai/dsh-atomic-write': '0.1.5-rc.2', '@deepseek-ai/dsh-home-paths': '0.1.5-rc.2' })
    for (const [name, version] of Object.entries(staged.dependencies)) {
      const path = join('node_modules', name, 'package.json')
      const sourceBytes = await readFile(join(f.runtime, path))
      expect(await readFile(join(f.output, path))).toEqual(sourceBytes)
      expect(JSON.parse(sourceBytes.toString('utf8'))).toMatchObject({ name, version })
    }
    expect(JSON.parse(await readFile(join(f.output, 'desktop-composition.json'), 'utf8'))).toMatchObject({ kind: 'base' })
    expect(await readFile(join(f.output, 'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), 'utf8')).toBe('export {}')
    expect(await readFile(join(f.output, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toBe('fixture notices')
    expect(await readFile(join(f.output, 'build/installer.nsh'), 'utf8')).toBe('fixture')
    expect(JSON.parse(await readFile(join(f.output, 'update-metadata.json'), 'utf8'))).toMatchObject({
      desktopVersion: '0.5.8', harnessVersion: '0.1.5-rc.2', platform: process.platform, arch: process.arch,
    })
  })
  it.skipIf(process.platform === 'win32').each([false, true])(
    'makes packaged runtime descriptors readable without changing input modes (installation receipt: %s)', async (installationReceipt) => {
      const f = await fixture({}, async (runtime) => {
        if (installationReceipt) {
          await writeFile(join(runtime, 'desktop-official-installation.json'), JSON.stringify({
            schema: 1, sourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203',
            sourceTree: 'bd7dd6d90010a35d3d6ff9f12c1f6207d5b6fe38', harnessVersion: '0.1.5-rc.2',
            inputManifestSha256: 'a'.repeat(64), platform: process.platform, arch: 'x64', nodeVersion: process.version,
            pnpmVersion: '11.7.0', pnpmCliSha256: 'b'.repeat(64),
          }), { mode: 0o600 })
        }
        await writeFile(join(runtime, 'private-fixture.txt'), 'non-secret private fixture', { mode: 0o600 })
        await chmod(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 0o755)
      })
      await chmod(join(f.helper, 'node'), 0o755)
      const metadata = ['provenance.json', ...installationReceipt ? ['desktop-official-installation.json'] : []]
      const inputs = await Promise.all(metadata.map(async name => ({ name, bytes: await readFile(join(f.runtime, name)),
        mode: (await lstat(join(f.runtime, name))).mode & 0o777 })))
      // These owner-only input modes become unreadable to ordinary users after root-owned system installation.
      for (const input of inputs) expect(input.mode).toBe(0o600)
      await stageDesktopBase(f.root, f.runtime, f.output, f.helper)
      for (const input of inputs) {
        const copied = join(f.output, 'official-runtime', input.name)
        expect((await lstat(copied)).mode & 0o777).toBe(0o644)
        expect(await readFile(copied)).toEqual(input.bytes)
        expect((await lstat(join(f.runtime, input.name))).mode & 0o777).toBe(input.mode)
        expect(await readFile(join(f.runtime, input.name))).toEqual(input.bytes)
      }
      for (const root of [f.runtime, join(f.output, 'official-runtime')]) {
        expect((await lstat(join(root, 'private-fixture.txt'))).mode & 0o777).toBe(0o600)
        expect((await lstat(join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))).mode & 0o777).toBe(0o755)
      }
      expect((await lstat(join(f.output, 'helper-runtime/node'))).mode & 0o777)
        .toBe((await lstat(join(f.helper, 'node'))).mode & 0o777)
    },
  )
  it('rejects a changed runtime before touching an existing output', async () => {
    const f = await fixture(); await mkdir(f.output, { recursive: true })
    await writeFile(join(f.output, 'keep'), 'old')
    await writeFile(join(f.runtime, 'extra.js'), 'extra')
    await expect(stageDesktopBase(f.root, f.runtime, f.output, f.helper)).rejects.toThrow(/inventory/iu)
    expect(await readFile(join(f.output, 'keep'), 'utf8')).toBe('old')
  })
  it('refuses to replace an existing output', async () => {
    const f = await fixture(); await mkdir(f.output, { recursive: true })
    await writeFile(join(f.output, 'keep'), 'old')
    await expect(stageDesktopBase(f.root, f.runtime, f.output, f.helper)).rejects.toThrow(/exist/iu)
    expect(await readFile(join(f.output, 'keep'), 'utf8')).toBe('old')
  })
})
