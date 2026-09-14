import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordOfficialRuntime } from './desktop-base-runtime.ts'
import {
  createOfficialRuntimePolicy, inspectOfficialTarball, prepareOfficialRuntime, resolveOfficialPnpmCli,
  verifyOfficialInputs, verifyOfficialTarball,
  type OfficialPackageInput, type OfficialPackageManifest, type OfficialRuntimeCommand, type VerifiedOfficialInputs,
} from './desktop-official-inputs.ts'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const execFile = actual.execFile.bind(actual)
  Object.defineProperty(execFile, promisify.custom, { value: vi.fn(promisify(actual.execFile)) })
  return { ...actual, execFile }
})

const roots: string[] = []
const source = {
  sourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203',
  sourceTree: 'bd7dd6d90010a35d3d6ff9f12c1f6207d5b6fe38',
  harnessVersion: '0.1.5-rc.2',
}
const subprocessName = '@deepseek-ai/dsh-subprocess-local'
const postinstall = 'node scripts/ensure-spawn-helper.mjs'
const fixturePolicy = {
  packages: ['apps/*'],
  allowBuilds: { esbuild: true, 'node-pty': true, koffi: true, protobufjs: false,
    [`${subprocessName}@file:packages/subprocess/subprocess-local`]: true },
  patchedDependencies: {
    '@yao-pkg/pkg@6.21.0': 'patches/@yao-pkg__pkg@6.21.0.patch',
    'node-pty@1.2.0-beta.15': 'patches/node-pty@1.2.0-beta.15.patch',
  },
  minimumReleaseAgeExclude: ['reviewed-package@1.0.0'],
}

