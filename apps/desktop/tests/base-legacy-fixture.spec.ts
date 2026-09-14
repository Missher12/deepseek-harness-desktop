import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { desktopBaseLegacyBaseline } from '../../../scripts/desktop-base-contract.ts'
import { prepareBaseLegacyFixture, verifyBaseLegacyFixture } from './base-legacy-fixture.ts'
import type { BaseLegacyFixtureOptions } from './base-legacy-fixture.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'legacy-fixture-contract-'))
  roots.push(root)
  const extractedRoot = join(root, 'old-runtime')
  await mkdir(extractedRoot)
  const artifactPath = join(root, 'old-package.dmg')
  await writeFile(artifactPath, 'inert input contract fixture')
  const options: BaseLegacyFixtureOptions = {
    isolationRoot: join(root, 'isolation'),
    legacy: {
      artifactPath,
      artifactSha256: createHash('sha256').update('inert input contract fixture').digest('hex'),
      releaseUrl: 'https://github.com/Missher12/deepseek-harness-desktop/releases/download/desktop-v0.5.5/fixture.dmg',
      extractedRoot, modulesRoot: join(extractedRoot, 'node_modules'),
      executablePath: join(extractedRoot, 'electron'), executableKind: 'electron',
      cliPath: join(extractedRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      applicationAsarPath: join(extractedRoot, 'app.asar'),
      ...desktopBaseLegacyBaseline(process.platform),
      platform: process.platform, arch: 'x64', files: [],
    },
  }
  return { root, options }
}

describe('old production base-smoke fixture', () => {
  it('fails missing old runtime inputs without creating a synthetic replacement', async () => {
    const f = await fixture()
    await expect(prepareBaseLegacyFixture(f.options)).rejects.toThrow(/legacy-runtime-unavailable|legacy-artifact-hash/iu)
    expect(await readdir(f.root)).not.toContain('isolation')
  })
  it('rejects a new source labelled as the old runtime', async () => {
    const f = await fixture()
    f.options.legacy.sourceSha = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
    await expect(prepareBaseLegacyFixture(f.options)).rejects.toThrow(/legacy-runtime-identity/iu)
    expect(await readdir(f.root)).not.toContain('isolation')
  })
  it('rejects the annotated tag object and a foreign platform baseline before execution', async () => {
    for (const sourceSha of ['41bf507' + '0'.repeat(33), desktopBaseLegacyBaseline(process.platform === 'linux' ? 'darwin' : 'linux').sourceSha]) {
      const f = await fixture()
      f.options.legacy.sourceSha = sourceSha
      await expect(prepareBaseLegacyFixture(f.options)).rejects.toThrow(/legacy-runtime-identity/iu)
      expect(await readdir(f.root)).not.toContain('isolation')
    }
  })
  it('rejects an incorrect old asset hash before execution', async () => {
    const f = await fixture()
    f.options.legacy.artifactSha256 = '0'.repeat(64)
    await expect(prepareBaseLegacyFixture(f.options)).rejects.toThrow(/legacy-artifact-hash/iu)
  })
  it('rejects an executable outside the extracted old asset and preserves that file', async () => {
    const f = await fixture()
    const protectedPath = join(f.root, 'keep.txt')
    await writeFile(protectedPath, 'protected')
    f.options.legacy.executablePath = protectedPath
    await expect(prepareBaseLegacyFixture(f.options)).rejects.toThrow(/legacy-path-escape/iu)
    expect(await readFile(protectedPath, 'utf8')).toBe('protected')
    expect(await readdir(f.root)).not.toContain('isolation')
  })
  it('refuses an existing fixture root without changing its files', async () => {
    const f = await fixture()
    await mkdir(f.options.isolationRoot)
    await writeFile(join(f.options.isolationRoot, 'user-data'), 'preserve')
    await expect(prepareBaseLegacyFixture(f.options)).rejects.toThrow(/already exists/iu)
    expect(await readFile(join(f.options.isolationRoot, 'user-data'), 'utf8')).toBe('preserve')
  })
  it('rejects a receipt outside its claimed fixture root', async () => {
    const f = await fixture()
    await mkdir(f.options.isolationRoot)
    const receipt = join(f.root, 'untrusted.json')
    await writeFile(receipt, '{}')
    await expect(verifyBaseLegacyFixture(receipt, { isolationRoot: f.options.isolationRoot, platform: process.platform }))
      .rejects.toThrow(/fixture-path-escape/iu)
  })
  it('rejects a hand-authored receipt without observed old production execution', async () => {
    const f = await fixture()
    await mkdir(f.options.isolationRoot)
    const receipt = join(f.options.isolationRoot, 'legacy-fixture.json')
    await writeFile(receipt, JSON.stringify({ schema: 1, fixtureOnly: true, oldReaderPassed: true }))
    await expect(verifyBaseLegacyFixture(receipt, { isolationRoot: f.options.isolationRoot, platform: process.platform }))
      .rejects.toThrow(/fixture-receipt-invalid/iu)
  })
  it.skipIf(process.env.DSH_TEST_LEGACY_RUNTIME_DESCRIPTOR === undefined)('creates and reads a V2 fixture using the explicitly supplied real old installation', async () => {
    const input = process.env.DSH_TEST_LEGACY_RUNTIME_DESCRIPTOR
    if (input === undefined) throw new Error('Real old runtime descriptor missing.')
    const legacy = JSON.parse(await readFile(input, 'utf8')) as BaseLegacyFixtureOptions['legacy']
    const root = await mkdtemp(join(tmpdir(), 'legacy-fixture-native-'))
    roots.push(root)
    const isolationRoot = join(root, 'isolation')
    const result = await prepareBaseLegacyFixture({ isolationRoot, legacy })
    expect(result).toMatchObject({ oldVersion: desktopBaseLegacyBaseline(process.platform).desktopVersion,
      harnessVersion: legacy.harnessVersion, sourceSha: legacy.sourceSha })
    const verified = await verifyBaseLegacyFixture(result.fixtureReceiptPath, { isolationRoot, platform: process.platform })
    expect(verified.sessionId).toBe(result.sessionId)
    expect(verified.protectedPaths.length).toBeGreaterThan(6)
    const protectedPath = verified.protectedPaths[0]
    if (protectedPath === undefined) throw new Error('Old Session file is absent.')
    const original = await readFile(protectedPath)
    await writeFile(protectedPath, 'changed synthetic history')
    await expect(verifyBaseLegacyFixture(result.fixtureReceiptPath, { isolationRoot, platform: process.platform }))
      .rejects.toThrow(/fixture-file-changed/iu)
    await writeFile(protectedPath, original)
    const restored = await verifyBaseLegacyFixture(result.fixtureReceiptPath, { isolationRoot, platform: process.platform })
    expect(restored.sessionId).toBe(result.sessionId)
  }, 420_000)
})
