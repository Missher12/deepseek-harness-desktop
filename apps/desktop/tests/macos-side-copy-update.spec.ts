import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runMacosSideCopyUpdate, type MacosSideCopyAdapter } from './macos-side-copy-update.ts'

const owned: string[] = []
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

async function sources() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-mac-source-test-')))
  owned.push(root)
  const oldApp = join(root, 'DeepSeek Harness.app')
  const modules = join(oldApp, 'Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai')
  await mkdir(modules, { recursive: true })
  for (const name of ['dsh-base', 'dsh-web-app']) {
    await mkdir(join(modules, name))
    await writeFile(join(modules, name, 'package.json'), JSON.stringify({
      name: `@deepseek-ai/${name}`, version: '0.1.3-alpha.1', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    await writeFile(join(modules, name, 'cordis.patch.yml'), '[]\n')
  }
  await writeFile(join(oldApp, 'Contents/Resources/app.asar'), 'synthetic-old-asar')
  const dmg = join(root, 'candidate.dmg')
  await writeFile(dmg, 'synthetic-dmg')
  const evolutionArchive = join(root, 'evolution.tgz')
  await writeFile(evolutionArchive, 'synthetic-archive-not-executable')
  const evolutionPackage = join(root, 'evolution-package')
  await mkdir(evolutionPackage)
  await writeFile(join(evolutionPackage, 'package.json'), JSON.stringify({
    name: 'dsh-missher-evolution', version: '0.7.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(join(evolutionPackage, 'cordis.patch.yml'), '[]\n')
  return { oldApp, oldAsarSha256: hash('synthetic-old-asar'), targetDmg: dmg,
    targetDmgSha256: hash('synthetic-dmg'), finalSourceSha: 'a'.repeat(40),
    evolutionPackage, evolutionArchive, evolutionArchiveSha256: hash('synthetic-archive-not-executable'),
    sessionSeeds: [{ relativePath: 'sessions/example/session.v2.jsonl', content: Buffer.from('synthetic-history\n') }],
  }
}

function adapter(overrides: Partial<MacosSideCopyAdapter> = {}): MacosSideCopyAdapter {
  return {
    async upgrade(scope) { owned.push(scope.root) },
    async verifyReady() {},
    async stopAndVerify() {},
    ...overrides,
  }
}

afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true }) })

describe('macOS side-copy driver (offline adapter only)', () => {
  it('seeds the old ordered profile and links only to the disposable old app', async () => {
    const input = await sources()
    const result = await runMacosSideCopyUpdate(input, adapter({ async upgrade(scope) {
      owned.push(scope.root)
      const profile: unknown = JSON.parse(await readFile(join(scope.fixture.dshHome, 'profiles/web/package.json'), 'utf8'))
      expect(profile).toMatchObject({
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-missher-evolution'] } },
        dependencies: { 'dsh-missher-evolution': `file:${scope.fixture.evolutionArchive}` },
      })
      expect(await realpath(join(scope.fixture.dshHome, 'profiles/node_modules/@deepseek-ai')))
        .toBe(join(scope.currentApp, 'Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai'))
      expect(scope.currentApp).not.toBe(input.oldApp)
    } }))
    expect(result.outcome).toBe('adapter-completed')
    expect(result.nativeAcceptance).toBe(false)
    expect(result.protectedDataUnchanged).toBe(true)
    expect(await readFile(join(input.oldApp, 'Contents/Resources/app.asar'), 'utf8')).toBe('synthetic-old-asar')
  })

  it('rejects changed source bytes before invoking an update adapter', async () => {
    const input = await sources()
    await writeFile(input.targetDmg, 'wrong')
    let invoked = false
    await expect(runMacosSideCopyUpdate(input, adapter({ async upgrade() { invoked = true } })))
      .rejects.toThrow('SHA-256 mismatch')
    expect(invoked).toBe(false)
  })

  it('rejects an escaping bundle link before copying or launching', async () => {
    const input = await sources()
    await symlink('/Applications', join(input.oldApp, 'external'))
    await expect(runMacosSideCopyUpdate(input, adapter())).rejects.toThrow('outside source tree')
  })

  it('rejects absolute internal links that would still point into the source after copying', async () => {
    const input = await sources()
    await symlink(join(input.oldApp, 'Contents'), join(input.oldApp, 'absolute-internal'))
    await expect(runMacosSideCopyUpdate(input, adapter())).rejects.toThrow('absolute bundle link')
  })

  it('keeps relative bundle links inside the copy', async () => {
    const input = await sources()
    await symlink('Contents', join(input.oldApp, 'relative-internal'))
    const result = await runMacosSideCopyUpdate(input, adapter({ async upgrade(scope) {
      owned.push(scope.root)
      expect(await realpath(join(scope.currentApp, 'relative-internal'))).toBe(join(scope.currentApp, 'Contents'))
    } }))
    expect(result.outcome).toBe('adapter-completed')
  })

  it('detects source mutation separately from preserved fixture data', async () => {
    const input = await sources()
    const result = await runMacosSideCopyUpdate(input, adapter({ async upgrade(scope) {
      owned.push(scope.root)
      await writeFile(input.targetDmg, 'source changed during adapter')
    } }))
    expect(result.outcome).toBe('failed')
    expect(result.protectedDataUnchanged).toBe(true)
    expect(result.failures.map(f => f.stage)).toEqual(['sources'])
  })

  it('rejects traversal in a synthetic session path before launching', async () => {
    const input = await sources()
    input.sessionSeeds[0]!.relativePath = '../outside.jsonl'
    await expect(runMacosSideCopyUpdate(input, adapter())).rejects.toThrow('Session seed path')
  })

  it('records ready failure and still awaits quiescent shutdown', async () => {
    const input = await sources()
    let stopped = false
    const result = await runMacosSideCopyUpdate(input, adapter({
      async verifyReady() { throw new Error('wrong restart home') },
      async stopAndVerify() { await Promise.resolve(); stopped = true },
    }))
    expect(stopped).toBe(true)
    expect(result.outcome).toBe('failed')
    expect(result.failures).toEqual([{ stage: 'ready', message: 'wrong restart home' }])
    expect(result.protectedDataUnchanged).toBe(true)
  })

  it('records data corruption and cleanup failure independently of upgrade failure', async () => {
    const input = await sources()
    const result = await runMacosSideCopyUpdate(input, adapter({ async upgrade(scope) {
      owned.push(scope.root)
      await writeFile(join(scope.fixture.dshHome, 'sessions/example/session.v2.jsonl'), 'corrupted')
      throw new Error('update rejected')
    }, async stopAndVerify() { throw new Error('owned process remains') } }))
    expect(result.outcome).toBe('failed')
    expect(result.protectedDataUnchanged).toBe(false)
    expect(result.failures.map(f => f.stage)).toEqual(['upgrade', 'cleanup', 'preservation'])
    const saved: unknown = JSON.parse(await readFile(result.reportPath, 'utf8'))
    expect(saved).toMatchObject({ protectedDataUnchanged: false })
  })

  it('does not write evidence through a redirected run root', async () => {
    const input = await sources()
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'dsh-mac-outside-test-')))
    owned.push(outside)
    await expect(runMacosSideCopyUpdate(input, adapter({ async upgrade(scope) {
      owned.push(scope.root)
      await rm(scope.root, { recursive: true })
      await symlink(outside, scope.root, 'dir')
    } }))).rejects.toThrow('Private run root changed')
    await expect(readFile(join(outside, 'side-copy-result.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('allows only explicitly declared new generation paths while keeping old bytes', async () => {
    const input = await sources()
    const result = await runMacosSideCopyUpdate({ ...input,
      allowedNewProtectedPaths: ['home/.dsh/sessions/example/session.v3.jsonl'],
    }, adapter({ async upgrade(scope) {
      owned.push(scope.root)
      await writeFile(join(scope.fixture.dshHome, 'sessions/example/session.v3.jsonl'), 'synthetic-successor\n')
    } }))
    expect(result.outcome).toBe('adapter-completed')
    expect(result.protectedDataUnchanged).toBe(true)
    const saved: unknown = JSON.parse(await readFile(result.reportPath, 'utf8'))
    expect(saved).toMatchObject({ addedProtectedPaths: ['home/.dsh/sessions/example/session.v3.jsonl'] })
  })

  it('rejects an ordinary new protected file that was not declared', async () => {
    const input = await sources()
    const result = await runMacosSideCopyUpdate(input, adapter({ async upgrade(scope) {
      owned.push(scope.root)
      await writeFile(join(scope.fixture.outputs, 'unexpected.txt'), 'unapproved output')
    } }))
    expect(result.outcome).toBe('failed')
    expect(result.protectedDataUnchanged).toBe(false)
    expect(result.failures).toEqual([{ stage: 'preservation', message: 'Protected synthetic data changed.' }])
  })

  it('detects added files in protected data and refuses symlink replacements', async () => {
    const input = await sources()
    const result = await runMacosSideCopyUpdate(input, adapter({ async upgrade(scope) {
      owned.push(scope.root)
      await writeFile(join(scope.fixture.outputs, 'unexpected.txt'), 'added')
      await rm(join(scope.fixture.dshHome, 'sessions/example/session.v2.jsonl'))
      await symlink(input.targetDmg, join(scope.fixture.dshHome, 'sessions/example/session.v2.jsonl'))
    } }))
    expect(result.outcome).toBe('failed')
    expect(result.protectedDataUnchanged).toBe(false)
    expect(result.failures.some(f => f.stage === 'preservation')).toBe(true)
  })
})