afterEach(async () => {
  vi.mocked(promisify(execFile)).mockReset()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-official-inputs-'))
  roots.push(root)
  return root
}

function hash(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function file(path: string, bytes: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

async function tarball(withLink = false): Promise<{ path: string; input: OfficialPackageInput }> {
  const root = await directory()
  await file(join(root, 'package/package.json'), JSON.stringify({ name: subprocessName, version: '0.1.5-rc.2', scripts: { postinstall } }))
  await file(join(root, 'package/scripts/ensure-spawn-helper.mjs'), 'export {}\n')
  if (withLink) await symlink('../../outside', join(root, 'package/escape'))
  const path = join(root, 'input.tgz')
  await promisify(execFile)('tar', ['-czf', path, '-C', root, 'package'])
  const bytes = await readFile(path)
  return { path, input: { name: subprocessName, version: '0.1.5-rc.2', path: 'input.tgz', bytes: bytes.length, sha256: hash(bytes) } }
}

function policyPackages(): { input: OfficialPackageInput; manifest: OfficialPackageManifest }[] {
  return [
    { input: { name: '@deepseek-ai/dsh', version: '0.1.5-rc.2', path: '/inputs/dsh.tgz', bytes: 1, sha256: 'a'.repeat(64) },
      manifest: { name: '@deepseek-ai/dsh', version: '0.1.5-rc.2', dependencies: { [subprocessName]: '0.1.5-rc.2' } } },
    { input: { name: subprocessName, version: '0.1.5-rc.2', path: '/inputs/subprocess.tgz', bytes: 1, sha256: 'b'.repeat(64) },
      manifest: { name: subprocessName, version: '0.1.5-rc.2', dependencies: { 'node-pty': '1.2.0-beta.15' }, scripts: { postinstall } } },
  ]
}

const rootManifest = { devDependencies: { '@yao-pkg/pkg': '6.21.0' } }
const lockfile = { snapshots: { 'node-pty@1.2.0-beta.15': {} } }

// Windows bsdtar 3.8.4 probe 34778369910: only listing stdout is replayed; extraction uses the real fixture archive.
const windowsTarNames = 'package/package.json\r\npackage/after.txt\r\n'
const windowsTarVerbose = '-rw-r--r--  0 0      0          71 Jan 01  1970 package/package.json\r\n-rw-r--r--  0 0      0          26 Jan 01  1970 package/after.txt\r\n'
const windowsEscapedTarNames = 'package/package.json\r\npackage/carriage\\rreturn.txt\r\npackage/after.txt\r\n'

async function listingArchive(): Promise<string> {
  const root = await directory()
  await file(join(root, 'package/package.json'), JSON.stringify({ name: subprocessName, version: '0.1.5-rc.2' }))
  await file(join(root, 'package/after.txt'), 'fixture member after manifest')
  const path = join(root, 'listing.tgz')
  await promisify(execFile)('tar', ['-czf', path, '-C', root, 'package/package.json', 'package/after.txt'])
  return path
}

describe('official package inputs', () => {
  it.each(['LF', 'CRLF'])('reads a non-final manifest from %s tar listings', async (ending) => {
    const path = await listingArchive()
    const lineEndings = (text: string) => ending === 'LF' ? text.replaceAll('\r\n', '\n') : text
    const command = vi.mocked(promisify(execFile))
    command.mockResolvedValueOnce({ stdout: lineEndings(windowsTarNames), stderr: '' })
      .mockResolvedValueOnce({ stdout: lineEndings(windowsTarVerbose), stderr: '' })
    await expect(inspectOfficialTarball(path)).resolves.toMatchObject({ name: subprocessName, version: '0.1.5-rc.2' })
    expect(command).toHaveBeenCalledWith('tar', ['-tzf', path], expect.any(Object))
    expect(command).toHaveBeenCalledWith('tar', ['-tvzf', path], expect.any(Object))
  })
  it('rejects the escaped control-character member from the Windows listing', async () => {
    const path = await listingArchive()
    vi.mocked(promisify(execFile)).mockResolvedValueOnce({ stdout: windowsEscapedTarNames, stderr: '' })
    await expect(inspectOfficialTarball(path)).rejects.toThrow('Unsafe or duplicate archive entry: package/carriage\\rreturn.txt')
  })
  it.each(['LF', 'CRLF'])('preserves last-member whitespace when parsing %s line endings', async (ending) => {
    const path = await listingArchive()
    const newline = ending === 'LF' ? '\n' : '\r\n'
    const command = vi.mocked(promisify(execFile))
    command.mockResolvedValueOnce({ stdout: `package/after.txt${newline}package/package.json ${newline}`, stderr: '' })
      .mockResolvedValueOnce({ stdout: windowsTarVerbose, stderr: '' })
    await expect(inspectOfficialTarball(path)).rejects.toThrow('Official archive has no package identity manifest.')
  })
  it('describes an actual tarball for a separately owned build input descriptor', async () => {
    const fixture = await tarball()
    await expect(inspectOfficialTarball(fixture.path)).resolves.toEqual({ name: fixture.input.name,
      version: fixture.input.version, bytes: fixture.input.bytes, sha256: fixture.input.sha256 })
  })
  it('reads a real tarball manifest only after checking its content digest', async () => {
    const fixture = await tarball()
    await expect(verifyOfficialTarball(fixture.input, fixture.path)).resolves.toMatchObject({ name: subprocessName, version: '0.1.5-rc.2' })
  })

  it.each(['digest', 'bytes', 'name', 'version'] as const)('rejects a tarball with mismatched %s', async (field) => {
    const fixture = await tarball()
    const input = { ...fixture.input }
    if (field === 'digest') input.sha256 = '0'.repeat(64)
    if (field === 'bytes') input.bytes++
    if (field === 'name') input.name = '@deepseek-ai/fork'
    if (field === 'version') input.version = '0.1.5'
    await expect(verifyOfficialTarball(input, fixture.path)).rejects.toThrow(/hash|bytes|identity/iu)
  })

  it('rejects archive links before an installer could follow them', async () => {
    const fixture = await tarball(true)
    await expect(verifyOfficialTarball(fixture.input, fixture.path)).rejects.toThrow(/archive.*link|archive.*entry/iu)
  })

  it('retains the official deny entries and node-pty patch while granting only the exact subprocess tarball', () => {
    const policy = createOfficialRuntimePolicy(fixturePolicy, rootManifest, lockfile, policyPackages())
    expect(policy).toMatchObject({ packages: [], strictDepBuilds: true, nodeLinker: 'hoisted', autoInstallPeers: false,
      patchedDependencies: { 'node-pty@1.2.0-beta.15': 'patches/node-pty@1.2.0-beta.15.patch' },
      allowBuilds: { protobufjs: false, [`${subprocessName}@file:/inputs/subprocess.tgz`]: true },
      overrides: { '@deepseek-ai/dsh': 'file:/inputs/dsh.tgz', [subprocessName]: 'file:/inputs/subprocess.tgz' } })
    expect((policy.allowBuilds as Record<string, unknown>)[subprocessName]).toBeUndefined()
    expect((policy.patchedDependencies as Record<string, unknown>)['@yao-pkg/pkg@6.21.0']).toBeUndefined()
    expect(fixturePolicy.patchedDependencies['@yao-pkg/pkg@6.21.0']).toBeDefined()
  })

  it('refuses to drop the pkg patch if an external production dependency reaches it', () => {
    const snapshots = { 'node-pty@1.2.0-beta.15': { dependencies: { '@yao-pkg/pkg': '6.21.0' } } }
    expect(() => createOfficialRuntimePolicy(fixturePolicy, rootManifest, { snapshots }, policyPackages())).toThrow(/production/iu)
  })

  it('resolves native platform leaves recorded as official workspace importers', () => {
    const packages = policyPackages()
    packages[1]!.manifest.dependencies = { 'node-pty': '1.2.0-beta.15', '@deepseek-ai/native-platform': '0.1.2' }
    const importers = {
      'native/system/packages/entry': { optionalDependencies: { '@deepseek-ai/native-platform': { version: 'link:../darwin-arm64' } } },
      'native/system/packages/darwin-arm64': {},
    }
    const policy = createOfficialRuntimePolicy(fixturePolicy, rootManifest, { ...lockfile, importers }, packages)
    expect(policy).toMatchObject({ strictDepBuilds: true })
  })

  it('refuses an unreviewed subprocess postinstall', () => {
    const packages = policyPackages()
    packages[1]!.manifest.scripts = { postinstall: 'node arbitrary.js' }
    expect(() => createOfficialRuntimePolicy(fixturePolicy, rootManifest, lockfile, packages)).toThrow(/postinstall/iu)
  })

  it('refuses a descriptor whose bytes do not match the trusted digest', async () => {
    const root = await directory()
    const descriptorPath = join(root, 'inputs.json')
    await writeFile(descriptorPath, '{}')
    await expect(verifyOfficialInputs({ sourceDirectory: root, packagesDirectory: root, descriptorPath, descriptorSha256: '0'.repeat(64) })).rejects.toThrow(/descriptor.*hash/iu)
  })

  it.each([
    { ...source, sourceSha: 'd1e8bd9c6d49f980405888099087f931ddd26d83' },
    { ...source, harnessVersion: '0.1.5' },
    { ...source, sourceDirty: true },
  ])('refuses incompatible official source identity %j', async (identity) => {
    const root = await directory()
    const descriptorPath = join(root, 'inputs.json')
    const bytes = JSON.stringify({ sourceDirty: false, ...identity, packages: [] })
    await writeFile(descriptorPath, bytes)
    await expect(verifyOfficialInputs({ sourceDirectory: root, packagesDirectory: root,
      descriptorPath, descriptorSha256: hash(bytes) })).rejects.toThrow(/official.*source/iu)
  })

  it.each(['count', 'duplicate-name', 'duplicate-file', 'escape'] as const)('rejects descriptor %s before source reads', async (invalid) => {
    const root = await directory()
    const packages = Array.from({ length: 275 }, (_, index) => ({
      name: index === 0 ? '@deepseek-ai/dsh' : `@deepseek-ai/fixture-${String(index)}`, version: '0.1.5-rc.2',
      path: `packages/fixture-${String(index)}.tgz`, bytes: 1, sha256: 'b'.repeat(64),
    }))
    if (invalid === 'count') packages.pop()
    if (invalid === 'duplicate-name') packages[1]!.name = packages[0]!.name
    if (invalid === 'duplicate-file') packages[1]!.path = packages[0]!.path
    if (invalid === 'escape') packages[1]!.path = '../external.tgz'
    const descriptorPath = join(root, 'inputs.json')
    const bytes = JSON.stringify({ ...source, sourceDirty: false, buildCommand: 'pnpm run build:official',
      clientBuildRecordSha256: 'c'.repeat(64), packages })
    await writeFile(descriptorPath, bytes)
    await expect(verifyOfficialInputs({ sourceDirectory: '/missing-fixture-source', packagesDirectory: root,
      descriptorPath, descriptorSha256: hash(bytes) })).rejects.toThrow(/275|duplicate|escapes/iu)
  })
})

async function installationFixture() {
  const root = await directory()
  const pnpmJs = join(root, 'pnpm/bin/pnpm.mjs')
  await file(pnpmJs, '// Public fixture CLI; never executed.\n')
  await file(join(root, 'pnpm/bin/pnpm.cjs'), '// Internal fixture CLI; never executed.\n')
  await file(join(root, 'pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.7.0', bin: { pnpm: 'bin/pnpm.mjs' } }))
  // This fixture exercises installation orchestration only; it does not establish official source/build acceptance.
  const inputs = { source, descriptorSha256: 'a'.repeat(64), packages: policyPackages().map(entry => entry.input),
    policy: createOfficialRuntimePolicy(fixturePolicy, rootManifest, lockfile, policyPackages()),
    patches: [{ path: 'patches/node-pty@1.2.0-beta.15.patch', bytes: Buffer.from('fixture patch\n') }] } as unknown as VerifiedOfficialInputs
  return { root, pnpmJs, inputs, runtimeDirectory: join(root, 'runtime') }
}

describe('pinned pnpm public CLI resolution', () => {
  it('selects the declared mjs command when the internal cjs also exists', async () => {
    const f = await installationFixture()
    expect(await resolveOfficialPnpmCli(join(f.root, 'pnpm'))).toBe(f.pnpmJs)
  })
  it.each([
    { name: 'other', version: '11.7.0', bin: { pnpm: 'bin/pnpm.mjs' } },
    { name: 'pnpm', version: '11.8.0', bin: { pnpm: 'bin/pnpm.mjs' } },
    { name: 'pnpm', version: '11.7.0' },
    { name: 'pnpm', version: '11.7.0', bin: { pnpm: 'bin/pnpm.exe' } },
    { name: 'pnpm', version: '11.7.0', bin: { pnpm: '../outside.mjs' } },
  ])('rejects an invalid pnpm manifest: %j', async (manifest) => {
    const f = await installationFixture()
    await file(join(f.root, 'pnpm/package.json'), JSON.stringify(manifest))
    await expect(resolveOfficialPnpmCli(join(f.root, 'pnpm'))).rejects.toThrow(/pnpm.*11\.7\.0/iu)
  })
  it('rejects a missing declared command without selecting the internal cjs', async () => {
    const f = await installationFixture()
    await rm(f.pnpmJs)
    await expect(resolveOfficialPnpmCli(join(f.root, 'pnpm'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('local official runtime orchestration with a fixture runner', () => {
  it.each(['platform', 'arch', 'inputManifestSha256'] as const)('refuses an existing receipt with another %s before any installer invocation', async (field) => {
    const f = await installationFixture()
    await mkdir(f.runtimeDirectory)
    const identity = { schema: 1, ...source, inputManifestSha256: f.inputs.descriptorSha256,
      platform: process.platform, arch: process.arch, nodeVersion: process.version,
      pnpmVersion: '11.7.0', pnpmCliSha256: hash(await readFile(f.pnpmJs)) }
    await file(join(f.runtimeDirectory, 'desktop-official-installation.json'), JSON.stringify({ ...identity, [field]: 'another-host-or-input' }))
    await expect(prepareOfficialRuntime(f.inputs, { ...f, runner: async () => { throw new Error('Must not install.') } })).rejects.toThrow(/platform\/arch/iu)
  })
  it('invokes the exact pnpm JS without a shell and reuses a completely verified host runtime', async () => {
    const f = await installationFixture()
    const commands: OfficialRuntimeCommand[] = []
    const runner = async (command: OfficialRuntimeCommand) => {
      commands.push(command)
      if (command.args.includes('--version')) return { exitCode: 0, stdout: '11.7.0\n' }
      await file(join(f.runtimeDirectory, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.2' }))
      await file(join(f.runtimeDirectory, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'export {}\n')
      return { exitCode: 0 }
    }
    const receipt = await prepareOfficialRuntime(f.inputs, { ...f, runner })
    expect(receipt).toMatchObject({ ...source, inputManifestSha256: 'a'.repeat(64), platform: process.platform, arch: process.arch, reused: false })
    expect(receipt.pnpmCliSha256).toBe(hash(await readFile(f.pnpmJs)))
    expect(commands[0]?.args).toEqual([f.pnpmJs, '--version'])
    const command = commands.find(entry => entry.args.includes('install'))!
    expect(command).toMatchObject({ executable: process.execPath, shell: false, cwd: f.runtimeDirectory })
    expect(command.args).toEqual([f.pnpmJs, 'install', '--prod', '--no-frozen-lockfile',
      `--config.npmrc-auth-file=${join(f.runtimeDirectory, '.npmrc')}`])
    expect(await readFile(join(f.runtimeDirectory, '.npmrc'), 'utf8')).toBe('')
    const before = await readFile(join(f.runtimeDirectory, 'provenance.json'), 'utf8')
    const reused = await prepareOfficialRuntime(f.inputs, { ...f, runner: async () => { throw new Error('Reuse must not invoke a runner.') } })
    expect(reused).toMatchObject({ reused: true, inventorySha256: receipt.inventorySha256 })
    expect(await readFile(join(f.runtimeDirectory, 'provenance.json'), 'utf8')).toBe(before)
    await writeFile(join(f.runtimeDirectory, 'extra'), 'changed')
    await expect(prepareOfficialRuntime(f.inputs, { ...f, runner })).rejects.toThrow(/inventory/iu)
  })

  it('refuses an old runtime without a local installation receipt and preserves it', async () => {
    const f = await installationFixture()
    await mkdir(f.runtimeDirectory)
    await file(join(f.runtimeDirectory, 'keep'), 'old')
    await recordOfficialRuntime(f.runtimeDirectory, source)
    await expect(prepareOfficialRuntime(f.inputs, { ...f, runner: async () => { throw new Error('Must not install.') } })).rejects.toThrow(/receipt.*audit/iu)
    expect(await readFile(join(f.runtimeDirectory, 'keep'), 'utf8')).toBe('old')
  })

  it('refuses the undeclared internal cjs before invoking it or creating output', async () => {
    const f = await installationFixture()
    await expect(prepareOfficialRuntime(f.inputs, { ...f, pnpmJs: join(f.root, 'pnpm/bin/pnpm.cjs'),
      runner: async () => { throw new Error('Must not run the internal CLI.') },
    })).rejects.toThrow(/exact pnpm/iu)
    await expect(readdir(f.runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('refuses an invoked CLI reporting a different version before creating output', async () => {
    const f = await installationFixture()
    await expect(prepareOfficialRuntime(f.inputs, { ...f, runner: async () => ({ exitCode: 0, stdout: '11.8.0' }) }))
      .rejects.toThrow(/did not report version 11\.7\.0/iu)
    await expect(readdir(f.runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a pnpm version change before creating output', async () => {
    const f = await installationFixture()
    await file(join(f.root, 'pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.8.0', bin: { pnpm: 'bin/pnpm.cjs' } }))
    await expect(prepareOfficialRuntime(f.inputs, { ...f, runner: async () => ({ exitCode: 0 }) })).rejects.toThrow(/pnpm.*11\.7\.0/iu)
    await expect(readdir(f.runtimeDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves a failed installation without a completion receipt and refuses a blind retry', async () => {
    const f = await installationFixture()
    const runner = async (command: OfficialRuntimeCommand) => ({ exitCode: command.args.includes('--version') ? 0 : 1, stdout: '11.7.0\n' })
    await expect(prepareOfficialRuntime(f.inputs, { ...f, runner })).rejects.toThrow(/install/iu)
    await expect(prepareOfficialRuntime(f.inputs, { ...f, runner })).rejects.toThrow(/receipt.*audit/iu)
  })
})
