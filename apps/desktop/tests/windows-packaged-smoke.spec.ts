import { existsSync } from 'node:fs'
import { readlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPackagedDesktopSmoke } from './packaged-smoke.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  ?? join(repositoryRoot, 'apps/desktop/release/win-unpacked/DeepSeek Harness.exe')

function isolatedHarnessHome(): string {
  const harnessHome = process.env.DSH_DESKTOP_SMOKE_DSH_HOME
  if (harnessHome === undefined) throw new Error('Windows packaged smoke requires an isolated DSH_HOME.')
  return harnessHome
}

describe('packaged DeepSeek Harness desktop on Windows', () => {
  it.skipIf(process.platform !== 'win32' || !existsSync(executable))(
    'boots isolated data, renders the desktop shell, and closes its complete process tree',
    async () => {
      await runPackagedDesktopSmoke(executable, 'win32')
      const link = join(
        isolatedHarnessHome(),
        'profiles',
        'node_modules',
        '@deepseek-ai',
        'dsh-desktop',
      )
      expect(resolve(await readlink(link))).toBe(resolve(dirname(executable), 'resources', 'app.asar'))
    },
    180_000,
  )
})
