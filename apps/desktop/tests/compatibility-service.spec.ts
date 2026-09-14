import { mkdir, mkdtemp, realpath, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopCompatibilityService } from '../src/compatibility/service.ts'
import { composeManagedProfile, ProfileCompositionRecovery, type ManagedProfileReceipt, type ManagedProfileInput } from '../src/compatibility/profile-composition.ts'

import { computeEffectiveBundles } from '../src/compatibility/plugin-state.ts'

vi.mock('../src/compatibility/profile-composition.ts', async original => ({
  ...await original<typeof import('../src/compatibility/profile-composition.ts')>(), composeManagedProfile: vi.fn(),
}))
const roots: string[] = []
const compose = vi.mocked(composeManagedProfile)
// Complete synthetic receipts isolate orchestration; the composer suite owns source identity and publication checks.
function compositionReceipt(
  input: ManagedProfileInput, requestedBundles = input.snapshot.entries.map(item => item.name),
): ManagedProfileReceipt {
  const selection = computeEffectiveBundles(input.snapshot, requestedBundles)
  return {
    schemaVersion: 1, status: 'ready', profileName: basename(input.effectiveDirectory), profileDirectory: input.effectiveDirectory,
    canonicalDirectory: input.canonicalDirectory, dshHome: input.dshHome,
    officialSourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', stateRevision: input.snapshot.revision,
    inputHash: '0'.repeat(64), originalPatchReload: 'live', effectivePatchReload: 'startup', requestedBundles,
    activeBundles: selection.active, excludedBundles: selection.excluded,
    observations: input.snapshot.entries.filter(item => selection.active.includes(item.name)).map(item => ({
      name: item.name, observedVersion: item.observedVersion, codePath: item.source.codePath,
      patchPath: join(item.source.codePath, 'cordis.patch.yml'), order: item.order,
      requiredBundleNames: item.requiredBundleNames, requiredRelationsVerified: true,
    })),
    relationVerification: 'declared-canonical-bundle-dependencies', inputs: [], directoryInputs: [], publication: 'staged-directory-swap',
  }
}
beforeEach(() => {
  compose.mockReset()
  compose.mockImplementation(async input => compositionReceipt(input))
})
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-compat-service-')))
  roots.push(root)
  await mkdir(join(root, 'profiles/web'), { recursive: true })
  await writeFile(join(root, 'profiles/web/package.json'), '{}')
  const bundle = join(root, 'bundle-a')
  await mkdir(bundle)
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'bundle-a', version: '1.0.0', dependencies: {} }))
  const validateHost = vi.fn(async () => {})
  const resolveBundleDir = vi.fn(() => bundle)
  const service = new DesktopCompatibilityService({ dshHome: root, directory: join(root, 'native'),
    canonicalDirectory: join(root, 'profiles/web'), effectiveDirectory: join(root, 'profiles/desktop-base'),
    officialAnchor: join(root, 'official/package.json'), harnessVersion: '0.1.5-rc.2', policy: { failureConfirmations: 2 },
    official: { sourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', resolveBundleDir,
      loadOverlayPatches: () => [], entryListSchema: {}, yaml: { load: () => [], dump: () => '[]\n' } },
    initializeCanonical() {}, requestedBundles: () => ['bundle-a'], validateHost })
  return { root, service, bundle, validateHost, resolveBundleDir }
}
describe('native compatibility orchestration', () => {
  it('does not blame an observed Bundle for unknown resolver failures', async () => {
    const { service, resolveBundleDir } = await fixture()
    await service.prepare()
    resolveBundleDir.mockImplementation(() => { throw new Error('unknown resolver failure') })
    for (let attempt = 0; attempt < 2; attempt++) await expect(service.prepare()).rejects.toThrow('unknown resolver failure')
    expect((await service.getSnapshot()).entries[0]).toMatchObject({ health: 'unverified', reason: null })
  })

  it('does not write through a canonical directory link before rejecting recovery', async () => {
    const { root, service } = await fixture()
    const external = join(root, 'external')
    await mkdir(external)
    await writeFile(join(external, 'sentinel'), 'unchanged')
    await rm(join(root, 'profiles/web'), { recursive: true })
    await symlink(external, join(root, 'profiles/web'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(service.prepare()).rejects.toThrow('traverse links')
    expect(await readFile(join(external, 'sentinel'), 'utf8')).toBe('unchanged')
    await expect(readFile(join(external, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses the last verified identity to pause a subsequently malformed manifest', async () => {
    const { service, bundle } = await fixture()
    await service.prepare()
    await writeFile(join(bundle, 'package.json'), 'bad json')
    await expect(service.prepare()).rejects.toMatchObject({ code: 'bundle-manifest-invalid' })
    await service.prepare()
    expect((await service.getSnapshot()).entries[0]).toMatchObject({ health: 'paused', reason: 'invalid-manifest' })
  })

  it('refuses to restore a Bundle excluded from the candidate even when the base graph composes', async () => {
    const { service, validateHost } = await fixture()
    await service.prepare()
    compose.mockImplementationOnce(async input => compositionReceipt(input, []))
    const state = await service.getSnapshot()
    await expect(service.mutate({ name: 'bundle-a', action: 'restore', revision: state.revision }, new AbortController().signal))
      .rejects.toThrow('validation failed')
    expect(validateHost).not.toHaveBeenCalled()
    expect((await service.getSnapshot()).entries[0]?.health).toBe('unverified')
  })

  it('pauses only after independent attributed observations and validates the current version before restoration', async () => {
    const { service, bundle, validateHost } = await fixture()
    compose.mockRejectedValueOnce(new ProfileCompositionRecovery('bundle-yaml-invalid', { bundleName: 'bundle-a' }))
    await expect(service.prepare()).rejects.toMatchObject({ code: 'bundle-yaml-invalid' })
    expect((await service.getSnapshot()).entries[0]?.health).toBe('suspected')
    compose.mockRejectedValueOnce(new ProfileCompositionRecovery('bundle-yaml-invalid', { bundleName: 'bundle-a' }))
    await service.prepare()
    let state = await service.getSnapshot()
    expect(state.entries[0]?.health).toBe('paused')
    await service.mutate({ name: 'bundle-a', action: 'disable', revision: state.revision }, new AbortController().signal)
    await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'bundle-a', version: '1.1.0', dependencies: {} }))
    state = await service.getSnapshot()
    await service.mutate({ name: 'bundle-a', action: 'restore', revision: state.revision }, new AbortController().signal)
    expect(validateHost).toHaveBeenCalledOnce()
    expect((await service.getSnapshot()).entries[0]).toMatchObject({ version: '1.1.0', health: 'healthy', enabled: false })
  })
  it('keeps a pause and manual choice when the fixed native Host validation fails', async () => {
    const { service, validateHost } = await fixture()
    for (let attempt = 0; attempt < 2; attempt++) {
      compose.mockRejectedValueOnce(new ProfileCompositionRecovery('bundle-yaml-invalid', { bundleName: 'bundle-a' }))
      if (attempt === 0) await expect(service.prepare()).rejects.toBeInstanceOf(ProfileCompositionRecovery)
      else await service.prepare()
    }
    const state = await service.getSnapshot()
    validateHost.mockRejectedValueOnce(new Error('candidate failed'))
    await expect(service.mutate({ name: 'bundle-a', action: 'restore', revision: state.revision }, new AbortController().signal)).rejects.toThrow('validation failed')
    expect((await service.getSnapshot()).entries[0]).toMatchObject({ health: 'paused', enabled: true })
  })
  it('never attributes invalid global configuration or arbitrary core exceptions to a Bundle', async () => {
    const { service } = await fixture()
    for (const error of [new ProfileCompositionRecovery('root-yaml-invalid'), new Error('network/auth/core unknown')]) {
      compose.mockRejectedValueOnce(error)
      await expect(service.prepare()).rejects.toBe(error)
    }
    const state = await service.getSnapshot()
    expect(state.entries[0]?.health).toBe('unverified')
    expect(JSON.stringify(state)).not.toContain('network/auth')
    await expect(service.mutate({ name: 'bundle-a', action: 'disable', revision: 0 }, new AbortController().signal)).rejects.toThrow('state changed')
  })
})
