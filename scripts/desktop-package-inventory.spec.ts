import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertBrowserSkillBinary,
  assertDesktopPackageInventoryPolicy,
  assertManagedPackageRootsArePhysical,
  createDesktopPackageInventory,
} from './desktop-package-inventory.ts'

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

  it('rejects non-Windows-x64 native assets, build artifacts, and unapproved Electron locales', () => {
    const forbidden = [
      'locales/fr.pak',
      'resources/app.asar.unpacked/node_modules/pkg/debug/addon.pdb',
      'resources/app.asar.unpacked/node_modules/pkg/lib/index.js.map',
      'resources/app.asar.unpacked/node_modules/pkg/lib/index.d.ts',
      'resources/app.asar.unpacked/node_modules/pkg/lib/index.d.cts',
      'resources/app.asar.unpacked/node_modules/pkg/lib/index.d.mts',
      'resources/app.asar.unpacked/node_modules/pkg/tsconfig.tsbuildinfo',
      'resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-x64/pty.node',
      'resources/app.asar.unpacked/node_modules/@napi-rs/canvas-linux-x64-gnu/skia.node',
      'resources/app.asar.unpacked/node_modules/@img/sharp-darwin-x64/lib/sharp.node',
      'resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-arm64/koffi.node',
      'resources/app.asar.unpacked/node_modules/node-addon-require-builtin-win32-ia32-msvc/addon.node',
    ]

    for (const path of forbidden) {
      expect(() => {
        assertDesktopPackageInventoryPolicy({ files: [{ path }] }, 'windows-x64')
      }, path).toThrow(/Windows x64 package policy/u)
    }
  })

  it('keeps the Windows x64 runtime, confirmed locales, licenses, fonts, workers, and WASM', () => {
    const paths = [
      'locales/en-US.pak',
      'locales/zh-CN.pak',
      'LICENSE.electron.txt',
      'resources/app.asar',
      'resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-attachment-local/lib/pdf-worker.cjs',
      'resources/app.asar.unpacked/node_modules/node-pty/prebuilds/win32-x64/pty.node',
      'resources/app.asar.unpacked/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.node',
      'resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/sharp.node',
      'resources/app.asar.unpacked/node_modules/@img/sharp-wasm32/lib/sharp-wasm32.node.wasm',
      'resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/koffi.node',
      'resources/app.asar.unpacked/node_modules/node-addon-require-builtin-win32-x64-msvc/addon.node',
      'resources/app.asar.unpacked/node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb',
      'resources/app.asar.unpacked/node_modules/pdfjs-dist/wasm/openjpeg.wasm',
      'resources/app.asar.unpacked/node_modules/pkg/lib/worker.js',
      'resources/browser-skill/bin/bsk.exe',
    ]

    expect(() => {
      assertDesktopPackageInventoryPolicy({ files: paths.map(path => ({ path })) }, 'windows-x64')
    }).not.toThrow()
  })

  it('fails closed if pruning removes an offline renderer, license, worker, font, or WASM asset', () => {
    const preserved = [
      'resources/app.asar',
      'THIRD_PARTY_NOTICES.md',
      'resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-attachment-local/lib/pdf-worker.cjs',
      'resources/app.asar.unpacked/node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb',
      'resources/app.asar.unpacked/node_modules/pdfjs-dist/wasm/openjpeg.wasm',
    ]
    const required = [...preserved, 'resources/browser-skill/bin/bsk.exe']
    for (const removed of preserved) {
      expect(() => {
        assertDesktopPackageInventoryPolicy({
          files: required.filter(path => path !== removed).map(path => ({ path })),
        }, 'windows-x64')
      }, removed).toThrow(/missing preserved runtime assets/u)
    }
    expect(() => {
      assertDesktopPackageInventoryPolicy({
        files: required.filter(path => path !== 'resources/browser-skill/bin/bsk.exe').map(path => ({ path })),
      }, 'windows-x64')
    }).toThrow(/missing the win32-x64 BrowserSkill CLI/u)
  })

  it('requires exactly one declared BrowserSkill CLI and rejects stray or foreign members', () => {
    const withExe = { files: [{ path: 'resources/app.asar' }, { path: 'resources/browser-skill/bin/bsk.exe' }] }
    expect(() => assertBrowserSkillBinary(withExe, 'win32-x64')).not.toThrow()
    expect(() => assertBrowserSkillBinary(withExe, 'darwin-x64')).toThrow(/missing the darwin-x64 BrowserSkill CLI/u)

    const withBs = { files: [{ path: 'resources/app.asar' }, { path: 'resources/browser-skill/bin/bsk' }] }
    expect(() => assertBrowserSkillBinary(withBs, 'darwin-x64')).not.toThrow()
    expect(() => assertBrowserSkillBinary(withBs, 'win32-x64')).toThrow(/missing the win32-x64 BrowserSkill CLI/u)

    expect(() => assertBrowserSkillBinary({ files: [] }, 'darwin-x64')).toThrow(/missing the darwin-x64 BrowserSkill CLI/u)
    expect(() => assertBrowserSkillBinary({
      files: [
        { path: 'resources/browser-skill/bin/bsk.exe' },
        { path: 'resources/browser-skill/bin/bsk' },
      ],
    }, 'win32-x64')).toThrow(/unexpected browser-skill files.*bsk$/u)
    expect(() => assertBrowserSkillBinary({
      files: [
        { path: 'resources/browser-skill/bin/bsk.exe' },
        { path: 'resources/browser-skill/bin/shim.dll' },
      ],
    }, 'win32-x64')).toThrow(/unexpected browser-skill files.*shim\.dll$/u)
  })

  it('requires every managed package root to remain physical under app.asar.unpacked', () => {
    const physical = {
      files: [
        { path: 'resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh/package.json' },
        { path: 'resources/app.asar.unpacked/node_modules/dshmarket/package.json' },
      ],
    }
    expect(() => {
      assertManagedPackageRootsArePhysical(physical, ['@deepseek-ai/dsh', 'dshmarket'])
    }).not.toThrow()
    expect(() => {
      assertManagedPackageRootsArePhysical(physical, ['@deepseek-ai/dsh', 'missing-runtime'])
    }).toThrow(/missing-runtime.*app\.asar\.unpacked/u)
  })
})
