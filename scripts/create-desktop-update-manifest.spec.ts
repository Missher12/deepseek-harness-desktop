import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe('Desktop update manifest generator', () => {
  it('binds one release manifest to the exact DMG bytes and fixed public release URL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-update-manifest-'))
    directories.push(directory)
    const assetName = 'DeepSeek-Harness-0.2.0-mac-x64.dmg'
    const dmg = join(directory, assetName)
    const output = join(directory, 'deepseek-harness-desktop-update.json')
    const payload = Buffer.from('verified dmg fixture')
    writeFileSync(dmg, payload)

    const result = spawnSync(process.execPath, [
      resolve(root, 'node_modules/tsx/dist/cli.mjs'),
      resolve(root, 'scripts/create-desktop-update-manifest.ts'),
      dmg,
      output,
      '0.2.0',
      '0.1.0-rc.8',
      'desktop-v0.2.0',
    ], { cwd: root, encoding: 'utf8', shell: false })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
      schema: 1,
      desktopVersion: '0.2.0',
      harnessVersion: '0.1.0-rc.8',
      platform: 'darwin',
      arch: 'x64',
      assetName,
      bytes: payload.byteLength,
      sha256: createHash('sha256').update(payload).digest('hex'),
      releaseUrl: 'https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v0.2.0',
    })
  })
})
