import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('dsh-lark package contract', () => {
  test('is an independently installable web bundle using the official Lark SDK', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

    expect(manifest).toMatchObject({
      name: '@deepseek-ai/dsh-lark',
      version: '0.1.1-rc.2',
      license: 'MIT',
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web' },
      },
      dependencies: { '@larksuiteoapi/node-sdk': '^1.64.0' },
    })
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-settings')
    expect(JSON.stringify(manifest).toLowerCase()).not.toContain('openclaw')
  })

  test('contributes exactly one removable lark service row', async () => {
    const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')

    expect(patch.match(/\n\s*- id:/g)).toHaveLength(1)
    expect(patch).toContain('id: lark')
    expect(patch).toContain("name: '@deepseek-ai/dsh-lark'")
  })
})
