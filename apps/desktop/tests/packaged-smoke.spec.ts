import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'vitest'
import { runPackagedDesktopSmoke } from './packaged-smoke.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const application = join(repositoryRoot, 'apps/desktop/release/mac/DeepSeek Harness.app')
const executable = join(application, 'Contents/MacOS/DeepSeek Harness')

describe('packaged DeepSeek Harness desktop on macOS', () => {
  it.skipIf(process.platform !== 'darwin' || !existsSync(executable))(
    'boots isolated data, renders the desktop shell, and shuts down its process tree',
    async () => runPackagedDesktopSmoke(executable, 'darwin'),
    180_000,
  )
})
