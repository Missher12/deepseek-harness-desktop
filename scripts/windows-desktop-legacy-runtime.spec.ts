import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { JSON_SCHEMA, load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { collectWindowsLegacyRuntime, verifyWindowsLegacySetup } from './windows-desktop-legacy-runtime.ts'

const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const requireBuilder = createRequire(requireDesktop.resolve('electron-builder'))
const requireAppBuilder = createRequire(requireBuilder.resolve('app-builder-lib'))
const asar = requireAppBuilder('@electron/asar') as { createPackage(source: string, destination: string): Promise<unknown> }

async function withRuntime(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'win-legacy-layout-'))
  try {
    const executable = Buffer.alloc(256)
    executable.write('MZ'); executable.writeUInt32LE(128, 60); executable.write('PE\0\0', 128); executable.writeUInt16LE(0x8664, 132)
    await writeFile(join(root, 'DeepSeek Harness.exe'), executable)
    const source = join(root, 'asar-fixture')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.5.5' }))
    await mkdir(join(root, 'resources'))
    await asar.createPackage(source, join(root, 'resources/app.asar'))
    const packages = ['dsh', 'cordis', 'dsh-session', 'dsh-session-persistence-jsonl', 'dsh-storage', 'dsh-storage-json',
      'dsh-storage-domain', 'dsh-workspace', 'dsh-app-boot', 'dsh-llm']
    for (const name of packages) {
      const directory = join(root, 'resources/app.asar.unpacked/node_modules/@deepseek-ai', name)
      await mkdir(join(directory, 'lib'), { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version: '0.1.3-alpha.1',
        main: 'lib/index.js', exports: { '.': './lib/index.js', './package.json': './package.json' } }))
      await writeFile(join(directory, 'lib/index.js'), 'throw new Error("Offline fixture must never execute");\n')
    }
    await writeFile(join(root, 'resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh/lib/bin.js'), '// Inert CLI fixture, not executed.\n')
    await action(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

describe('Windows legacy release runtime preparation', () => {
  it('rejects incorrect Setup byte counts and hashes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'win-legacy-asset-'))
    const path = join(directory, 'incorrect.exe')
    try {
      await writeFile(path, 'not the released installer')
      await expect(verifyWindowsLegacySetup(path)).rejects.toThrow(/bytes/u)
      await truncate(path, 146631832)
      await expect(verifyWindowsLegacySetup(path)).rejects.toThrow(/SHA/u)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('collects actual physical entry paths and bytes without executing fixture code', async () => {
    await withRuntime(async (root) => {
      const input = await collectWindowsLegacyRuntime(root)
      expect(input.files).toHaveLength(15)
      expect(input.executableKind).toBe('electron')
      expect(input.cliPath).toBe(join(input.modulesRoot, '@deepseek-ai/dsh/lib/bin.js'))
      for (const file of input.files) {
        expect(file.sha256).toBe(createHash('sha256').update(await readFile(file.path)).digest('hex'))
      }
    })
  })
  it.each(['missing-cli', 'missing-import', 'wrong-core', 'wrong-desktop', 'wrong-arch', 'redirected-executable'])
  ('rejects extracted input mismatch: %s', async (failure) => {
    await withRuntime(async (root) => {
      const cli = join(root, 'resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh/lib/bin.js')
      if (failure === 'missing-cli') await rm(cli)
      if (failure === 'missing-import') await rm(join(dirname(dirname(cli)), '../dsh-llm/lib/index.js'))
      if (failure === 'wrong-core') await writeFile(join(dirname(dirname(cli)), 'package.json'), '{"version":"0.1.5-rc.2"}')
      if (failure === 'wrong-desktop') {
        await writeFile(join(root, 'asar-fixture/package.json'), '{"name":"@deepseek-ai/dsh-desktop","version":"0.5.6"}')
        await asar.createPackage(join(root, 'asar-fixture'), join(root, 'resources/app.asar'))
      }
      if (failure === 'wrong-arch') {
        const executable = await readFile(join(root, 'DeepSeek Harness.exe'))
        executable.writeUInt16LE(0x14c, 132)
        await writeFile(join(root, 'DeepSeek Harness.exe'), executable)
      }
      if (failure === 'redirected-executable') {
        await writeFile(join(root, 'redirected.exe'), await readFile(join(root, 'DeepSeek Harness.exe')))
        await rm(join(root, 'DeepSeek Harness.exe'))
        await symlink(join(root, 'redirected.exe'), join(root, 'DeepSeek Harness.exe'))
      }
      await expect(collectWindowsLegacyRuntime(root)).rejects.toThrow()
    })
  })
  it('generates the legacy descriptor before passing its existing path to Setup smoke', async () => {
    const workflow = load(await readFile(new URL('../.github/workflows/windows-desktop.yml', import.meta.url), 'utf8'), {
      schema: JSON_SCHEMA,
    }) as { jobs: { 'build-install-smoke': { steps: { name?: string; run?: string }[] } } }
    const steps = workflow.jobs['build-install-smoke'].steps
    const prepareIndex = steps.findIndex(step => step.name === 'Prepare the fixed Windows 0.5.5 legacy runtime')
    const consumeIndex = steps.findIndex(step => step.name === 'Install and exercise the packaged application lifecycle')
    expect(prepareIndex).toBeGreaterThan(-1)
    expect(prepareIndex).toBeLessThan(consumeIndex)
    expect(prepareIndex).toBeLessThan(steps.findIndex(step => step.name === 'Build the assisted Windows Setup'))
    const prepare = steps[prepareIndex]?.run ?? ''
    expect(prepare).toContain('scripts/windows-desktop-legacy-runtime.ts')
    expect(prepare).toContain('DSH_WINDOWS_LEGACY_RUNTIME_INPUT=')
    expect(prepare).toContain('GITHUB_ENV')
    expect(prepare).toContain('Test-Path -LiteralPath $descriptor -PathType Leaf')
    expect(prepare).toContain('https://github.com/Missher12/deepseek-harness-desktop/releases/download/desktop-v0.5.5/')
    expect(steps[consumeIndex]?.run).toContain('-LegacyRuntimeInputPath "$env:DSH_WINDOWS_LEGACY_RUNTIME_INPUT"')
  })
})
