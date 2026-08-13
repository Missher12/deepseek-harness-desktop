import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'vitest'
import { runPackagedDesktopSmoke } from './packaged-smoke.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const executable = process.env.DSH_WINDOWS_DESKTOP_EXECUTABLE
  ?? join(repositoryRoot, 'apps/desktop/release/win-unpacked/DeepSeek Harness.exe')

describe('packaged DeepSeek Harness desktop on Windows', () => {
  it.skipIf(process.platform !== 'win32' || !existsSync(executable))(
    'boots isolated data, renders the desktop shell, and closes its complete process tree',
    async () => runPackagedDesktopSmoke(executable, 'win32'),
    180_000,
  )
})
