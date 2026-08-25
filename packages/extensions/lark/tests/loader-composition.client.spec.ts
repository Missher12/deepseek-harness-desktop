import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as LarkHost from '../src/index.ts'
import * as LarkClient from '../src/client/index.tsx'
import * as LarkInvariant from '../src/invariant.ts'

const repositoryRoot = new URL('../../../..', import.meta.url)

describe('dsh-lark removable bundle composition', () => {
  it('exports one Host, Client, and invariant face behind one removable Loader row', async () => {
    expect(LarkHost.name).toBe('lark')
    expect(typeof LarkHost.apply).toBe('function')
    expect(LarkClient.name).toBe('lark-client')
    expect(typeof LarkClient.apply).toBe('function')
    expect(LarkInvariant.name).toBe('lark-invariant')
    expect(typeof LarkInvariant.apply).toBe('function')

    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch.match(/\n\s*- id:/g)).toHaveLength(1)
    expect(patch).toContain('id: lark')
    expect(patch).toContain("name: '@deepseek-ai/dsh-lark'")
  })

  it('ships complete package exports and stays out of the Desktop default layer', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, unknown>
      files: string[]
    }
    expect(Object.keys(manifest.exports)).toEqual(expect.arrayContaining(['.', './client', './invariant']))
    expect(manifest.files).toEqual(expect.arrayContaining([
      'lib/index.js', 'lib/client.js', 'lib/invariant.js', 'cordis.patch.yml',
    ]))
    await Promise.all([
      'lib/index.js', 'lib/client.js', 'lib/invariant.js',
      'README.md', 'README.zh.md', 'LICENSE',
    ]
      .map(path => access(new URL(`../${path}`, import.meta.url))))

    const desktopPatch = await readFile(new URL('apps/desktop/desktop.cordis.patch.yml', repositoryRoot), 'utf8')
    const desktopManifest = await readFile(new URL('apps/desktop/package.json', repositoryRoot), 'utf8')
    expect(desktopPatch).not.toContain('@deepseek-ai/dsh-lark')
    expect(desktopManifest).not.toContain('@deepseek-ai/dsh-lark')
  })
})
