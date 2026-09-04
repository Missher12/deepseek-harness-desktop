import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readDesktopIntegrations } from '../src/integrations.ts'

const roots: string[] = []

async function fixture(manifest: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-integrations-'))
  roots.push(root)
  const profile = join(root, 'profiles', 'open-design')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest), 'utf8')
  return root
}

function officialManifest(): unknown {
  return {
    name: 'dsh-profile-open-design',
    dependencies: {
      '@open-design/dsh-runtime': 'file:.open-design/8412c8a48eb69e7e71aa02cfd6058f3b2d64a51b30097cfc30f553c43962226a.tgz',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@open-design/dsh-runtime'] } },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Desktop integration inventory', () => {
  it('recognizes only the official Open Design plugin profile and returns no filesystem data', async () => {
    const root = await fixture(officialManifest())

    const snapshot = await readDesktopIntegrations(root)

    expect(snapshot).toEqual({ openDesign: { state: 'installed', profile: 'open-design' } })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.openDesign)).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain(root)
    expect(JSON.stringify(snapshot)).not.toContain('.open-design/')
  })

  it('reports a missing profile without creating it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-integrations-missing-'))
    roots.push(root)

    await expect(readDesktopIntegrations(root)).resolves.toEqual({
      openDesign: { state: 'missing', profile: 'open-design' },
    })
  })

  it.each([
    { ...officialManifest() as object, name: 'lookalike' },
    {
      name: 'dsh-profile-open-design',
      dependencies: { '@open-design/dsh-runtime': 'https://example.invalid/foreign.tgz' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@open-design/dsh-runtime'] } },
    },
    {
      name: 'dsh-profile-open-design',
      dependencies: { '@open-design/dsh-runtime': 'file:.open-design/8412c8a48eb69e7e71aa02cfd6058f3b2d64a51b30097cfc30f553c43962226a.tgz' },
      dsh: { profile: { bundles: ['@open-design/dsh-runtime', '@deepseek-ai/dsh-base'] } },
    },
    { name: 'dsh-profile-open-design', dependencies: {}, dsh: { profile: { bundles: [] } } },
  ])('fails closed for foreign or malformed profile manifests', async (manifest) => {
    const root = await fixture(manifest)
    await expect(readDesktopIntegrations(root)).resolves.toEqual({
      openDesign: { state: 'missing', profile: 'open-design' },
    })
  })
})
