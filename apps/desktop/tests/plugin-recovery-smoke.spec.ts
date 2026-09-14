import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { createPluginRecoveryFixtures, pluginRecoveryConfirmationStatus, runPluginRecoverySmoke,
  runRecoveryPluginCli, verifyRecoveryExclusion, type PluginRecoveryContext } from './plugin-recovery-smoke.ts'

const roots: string[] = []
async function root() {
  const value = await realpath(await mkdtemp(join(tmpdir(), 'dsh-plugin-recovery-unit-')))
  roots.push(value)
  return value
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

it('releases an owned CLI mount once even when core validation fails before the recovery sequence', async () => {
  const path = await root()
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await once(child, 'close')
  if (child.pid === undefined) throw new Error('Fixture process did not start')
  const release = vi.fn(async () => ({ pids: [child.pid!], ports: [] }))
  const unused = async (): Promise<never> => { throw new Error('Driver must not run before core validation') }
  await expect(runPluginRecoverySmoke({ coreReceiptPath: join(path, 'missing-core.json'), fixtureRoot: path,
    cli: { executable: process.execPath, cliPath: '', env: {} },
    driver: { schemaVersion: 1, launch: unused, openRecovery: unused, confirmRestart: unused,
      waitForHost: unused, inventory: unused, continueConversation: unused, quit: unused },
    cliAppImageMount: { owner: { pid: child.pid, startTime: '1' }, release,
      observation: { appImage: '', appDir: join(path, 'unmounted'), executablePath: '', resourcesDirectory: '', appPath: '', mountInfo: '' } },
  })).rejects.toMatchObject({ code: 'ENOENT' })
  expect(release).toHaveBeenCalledOnce()
})

it('creates independent, dependency-free local Bundles with real Host activation probes', async () => {
  const path = await root()
  const f = await createPluginRecoveryFixtures(path)
  const a = JSON.parse(await readFile(join(f.a, 'package.json'), 'utf8')) as {
    name: string
    dependencies: Record<string, string>
    scripts?: unknown
    dsh: { bundle: { patch: string } }
  }
  const b = JSON.parse(await readFile(join(f.b, 'package.json'), 'utf8')) as { name: string }
  expect(a.name).not.toBe(b.name)
  expect(a.dependencies).toEqual({})
  expect(a.scripts).toBeUndefined()
  expect(a.dsh.bundle.patch).toBe('./cordis.patch.yml')
  expect(await readFile(join(f.a, 'index.js'), 'utf8')).toContain('ctx.effect')
  expect(await readFile(join(f.a, 'cordis.patch.yml'), 'utf8')).toContain('insert:')
  await expect(createPluginRecoveryFixtures(path)).rejects.toThrow()
})

it('rejects a linked fixture root without writing through it', async () => {
  const path = await root()
  const outside = join(path, 'outside')
  await mkdir(outside)
  const linked = join(path, 'linked')
  await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(createPluginRecoveryFixtures(linked)).rejects.toThrow(/physical/u)
  await expect(readFile(join(outside, 'bundle-a/package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('never promotes an intercepted native confirmation into formal native evidence', () => {
  expect(pluginRecoveryConfirmationStatus(['native-dialog-clicked'])).toBe('passed')
  expect(pluginRecoveryConfirmationStatus(['native-dialog-clicked', 'dialog-contract-intercepted'])).toBe('development-only')
  expect(() => pluginRecoveryConfirmationStatus([])).toThrow(/confirmation/u)
})

it('requires exclusion before manifest/YAML inputs as well as absent execution', () => {
  const receipt = { activeBundles: ['bundle-b'], excludedBundles: [{ name: 'bundle-a', reason: 'paused' }],
    observations: [{ name: 'bundle-b' }], inputs: [{ path: '/bundle-b/cordis.patch.yml' }] }
  expect(() =>{  verifyRecoveryExclusion(receipt, 'bundle-a', '/bundle-a', 2, 2) }).not.toThrow()
  expect(() =>{  verifyRecoveryExclusion({ ...receipt, inputs: [{ path: '/bundle-a/package.json' }] }, 'bundle-a', '/bundle-a', 2, 2) }).toThrow(/parsed/u)
  expect(() =>{  verifyRecoveryExclusion(receipt, 'bundle-a', '/bundle-a', 2, 3) }).toThrow(/executed/u)
  expect(() =>{  verifyRecoveryExclusion({ ...receipt, activeBundles: ['bundle-a'] }, 'bundle-a', '/bundle-a', 2, 2) }).toThrow(/excluded/u)
})

it('rejects an incomplete core receipt before invoking a platform driver or writing fixtures', async () => {
  const path = await root()
  const receipt = join(path, 'core.json')
  await writeFile(receipt, '{}')
  const launch = vi.fn()
  await expect(runPluginRecoverySmoke({ coreReceiptPath: receipt, fixtureRoot: path,
    cli: { executable: '/unused', cliPath: '/unused', env: {} },
    driver: { schemaVersion: 1, launch } as never })).rejects.toThrow(/core receipt/u)
  expect(launch).not.toHaveBeenCalled()
  await expect(readFile(join(path, 'bundle-a/package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses a fixture with transitive dependencies before invoking the public CLI', async () => {
  const path = await root()
  const fixture = await createPluginRecoveryFixtures(path)
  const manifest = JSON.parse(await readFile(join(fixture.a, 'package.json'), 'utf8')) as Record<string, unknown>
  manifest.dependencies = { 'should-not-download': '1.0.0' }
  await writeFile(join(fixture.a, 'package.json'), JSON.stringify(manifest))
  await expect(runRecoveryPluginCli({ executable: '/must-not-run', cliPath: '/must-not-run', env: {} },
    { fixtureRoot: path } as PluginRecoveryContext, ['add', `file:${fixture.a}`], join(path, 'cli.json')))
    .rejects.toThrow(/dependency-free/u)
  await expect(readFile(join(path, 'cli.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('never forwards removal of an adjacent Evolution or official Bundle', async () => {
  const path = await root()
  for (const name of ['dsh-missher-evolution', '@deepseek-ai/dsh-base']) {
    await expect(runRecoveryPluginCli({ executable: '/must-not-run', cliPath: '/must-not-run', env: {} },
      { fixtureRoot: path } as PluginRecoveryContext, ['remove', name], join(path, 'cli.json')))
      .rejects.toThrow(/owned local fixture/u)
  }
})
