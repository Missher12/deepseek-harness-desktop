import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
  it.each([
    ['win32-x64-nsis', 'win32', 'nsis', 'DeepSeek-Harness-Setup-0.5.7-win-x64.exe', 'deepseek-harness-desktop-update-win-x64.json'],
    ['linux-x64-deb', 'linux', 'deb', 'DeepSeek-Harness-0.5.7-linux-x64.deb', 'deepseek-harness-desktop-update-linux-x64-deb.json'],
    ['linux-x64-appimage', 'linux', 'appimage', 'DeepSeek-Harness-0.5.7-linux-x64.AppImage', 'deepseek-harness-desktop-update-linux-x64-appimage.json'],
  ])('generates only the explicitly selected %s manifest and preserves Mac bytes', (target, platform, packageFormat, assetName, manifestName) => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-update-target-'))
    directories.push(directory)
    const payload = Buffer.from('physical accepted candidate payload')
    const input = join(directory, assetName)
    const output = join(directory, manifestName)
    const mac = join(directory, 'deepseek-harness-desktop-update.json')
    writeFileSync(input, payload)
    writeFileSync(mac, 'existing Mac manifest\n')
    const result = generate([input, output, '0.5.7', '0.1.3-alpha.1', 'desktop-v0.5.7', '--target', target])
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
      schema: 2, desktopVersion: '0.5.7', harnessVersion: '0.1.3-alpha.1',
      platform, arch: 'x64', packageFormat, assetName, bytes: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
      releaseUrl: 'https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v0.5.7',
    })
    expect(readFileSync(mac, 'utf8')).toBe('existing Mac manifest\n')
    const foreignOutput = generate([input, mac, '0.5.7', '0.1.3-alpha.1', 'desktop-v0.5.7', '--target', target])
    expect(foreignOutput.status).not.toBe(0)
    expect(readFileSync(mac, 'utf8')).toBe('existing Mac manifest\n')
  })

  it('rejects a symlink input without creating a manifest', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-update-link-'))
    directories.push(directory)
    const physical = join(directory, 'physical.dmg')
    const input = join(directory, 'DeepSeek-Harness-0.2.0-mac-x64.dmg')
    const output = join(directory, 'deepseek-harness-desktop-update.json')
    writeFileSync(physical, 'retained payload')
    symlinkSync(physical, input)
    expect(generate([input, output, '0.2.0', '0.1.0-rc.8', 'desktop-v0.2.0']).status).not.toBe(0)
    expect(existsSync(output)).toBe(false)
    expect(readFileSync(physical, 'utf8')).toBe('retained payload')
  })

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

function generate(args: string[]) {
  return spawnSync(process.execPath, [
    resolve(root, 'node_modules/tsx/dist/cli.mjs'),
    resolve(root, 'scripts/create-desktop-update-manifest.ts'), ...args,
  ], { cwd: root, encoding: 'utf8', shell: false, timeout: 10_000 })
}
