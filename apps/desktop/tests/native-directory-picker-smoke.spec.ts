import { expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { withOwnedPickerAutomation } from './native-directory-picker-smoke.ts'

it.each(['action-failure', 'timeout', 'normal'])('drains an actual owned process after %s', async (mode) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'picker-owner-')))
  const path = join(root, 'pid')
  let pid: number | undefined
  try {
    const first = new Error('first native click failure')
    const action = async () => {
      const end = Date.now() + 3000
      while (pid === undefined) {
        try { pid = Number(await readFile(path, 'utf8')) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() >= end) throw error
          await delay(10)
        }
      }
      if (mode === 'action-failure') throw first
    }
    const running = withOwnedPickerAutomation(process.execPath, ['--input-type=module', '-e', `
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(path)}, String(process.pid));
      process.on('SIGTERM', () => {});
      ${mode === 'normal' ? '' : 'setInterval(() => {}, 1000);'}
    `], action, { executionMs: 1000, drainMs: 2000 })
    if (mode === 'normal') await running
    else await expect(running).rejects.toThrow(mode === 'action-failure' ? first : /timed out/)
    expect(pid).toBeDefined()
    expect(() => process.kill(pid!, 0)).toThrow()
  } finally {
    // Only this fixture's exact owned PID may be cleaned after an assertion failure.
    if (pid !== undefined) { try { process.kill(pid, 'SIGKILL') } catch { /* The successful path already proved it exited. */ } }
    await rm(root, { recursive: true, force: true })
  }
})
