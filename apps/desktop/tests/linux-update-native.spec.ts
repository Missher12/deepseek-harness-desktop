import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probeLinuxNoReplace, renameLinuxNoReplace } from '../src/update/linux-appimage-replace.ts'
import { readLinuxParentStartTime } from '../src/update/linux-update-helper.ts'

// Native syscall and /proc evidence only; these checks do not install a package or prove polkit/GUI acceptance.
describe.skipIf(process.platform !== 'linux')('native Linux update primitives', () => {
  it('moves the real inode only into an absent destination on the current filesystem', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-native-update-')))
    try {
      await probeLinuxNoReplace(root)
      const source = join(root, 'source with spaces'), target = join(root, 'target')
      await writeFile(source, 'candidate', { mode: 0o600 }); await writeFile(target, 'external', { mode: 0o600 })
      await expect(renameLinuxNoReplace(source, target)).rejects.toThrow('errno=17')
      expect(await readFile(source, 'utf8')).toBe('candidate')
      expect(await readFile(target, 'utf8')).toBe('external')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('reads the current process start identity from the actual kernel', async () => {
    expect(await readLinuxParentStartTime(process.pid)).toMatch(/^\d+$/)
  })
})
