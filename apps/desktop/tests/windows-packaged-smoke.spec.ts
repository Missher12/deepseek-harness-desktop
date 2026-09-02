import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'vitest'
import { runPackagedDesktopSmoke } from './packaged-smoke.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  ?? join(repositoryRoot, 'apps/desktop/release/win-unpacked/DeepSeek Harness.exe')

async function seedLegacyDesktopModuleFallback(): Promise<void> {
  const harnessHome = process.env.DSH_DESKTOP_SMOKE_DSH_HOME
  if (harnessHome === undefined) throw new Error('Windows packaged smoke requires an isolated DSH_HOME.')
  const packageName = '@deepseek-ai/dsh-desktop'
  const target = pathToFileURL(join(dirname(executable), 'resources', 'app.asar', 'lib', 'main.js')).href
  const targets = { '.': target }
  const linkPath = join(harnessHome, 'profiles', 'node_modules', packageName)
  await mkdir(linkPath, { recursive: true })
  await writeFile(join(linkPath, 'package.json'), JSON.stringify({
    name: packageName,
    version: '0.4.10',
    private: true,
    type: 'module',
    exports: { '.': './entry-0.js' },
    dsh: { moduleFallback: { targets } },
  }, undefined, 2) + '\n', 'utf8')
  const specifier = JSON.stringify(target)
  await writeFile(
    join(linkPath, 'entry-0.js'),
    `export * from ${specifier}\nimport * as target from ${specifier}\nexport default target.default\n`,
    'utf8',
  )
}

describe('packaged DeepSeek Harness desktop on Windows', () => {
  it.skipIf(process.platform !== 'win32' || !existsSync(executable))(
    'boots isolated data, renders the desktop shell, and closes its complete process tree',
    async () => {
      await seedLegacyDesktopModuleFallback()
      await runPackagedDesktopSmoke(executable, 'win32')
    },
    180_000,
  )
})
