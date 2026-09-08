import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const installLauncher = require('../apps/desktop/build/linux/after-pack.cjs') as (
  context: { electronPlatformName: string; appOutDir: string },
) => Promise<void>

describe.skipIf(process.platform === 'win32')('Linux packaged entry', () => {
  it('preserves arguments and refuses AppRun sandbox downgrades before exec', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh Linux launcher '))
    try {
      const launcher = join(root, 'deepseek-harness')
      await writeFile(launcher, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n')
      await chmod(launcher, 0o755)
      await installLauncher({ electronPlatformName: 'linux', appOutDir: root })
      for (const flag of ['--no-sandbox', '--no-sandbox=true', '--disable-namespace-sandbox']) {
        const rejected = spawnSync(launcher, [flag], { encoding: 'utf8', timeout: 5_000 })
        expect(rejected.signal).toBeNull()
        expect(rejected.status).toBe(78)
        expect(rejected.stdout).toBe('')
        expect(rejected.stderr).toContain('requires the Chromium sandbox')
      }
      const accepted = spawnSync(launcher, ['argument with spaces'], { encoding: 'utf8', timeout: 5_000 })
      expect(accepted.signal).toBeNull()
      expect(accepted.status).toBe(0)
      expect(accepted.stdout).toBe('argument with spaces\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('refuses invocation for another platform', async () => {
    await expect(installLauncher({ electronPlatformName: 'darwin', appOutDir: '/unused' })).rejects.toThrow('Linux package')
  })
})
