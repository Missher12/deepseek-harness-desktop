import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDesktopRuntime } from '../src/harness/composition.ts'

const officialSha = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
const harnessVersion = '0.1.5-rc.2'
const baseDescriptor = { schema: 1, kind: 'base', officialSha, harnessVersion }
const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-composition-')))
  temporaryDirectories.push(directory)
  return directory
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeJson(path: string, value: unknown): void {
  writeFile(path, JSON.stringify(value))
}

function installation(): string {
  const anchor = join(temporaryDirectory(), 'package.json')
  writeJson(anchor, { name: '@deepseek-ai/dsh-desktop' })
  return anchor
}

function baseInstallation(): string {
  const anchor = installation()
  const directory = dirname(anchor)
  writeJson(join(directory, 'desktop-composition.json'), baseDescriptor)
  writeJson(join(directory, 'official-runtime/provenance.json'), {
    sourceSha: officialSha,
    harnessVersion,
    artifacts: [],
  })
  writeJson(join(directory, 'official-runtime/node_modules/@deepseek-ai/dsh/package.json'), {
    name: '@deepseek-ai/dsh', version: harnessVersion,
  })
  writeFile(join(directory, 'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), '')
  writeFile(join(directory, 'base.cordis.patch.yml'), 'plugins: {}\n')
  return anchor
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('resolveDesktopRuntime', () => {
  it('uses physical unpacked base resources for packaged ASAR launches', () => {
    const source = dirname(baseInstallation())
    const resources = temporaryDirectory()
    const unpacked = join(resources, 'app.asar.unpacked')
    cpSync(source, unpacked, { recursive: true })
    const runtime = resolveDesktopRuntime(join(resources, 'app.asar/package.json'))
    expect(runtime.cli).toBe(join(unpacked, 'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'))
    expect(runtime.patch).toBe(join(unpacked, 'base.cordis.patch.yml'))
  })
  it('selects full only when the descriptor is absent and reads the resolved CLI version', () => {
    const anchor = installation()
    const directory = dirname(anchor)
    writeJson(join(directory, 'node_modules/@deepseek-ai/dsh/package.json'), {
      name: '@deepseek-ai/dsh', version: '0.1.4',
      exports: { './package.json': './package.json' },
    })
    expect(resolveDesktopRuntime(anchor)).toMatchObject({
      kind: 'full', profile: 'web', harnessVersion: '0.1.4',
      cli: join(directory, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      patch: join(directory, 'desktop.cordis.patch.yml'),
    })
  })

  it('selects the pinned base runtime even when an unrelated full CLI is installed', () => {
    const anchor = baseInstallation()
    const directory = dirname(anchor)
    writeJson(join(directory, 'node_modules/@deepseek-ai/dsh/package.json'), { version: '9.9.9' })
    expect(resolveDesktopRuntime(anchor)).toMatchObject({
      kind: 'base', profile: 'desktop-base', harnessVersion: '0.1.5-rc.2',
      cli: join(directory, 'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'),
      patch: join(directory, 'base.cordis.patch.yml'),
    })
  })

  it.each([
    null,
    [],
    {},
    { ...baseDescriptor, schema: 2 },
    { ...baseDescriptor, schema: '1' },
    { ...baseDescriptor, kind: 'full' },
    { ...baseDescriptor, officialSha: 'another-sha' },
    { ...baseDescriptor, harnessVersion: '0.1.5' },
    { ...baseDescriptor, runtimeDirectory: '../external' },
  ])('rejects unsupported descriptor %j without falling back', (descriptor) => {
    const anchor = baseInstallation()
    writeJson(join(dirname(anchor), 'desktop-composition.json'), descriptor)
    expect(() => resolveDesktopRuntime(anchor)).toThrow(/composition/i)
  })

  it('rejects malformed descriptor JSON', () => {
    const anchor = baseInstallation()
    writeFile(join(dirname(anchor), 'desktop-composition.json'), '{')
    expect(() => resolveDesktopRuntime(anchor)).toThrow(/composition/i)
  })

  it.each([
    { sourceSha: 'another-sha', harnessVersion },
    { sourceSha: officialSha, harnessVersion: '0.1.4' },
    { sourceSha: officialSha },
    null,
  ])('rejects incompatible provenance %j', (provenance) => {
    const anchor = baseInstallation()
    writeJson(join(dirname(anchor), 'official-runtime/provenance.json'), provenance)
    expect(() => resolveDesktopRuntime(anchor)).toThrow(/provenance/i)
  })

  it('rejects a CLI manifest version inconsistent with the pinned provenance', () => {
    const anchor = baseInstallation()
    writeJson(join(dirname(anchor), 'official-runtime/node_modules/@deepseek-ai/dsh/package.json'), {
      version: '0.1.4',
    })
    expect(() => resolveDesktopRuntime(anchor)).toThrow(/version/i)
  })

  it.each([
    'official-runtime',
    'official-runtime/provenance.json',
    'official-runtime/node_modules/@deepseek-ai/dsh/package.json',
    'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    'base.cordis.patch.yml',
  ])('rejects a missing base component: %s', (component) => {
    const anchor = baseInstallation()
    rmSync(join(dirname(anchor), component), { recursive: true })
    expect(() => resolveDesktopRuntime(anchor)).toThrow()
  })

  it.each([
    'desktop-composition.json',
    'official-runtime/provenance.json',
    'official-runtime/node_modules/@deepseek-ai/dsh/package.json',
    'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    'base.cordis.patch.yml',
  ])('rejects an external symlink at %s', (component) => {
    const anchor = baseInstallation()
    const target = join(dirname(anchor), component)
    const outside = join(temporaryDirectory(), 'external-file')
    writeFile(outside, '{}')
    rmSync(target)
    symlinkSync(outside, target)
    expect(() => resolveDesktopRuntime(anchor)).toThrow(/outside.*installation/i)
  })

  it('rejects a runtime directory symlink outside the installation', () => {
    const anchor = baseInstallation()
    const runtime = join(dirname(anchor), 'official-runtime')
    rmSync(runtime, { recursive: true })
    symlinkSync(temporaryDirectory(), runtime, 'dir')
    expect(() => resolveDesktopRuntime(anchor)).toThrow(/outside.*installation/i)
  })

  it('rejects a dangling descriptor symlink instead of selecting full', () => {
    const anchor = installation()
    symlinkSync(join(dirname(anchor), 'missing.json'), join(dirname(anchor), 'desktop-composition.json'))
    expect(() => resolveDesktopRuntime(anchor)).toThrow(/composition/i)
  })

  it.each([
    'desktop-composition.json',
    'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    'base.cordis.patch.yml',
  ])('rejects a directory in place of a required file: %s', (component) => {
    const anchor = baseInstallation()
    const target = join(dirname(anchor), component)
    rmSync(target)
    mkdirSync(target)
    expect(() => resolveDesktopRuntime(anchor)).toThrow(/file/i)
  })

  it('accepts an internal CLI symlink used by a staged package layout', () => {
    const anchor = baseInstallation()
    const directory = dirname(anchor)
    const cli = join(directory, 'official-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js')
    const target = join(directory, 'official-runtime/built-cli.js')
    writeFile(target, '')
    rmSync(cli)
    symlinkSync(target, cli)
    expect(resolveDesktopRuntime(anchor)).toMatchObject({ kind: 'base', cli })
  })
})
