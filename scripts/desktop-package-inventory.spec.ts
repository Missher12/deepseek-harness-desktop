import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopPackageInventory } from './desktop-package-inventory.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { force: true, recursive: true }) }))
})

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, ...relativePath.split('/'))
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

describe('desktop package inventory', () => {
  it('records portable file evidence and classifies the staged or installed tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-package-inventory-'))
    roots.push(root)
    await write(root, 'DeepSeek Harness.exe', 'runtime')
    await write(root, 'resources/app.asar', 'asar')
    await write(root, 'resources/app.asar.unpacked/node_modules/pkg/prebuilds/win32-x64/addon.node', 'native')
    await write(root, 'locales/zh-CN.pak', 'locale')
    await write(root, 'LICENSE.electron.txt', 'license')
    await write(root, 'resources/renderer-worker.js', 'other')

    const inventory = await createDesktopPackageInventory(root)

    expect(inventory.files.map(file => [file.path, file.category])).toEqual([
      ['DeepSeek Harness.exe', 'electron-runtime'],
      ['LICENSE.electron.txt', 'licenses'],
      ['locales/zh-CN.pak', 'locales'],
      ['resources/app.asar', 'app.asar'],
      ['resources/app.asar.unpacked/node_modules/pkg/prebuilds/win32-x64/addon.node', 'native-prebuilds'],
      ['resources/renderer-worker.js', 'other'],
    ])
    const asar = inventory.files.find(file => file.path === 'resources/app.asar')
    expect(asar).toEqual({
      path: 'resources/app.asar',
      bytes: 4,
      category: 'app.asar',
      sha256: createHash('sha256').update('asar').digest('hex'),
    })
    expect(inventory.totalBytes).toBe(inventory.files.reduce((total, file) => total + file.bytes, 0))
    expect(inventory.categories['native-prebuilds']).toEqual({ bytes: 6, files: 1 })
    expect(inventory.largestFiles[0]).toMatchObject({ path: 'DeepSeek Harness.exe', bytes: 7 })
  })

  it('never follows a symlink whose resolved target escapes the inventory root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-package-inventory-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-package-inventory-outside-'))
    roots.push(root, outside)
    await write(outside, 'secret.txt', 'must-not-be-read')
    await symlink(outside, join(root, 'external'))

    const inventory = await createDesktopPackageInventory(root)

    expect(inventory.files).toEqual([])
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('must-not-be-read')
  })
})
