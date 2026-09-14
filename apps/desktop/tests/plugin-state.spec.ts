import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DesktopPluginStateStore,
  computeEffectiveBundles,
  type ObservedBundle,
  type PluginDiagnosisCode,
  type PluginRestoreReceipt,
} from '../src/compatibility/plugin-state.ts'

const roots: string[] = []
const evidence = (number: number): string => number.toString(16).padStart(64, '0')
async function fixture(failureConfirmations = 2) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-plugin-state-')))
  roots.push(root)
  const directory = join(root, 'compatibility')
  const store = new DesktopPluginStateStore({ directory, policy: { failureConfirmations } })
  return { root, directory, store }
}
function bundle(root: string, name = 'plugin-a', overrides: Partial<ObservedBundle> = {}): ObservedBundle {
  return {
    name, observedVersion: '1.0.0', targetHostVersion: '0.6.0', userEnabled: true,
    source: { profileName: 'web', codePath: join(root, name), dataPaths: [join(root, 'data', name)] },
    order: 0, requiredBundleNames: [], requiredRelationsVerified: true, ...overrides,
  }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('native Bundle pause state', () => {
  it('persists user choice across fresh instances without deleting package or data', async () => {
    const { root, directory, store } = await fixture()
    const input = bundle(root)
    await mkdir(input.source.codePath, { recursive: true })
    await writeFile(join(input.source.codePath, 'keep.txt'), 'package bytes')
    await mkdir(input.source.dataPaths[0]!, { recursive: true })
    await writeFile(join(input.source.dataPaths[0]!, 'keep.txt'), 'private data')
    expect((await store.read()).revision).toBe(0)
    await store.observeBundle(input, 0)
    const disabled = await store.setUserEnabled('plugin-a', false, 1)
    expect(disabled.revision).toBe(2)
    const reopened = await new DesktopPluginStateStore({ directory, policy: { failureConfirmations: 2 } }).read()
    expect(reopened.entries[0]).toMatchObject({ userEnabled: false, health: 'unverified' })
    expect(await readFile(join(input.source.codePath, 'keep.txt'), 'utf8')).toBe('package bytes')
    expect(await readFile(join(input.source.dataPaths[0]!, 'keep.txt'), 'utf8')).toBe('private data')
  })

  it('requires distinct confirmations for the same identity and keeps independent bundles active', async () => {
    const { root, store } = await fixture()
    await store.observeBundle(bundle(root), 0)
    await store.observeBundle(bundle(root, 'plugin-b', { order: 1 }), 1)
    const diagnosis = { name: 'plugin-a', observedVersion: '1.0.0', targetHostVersion: '0.6.0', code: 'invalid-yaml' as const, evidenceId: evidence(1) }
    const first = await store.recordDiagnosis(diagnosis, 2)
    expect(first.entries[0]).toMatchObject({ health: 'suspected', userEnabled: true })
    const duplicate = await store.recordDiagnosis(diagnosis, first.revision)
    expect(duplicate.entries[0]?.diagnosis?.confirmations).toBe(1)
    const second = await store.recordDiagnosis({ ...diagnosis, evidenceId: evidence(2) }, duplicate.revision)
    expect(second.entries[0]).toMatchObject({ health: 'paused', userEnabled: true, pauseReason: { code: 'invalid-yaml', confirmations: 2 } })
    expect(computeEffectiveBundles(second, ['plugin-b', 'plugin-a']).active).toEqual(['plugin-b'])
  })

  it('does not combine different diagnosis codes, versions, or target hosts', async () => {
    const { root, store } = await fixture()
    await store.observeBundle(bundle(root), 0)
    const base = { name: 'plugin-a', observedVersion: '1.0.0', targetHostVersion: '0.6.0', evidenceId: evidence(1) }
    const first = await store.recordDiagnosis({ ...base, code: 'invalid-yaml' }, 1)
    const differentCode = await store.recordDiagnosis({ ...base, code: 'invalid-manifest', evidenceId: evidence(2) }, first.revision)
    expect(differentCode.entries[0]?.diagnosis?.confirmations).toBe(1)
    await expect(store.recordDiagnosis({ ...base, observedVersion: '0.9.0', code: 'invalid-manifest' }, differentCode.revision)).rejects.toMatchObject({ code: 'identity-conflict' })
    await expect(store.recordDiagnosis({ ...base, targetHostVersion: '0.5.5', code: 'invalid-manifest' }, differentCode.revision)).rejects.toMatchObject({ code: 'identity-conflict' })
    const updated = await store.observeBundle(bundle(root, 'plugin-a', { observedVersion: '1.1.0' }), differentCode.revision)
    expect(updated.entries[0]).toMatchObject({ health: 'unverified' })
    expect(updated.entries[0]?.diagnosis).toBeUndefined()
  })

  it.each(['network', 'auth', 'rate-limit', 'timeout', 'cancel', 'unknown-core'])('rejects %s as pause causality without modifying state', async (code) => {
    const { root, directory, store } = await fixture(1)
    await store.observeBundle(bundle(root), 0)
    const before = await readFile(join(directory, 'plugin-state.json'))
    await expect(store.recordDiagnosis({ name: 'plugin-a', observedVersion: '1.0.0', targetHostVersion: '0.6.0', code: code as PluginDiagnosisCode, evidenceId: evidence(1) }, 1)).rejects.toMatchObject({ code: 'unattributable-diagnosis' })
    expect(await readFile(join(directory, 'plugin-state.json'))).toEqual(before)
  })

  it.each(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-client-ui-desktop-shell', '@deepseek-ai/dsh-client-ui-settings-system-update'])('protects %s from manual and automatic pause', async (name) => {
    const { root, store } = await fixture(1)
    await store.observeBundle(bundle(root, name), 0)
    await expect(store.setUserEnabled(name, false, 1)).rejects.toMatchObject({ code: 'protected-bundle' })
    await expect(store.recordDiagnosis({ name, observedVersion: '1.0.0', targetHostVersion: '0.6.0', code: 'incompatible', evidenceId: evidence(1) }, 1)).rejects.toMatchObject({ code: 'protected-bundle' })
    expect(computeEffectiveBundles(await store.read(), [name]).active).toEqual([name])
  })

  it('uses only explicitly verified required edges and propagates exclusion without reordering peers', async () => {
    const { root, store } = await fixture()
    await store.observeBundle(bundle(root), 0)
    await store.observeBundle(bundle(root, 'plugin-b'), 1)
    await store.observeBundle(bundle(root, 'plugin-c', { requiredBundleNames: ['plugin-a'] }), 2)
    await store.observeBundle(bundle(root, 'plugin-d', { requiredBundleNames: ['plugin-c'] }), 3)
    const state = await store.setUserEnabled('plugin-a', false, 4)
    expect(computeEffectiveBundles(state, ['plugin-d', 'plugin-b', 'plugin-c', 'plugin-a'])).toEqual({
      active: ['plugin-b'],
      excluded: [
        { name: 'plugin-d', reason: 'required-bundle-unavailable', requiredBundleNames: ['plugin-c'] },
        { name: 'plugin-c', reason: 'required-bundle-unavailable', requiredBundleNames: ['plugin-a'] },
        { name: 'plugin-a', reason: 'user-disabled', requiredBundleNames: [] },
      ],
    })
    await expect(store.observeBundle(bundle(root, 'plugin-e', { requiredRelationsVerified: false as true, requiredBundleNames: ['plugin-a'] }), state.revision)).rejects.toMatchObject({ code: 'unverified-relations' })
  })

  it('serializes simultaneous writers and rejects stale revisions instead of losing a choice', async () => {
    const { root, directory, store } = await fixture()
    await store.observeBundle(bundle(root), 0)
    await store.observeBundle(bundle(root, 'plugin-b'), 1)
    const second = new DesktopPluginStateStore({ directory, policy: { failureConfirmations: 2 } })
    const outcomes = await Promise.allSettled([
      store.setUserEnabled('plugin-a', false, 2), second.setUserEnabled('plugin-b', false, 2),
    ])
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(value => value.status === 'rejected')).toMatchObject({ reason: { code: 'revision-conflict' } })
    const current = await second.read()
    expect(current.revision).toBe(3)
    const stillEnabled = current.entries.find(entry => entry.userEnabled)!
    const final = await second.setUserEnabled(stillEnabled.name, false, current.revision)
    expect(final.entries.map(entry => entry.userEnabled)).toEqual([false, false])
  })

  it('requires a current native receipt, preserves manual disable and retains a pause after failed validation', async () => {
    const { root, store } = await fixture(1)
    await store.observeBundle(bundle(root, 'plugin-a', { userEnabled: false }), 0)
    const paused = await store.recordDiagnosis({ name: 'plugin-a', observedVersion: '1.0.0', targetHostVersion: '0.6.0', code: 'incompatible', evidenceId: evidence(1) }, 1)
    const failed = await store.validateRestore('plugin-a', paused.revision, async () => false)
    expect(failed).toBeNull()
    expect((await store.read()).entries[0]?.health).toBe('paused')
    await expect(store.restore({ name: 'plugin-a', valid: true } as unknown as PluginRestoreReceipt, paused.revision)).rejects.toMatchObject({ code: 'untrusted-receipt' })
    const receipt = await store.validateRestore('plugin-a', paused.revision, async entry => entry.observedVersion === '1.0.0')
    expect(receipt).not.toBeNull()
    await expect(store.restore(JSON.parse(JSON.stringify(receipt)) as PluginRestoreReceipt, paused.revision)).rejects.toMatchObject({ code: 'untrusted-receipt' })
    const restored = await store.restore(receipt!, paused.revision)
    expect(restored.entries[0]).toMatchObject({ health: 'healthy', userEnabled: false })
    expect(restored.entries[0]?.pauseReason).toBeUndefined()
    expect(computeEffectiveBundles(restored, ['plugin-a']).active).toEqual([])
    await expect(store.restore(receipt!, restored.revision)).rejects.toMatchObject({ code: 'untrusted-receipt' })
  })

  it('invalidates restoration when state changes while validation is running', async () => {
    const { root, store } = await fixture(1)
    await store.observeBundle(bundle(root), 0)
    const started = Promise.withResolvers<undefined>()
    const validation = Promise.withResolvers<boolean>()
    const pending = store.validateRestore('plugin-a', 1, async () => {
      started.resolve(undefined)
      return validation.promise
    })
    await started.promise
    await store.setUserEnabled('plugin-a', false, 1)
    validation.resolve(true)
    const receipt = await pending
    await expect(store.restore(receipt!, 2)).rejects.toMatchObject({ code: 'revision-conflict' })
    expect((await store.read()).entries[0]?.userEnabled).toBe(false)
  })

  it('retains a pause and user choice across discovery of a new version until validated restoration', async () => {
    const { root, store } = await fixture(1)
    await store.observeBundle(bundle(root), 0)
    await store.recordDiagnosis({ name: 'plugin-a', observedVersion: '1.0.0', targetHostVersion: '0.6.0', code: 'incompatible', evidenceId: evidence(1) }, 1)
    await store.setUserEnabled('plugin-a', false, 2)
    const updated = await store.observeBundle(bundle(root, 'plugin-a', { observedVersion: '1.1.0', userEnabled: true }), 3)
    expect(updated.entries[0]).toMatchObject({ observedVersion: '1.1.0', userEnabled: false, health: 'paused', pauseReason: { observedVersion: '1.0.0' } })
  })

  it('fails closed on malformed persisted data and never copies diagnostic input into errors or state', async () => {
    const { root, directory, store } = await fixture()
    await store.observeBundle(bundle(root), 0)
    const before = await readFile(join(directory, 'plugin-state.json'))
    await expect(store.recordDiagnosis({ name: 'plugin-a', observedVersion: '1.0.0', targetHostVersion: '0.6.0', code: 'invalid-yaml', evidenceId: 'SECRET=do-not-copy' }, 1)).rejects.toThrow('Invalid evidence identifier')
    expect(await readFile(join(directory, 'plugin-state.json'))).toEqual(before)
    await writeFile(join(directory, 'plugin-state.json'), '{"token":"SECRET=do-not-copy"}')
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid-state' })
    await expect(store.read()).rejects.not.toThrow('SECRET=do-not-copy')
  })

  it.each(['directory', 'state', 'lock'])('rejects a symlinked %s without touching its target', async (kind) => {
    const { root, directory, store } = await fixture()
    const outside = join(root, 'outside')
    await mkdir(outside)
    const target = join(outside, 'sentinel')
    await writeFile(target, 'keep')
    if (kind === 'directory') await symlink(outside, directory, 'junction')
    else {
      await mkdir(directory)
      await symlink(target, join(directory, kind === 'state' ? 'plugin-state.json' : 'plugin-state.json.lock'), 'file')
    }
    await expect(store.observeBundle(bundle(root), 0)).rejects.toMatchObject({ code: 'unsafe-path' })
    expect(await readFile(target, 'utf8')).toBe('keep')
  })

  it('coordinates independent processes through the same file lock', async () => {
    const { root, directory, store } = await fixture()
    await store.observeBundle(bundle(root), 0)
    await store.observeBundle(bundle(root, 'plugin-b'), 1)
    const moduleUrl = new URL('../src/compatibility/plugin-state.ts', import.meta.url).href
    const execute = promisify(execFile)
    const outputs = await Promise.all(['plugin-a', 'plugin-b'].map(async (name) => {
      const program = `
        import { DesktopPluginStateStore } from ${JSON.stringify(moduleUrl)};
        const store = new DesktopPluginStateStore({directory:${JSON.stringify(directory)},policy:{failureConfirmations:2}});
        try { const result = await store.setUserEnabled(${JSON.stringify(name)},false,2); console.log(JSON.stringify({revision:result.revision})); }
        catch(error) { if(error.code !== 'revision-conflict') throw error; console.log(JSON.stringify({code:error.code})); }
      `
      const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', program], {
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 15_000,
      })
      return JSON.parse(stdout.trim()) as { revision?: number; code?: string }
    }))
    expect(outputs.filter(output => output.revision === 3)).toHaveLength(1)
    expect(outputs.filter(output => output.code === 'revision-conflict')).toHaveLength(1)
    expect((await store.read()).entries.filter(item => !item.userEnabled)).toHaveLength(1)
  })

  it('keeps the previous pause when trusted validation throws and returns no raw diagnostic', async () => {
    const { root, store } = await fixture(1)
    await store.observeBundle(bundle(root), 0)
    const paused = await store.recordDiagnosis({ name: 'plugin-a', observedVersion: '1.0.0', targetHostVersion: '0.6.0', code: 'invalid-manifest', evidenceId: evidence(1) }, 1)
    await expect(store.validateRestore('plugin-a', paused.revision, async () => { throw new Error('SECRET=private') })).rejects.toMatchObject({ code: 'validation-failed', message: 'Native Bundle restoration validation failed.' })
    expect(await store.read()).toEqual(paused)
  })

  it('rejects a malformed persisted health record instead of silently enabling its Bundle', async () => {
    const { root, directory, store } = await fixture()
    await store.observeBundle(bundle(root), 0)
    const state = await store.read()
    await writeFile(join(directory, 'plugin-state.json'), JSON.stringify({ ...state, entries: [{ ...state.entries[0], health: 'paused' }] }))
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid-state' })
  })

  it('requires an explicit valid failure confirmation policy and rejects policy drift', async () => {
    const { root, directory, store } = await fixture()
    expect(() => new DesktopPluginStateStore({ directory, policy: { failureConfirmations: 0 } })).toThrow()
    await store.observeBundle(bundle(root), 0)
    await expect(new DesktopPluginStateStore({ directory, policy: { failureConfirmations: 3 } }).read()).rejects.toMatchObject({ code: 'policy-conflict' })
  })
})
